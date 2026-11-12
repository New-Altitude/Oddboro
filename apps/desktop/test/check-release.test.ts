import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  BUILDS,
  type Build,
  appPublicKey,
  checkRelease,
  checkSignature,
  expectedFiles
} from '../scripts/check-release.ts';

const VERSION = '0.0.9';
const URL = `https://github.com/New-Altitude/Oddboro/releases/download/v${VERSION}`;
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64');

/** Mirrors what `tauri signer generate` and `tauri signer sign --app-version` write. */
function makeKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const id = randomBytes(8);
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url');
  const pubkey = b64(
    `untrusted comment: minisign public key: ${id.toString('hex').toUpperCase()}\n` +
      `${b64(Buffer.concat([Buffer.from('Ed'), id, raw]))}\n`
  );
  const signFile = (bytes: Buffer, name: string, version: string) => {
    const sig = sign(null, createHash('blake2b512').update(bytes).digest(), privateKey);
    const trusted = `timestamp:1794095284\tfile:${name}\tversion:${version}`;
    const global = sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
    return b64(
      'untrusted comment: signature from tauri secret key\n' +
        `${b64(Buffer.concat([Buffer.from('ED'), id, sig]))}\n` +
        `trusted comment: ${trusted}\n${b64(global)}\n`
    );
  };
  return { pubkey, signFile };
}

const SMALL: Build[] = BUILDS.map((b) => ({
  ...b,
  smallest: { payload: 1024, download: 1024 }
}));

type Key = ReturnType<typeof makeKey>;

function makeRelease(root: string, key: Key, version = VERSION) {
  for (const b of SMALL) {
    const dir = join(root, b.folder);
    mkdirSync(dir, { recursive: true });
    const payload = b.payload(version);
    const download = b.download(version);
    const bytes = (name: string) => Buffer.from(`${name} `.repeat(400));
    writeFileSync(join(dir, payload), bytes(payload));
    if (download !== payload) writeFileSync(join(dir, download), bytes(download));
    writeFileSync(join(dir, b.site), readFileSync(join(dir, download)));
    const sig = key.signFile(readFileSync(join(dir, payload)), payload, version);
    writeFileSync(join(dir, `${payload}.sig`), sig);
    writeFileSync(
      join(dir, 'latest.json'),
      JSON.stringify({
        version,
        notes: 'notes',
        pub_date: '2026-11-07T00:00:00Z',
        platforms: { [b.platform]: { signature: sig, url: `${URL}/${payload}` } }
      })
    );
  }
}

let root: string;
let key: Key;
const check = (k: Key = key) =>
  checkRelease(root, VERSION, URL, { pubkey: k.pubkey, builds: SMALL });
const at = (folder: string, file: string) => join(root, folder, file);
const json = (folder: string) => JSON.parse(readFileSync(at(folder, 'latest.json'), 'utf8'));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oddboro-check-release-'));
  key = makeKey();
  makeRelease(root, key);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('a release as it should be', () => {
  it('passes, and lists every file once', async () => {
    const { problems, latest, assets } = await check();
    assert.deepEqual(problems, []);
    assert.equal(latest?.version, VERSION);
    assert.deepEqual(
      Object.keys(latest?.platforms ?? {}).sort(),
      SMALL.map((b) => b.platform).sort()
    );
    // Mac: two .dmg, the archive and its .sig. Each of the four others: three.
    assert.equal(assets?.length, 16);
    assert.equal(new Set(assets?.map((a) => a.split(/[\\/]/).pop())).size, 16);
    assert.ok(!assets?.some((a) => a.endsWith('latest.json')));
  });

  it('carries the names the site links to', () => {
    const names = BUILDS.map((b) => b.site).sort();
    assert.deepEqual(names, [
      'Oddboro-aarch64.AppImage',
      'Oddboro-arm64-setup.exe',
      'Oddboro-x64-setup.exe',
      'Oddboro-x86_64.AppImage',
      'Oddboro.dmg'
    ]);
  });
});

describe('a release that should not go out', () => {
  it("stops a build of another version (0.0.6's 0.0.5 installer)", async () => {
    const old = mkdtempSync(join(tmpdir(), 'oddboro-old-'));
    makeRelease(old, key, '0.0.5');
    rmSync(join(root, 'windows-x64'), { recursive: true });
    cpSync(join(old, 'windows-x64'), join(root, 'windows-x64'), { recursive: true });
    rmSync(old, { recursive: true, force: true });
    const { problems, assets } = await check();
    assert.ok(problems.some((p) => p.includes('Oddboro_0.0.9_x64-setup.exe is missing')));
    assert.ok(problems.some((p) => p.includes('Oddboro_0.0.5_x64-setup.exe should not be here')));
    assert.equal(assets, undefined);
  });

  it('stops an old file under the new name', async () => {
    const file = 'Oddboro_0.0.9_x64-setup.exe';
    writeFileSync(at('windows-x64', file), Buffer.from('0.0.5 installer '.repeat(200)));
    const { problems } = await check();
    assert.ok(problems.some((p) => p.includes(`${file}: its signature does not match its bytes`)));
    assert.ok(problems.some((p) => p.includes('Oddboro-x64-setup.exe: is not the same file')));
  });

  it('stops a signature that names another version', async () => {
    const b = SMALL.find((x) => x.folder === 'linux-x86_64')!;
    const file = b.payload(VERSION);
    const sig = key.signFile(readFileSync(at(b.folder, file)), file, '0.0.8');
    writeFileSync(at(b.folder, `${file}.sig`), sig);
    const latest = json(b.folder);
    latest.platforms[b.platform].signature = sig;
    writeFileSync(at(b.folder, 'latest.json'), JSON.stringify(latest));
    const { problems } = await check();
    assert.deepEqual(problems, [
      `linux-x86_64: ${file}: its signature names version 0.0.8, not 0.0.9`
    ]);
  });

  it('stops a signature made with a key the app does not trust', async () => {
    const { problems } = await check(makeKey());
    assert.equal(problems.length, SMALL.length);
    assert.ok(problems.every((p) => p.endsWith('signed with a key the app does not trust')));
  });

  it('stops a latest.json for another version, machine or link', async () => {
    const latest = json('mac');
    latest.version = '0.0.8';
    latest.platforms['darwin-aarch64'].url = `${URL}/Oddboro.dmg`;
    writeFileSync(at('mac', 'latest.json'), JSON.stringify(latest));
    const linux = json('linux-aarch64');
    linux.platforms['linux-x86_64'] = linux.platforms['linux-aarch64'];
    writeFileSync(at('linux-aarch64', 'latest.json'), JSON.stringify(linux));
    const { problems } = await check();
    assert.ok(problems.some((p) => p.includes('mac: latest.json: names version 0.0.8')));
    assert.ok(problems.some((p) => p.includes('mac: latest.json: links to')));
    assert.ok(
      problems.some((p) =>
        p.includes('linux-aarch64: latest.json: names linux-aarch64, linux-x86_64')
      )
    );
  });

  it("stops a latest.json whose signature is not the .sig's", async () => {
    const latest = json('windows-arm64');
    latest.platforms['windows-aarch64'].signature =
      json('windows-x64').platforms['windows-x86_64'].signature;
    writeFileSync(at('windows-arm64', 'latest.json'), JSON.stringify(latest));
    const { problems } = await check();
    assert.deepEqual(problems, [
      'windows-arm64: latest.json: carries a signature other than Oddboro_0.0.9_arm64-setup.exe.sig'
    ]);
  });

  it('stops a site copy that is not the versioned file', async () => {
    writeFileSync(at('mac', 'Oddboro.dmg'), Buffer.from('an older dmg '.repeat(200)));
    const { problems } = await check();
    assert.deepEqual(problems, [
      'mac: Oddboro.dmg: is not the same file as Oddboro_0.0.9_aarch64.dmg'
    ]);
  });

  it('stops a missing build, and a folder no build makes', async () => {
    rmSync(join(root, 'linux-aarch64'), { recursive: true });
    mkdirSync(join(root, 'windows-x86'));
    const { problems } = await check();
    assert.deepEqual(problems, [
      'linux-aarch64: no files came from this build',
      'windows-x86: no build by this name belongs in a release'
    ]);
  });

  const replaceInstaller = (bytes: Buffer) => {
    const b = SMALL.find((x) => x.folder === 'windows-x64')!;
    const file = b.payload(VERSION);
    writeFileSync(at(b.folder, file), bytes);
    writeFileSync(at(b.folder, b.site), bytes);
    const sig = key.signFile(bytes, file, VERSION);
    writeFileSync(at(b.folder, `${file}.sig`), sig);
    const latest = json(b.folder);
    latest.platforms[b.platform].signature = sig;
    writeFileSync(at(b.folder, 'latest.json'), JSON.stringify(latest));
  };

  it('stops a cut-off or empty file, even one signed and listed', async () => {
    replaceInstaller(Buffer.alloc(0));
    const { problems } = await check();
    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /^windows-x64: Oddboro_0\.0\.9_x64-setup\.exe: 0\.0 MB, under .* cut off/
    );
  });

  it("lets a big file through: bloat is stage.ts's to catch", async () => {
    replaceInstaller(Buffer.alloc(1024 * 1024, 1));
    const { problems } = await check();
    assert.deepEqual(problems, []);
  });

  it('stops a version that is not x.y.z', async () => {
    const { problems } = await checkRelease(root, '0.0.9-rc', URL, {
      pubkey: key.pubkey,
      builds: SMALL
    });
    assert.deepEqual(problems, ['0.0.9-rc is not x.y.z']);
  });
});

describe('the signature check', () => {
  it('stops a trusted comment changed after signing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oddboro-sig-'));
    const file = join(dir, 'Oddboro_0.0.9_x64-setup.exe');
    writeFileSync(file, 'installer');
    const sig = Buffer.from(
      key.signFile(readFileSync(file), 'Oddboro_0.0.9_x64-setup.exe', '0.0.9'),
      'base64'
    )
      .toString('utf8')
      .replace('version:0.0.9', 'version:0.1.0');
    const problems = await checkSignature(file, b64(sig), key.pubkey, {
      name: 'Oddboro_0.0.9_x64-setup.exe',
      version: '0.1.0'
    });
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(problems, ["its signature's comment was changed after signing"]);
  });

  it("reads the app's own key", () => {
    const key = Buffer.from(
      Buffer.from(appPublicKey(), 'base64').toString('utf8').trim().split('\n')[1],
      'base64'
    );
    assert.equal(key.length, 42);
    assert.equal(key.subarray(0, 2).toString(), 'Ed');
  });

  it('expects the same files for each build as the workflow used to name', () => {
    const mac = BUILDS.find((b) => b.folder === 'mac')!;
    assert.deepEqual(expectedFiles(mac, VERSION), [
      'Oddboro.dmg',
      'Oddboro_0.0.9_aarch64.app.tar.gz',
      'Oddboro_0.0.9_aarch64.app.tar.gz.sig',
      'Oddboro_0.0.9_aarch64.dmg',
      'latest.json'
    ]);
  });
});
