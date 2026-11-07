// Bundle the Pi worker into the same office build that the desktop stages.
// It carries its runtime dependencies and their license notices with it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const office = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(join(office, 'build'), { recursive: true });
const bundle = await rolldown({
  input: join(office, 'src/lib/server/pi-worker.ts'),
  platform: 'node',
  onLog(level, log, handler) {
    if (log.code === 'UNRESOLVED_IMPORT') throw new Error(log.message);
    handler(level, log);
  }
});
try {
  const result = await bundle.write({
    file: join(office, 'build/pi-worker.cjs'),
    format: 'cjs',
    codeSplitting: false
  });
  const packages = new Map<
    string,
    { name: string; version: string; license: string; notices: string[] }
  >();
  for (const chunk of result.output) {
    if (chunk.type !== 'chunk') continue;
    for (const id of Object.keys(chunk.modules)) {
      const marker = `${sep}node_modules${sep}`;
      const at = id.lastIndexOf(marker);
      if (at < 0) continue;
      const rest = id.slice(at + marker.length).split(sep);
      const parts = rest[0].startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1);
      const dir = resolve(id.slice(0, at + marker.length), ...parts);
      const file = join(dir, 'package.json');
      if (!existsSync(file)) throw new Error(`Missing package metadata for ${parts.join('/')}`);
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
        name: string;
        version: string;
        license?: string;
      };
      const key = `${pkg.name}@${pkg.version}`;
      if (packages.has(key)) continue;
      const notices: string[] = [];
      const collect = (folder: string) => {
        for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
          a.name.localeCompare(b.name)
        )) {
          const path = join(folder, entry.name);
          if (entry.isDirectory()) collect(path);
          else if (entry.isFile()) notices.push(readFileSync(path, 'utf8'));
        }
      };
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name)
      )) {
        if (!/^(license|licence|licenses|licences|notice)(\.|$)/i.test(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) collect(path);
        else if (entry.isFile()) notices.push(readFileSync(path, 'utf8'));
      }
      if (pkg.name.startsWith('@earendil-works/'))
        notices.unshift(readFileSync(join(office, 'licenses/pi-LICENSE'), 'utf8'));
      if (!pkg.license || !notices.length) throw new Error(`Missing license notice for ${key}`);
      packages.set(key, { name: pkg.name, version: pkg.version, license: pkg.license, notices });
    }
  }
  const notices =
    JSON.stringify(
      [...packages.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
      ),
      null,
      2
    ) + '\n';
  for (const name of [
    '@earendil-works/pi-agent-core@1.5.0',
    '@earendil-works/pi-ai@1.5.0',
    '@modelcontextprotocol/sdk@1.32.2'
  ])
    if (!packages.has(name)) throw new Error(`Worker bundle does not contain ${name}`);
  writeFileSync(join(office, 'build/pi-worker-licenses.json'), notices);
  const worker = readFileSync(join(office, 'build/pi-worker.cjs'));
  const sha256 = (v: Uint8Array | string) => createHash('sha256').update(v).digest('hex');
  writeFileSync(
    join(office, 'build/pi-worker-integrity.json'),
    JSON.stringify(
      {
        version: 1,
        workerSha256: sha256(worker),
        licensesSha256: sha256(notices)
      },
      null,
      2
    ) + '\n'
  );
} finally {
  await bundle.close();
}
