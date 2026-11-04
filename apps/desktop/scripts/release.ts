// Builds a release of Oddboro for the machine it runs on, into
// apps/desktop/release/, or the folder `--out` names.
//
// On a Mac: signed with New Altitude's Developer ID, notarized by Apple, with
// the ticket stapled, in a .dmg that is signed, notarized and stapled too,
// plus the updater's archive, its signature and the latest.json the app
// checks.
//
// On Linux (x86_64 or arm64): an AppImage, which is also the updater's
// payload, its signature, a copy under the name the site links to
// (Oddboro-x86_64.AppImage or Oddboro-aarch64.AppImage), and a latest.json
// for this one machine. GitHub merges the three latest.json files into one.
//
// Signing uses APPLE_SIGNING_IDENTITY, else the Developer ID in this Mac's
// keychain. Notarizing uses an App Store Connect API key when
// APPLE_API_KEY_PATH, APPLE_API_KEY_ID and APPLE_API_ISSUER are set (GitHub),
// else the notarytool profile ODDBORO_NOTARY_PROFILE, else "oddboro"
// (xcrun notarytool store-credentials oddboro ...). The updater archive is
// signed with TAURI_SIGNING_PRIVATE_KEY (the key or its path) and
// TAURI_SIGNING_PRIVATE_KEY_PASSWORD. latest.json points at
// ODDBORO_RELEASE_URL (the release's download folder) and carries
// ODDBORO_RELEASE_NOTES. Signing and notarizing are Mac only.
//
//   node apps/desktop/scripts/release.ts [--version 0.0.2] [--out <dir>] [--test]
//
// `--version` sets the version in tauri.conf.json and Cargo.toml for this
// build only, and puts the files back after. `--test` is for trying updates
// on this machine: no notarizing, and the app accepts an http latest.json
// from ODDBORO_UPDATE_URL. Never ship a --test build.
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const RELEASES = 'https://github.com/New-Altitude/Oddboro/releases';
const DESKTOP = fileURLToPath(new URL('..', import.meta.url));
const TAURI = join(DESKTOP, 'src-tauri');
const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const TEST = args.includes('--test');
const OUT = resolve(flag('--out') ?? join(DESKTOP, 'release'));
// Rust writes source paths into the binary for its panic messages, and those
// paths name the builder's home folder. Map them to neutral ones, so a release
// never carries whose Mac built it.
const CARGO_HOME = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
const RUSTFLAGS = [
  process.env.RUSTFLAGS ?? '',
  `--remap-path-prefix=${CARGO_HOME}=/cargo`,
  `--remap-path-prefix=${resolve(DESKTOP, '..', '..')}=/oddboro`,
  `--remap-path-prefix=${homedir()}=/home`
]
  .join(' ')
  .trim();
/** This machine: Rust's target, and the name its files and latest.json use. */
const MACHINES: Record<string, { target: string; arch: string; platform: string }> = {
  'darwin-arm64': { target: 'aarch64-apple-darwin', arch: 'aarch64', platform: 'darwin-aarch64' },
  'linux-x64': { target: 'x86_64-unknown-linux-gnu', arch: 'x86_64', platform: 'linux-x86_64' },
  'linux-arm64': { target: 'aarch64-unknown-linux-gnu', arch: 'aarch64', platform: 'linux-aarch64' }
};
const MACHINE = MACHINES[`${process.platform}-${process.arch}`];
if (!MACHINE) throw new Error(`Oddboro does not build on ${process.platform}-${process.arch}`);
const TARGET = MACHINE.target;
const RELEASE = join(DESKTOP, 'src-tauri', 'target', TARGET, 'release');
const IDENTITY =
  process.env.APPLE_SIGNING_IDENTITY ?? 'Developer ID Application: New Altitude, Inc. (982T92H38A)';
const PROFILE = process.env.ODDBORO_NOTARY_PROFILE ?? 'oddboro';
const API_KEY = [
  process.env.APPLE_API_KEY_PATH,
  process.env.APPLE_API_KEY_ID,
  process.env.APPLE_API_ISSUER
];
const CONF = join(TAURI, 'tauri.conf.json');
const CARGO = join(TAURI, 'Cargo.toml');
const LOCK = join(TAURI, 'Cargo.lock');
const BUNDLE = join(RELEASE, 'bundle', 'macos');
const APP = join(BUNDLE, 'Oddboro.app');

/** Run a command. An env value of undefined takes that variable out. */
const run = (cmd: string, argv: string[], env: Record<string, string | undefined> = {}) => {
  const all = { ...process.env, ...env };
  for (const k of Object.keys(all)) if (all[k] === undefined) delete all[k];
  execFileSync(cmd, argv, { cwd: DESKTOP, stdio: 'inherit', env: all });
};
const read = (cmd: string, argv: string[]) =>
  execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const KEY = process.env.TAURI_SIGNING_PRIVATE_KEY;
if (!KEY) throw new Error('Set TAURI_SIGNING_PRIVATE_KEY to sign the updater archive');
// `tauri build` takes the key or its path, `tauri signer sign` only the key.
if (existsSync(KEY)) process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(KEY, 'utf8').trim();
const wanted = flag('--version');
if (wanted !== undefined && !/^\d+\.\d+\.\d+$/.test(wanted))
  throw new Error(`--version wants x.y.z, not ${wanted}`);

/** Send a file to Apple and wait for its verdict, then staple the ticket to what was sent. */
function notarize(file: string, staple: string): void {
  const [key, keyId, issuer] = API_KEY;
  const auth =
    key && keyId && issuer
      ? ['--key', key, '--key-id', keyId, '--issuer', issuer]
      : ['--keychain-profile', PROFILE];
  run('xcrun', ['notarytool', 'submit', file, ...auth, '--wait']);
  run('xcrun', ['stapler', 'staple', staple]);
}

/** Set this build's version in tauri.conf.json and Cargo.toml. Returns what puts them back. */
function setVersion(version: string): () => void {
  const saved = [CONF, CARGO, LOCK].map((f) => [f, readFileSync(f, 'utf8')] as const);
  const conf = JSON.parse(saved[0][1]) as { version: string };
  conf.version = version;
  writeFileSync(CONF, JSON.stringify(conf, null, 2) + '\n');
  writeFileSync(CARGO, saved[1][1].replace(/^version = ".*"$/m, `version = "${version}"`));
  return () => saved.forEach(([f, text]) => writeFileSync(f, text));
}

/** latest.json for this machine's build of `version`, its file at `file` in OUT. */
function writeLatest(version: string, file: string): void {
  const base = process.env.ODDBORO_RELEASE_URL ?? `${RELEASES}/download/v${version}`;
  const latest = {
    version,
    notes: process.env.ODDBORO_RELEASE_NOTES ?? '',
    pub_date: new Date().toISOString(),
    platforms: {
      [MACHINE.platform]: {
        signature: readFileSync(join(OUT, `${file}.sig`), 'utf8').trim(),
        url: `${base.replace(/\/$/, '')}/${file}`
      }
    }
  };
  writeFileSync(join(OUT, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
}

/** Fails when the shell's binary still names the home folder of whoever built it. */
function checkNoHome(binary: string): void {
  if (read('strings', ['-a', binary]).includes(homedir()))
    throw new Error("The app binary still names this machine's home folder");
}

/**
 * The AppImage bundles GStreamer, so the office's music plays
 * (tauri.linux.conf.json). Its bundler looks in Debian's folders, which
 * Ubuntu has; Fedora keeps them in lib64 and libexec.
 */
function gstreamerDirs(): Record<string, string> {
  if (process.env.GSTREAMER_PLUGINS_DIR || !existsSync('/usr/lib64/gstreamer-1.0')) return {};
  return {
    GSTREAMER_PLUGINS_DIR: '/usr/lib64/gstreamer-1.0',
    GSTREAMER_HELPERS_DIR: '/usr/libexec/gstreamer-1.0'
  };
}

/** The AppImage: built, checked, signed for the updater, and named for the site. */
function buildLinux(version: string): void {
  run('node', [join(DESKTOP, 'scripts', 'stage.ts'), '--smoke']);
  const configs = ['src-tauri/tauri.bundle.conf.json'];
  if (TEST) configs.push('{"plugins":{"updater":{"dangerousInsecureTransportProtocol":true}}}');
  run(
    'npx',
    [
      'tauri',
      'build',
      '--target',
      TARGET,
      '--bundles',
      'appimage',
      ...configs.flatMap((c) => ['--config', c])
    ],
    { RUSTFLAGS, ...gstreamerDirs() }
  );
  checkNoHome(join(RELEASE, 'oddboro'));
  const built = join(RELEASE, 'bundle', 'appimage');
  const appimage = readdirSync(built).find((f) => f.endsWith('.AppImage'));
  if (!appimage) throw new Error(`No AppImage in ${built}`);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  // The AppImage is the updater's payload as it is, so one file serves both.
  const file = `Oddboro_${version}_${MACHINE.arch}.AppImage`;
  copyFileSync(join(built, appimage), join(OUT, file));
  chmodSync(join(OUT, file), 0o755);
  // The signature names the version, and the app refuses one that names another.
  run('npx', ['tauri', 'signer', 'sign', '--app-version', version, join(OUT, file)]);
  writeLatest(version, file);
  // The site's Download button links to releases/latest/download/ under this name.
  copyFileSync(join(OUT, file), join(OUT, `Oddboro-${MACHINE.arch}.AppImage`));
  console.log(
    `Released ${version} for ${MACHINE.platform}${TEST ? ' (test build)' : ''} in ${OUT}`
  );
}

function buildMac(version: string): void {
  // 1. The server, staged and smoke-tested.
  run('node', [join(DESKTOP, 'scripts', 'stage.ts'), '--smoke']);

  // 2. The app, signed by Tauri: the app, its Node sidecar, the hardened
  //    runtime and Entitlements.plist on both, and the updater archive.
  const configs = ['src-tauri/tauri.bundle.conf.json', 'src-tauri/tauri.release.conf.json'];
  if (TEST) configs.push('{"plugins":{"updater":{"dangerousInsecureTransportProtocol":true}}}');
  run(
    'npx',
    [
      'tauri',
      'build',
      '--target',
      TARGET,
      '--bundles',
      'app',
      ...configs.flatMap((c) => ['--config', c])
    ],
    // Tauri would notarize by itself with these. release.ts does it after the checks.
    { APPLE_SIGNING_IDENTITY: IDENTITY, RUSTFLAGS, APPLE_API_KEY: undefined, APPLE_ID: undefined }
  );
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', APP]);
  checkNoHome(join(APP, 'Contents/MacOS/oddboro'));
  const node = read('codesign', [
    '-d',
    '--entitlements',
    '-',
    '--xml',
    join(APP, 'Contents/MacOS/node')
  ]);
  if (!node.includes('com.apple.security.cs.allow-jit'))
    throw new Error('The Node sidecar is signed without allow-jit, so V8 would not start');

  // 3. The app notarized and stapled, so it opens offline on first launch.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  if (!TEST) {
    const zip = join(OUT, 'Oddboro.zip');
    run('ditto', ['-c', '-k', '--keepParent', APP, zip]);
    notarize(zip, APP);
    rmSync(zip);
  }

  // 4. The updater archive, packed again from the stapled app and signed
  //    with the updater key, which the app checks before it installs.
  const archive = `Oddboro_${version}_aarch64.app.tar.gz`;
  run('tar', ['-czf', join(OUT, archive), '-C', BUNDLE, 'Oddboro.app'], { COPYFILE_DISABLE: '1' });
  // The signature names the version, and the app refuses one that names another.
  run('npx', ['tauri', 'signer', 'sign', '--app-version', version, join(OUT, archive)]);
  writeLatest(version, archive);

  // 5. The .dmg: the stapled app beside a link to Applications, signed,
  //    notarized and stapled. The site's Download button links to
  //    Oddboro.dmg, so each release carries that name too.
  const dmg = join(OUT, `Oddboro_${version}_aarch64.dmg`);
  const volume = join(OUT, 'dmg');
  mkdirSync(volume);
  // ditto keeps the signature and the stapled ticket intact.
  run('ditto', [APP, join(volume, 'Oddboro.app')]);
  symlinkSync('/Applications', join(volume, 'Applications'));
  run('hdiutil', [
    'create',
    '-volname',
    'Oddboro',
    '-srcfolder',
    volume,
    '-fs',
    'APFS',
    '-format',
    'UDZO',
    '-ov',
    dmg
  ]);
  rmSync(volume, { recursive: true, force: true });
  run('codesign', ['--sign', IDENTITY, '--timestamp', dmg]);
  if (!TEST) notarize(dmg, dmg);
  copyFileSync(dmg, join(OUT, 'Oddboro.dmg'));

  // 6. What Gatekeeper says. A test build is not notarized, so it would refuse.
  if (!TEST) {
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', APP]);
    run('spctl', [
      '--assess',
      '--type',
      'open',
      '--context',
      'context:primary-signature',
      '--verbose=2',
      dmg
    ]);
  }
  console.log(`Released ${version}${TEST ? ' (test build)' : ''} in ${OUT}`);
}

const restore = wanted ? setVersion(wanted) : () => {};
try {
  const version = wanted ?? (JSON.parse(readFileSync(CONF, 'utf8')) as { version: string }).version;
  if (process.platform === 'darwin') buildMac(version);
  else buildLinux(version);
} finally {
  restore();
}
