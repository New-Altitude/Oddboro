// The app's shell is Rust, and the release smoke (apps/desktop/scripts/smoke.ts,
// with driver.ts) imports only Node's own modules, so neither can import the
// office's names for the owner's key, its file and its cookie, and each writes
// them out itself. This test reads their sources for each, so renaming one side
// alone fails here.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { OFFICE_PORT } from '@oddboro/ledger/home';
import { OWNER_COOKIE, OWNER_KEY_FILE, OWNER_PARAM } from '@oddboro/ledger/owner-key';

const shell = (file: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../desktop/src-tauri/src/${file}`, import.meta.url)),
    'utf8'
  );

test('the app and the office name the key and its file the same way', () => {
  assert.ok(shell('main.rs').includes(`"${OWNER_PARAM}"`), `main.rs lacks "${OWNER_PARAM}"`);
  assert.ok(shell('env.rs').includes(`"${OWNER_KEY_FILE}"`), `env.rs lacks "${OWNER_KEY_FILE}"`);
});

const script = (file: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../desktop/scripts/${file}`, import.meta.url)),
    'utf8'
  );

test("the release smoke names the key's file and the cookie the way the office does", () => {
  const driver = script('driver.ts');
  // The cookie's name ends in the office's port, and the smoke runs its own office on its own port.
  const prefix = OWNER_COOKIE.slice(0, -String(OFFICE_PORT).length);
  assert.ok(driver.includes(`'${OWNER_KEY_FILE}'`), `driver.ts lacks '${OWNER_KEY_FILE}'`);
  assert.ok(
    driver.includes(`\`${prefix}\${PORT}\``),
    `driver.ts lacks the cookie \`${prefix}\${PORT}\``
  );
});

test('the release smoke asks the office only through the fetch that carries the key', () => {
  // driver.ts's one fetch to the office, `officeFetch`, adds the cookie. A
  // fetch of the office's address anywhere else would go without it. The
  // page's own fetch inside the app's window carries the window's cookie,
  // and names no address.
  for (const file of ['smoke.ts', 'driver.ts']) {
    const fetches = script(file).match(/\bfetch\(\s*(BASE|`\$\{BASE\})/g) ?? [];
    assert.equal(fetches.length, file === 'driver.ts' ? 1 : 0, `${file}: ${fetches.join(', ')}`);
  }
});
