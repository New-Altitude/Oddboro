// Starting over asks the owner again about reports. The child gets a temp
// home and settings file and answers no, so nothing moves and no service
// stops. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

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
