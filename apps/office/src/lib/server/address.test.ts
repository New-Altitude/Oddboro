// The office's own Caddyfile (`ownCaddyfile` in address.ts) on each system,
// the look at port 80 (`port80`), and which of its commands may show a window.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, mock, test } from 'node:test';
import { openUrl, probe } from '@oddboro/ledger/platform';
import { ownCaddyfile, port80, secureAddress } from './address.ts';

const binds = (system: Parameters<typeof ownCaddyfile>[0]) =>
  ownCaddyfile(system)
    .split('\n')
    .filter((l) => /^\s*(default_)?bind\b/.test(l));

test("the office's own Caddy listens on the loopback addresses only on Windows; on a Mac, where a user binds a low port only on every address, and on Linux, unmeasured, it names no address", () => {
  assert.deepEqual(binds('windows'), ['\tdefault_bind 127.0.0.1 [::1]']);
  assert.deepEqual(binds('mac'), []);
  assert.deepEqual(binds('linux'), []);
});

const folder = mkdtempSync(join(tmpdir(), 'oddboro-port80-'));
after(() => rmSync(folder, { recursive: true, force: true }));

/** A folder holding one stand-in command, a shell script with this body. */
function standIn(name: string, body: string): string {
  const dir = mkdtempSync(join(folder, `${name}-`));
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
  return dir;
}
const empty = mkdtempSync(join(folder, 'empty-'));

/**
 * `fn` as on `platform`, with PATH only `path`. The office's own `onPlatform`
 * lives in office-under-test.ts, which starts a whole office as it loads.
 */
async function on<T>(platform: NodeJS.Platform, path: string, fn: () => Promise<T>): Promise<T> {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  const was = process.env.PATH;
  Object.defineProperty(process, 'platform', { value: platform });
  process.env.PATH = path;
  try {
    return await fn();
  } finally {
    if (real) Object.defineProperty(process, 'platform', real);
    process.env.PATH = was;
  }
}

const SHELL_STAND_INS = {
  skip: process.platform === 'win32' && 'the stand-ins are shell scripts'
};

test(
  'on Linux, with no ss, the port 80 check says it could not look, never that the port is free',
  SHELL_STAND_INS,
  async () => {
    assert.deepEqual(await on('linux', empty, port80), { status: 'unchecked' });
    assert.deepEqual(await on('linux', standIn('ss', 'exit 0'), port80), { status: 'free' });
    assert.deepEqual(await on('linux', standIn('ss', 'exit 1'), port80), { status: 'unchecked' });
    assert.deepEqual(
      await on('linux', standIn('ss', 'echo "LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*"'), port80),
      { status: 'held', by: 'another program' }
    );
    assert.deepEqual(
      await on(
        'linux',
        standIn('ss', `echo 'LISTEN 0 4096 *:80 *:* users:(("caddy",pid=812,fd=9))'`),
        port80
      ),
      { status: 'held', by: 'caddy' }
    );
  }
);

test('on a Mac, a missing lsof is not a free port', SHELL_STAND_INS, async () => {
  assert.deepEqual(await on('darwin', empty, port80), { status: 'unchecked' });
  assert.deepEqual(await on('darwin', standIn('lsof', 'exit 1'), port80), { status: 'free' });
  assert.deepEqual(
    await on('darwin', standIn('lsof', 'echo "lsof: a problem" >&2; exit 1'), port80),
    { status: 'free' }
  );
  assert.deepEqual(await on('darwin', standIn('lsof', 'echo p1; exit 1'), port80), {
    status: 'unchecked'
  });
  assert.deepEqual(await on('darwin', standIn('lsof', 'printf "p812\\ncnginx\\n"'), port80), {
    status: 'held',
    by: 'nginx'
  });
});

test("on Windows, a command runs with no window unless it opens one the owner must see: certutil's trust dialog and the browser", async () => {
  const started: { cmd: string; args: string[]; options: object }[] = [];
  const page = 'https://local.oddboro.com';
  // probe reaches execFile through its import, so the stand-in goes on the
  // module and the import is brought up to date with it.
  mock.method(
    childProcess,
    'execFile',
    (cmd: string, args: string[], options: object, done: (e: Error) => void) => {
      started.push({ cmd, args, options });
      done(Object.assign(new Error('a stand-in that fails'), { code: 1 }));
      return {};
    }
  );
  // Caddy's admin API, asked for the root certificate, answers with one.
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ root_certificate: 'a root certificate' })
  );
  syncBuiltinESMExports();
  try {
    await on('win32', empty, async () => {
      await probe('anything', []);
      await assert.rejects(secureAddress(), /The certificate was not trusted/);
      await openUrl(page);
    });
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  const hides = (what: string, which: (s: (typeof started)[number]) => boolean) => {
    const o = started.find(which)?.options;
    assert.ok(o, `${what} never started`);
    return 'windowsHide' in o ? o.windowsHide : 'not set';
  };
  assert.equal(
    hides('a command', (s) => s.cmd === 'anything'),
    true
  );
  assert.equal(
    hides('certutil', (s) => s.cmd === 'certutil.exe'),
    'not set'
  );
  assert.equal(
    hides('the opener', (s) => s.args.includes(page)),
    'not set'
  );
});
