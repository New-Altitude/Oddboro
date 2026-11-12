// Starting over asks the owner again about reports, and lists what it moves.
// The child gets a temp home and settings file and answers no, so nothing
// moves and no service stops. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { OFFICE_ENTRIES } from '../src/home.ts';

const RESET = fileURLToPath(new URL('../src/reset.ts', import.meta.url));

test('starting over lists the diagnostics answer among the settings it clears', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-reset-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, '.env');
  writeFileSync(envFile, 'OFFICE_DIAGNOSTICS=yes\n');

  const run = spawnSync(process.execPath, [RESET], {
    input: 'no\n',
    encoding: 'utf8',
    env: { ...process.env, ODDBORO_HOME: dir, ODDBORO_ENV: envFile }
  });

  assert.equal(run.status, 0, run.stderr);
  const cleared = run.stdout.split('\n').find((l) => l.startsWith('These come out of .env:'));
  assert.match(cleared ?? '', /\bOFFICE_DIAGNOSTICS\b/);
  assert.match(run.stdout, /Nothing moved\.\n$/);
});

test('starting over lists every office entry it moves, the sign-ins and the key among them, and nothing it keeps', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-reset-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'oddboro-reset-env-'));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });
  for (const name of Object.keys(OFFICE_ENTRIES)) mkdirSync(join(dir, name));

  const run = spawnSync(process.execPath, [RESET], {
    input: 'no\n',
    encoding: 'utf8',
    // A settings file outside the office, so the list holds only the office's entries.
    env: { ...process.env, ODDBORO_HOME: dir, ODDBORO_ENV: join(elsewhere, 'none.env') }
  });

  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.split('\n');
  const from = lines.findIndex((l) => l.startsWith('These move to '));
  assert.notEqual(from, -1, run.stdout);
  const block = lines.slice(from + 1, lines.indexOf('', from));
  const listed = block.map((l) => l.replace(/^ {2}~\/\.oddboro\//, ''));
  const moved = Object.entries(OFFICE_ENTRIES)
    .filter(([, entry]) => entry.reset === 'move')
    .map(([name]) => name);
  assert.deepEqual(listed.toSorted(), moved.toSorted());
  assert.ok(listed.includes('accounts') && listed.includes('owner-key'), block.join('\n'));
  assert.match(run.stdout, /Nothing moved\.\n$/);
});
