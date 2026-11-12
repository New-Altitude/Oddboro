// The office's own Caddyfile stays in step with the owner's key: written
// readable by the owner alone, over an older file's mode too, and rewritten
// with Caddy restarted when a reset made a new key. The login service is a
// stand-in here, so no test restarts this computer's Caddy.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { after, mock, test } from 'node:test';

const restarted: string[] = [];
/** The key the office reads as it starts. A reset moves it aside, and the next start makes a new one. */
let key = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

// The real modules, loaded apart from the stand-ins that replace them for address.ts.
const actual = async <T>(specifier: string) =>
  (await import(`${import.meta.resolve(specifier)}?actual`)) as T;
const ledger = await actual<typeof import('@oddboro/ledger')>('@oddboro/ledger');
const ownerKeys = await actual<typeof import('@oddboro/ledger/owner-key')>(
  '@oddboro/ledger/owner-key'
);
mock.module('@oddboro/ledger', {
  namedExports: {
    ...ledger,
    restartService: async (label: string) => {
      restarted.push(label);
      return true;
    }
  }
});
mock.module('@oddboro/ledger/owner-key', {
  namedExports: { ...ownerKeys, ownerKey: () => key }
});
const { home, SYSTEM } = ledger;
const { ownCaddyfile, keepAddress } = await import('./address.ts');

const CADDYFILE = home('caddy', 'Caddyfile');
const was = process.env.OFFICE_ADDRESS;
process.env.OFFICE_ADDRESS = 'own';
after(() => {
  if (was === undefined) delete process.env.OFFICE_ADDRESS;
  else process.env.OFFICE_ADDRESS = was;
});

const mode = () => statSync(CADDYFILE).mode & 0o777;
const UNIX = { skip: process.platform === 'win32' && 'Windows has no file modes' };

test(
  'the office writes its own Caddyfile readable by the owner alone, and makes an older readable one so',
  UNIX,
  async () => {
    rmSync(home('caddy'), { recursive: true, force: true });
    await keepAddress();
    assert.ok(existsSync(CADDYFILE));
    assert.equal(mode(), 0o600);

    // An older Caddyfile, from before the proxy header, readable by others.
    rmSync(CADDYFILE);
    writeFileSync(CADDYFILE, 'an older Caddyfile', { mode: 0o644 });
    assert.equal(mode(), 0o644);
    await keepAddress();
    assert.equal(mode(), 0o600);
  }
);

test("after a reset makes a new key, the office's next start rewrites its Caddyfile from that key and restarts its Caddy", async () => {
  await keepAddress();
  restarted.length = 0;
  const before = readFileSync(CADDYFILE, 'utf8');

  // Unchanged: nothing to restart.
  await keepAddress();
  assert.deepEqual(restarted, []);

  key = 'BBECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  await keepAddress();
  const now = readFileSync(CADDYFILE, 'utf8');
  assert.notEqual(now, before);
  assert.equal(now, ownCaddyfile(SYSTEM, key));
  assert.deepEqual(restarted, ['com.oddboro.caddy']);
});
