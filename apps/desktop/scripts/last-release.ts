// The release installed apps have now, downloaded for this machine, so the
// smoke test can install a build over it (`smoke.ts --previous-from`). It is
// the one the updater's own `latest.json` names (`tauri.conf.json`'s
// endpoint), the file an owner on this machine installed: the installer on
// Windows, the AppImage on Linux, and on a Mac the `.dmg` beside the updater's
// archive.
//
//   node apps/desktop/scripts/last-release.ts <folder>
//
// Prints the version. On GitHub Actions it sets PREVIOUS_VERSION for the
// job's later steps.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..');

const folder = process.argv[2];
if (!folder) throw new Error('Say where to put it: last-release.ts <folder>');

const conf = JSON.parse(readFileSync(join(DESKTOP, 'src-tauri', 'tauri.conf.json'), 'utf8')) as {
  plugins: { updater: { endpoints: string[] } };
};
const endpoint = conf.plugins.updater.endpoints[0];

async function get(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(300_000) }).catch((e: unknown) => e);
    if (r instanceof Response && r.ok) return r;
    if (attempt === 3) throw new Error(`${url}: ${r instanceof Response ? r.status : String(r)}`);
    await new Promise((done) => setTimeout(done, 10_000));
  }
}

const latest = (await (await get(endpoint)).json()) as {
  version: string;
  platforms: Record<string, { url: string }>;
};
const system = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform as string];
const platform = `${system}-${arch() === 'arm64' ? 'aarch64' : 'x86_64'}`;
const found = latest.platforms[platform];
if (!found) throw new Error(`${latest.version} has no build for ${platform}`);
const url = found.url.replace(/\.app\.tar\.gz$/, '.dmg');
const file = join(folder, url.split('/').pop()!);

mkdirSync(folder, { recursive: true });
writeFileSync(file, Buffer.from(await (await get(url)).arrayBuffer()));
if (process.env.GITHUB_ENV)
  appendFileSync(process.env.GITHUB_ENV, `PREVIOUS_VERSION=${latest.version}\n`);
console.log(`${latest.version}: ${file}`);
