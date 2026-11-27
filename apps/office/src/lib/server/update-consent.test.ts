// No update installs without the owner's yes. A version the shell reports
// waits with no install time until the owner presses Install now or Install
// tonight; Wait takes a time back and hides the floor's notice. The owner's
// switch for the shell's own checks lives in `.env`, where the shell reads it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

process.env.ODDBORO_UPDATES = '1';
process.env.ODDBORO_VERSION = '0.0.10';
await import('./office-under-test.ts');
const { ENV_FILE } = await import('@oddboro/ledger/env');
const { loadUpdate, status } = await import('./update.ts');
const { KEY_HEADER, KEY_LINE, readKey } = await import('./app-key.ts');
const { POST } = await import('../../routes/api/update/+server.ts');
await loadUpdate();
const KEY = 'c3'.repeat(32);
const pipe = new PassThrough();
const keyRead = readKey(pipe, 200);
pipe.write(`${KEY_LINE}${KEY}\n`);
await keyRead;

const post = (body: unknown, shell = false) =>
  POST({
    request: new Request('http://localhost/api/update', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: shell ? { [KEY_HEADER]: KEY } : {}
    }),
    getClientAddress: () => '127.0.0.1'
  } as Parameters<typeof POST>[0]);

test('a ready update waits for the owner, and Wait takes back a time they gave', async () => {
  await post({ version: '0.0.11', notes: '' }, true);
  let s = await status(true);
  assert.equal(s.ready, true);
  assert.equal(s.installAt, null);
  assert.equal(s.install, false);
  assert.equal(s.holding, false);
  assert.equal(s.waited, false);

  s = await (await post({ action: 'install-tonight' })).json();
  assert.ok(s.installAt, 'Install tonight gives a time');

  s = await (await post({ action: 'wait' })).json();
  assert.equal(s.installAt, null);
  assert.equal(s.waited, true);

  // The shell tells the server again every 30 seconds: still no time, still waited.
  await post({ version: '0.0.11', notes: '' }, true);
  s = await status(true);
  assert.equal(s.installAt, null);
  assert.equal(s.install, false);
  assert.equal(s.waited, true);

  // A newer version is news again.
  await post({ version: '0.0.12', notes: '' }, true);
  assert.equal((await status()).waited, false);

  s = await (await post({ action: 'install-now' })).json();
  assert.equal(s.install, true);
  assert.equal(s.waited, false);
});

test("the owner's switch writes .env, which the shell reads", async () => {
  assert.equal((await status()).checks, true);
  let s = await (await post({ action: 'checks-off' })).json();
  assert.equal(s.checks, false);
  assert.match(readFileSync(ENV_FILE, 'utf8'), /^OFFICE_UPDATE_CHECKS=off$/m);
  s = await (await post({ action: 'checks-on' })).json();
  assert.equal(s.checks, true);
  assert.match(readFileSync(ENV_FILE, 'utf8'), /^OFFICE_UPDATE_CHECKS=on$/m);
});

test('an action the route does not know is refused, even one every object has', async () => {
  await assert.rejects(async () => post({ action: 'toString' }), { status: 400 });
  await assert.rejects(async () => post({ action: 'install-later' }), { status: 400 });
});
