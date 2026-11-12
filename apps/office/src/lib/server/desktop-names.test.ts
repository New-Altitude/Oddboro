// The app's shell is Rust, and the release smoke (apps/desktop/scripts/stage.ts)
// imports only Node's own modules, so neither can import the office's names for
// the owner's key, its file and its cookie, and each writes them out itself.
// This test reads their sources for each, so renaming one side alone fails here.
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

test("the release smoke names the key's file and the cookie the way the office does", () => {
  const smoke = readFileSync(
    fileURLToPath(new URL('../../../../desktop/scripts/stage.ts', import.meta.url)),
    'utf8'
  );
  // The cookie's name ends in the office's port, and the smoke runs its own office on its own port.
  const prefix = OWNER_COOKIE.slice(0, -String(OFFICE_PORT).length);
  assert.ok(smoke.includes(`'${OWNER_KEY_FILE}'`), `stage.ts lacks '${OWNER_KEY_FILE}'`);
  assert.ok(
    smoke.includes(`\`${prefix}\${port}\``),
    `stage.ts lacks the cookie \`${prefix}\${port}\``
  );
});
