// Stages the office server for the app: apps/desktop/stage/ becomes the app's
// Resources/server folder. Node runs it from there with no TypeScript, no Vite
// and no workspace links, so the layout is plain:
//
//   stage/apps/office/build/        the office, from vite build
//   stage/node_modules/             what the workspace packages load, at the versions installed here
//   stage/node_modules/@oddboro/*   ledger, sprites and world, as JavaScript, with their files
//
// Packages' test folders stay out, and no path may run long enough to stop
// the Windows installer's builder (see LONGEST).
//
// It also fetches the Node binary the app carries, checked against nodejs.org's
// published sums. `--smoke` then starts the staged office on a spare port and
// home, and stops it once it answers.
import { preparePty } from '../../../scripts/prepare-pty.mjs';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DESKTOP = join(ROOT, 'apps', 'desktop');
const STAGE = join(DESKTOP, 'stage');
/** This machine as Rust names it (the sidecar's suffix) and as nodejs.org does. */
const MACHINES: Record<string, { triple: string; dist: string }> = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin', dist: 'darwin-arm64' },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu', dist: 'linux-x64' },
  'linux-arm64': { triple: 'aarch64-unknown-linux-gnu', dist: 'linux-arm64' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', dist: 'win-x64' },
  'win32-arm64': { triple: 'aarch64-pc-windows-msvc', dist: 'win-arm64' }
};
const MACHINE = MACHINES[`${process.platform}-${process.arch}`];
if (!MACHINE) throw new Error(`Oddboro does not build on ${process.platform}-${process.arch}`);
const WINDOWS = process.platform === 'win32';
const NODE_BIN = join(
  DESKTOP,
  'src-tauri',
  'binaries',
  `node-${MACHINE.triple}${WINDOWS ? '.exe' : ''}`
);
const PACKAGES = ['ledger', 'sprites', 'world'];
/** What a package needs at runtime. Everything else in it stays behind. */
const LEAVE_OUT = new Set([
  'node_modules',
  'out',
  'scripts',
  'test',
  'tsconfig.json',
  'drizzle.config.ts'
]);

const run = (cmd: string, args: string[], cwd = ROOT) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
/**
 * npm. On Windows it is a batch file, which only a shell can run, so it goes
 * as one command line; its arguments here are plain words.
 */
const npm = (args: string[], cwd = ROOT) =>
  WINDOWS
    ? execSync(['npm', ...args].join(' '), { cwd, stdio: 'inherit' })
    : execFileSync('npm', args, { cwd, stdio: 'inherit' });
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

function build(): void {
  npm(['run', 'sprites']);
  npm(['run', 'build', '-w', '@oddboro/office']);
}

/**
 * Every third-party runtime dependency, pinned to the version installed here.
 * The office's own are bundled into its build (they sit under its
 * devDependencies), so in practice these are the workspace packages'.
 */
function dependencies(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of ['apps/office', ...PACKAGES.map((p) => `packages/${p}`)]) {
    for (const name of Object.keys(readJson(join(ROOT, dir, 'package.json')).dependencies ?? {})) {
      if (name.startsWith('@oddboro/')) continue;
      out[name] = readJson(join(ROOT, 'node_modules', name, 'package.json')).version;
    }
  }
  return out;
}

/** A .ts file as plain JavaScript, with its relative imports pointing at .js. */
function compile(file: string): void {
  const js = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip' }).replace(
    /((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g,
    '$1$2.js$3'
  );
  writeFileSync(file.replace(/\.ts$/, '.js'), js);
  rmSync(file);
}

function compileAll(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) compileAll(p);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) compile(p);
  }
}

function stagePackage(name: string): void {
  const from = join(ROOT, 'packages', name);
  const to = join(STAGE, 'node_modules', '@oddboro', name);
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(from.length + 1).split(sep)[0];
      return !LEAVE_OUT.has(rel) && !(rel.endsWith('.md') && !src.includes(`${sep}src${sep}`));
    }
  });
  compileAll(join(to, 'src'));
  const pkg = readJson(join(from, 'package.json'));
  const exports = Object.fromEntries(
    Object.entries(pkg.exports as Record<string, string>).map(([k, v]) => [
      k,
      v.replace(/\.ts$/, '.js')
    ])
  );
  writeFileSync(
    join(to, 'package.json'),
    JSON.stringify({ name: pkg.name, type: 'module', exports }, null, 2) + '\n'
  );
}

/** Folders a package keeps for its own tests, which the app never loads. */
const TEST_DIRS = new Set(['__screenshots__', '__tests__']);
/**
 * The Windows installer's builder opens every file by its full path, and a
 * path stops at 260 characters there. GitHub's runner puts the stage about 60
 * characters deep, so no staged path may be longer than this.
 */
const LONGEST = 180;

/**
 * Takes out every test folder, where the longest names live (layerchart's
 * screenshots run past 200 characters), then fails on any path still too
 * long, here rather than in the installer.
 */
function prune(dir: string, rel = ''): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path).isDirectory()) {
      if (TEST_DIRS.has(name)) rmSync(path, { recursive: true, force: true });
      else prune(path, r);
    } else if (r.length > LONGEST)
      throw new Error(`stage/${r} is ${r.length} characters, too long for the Windows installer`);
  }
}

function stageOffice(): void {
  const office = join(STAGE, 'apps', 'office');
  cpSync(join(ROOT, 'apps', 'office', 'build'), join(office, 'build'), { recursive: true });
  writeFileSync(
    join(office, 'package.json'),
    JSON.stringify({ name: '@oddboro/office', private: true, type: 'module' }, null, 2) + '\n'
  );
}

/** The Node the app carries: this machine's version and system, checked against its sum. */
async function fetchNode(): Promise<void> {
  const version = process.version;
  const have = existsSync(NODE_BIN)
    ? execFileSync(NODE_BIN, ['--version'], { encoding: 'utf8' }).trim()
    : '';
  if (have === version) return;
  const base = `https://nodejs.org/dist/${version}`;
  // Windows builds come as a zip, with node.exe at the top; the rest as a
  // tarball, with node in bin/.
  const folder = `node-${version}-${MACHINE.dist}`;
  const tarball = `${folder}${WINDOWS ? '.zip' : '.tar.gz'}`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const want = sums
    .split('\n')
    .find((l) => l.endsWith(`  ${tarball}`))
    ?.split(' ')[0];
  if (!want) throw new Error(`No published sum for ${tarball}`);
  const body = Buffer.from(await (await fetch(`${base}/${tarball}`)).arrayBuffer());
  const got = createHash('sha256').update(body).digest('hex');
  if (got !== want) throw new Error(`${tarball} does not match its published sum`);
  const tmp = join(tmpdir(), `oddboro-node-${version}`);
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, tarball), body);
  // Windows's own tar reads zips. Git for Windows puts a GNU tar earlier on
  // the PATH that does not, so name the system's.
  const tar = WINDOWS
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  run(tar, ['-xf', tarball], tmp);
  mkdirSync(join(DESKTOP, 'src-tauri', 'binaries'), { recursive: true });
  cpSync(join(tmp, folder, ...(WINDOWS ? ['node.exe'] : ['bin', 'node'])), NODE_BIN);
  chmodSync(NODE_BIN, 0o755);
  rmSync(tmp, { recursive: true, force: true });
}

/** Start the staged office on a spare port and home, and wait for it to answer. */
async function smoke(): Promise<void> {
  const port = 4590;
  const home = join(tmpdir(), 'oddboro-smoke');
  rmSync(home, { recursive: true, force: true });
  const child = spawn(NODE_BIN, [join(STAGE, 'apps', 'office', 'build', 'index.js')], {
    cwd: join(STAGE, 'apps', 'office'),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ORIGIN: `http://127.0.0.1:${port}`,
      ODDBORO_PORT: String(port),
      ODDBORO_DB_PORT: '54590',
      ODDBORO_HOME: home,
      ODDBORO_CODE: STAGE,
      // As in the app: the server quits when asked, and a versioned first
      // start in an empty home makes its folder and records the version.
      ODDBORO_APP: '1',
      ODDBORO_VERSION: '0.0.0-smoke'
    },
    // A held stdin, as the app gives it: the server quits when it closes.
    stdio: ['pipe', 'inherit', 'inherit']
  });
  try {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const ok = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(2000)
      }).then(
        (r) => r.status < 500,
        () => false
      );
      if (ok) return console.log(`Smoke: the staged office answered on ${port}.`);
      if (child.exitCode !== null) throw new Error(`The staged office exited (${child.exitCode})`);
    }
    throw new Error('The staged office never answered');
  } finally {
    // As the app asks: SIGTERM, or on Windows, which has none, by closing stdin.
    if (WINDOWS) child.stdin?.end();
    else child.kill('SIGTERM');
    const quit = await new Promise((r) => {
      child.once('exit', () => r(true));
      setTimeout(() => r(false), 10_000);
    });
    if (!quit) {
      child.kill('SIGKILL');
      throw new Error('The staged office did not quit when asked');
    }
    console.log('Smoke: it quit when asked.');
  }
}

build();
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
writeFileSync(
  join(STAGE, 'package.json'),
  JSON.stringify(
    { name: 'oddboro-server', private: true, type: 'module', dependencies: dependencies() },
    null,
    2
  ) + '\n'
);
npm(['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], STAGE);
preparePty(STAGE);
for (const p of PACKAGES) stagePackage(p);
stageOffice();
prune(STAGE);
await fetchNode();
console.log(`Staged the server in ${STAGE}.`);
if (process.argv.includes('--smoke')) await smoke();
