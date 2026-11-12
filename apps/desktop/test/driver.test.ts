import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BASE,
  descendantsIn,
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
    ' 104 /private/var/x/Oddboro.app/Contents/MacOS/node /x/apps/office/start.js'
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
