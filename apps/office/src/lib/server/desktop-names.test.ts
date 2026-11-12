// The app's shell is Rust, so it cannot import the office's names for the
// owner's key and its file, and writes them out itself. This test reads the
// shell's sources for each, so renaming one side alone fails here.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { OWNER_KEY_FILE, OWNER_PARAM } from '@oddboro/ledger/owner-key';

const shell = (file: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../desktop/src-tauri/src/${file}`, import.meta.url)),
    'utf8'
  );

test('the app and the office name the key and its file the same way', () => {
  assert.ok(shell('main.rs').includes(`"${OWNER_PARAM}"`), `main.rs lacks "${OWNER_PARAM}"`);
  assert.ok(shell('env.rs').includes(`"${OWNER_KEY_FILE}"`), `env.rs lacks "${OWNER_KEY_FILE}"`);
});
