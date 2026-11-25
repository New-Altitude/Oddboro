import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BASE,
  databaseId,
  descendantsIn,
  firstStarts,
  loggedPids,
  pageHeaders,
  parseTasklist,
  shellsIn
} from '../scripts/driver.ts';

test("the run's processes are the shells and Nodes its own log names", () => {
  const log = [
    'oddboro: 2026-11-08T06:15:40.000Z Oddboro 0.0.9 (aarch64-apple-darwin) opening: pid 90, port 4590, home /tmp/h, webview 26',
    'oddboro: 2026-11-08T06:15:40.123Z started node, pid 101',
    'Listening on http://127.0.0.1:4590',
    'oddboro: started node, pid 202',
    'page: error opening: pid 7 started node, pid',
    'office: ready 812 ms after Node started'
  ].join('\n');
  assert.deepEqual(loggedPids(log), [90, 101, 202]);
  assert.deepEqual(loggedPids('nothing started'), []);
});

test('the processes under a run are found down the tree, and nothing beside it', () => {
  const out = [
    '   1     0',
    '  90     1',
    ' 101    90',
    ' 150   101',
    ' 300     1',
    ' 301   300'
  ].join('\n');
  assert.deepEqual(descendantsIn(out, [90]).sort(), [101, 150]);
  assert.deepEqual(descendantsIn(out, [404]), []);
});

test("tasklist's CSV gives the pids, and its no-match notice none", () => {
  const out =
    '"oddboro.exe","8100","Console","1","45,000 K"\r\n"oddboro.exe","8120","Console","1","1,200 K"\r\n';
  assert.deepEqual(parseTasklist(out), [8100, 8120]);
  assert.deepEqual(
    parseTasklist('INFO: No tasks are running which match the specified criteria.'),
    []
  );
});

test('a shell counts by the program it runs, never by its arguments', () => {
  const out = [
    '  77 node apps/desktop/scripts/smoke.ts --artifact /tmp/Oddboro_0.0.9_x86_64.AppImage',
    ' 101 /tmp/Oddboro_0.0.9_x86_64.AppImage',
    ' 102 /tmp/.mount_OddborAbC/usr/bin/oddboro',
    ' 103 /private/var/x/Oddboro.app/Contents/MacOS/oddboro',
    ' 104 /private/var/x/Oddboro.app/Contents/MacOS/node /x/apps/office/build/index.js'
  ].join('\n');
  assert.deepEqual(shellsIn(out, 0), [101, 102, 103]);
  assert.deepEqual(shellsIn(out, 101), [102, 103]);
});

test('a shell counts by its program name too, as `ps -o comm` gives it', () => {
  const out = [' 201 oddboro', ' 202 node', ' 203 WebKitWebProce', ' 204 tauri-driver'].join('\n');
  assert.deepEqual(shellsIn(out, 0), [201]);
});

test('a page-shaped write carries the Origin, and Sec-Fetch-Site when asked', () => {
  assert.deepEqual(pageHeaders(false), { origin: BASE, 'content-type': 'application/json' });
  assert.equal(pageHeaders(true)['sec-fetch-site'], 'same-origin');
});

test('a first start names its version, the one before and the backup, each only when there is one', () => {
  const log = [
    'office: first start of 0.0.15',
    '2026-11-25T06:00:00.000Z office: 9.9.9 on darwin 24.6.0 arm64, Node v24.11.1',
    '2026-11-25T06:00:00.100Z office: first start of 9.9.9 after 0.0.15, backed up to /tmp/h/backups/pre-9.9.9-20261125T060000Z\r',
    'office: first start of 9.9.10 after 9.9.9',
    'page: error office: first start of 1.0.0'
  ].join('\n');
  assert.deepEqual(firstStarts(log), [
    { version: '0.0.15' },
    {
      version: '9.9.9',
      after: '0.0.15',
      backup: '/tmp/h/backups/pre-9.9.9-20261125T060000Z'
    },
    { version: '9.9.10', after: '9.9.9' }
  ]);
  assert.deepEqual(firstStarts('office: ready 812 ms after Node started'), []);
});

test("a database's identifier is the first 8 bytes of its pg_control, and a home without one throws", () => {
  const home = mkdtempSync(join(tmpdir(), 'driver-test-'));
  try {
    assert.throws(() => databaseId(home), /no database in/);
    mkdirSync(join(home, 'db', 'global'), { recursive: true });
    writeFileSync(
      join(home, 'db', 'global', 'pg_control'),
      Buffer.from('2a803bbcfd83066b0807000033', 'hex')
    );
    assert.equal(databaseId(home), '2a803bbcfd83066b');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
