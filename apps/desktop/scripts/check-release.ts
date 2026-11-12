// The draft job's gate on what the five builds uploaded (0.0.6 shipped the
// 0.0.5 Windows installer, #40). The draft uploads only the files it lists.
//
//   node apps/desktop/scripts/check-release.ts --version 0.0.9 --dir built \
//     --url https://github.com/New-Altitude/Oddboro/releases/download/v0.0.9 \
//     --latest latest.json --assets assets.txt
import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MB = 1024 * 1024;

export interface Build {
  folder: string;
  platform: string;
  /** What the updater downloads. */
  payload: (version: string) => string;
  download: (version: string) => string;
  /** The name the site's Download button links to: a copy of `download`. */
  site: string;
  /**
   * The fewest bytes each served file may have: about half of 0.0.8's, so
   * only a cut-off or empty file fails. No ceiling: compression hides bloat
   * here (0.0.5's 16,000 extra files passed one); stage.ts stops its cause.
   */
  smallest: Record<'payload' | 'download', number>;
}

const appImage = (arch: 'x86_64' | 'aarch64'): Build => ({
  folder: `linux-${arch}`,
  platform: `linux-${arch}`,
  payload: (v) => `Oddboro_${v}_${arch}.AppImage`,
  download: (v) => `Oddboro_${v}_${arch}.AppImage`,
  site: `Oddboro-${arch}.AppImage`,
  // 0.0.8: 270 MB on x86_64, 264 MB on arm64.
  smallest: { payload: 130 * MB, download: 130 * MB }
});

const installer = (arch: 'x64' | 'arm64', platform: string): Build => ({
  folder: `windows-${arch}`,
  platform,
  payload: (v) => `Oddboro_${v}_${arch}-setup.exe`,
  download: (v) => `Oddboro_${v}_${arch}-setup.exe`,
  site: `Oddboro-${arch}-setup.exe`,
  // 0.0.8: 110 MB on x64, 107 MB on arm64.
  smallest: { payload: 50 * MB, download: 50 * MB }
});

export const BUILDS: Build[] = [
  {
    folder: 'mac',
    platform: 'darwin-aarch64',
    payload: (v) => `Oddboro_${v}_aarch64.app.tar.gz`,
    download: (v) => `Oddboro_${v}_aarch64.dmg`,
    site: 'Oddboro.dmg',
    // 0.0.8: the updater archive 135 MB, the .dmg 197 MB.
    smallest: { payload: 65 * MB, download: 95 * MB }
  },
  appImage('x86_64'),
  appImage('aarch64'),
  installer('x64', 'windows-x86_64'),
  installer('arm64', 'windows-aarch64')
];

export function expectedFiles(build: Build, version: string): string[] {
  const payload = build.payload(version);
  return [
    ...new Set([build.site, build.download(version), payload, `${payload}.sig`, 'latest.json'])
  ].sort();
}

export function appPublicKey(): string {
  const conf = fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url));
  return (JSON.parse(readFileSync(conf, 'utf8')) as { plugins: { updater: { pubkey: string } } })
    .plugins.updater.pubkey;
}

async function digest(algorithm: string, file: string): Promise<Buffer> {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest();
}

const lines = (b64: string) =>
  Buffer.from(b64.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);

/** Tauri's updater signatures are minisign, base64-wrapped in both the .sig and tauri.conf.json. */
export async function checkSignature(
  file: string,
  sig: string,
  pubkey: string,
  want: { name: string; version: string }
): Promise<string[]> {
  const key = Buffer.from(lines(pubkey)[1] ?? '', 'base64');
  const [, sigLine, trustedLine, globalLine] = lines(sig);
  if (key.length !== 42 || !sigLine || !trustedLine?.startsWith('trusted comment: ') || !globalLine)
    return ['its signature or the app key is not in minisign form'];
  const raw = Buffer.from(sigLine, 'base64');
  if (raw.length !== 74) return ['its signature is not in minisign form'];
  const algorithm = raw.subarray(0, 2).toString('latin1');
  if (!raw.subarray(2, 10).equals(key.subarray(2, 10)))
    return ['it is signed with a key the app does not trust'];
  const publicKey = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: key.subarray(10).toString('base64url') },
    format: 'jwk'
  });
  const signed = algorithm === 'ED' ? await digest('blake2b512', file) : readFileSync(file);
  const problems: string[] = [];
  if (!verify(null, signed, publicKey, raw.subarray(10)))
    problems.push('its signature does not match its bytes');
  const trusted = trustedLine.slice('trusted comment: '.length);
  const global = Buffer.from(globalLine, 'base64');
  if (!verify(null, Buffer.concat([raw.subarray(10), Buffer.from(trusted)]), publicKey, global))
    problems.push("its signature's comment was changed after signing");
  const fields = Object.fromEntries(
    trusted.split('\t').map((f) => [f.slice(0, f.indexOf(':')), f.slice(f.indexOf(':') + 1)])
  );
  if (fields.file !== want.name)
    problems.push(`its signature names ${fields.file ?? 'no file'}, not ${want.name}`);
  if (fields.version !== want.version)
    problems.push(`its signature names version ${fields.version ?? 'none'}, not ${want.version}`);
  return problems;
}

interface Latest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
}

export async function checkBuild(
  dir: string,
  build: Build,
  version: string,
  url: string,
  pubkey: string
): Promise<string[]> {
  const problems: string[] = [];
  const at = (f: string) => join(dir, f);
  if (!existsSync(dir)) return [`${build.folder}: no files came from this build`];

  const want = expectedFiles(build, version);
  const have = readdirSync(dir).sort();
  for (const f of want) if (!have.includes(f)) problems.push(`${build.folder}: ${f} is missing`);
  for (const f of have)
    if (!want.includes(f)) problems.push(`${build.folder}: ${f} should not be here`);
  if (problems.length) return problems;

  const payload = build.payload(version);
  const download = build.download(version);
  const say = (f: string, p: string) => problems.push(`${build.folder}: ${f}: ${p}`);

  // On Linux and Windows the payload is the download, so each file once.
  const floors = new Map<string, number>();
  floors.set(payload, build.smallest.payload);
  floors.set(download, Math.max(floors.get(download) ?? 0, build.smallest.download));
  for (const [file, smallest] of floors) {
    const size = statSync(at(file)).size;
    if (size < smallest)
      say(file, `${(size / MB).toFixed(1)} MB, under ${smallest / MB} MB: cut off or empty?`);
  }

  if (!(await digest('sha256', at(build.site))).equals(await digest('sha256', at(download))))
    say(build.site, `is not the same file as ${download}`);

  const sig = readFileSync(at(`${payload}.sig`), 'utf8').trim();
  for (const p of await checkSignature(at(payload), sig, pubkey, { name: payload, version }))
    say(payload, p);

  let latest: Latest;
  try {
    latest = JSON.parse(readFileSync(at('latest.json'), 'utf8')) as Latest;
  } catch {
    say('latest.json', 'is not JSON');
    return problems;
  }
  if (latest.version !== version)
    say('latest.json', `names version ${latest.version}, not ${version}`);
  const platforms = Object.keys(latest.platforms ?? {});
  if (platforms.length !== 1 || platforms[0] !== build.platform)
    say(
      'latest.json',
      `names ${platforms.join(', ') || 'no machine'}, not ${build.platform} alone`
    );
  const entry = latest.platforms?.[build.platform];
  if (entry) {
    const link = `${url.replace(/\/$/, '')}/${payload}`;
    if (entry.url !== link) say('latest.json', `links to ${entry.url}, not ${link}`);
    if (entry.signature?.trim() !== sig)
      say('latest.json', `carries a signature other than ${payload}.sig`);
  }
  return problems;
}

export async function checkRelease(
  root: string,
  version: string,
  url: string,
  { pubkey = appPublicKey(), builds = BUILDS }: { pubkey?: string; builds?: Build[] } = {}
): Promise<{ problems: string[]; latest?: Latest; assets?: string[] }> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { problems: [`${version} is not x.y.z`] };
  const problems: string[] = [];
  for (const build of builds)
    problems.push(...(await checkBuild(join(root, build.folder), build, version, url, pubkey)));
  const extra = existsSync(root)
    ? readdirSync(root).filter((d) => !builds.some((b) => b.folder === d))
    : [];
  for (const d of extra) problems.push(`${d}: no build by this name belongs in a release`);
  if (problems.length) return { problems };

  const each = builds.map(
    (b) => JSON.parse(readFileSync(join(root, b.folder, 'latest.json'), 'utf8')) as Latest
  );
  const latest: Latest = {
    ...each[0],
    platforms: Object.assign({}, ...each.map((l) => l.platforms))
  };
  const assets = builds.flatMap((b) =>
    expectedFiles(b, version)
      .filter((f) => f !== 'latest.json')
      .map((f) => join(root, b.folder, f))
  );
  return { problems, latest, assets };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const at = args.indexOf(name);
    const value = at >= 0 ? args[at + 1] : undefined;
    if (!value) throw new Error(`check-release.ts needs ${name}`);
    return value;
  };
  const version = flag('--version');
  const { problems, latest, assets } = await checkRelease(flag('--dir'), version, flag('--url'));
  if (problems.length || !latest || !assets) {
    console.error(`\n${version} does not go out. What is wrong:\n`);
    for (const p of problems) console.error(`  - ${p}`);
    if (process.env.GITHUB_ACTIONS) for (const p of problems) console.log(`::error::${p}`);
    process.exit(1);
  }
  writeFileSync(flag('--latest'), JSON.stringify(latest, null, 2) + '\n');
  writeFileSync(flag('--assets'), assets.join('\n') + '\n');
  console.log(`${version}: all ${BUILDS.length} builds pass. ${assets.length} files to upload.`);
}
