// Build the private model gateway from one pinned source and reviewed patch.
// The resulting files travel inside the desktop app, beside its office server.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DESKTOP = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = join(DESKTOP, 'magpie');
const MAX_ARCHIVE = 160 * 1024 * 1024;
const PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const ARCHES = new Set(['x64', 'arm64']);

type Source = {
  repository: string;
  commit: string;
  archiveSha256: string;
  patchSha256: string;
  version: string;
  apiVersion: number;
  goVersion: string;
};

export const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

export function cachedRuntimeMatches(
  value: unknown,
  source: Source,
  sha256: string,
  signingIdentity: string
): boolean {
  if (!value || typeof value !== 'object') return false;
  const current = value as Record<string, unknown>;
  return (
    current.apiVersion === source.apiVersion &&
    current.embedded === true &&
    current.sourceCommit === source.commit &&
    current.patchSha256 === source.patchSha256 &&
    current.version === source.version &&
    current.goVersion === source.goVersion &&
    current.platform === process.platform &&
    current.arch === process.arch &&
    current.signingIdentity === signingIdentity &&
    current.sha256 === sha256
  );
}

export function sourceOf(value: unknown): Source {
  const s = value as Partial<Source> | null;
  if (
    !s ||
    s.repository !== 'https://github.com/yetone/magpie' ||
    !/^[a-f0-9]{40}$/.test(s.commit ?? '') ||
    !/^[a-f0-9]{64}$/.test(s.archiveSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(s.patchSha256 ?? '') ||
    !/^[0-9][a-zA-Z0-9.+-]*$/.test(s.version ?? '') ||
    s.apiVersion !== 1 ||
    !/^\d+\.\d+\.\d+$/.test(s.goVersion ?? '')
  ) {
    throw new Error('The pinned Magpie source or patch metadata is invalid.');
  }
  return s as Source;
}

export function checkArchiveEntries(entries: string[], commit: string): void {
  const prefix = `magpie-${commit}`;
  if (!entries.length) throw new Error('The Magpie source archive is empty.');
  for (const name of entries) {
    const parts = name.replace(/\/$/, '').split('/');
    if (
      parts[0] !== prefix ||
      parts.some((p) => !p || p === '.' || p === '..') ||
      /[\\\x00-\x1f]/.test(name)
    ) {
      throw new Error('The Magpie source archive contains an unexpected path.');
    }
  }
}

async function archiveBytes(source: Source, localArchive?: string): Promise<Buffer> {
  if (localArchive) {
    const bytes = readFileSync(localArchive);
    if (bytes.byteLength > MAX_ARCHIVE) throw new Error('The Magpie source archive is too large.');
    if (digest(bytes) !== source.archiveSha256)
      throw new Error('The Magpie source archive does not match its pinned digest.');
    return bytes;
  }
  const response = await fetch(
    `https://codeload.github.com/yetone/magpie/tar.gz/${source.commit}`,
    { redirect: 'error', signal: AbortSignal.timeout(120_000) }
  );
  if (!response.ok || !response.body)
    throw new Error('The pinned Magpie source could not be read.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_ARCHIVE) {
      throw new Error('The Magpie source archive is too large.');
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (digest(bytes) !== source.archiveSha256)
    throw new Error('The Magpie source archive does not match its pinned digest.');
  return bytes;
}

type GoModule = {
  Path: string;
  Version?: string;
  Dir?: string;
  Main?: boolean;
  Replace?: GoModule;
};

// Copy the source notices, including nested notices, without inventing license text.
function noticeFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(name);
      else if (
        entry.isFile() &&
        /^(license|licence|copying|notice|copyright|patents)([._-].*)?$/i.test(entry.name)
      )
        found.push(name);
    }
  };
  visit('');
  return found.sort();
}

export function thirdPartyNotices(modules: GoModule[], goRoot: string, version: string): string {
  const sections = [`Magpie third-party notices\nGo toolchain: ${version}\n`];
  const emit = (label: string, root: string, paths: string[]) => {
    for (const path of paths) {
      const body = readFileSync(join(root, path), 'utf8');
      if (!body.trim()) throw new Error(`Empty required notice: ${label}/${path}`);
      sections.push(`===== ${label} / ${path} =====\n${body.trimEnd()}\n`);
    }
  };
  for (const path of ['LICENSE', 'PATENTS'])
    if (!existsSync(join(goRoot, path))) throw new Error(`Missing Go runtime notice: ${path}`);
  emit('Go runtime', goRoot, ['LICENSE', 'PATENTS']);
  const goSource = join(goRoot, 'src');
  const vendor = join(goSource, 'vendor');
  const vendorIndex = join(vendor, 'modules.txt');
  if (!existsSync(vendorIndex)) throw new Error('Missing Go vendor module index.');
  const vendorModules = readFileSync(vendorIndex, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^# [^ ]+ v[^ ]+$/.test(line))
    .map((line) => line.slice(2).split(' '));
  if (!vendorModules.length) throw new Error('Missing Go vendor notices.');
  for (const [name, vendorVersion] of vendorModules) {
    if (!name || name.startsWith('/') || name.split('/').some((part) => part === '..' || !part))
      throw new Error('Invalid Go vendor module path.');
    const directory = join(vendor, name);
    if (!existsSync(directory)) throw new Error(`Missing Go vendor source: ${name}`);
    const paths = noticeFiles(directory);
    if (!paths.some((p) => !p.includes('/') && /^(license|licence|copying)([._-].*)?$/i.test(p)))
      throw new Error(`Missing Go vendor license: ${name}`);
    emit(`Go vendor ${name}@${vendorVersion}`, directory, paths);
  }
  const boring = join(goSource, 'crypto/internal/boring');
  if (existsSync(boring)) emit('Go source crypto/internal/boring', boring, noticeFiles(boring));
  const seen = new Set<string>();
  const ordered = modules
    .filter((m) => !m.Main)
    .sort((a, b) => (a.Path < b.Path ? -1 : a.Path > b.Path ? 1 : 0));
  for (const mod of ordered) {
    const effective = mod.Replace ?? mod;
    const label = `${mod.Path}@${mod.Version ?? '(local)'}${mod.Replace ? ` => ${effective.Version ? `${effective.Path}@${effective.Version}` : '(local replacement)'}` : ''}`;
    if (seen.has(label)) continue;
    seen.add(label);
    if (!effective.Dir || !existsSync(effective.Dir))
      throw new Error(`Missing Go module source: ${label}`);
    const paths = noticeFiles(effective.Dir);
    if (!paths.some((p) => !p.includes('/') && /^(license|licence|copying)([._-].*)?$/i.test(p)))
      throw new Error(`Missing Go module license: ${label}`);
    emit(label, effective.Dir, paths);
  }
  return sections.join('\n');
}

export function noticesMatch(output: string, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  try {
    return (
      m.noticeSha256 === digest(readFileSync(join(output, 'THIRD_PARTY_NOTICES.txt'))) &&
      m.licenseSha256 === digest(readFileSync(join(output, 'LICENSE')))
    );
  } catch {
    return false;
  }
}

/** Build without running Magpie, reading sign-ins, or starting its gateway. */
export async function buildMagpie(
  output = join(DESKTOP, 'stage', 'magpie'),
  localArchive?: string
): Promise<void> {
  if (!PLATFORMS.has(process.platform) || !ARCHES.has(process.arch))
    throw new Error(`The bundled Magpie does not support ${process.platform}-${process.arch}.`);
  const source = sourceOf(JSON.parse(readFileSync(join(SOURCE, 'source.json'), 'utf8')));
  const patchPath = join(SOURCE, 'embedded-runtime.patch');
  const patch = readFileSync(patchPath);
  if (digest(patch) !== source.patchSha256)
    throw new Error('The Magpie embedding patch does not match its pinned digest.');
  const binaryName = process.platform === 'win32' ? 'magpie.exe' : 'magpie';
  // Tauri copies resources without signing them as sidecars. Sign the helper
  // before hashing it, so the manifest names the bytes the app will execute.
  const signingIdentity =
    process.platform === 'darwin' ? process.env.APPLE_SIGNING_IDENTITY || '-' : '';
  const binary = join(output, binaryName);
  const manifestPath = join(output, 'magpie-runtime.json');
  if (existsSync(binary) && existsSync(manifestPath)) {
    let current: unknown;
    try {
      current = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      // A damaged manifest is rebuilt from the pinned source below.
    }
    if (
      cachedRuntimeMatches(current, source, digest(readFileSync(binary)), signingIdentity) &&
      noticesMatch(output, current)
    ) {
      console.log('The bundled Magpie matches its pinned source and patch.');
      return;
    }
  }
  const goVersion = execFileSync('go', ['env', 'GOVERSION'], {
    encoding: 'utf8',
    env: { ...process.env, GOTOOLCHAIN: 'local' }
  }).trim();
  if (goVersion !== `go${source.goVersion}`)
    throw new Error(`Building the pinned Magpie requires Go ${source.goVersion}.`);
  const archive = await archiveBytes(source, localArchive);
  const temporary = mkdtempSync(join(tmpdir(), 'oddboro-magpie-build-'));
  try {
    const archivePath = join(temporary, 'source.tar.gz');
    writeFileSync(archivePath, archive);
    const tar =
      process.platform === 'win32'
        ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
        : 'tar';
    const entries = execFileSync(tar, ['-tzf', archivePath], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
      .trim()
      .split(/\r?\n/);
    checkArchiveEntries(entries, source.commit);
    execFileSync(tar, ['-xzf', archivePath, '-C', temporary], { stdio: 'inherit' });
    const cwd = join(temporary, `magpie-${source.commit}`);
    // The source digest fixes the base. Zero-context hunks keep unrelated
    // upstream prose out of this repository's reviewed patch.
    execFileSync('git', ['apply', '--unidiff-zero', '--check', patchPath], {
      cwd,
      stdio: 'inherit'
    });
    execFileSync('git', ['apply', '--unidiff-zero', patchPath], { cwd, stdio: 'inherit' });
    const built = join(temporary, binaryName);
    const env = {
      ...process.env,
      CGO_ENABLED: '0',
      GOTOOLCHAIN: 'local',
      GOOS: process.platform === 'win32' ? 'windows' : process.platform,
      GOARCH: process.arch === 'x64' ? 'amd64' : process.arch
    };
    execFileSync(
      'go',
      [
        'build',
        '-mod=readonly',
        '-p',
        '2',
        '-tags',
        'nogui',
        '-trimpath',
        '-buildvcs=false',
        `-ldflags=-s -w -X main.version=${source.version}`,
        '-o',
        built,
        '.'
      ],
      { cwd, env, stdio: 'inherit' }
    );
    const moduleLines = execFileSync(
      'go',
      [
        'list',
        '-mod=readonly',
        '-tags',
        'nogui',
        '-deps',
        '-f',
        '{{if .Module}}{{if not .Module.Main}}{{.Module.Path}}|{{.Module.Version}}|{{.Module.Dir}}|{{if .Module.Replace}}{{.Module.Replace.Path}}|{{.Module.Replace.Version}}|{{.Module.Replace.Dir}}{{end}}{{end}}{{end}}',
        '.'
      ],
      { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
    const modules = moduleLines
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line): GoModule => {
        const [Path, Version, Dir, replacement, replacementVersion, replacementDir, ...extra] =
          line.split('|');
        if (!Path || extra.length) throw new Error('Invalid Go dependency metadata.');
        return {
          Path,
          Version,
          Dir,
          ...(replacement
            ? { Replace: { Path: replacement, Version: replacementVersion, Dir: replacementDir } }
            : {})
        };
      });
    const goRoot = execFileSync('go', ['env', 'GOROOT'], { env, encoding: 'utf8' }).trim();
    const notices = thirdPartyNotices(modules, goRoot, goVersion);
    if (signingIdentity)
      execFileSync(
        'codesign',
        [
          '--force',
          '--sign',
          signingIdentity,
          '--options',
          'runtime',
          ...(signingIdentity === '-' ? [] : ['--timestamp']),
          built
        ],
        { stdio: 'inherit' }
      );
    mkdirSync(output, { recursive: true });
    copyFileSync(built, binary);
    chmodSync(binary, 0o755);
    copyFileSync(join(SOURCE, 'LICENSE'), join(output, 'LICENSE'));
    writeFileSync(join(output, 'THIRD_PARTY_NOTICES.txt'), notices);
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          apiVersion: source.apiVersion,
          embedded: true,
          version: source.version,
          sha256: digest(readFileSync(binary)),
          sourceCommit: source.commit,
          patchSha256: source.patchSha256,
          goVersion: source.goVersion,
          platform: process.platform,
          arch: process.arch,
          signingIdentity,
          licenseSha256: digest(readFileSync(join(output, 'LICENSE'))),
          noticeSha256: digest(Buffer.from(notices))
        },
        null,
        2
      ) + '\n'
    );
    console.log(`Built the bundled Magpie in ${output}.`);
  } finally {
    // Only the private directory made by this invocation is removed.
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} needs a path.`);
    return resolve(args[i + 1]);
  };
  const output = option('--output');
  if (output) mkdirSync(dirname(output), { recursive: true });
  await buildMagpie(output, option('--archive'));
}
