// A fresh office makes its key as it starts, before any request asks for it.
// The app's shell reads the key's file once the office answers anything, and
// in the app nothing else makes it, so without this the first window would
// open on the refusal page. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, mock, test } from 'node:test';
import { tempOffice } from './diagnostics-harness.ts';

const { folder } = tempOffice('owner-key-init');
// With it set, `init` would start a real database.
delete process.env.ODDBORO_LOCAL_DB;
// `init`'s steps after the key reach the database and beyond. The first of
// those is stood in to stop `init` there, so nothing outside the temp office runs.
const stopped = new Error('init stopped after the key');
const upgrade = await import('@oddboro/ledger/upgrade');
mock.module('@oddboro/ledger/upgrade', {
  namedExports: { ...upgrade, bringUpToDate: () => Promise.reject(stopped) }
});
const { init } = await import('../../hooks.server.ts');

after(() => rmSync(folder, { recursive: true, force: true }));

test('a fresh office makes its key as it starts, before anything asks for it', async () => {
  const file = join(folder, 'owner-key');
  assert.ok(!existsSync(file), 'the temp office already had a key');
  await assert.rejects(async () => init(), stopped);
  assert.ok(existsSync(file), 'init made no key');
  assert.match(readFileSync(file, 'utf8'), /^[A-Za-z0-9_-]{43}$/);
});
