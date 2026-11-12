import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  answerProof,
  NONCE_PARAM,
  OFFICE_PROOF_PATH
} from '../../../packages/ledger/src/office-proof.ts';
import {
  BASE,
  descendantsIn,
  loggedPids,
  pageHeaders,
  parseTasklist,
  provenKey,
  type Run,
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

/** A key in the shape the office makes, so no real key is ever near these tests. */
const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

/** A run whose home holds `key` as its key file, or no key file at all. */
function runWith(key?: string): Run {
  const home = mkdtempSync(join(tmpdir(), 'oddboro-driver-test-'));
  after(() => rmSync(home, { recursive: true, force: true }));
  if (key !== undefined) writeFileSync(join(home, 'owner-key'), key);
  return { out: home, home, log: join(home, 'log'), env: {}, pids: new Set(), gone: new Set() };
}

/** A listener on a free 127.0.0.1 port that records every request, then answers with `handle`. */
async function listen(handle: (req: IncomingMessage, res: ServerResponse) => void) {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(JSON.stringify([req.url, req.rawHeaders]));
    handle(req, res);
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  after(() => server.close());
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

/** The office's proof route, for the key it holds. */
const office = (key: string) => (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://office');
  if (url.pathname !== OFFICE_PROOF_PATH) return void res.writeHead(404).end();
  const { status, body } = answerProof(key, url.searchParams.get(NONCE_PARAM), null);
  res.writeHead(status).end(body);
};

test('a run whose home has no key file, as an app older than the key, goes keyless and asks nothing first', async () => {
  const listener = await listen(office(KEY));
  assert.equal(await provenKey(runWith(), listener.base), undefined);
  assert.deepEqual(listener.seen, []);
});

test('a squatter on the office’s port is never given the key: the run’s key is refused there', async () => {
  const squatter = await listen((_req, res) => res.end('{"office":true}'));
  await assert.rejects(provenKey(runWith(KEY), squatter.base), /is not the office/);
  assert.equal(squatter.seen.length, 1);
  for (const word of [KEY, 'oddboro-owner', 'cookie'])
    assert.ok(!squatter.seen.join().toLowerCase().includes(word.toLowerCase()), word);
});

test('the office proves it holds the run’s key once a run, and again only for a new key', async () => {
  const run = runWith(KEY);
  const real = await listen(office(KEY));
  assert.equal(await provenKey(run, real.base), KEY);
  assert.equal(await provenKey(run, real.base), KEY);
  assert.equal(real.seen.length, 1);
  const newKey = KEY.replace('A', 'B');
  writeFileSync(join(run.home, 'owner-key'), newKey);
  await assert.rejects(provenKey(run, real.base), /is not the office/);
  assert.equal(real.seen.length, 2);
});
