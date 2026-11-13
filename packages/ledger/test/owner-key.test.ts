// The owner's key: made once in the office's own folder, readable by the owner
// alone, the same for every process; a tool that talks to the office reads
// the key and never makes one, and sends it only after the proof; a planted
// cookie cannot log the owner out; and only an exact exception route passes
// without the key, over the one table of request targets. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test, type TestContext } from 'node:test';
import { answerProof, NONCE_PARAM, OFFICE_PROOF_PATH } from '../src/office-proof.ts';
import { REQUEST_TARGETS } from './request-targets.ts';

// home.ts reads where the office is as it loads, so the fresh office is named first.
const office = mkdtempSync(join(tmpdir(), 'oddboro-owner-key-'));
after(() => rmSync(office, { recursive: true, force: true }));
process.env.ODDBORO_HOME = office;
const K = await import('../src/owner-key.ts');
const { home } = await import('../src/home.ts');

const OWNER_KEY_URL = new URL('../src/owner-key.ts', import.meta.url).href;

/** What `code` writes in another process whose office is `folder`: a plain node process, not a test. */
function inAnotherProcess(folder: string, code: string): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, ODDBORO_HOME: folder };
  // A child that inherits the runner's context would report to it instead of running.
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', `import * as K from ${JSON.stringify(OWNER_KEY_URL)}; ${code}`],
    { env }
  );
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  return new Promise((resolve, reject) =>
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`the child exited ${code}: ${err}`))
    )
  );
}

/** The key another process reads from `folder`. */
const keyFromAnotherProcess = (folder: string) =>
  inAnotherProcess(folder, 'process.stdout.write(K.ownerKey());');

/** The key a tool in another process gets from `folder` for the office at `origin`. */
const provenFromAnotherProcess = (folder: string, origin: string) =>
  inAnotherProcess(
    folder,
    `process.stdout.write(await K.provenOwnerKey(${JSON.stringify(origin)}));`
  );

/** Every request the server got, by URL and headers. */
type Asked = { url: string; headers: string }[];

/** A server on 127.0.0.1 that answers the office's proof as an office holding `key` would. */
async function officeHolding(
  t: TestContext,
  key: string
): Promise<{ origin: string; asked: Asked }> {
  const asked: Asked = [];
  const server = createServer((req, res) => {
    asked.push({ url: req.url ?? '', headers: JSON.stringify(req.headers) });
    const nonce = new URL(req.url ?? '/', 'http://office').searchParams.get(NONCE_PARAM);
    const answer = answerProof(key, nonce, null);
    res.writeHead(answer.status).end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  // A server listening on a TCP port has an AddressInfo, never a pipe's name.
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked };
}

test('the office makes its key once, in its own folder, readable by the owner alone', async () => {
  const key = K.ownerKey();
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(K.ownerKey(), key);
  assert.equal(readFileSync(home('owner-key'), 'utf8'), key);
  if (process.platform !== 'win32') assert.equal(statSync(home('owner-key')).mode & 0o777, 0o600);
  assert.equal(await keyFromAnotherProcess(office), key);
  assert.deepEqual(readdirSync(office), ['owner-key'], 'a temp file was left beside the key');
});

test('offices starting at once on a new folder all read the one key that was linked first', async (t) => {
  const fresh = mkdtempSync(join(tmpdir(), 'oddboro-owner-key-race-'));
  t.after(() => rmSync(fresh, { recursive: true, force: true }));
  const keys = await Promise.all(Array.from({ length: 6 }, () => keyFromAnotherProcess(fresh)));
  const onDisk = readFileSync(join(fresh, 'owner-key'), 'utf8');
  assert.deepEqual(new Set(keys), new Set([onDisk]));
  assert.deepEqual(readdirSync(fresh), ['owner-key'], 'a temp file was left beside the key');
});

test('an empty or damaged key file stops the office, and the file is left as it was', async (t) => {
  for (const held of ['', 'not a key']) {
    const damaged = mkdtempSync(join(tmpdir(), 'oddboro-owner-key-damaged-'));
    t.after(() => rmSync(damaged, { recursive: true, force: true }));
    writeFileSync(join(damaged, 'owner-key'), held);
    await assert.rejects(keyFromAnotherProcess(damaged), /does not hold an owner key/);
    assert.equal(readFileSync(join(damaged, 'owner-key'), 'utf8'), held);
  }
});

test('a tool finds no key file: it makes none and sends nothing', async (t) => {
  const none = mkdtempSync(join(tmpdir(), 'oddboro-owner-key-none-'));
  t.after(() => rmSync(none, { recursive: true, force: true }));
  const office = await officeHolding(t, 'a'.repeat(43));
  await assert.rejects(provenFromAnotherProcess(none, office.origin), /holds no owner key/);
  assert.deepEqual(readdirSync(none), [], 'the tool left a key file');
  assert.deepEqual(office.asked, [], 'the tool sent a request');
});

test('a tool gets the stored key only from the office that proves it holds it, and never sends it', async (t) => {
  const stored = mkdtempSync(join(tmpdir(), 'oddboro-owner-key-stored-'));
  t.after(() => rmSync(stored, { recursive: true, force: true }));
  const key = await keyFromAnotherProcess(stored);
  const other = await officeHolding(t, 'b'.repeat(43));
  await assert.rejects(
    provenFromAnotherProcess(stored, other.origin),
    /is not the office whose key is in/
  );
  const office = await officeHolding(t, key);
  assert.equal(await provenFromAnotherProcess(stored, office.origin), key);
  for (const { url, headers } of [...other.asked, ...office.asked]) {
    assert.ok(url.startsWith(OFFICE_PROOF_PATH), url);
    assert.ok(!url.includes(key) && !headers.includes(key), 'the key went with a proof');
  }
  assert.equal(other.asked.length + office.asked.length, 2);
});

test('a planted cookie of the same name does not log the owner out', () => {
  const key = K.ownerKey();
  assert.equal(K.hasOwnerKey(`${K.OWNER_COOKIE}=x; ${K.OWNER_COOKIE}=${key}`), true);
  assert.equal(K.hasOwnerKey(`${K.OWNER_COOKIE}=x`), false);
  assert.equal(K.hasOwnerKey(`another-cookie=${key}`), false);
  assert.equal(K.hasOwnerKey(null), false);
});

test('only an exact exception route passes as an exception', () => {
  const rows = REQUEST_TARGETS.filter((r) => !r.target.includes('?'));
  assert.ok(rows.length > 0, 'no row to check');
  const wrong = rows
    .filter((r) => K.isExceptionPath(r.target) !== (r.dev === 'passes'))
    .map((r) => r.target);
  assert.deepEqual(wrong, []);

  assert.equal(K.isGatewayPath('/api/gateway/notes'), true);
  assert.equal(K.isGatewayPath('/api/gateway/gmail-2'), true);
  for (const path of [K.UPDATE_PATH, ...K.OWN_PROOF])
    assert.equal(K.isGatewayPath(path), false, path);
});

/** Each exception route as a request names it: the gateway's with a connector id in place of its parameter. */
const ROUTES = K.EXCEPTION_ROUTES.map((r) => r.replace(/\[[a-z]+\]/, 'notes'));
/** What a router may read as a separator, a step back or an empty step, in place of a `/`. */
const SEPARATORS = ['%2f', '%5c', '\\', '//', '/./', '/../'];
/** A step back, as written and escaped. */
const BACK = ['..', '%2e%2e'];

/**
 * Each route rewritten so that a router could read it as another path: each of
 * its `/` swapped for another separator, a step back after it, a step back
 * into it, and a gateway id that is itself a step back or holds a separator.
 */
function rereadable(route: string): string[] {
  const slashes = [...route.matchAll(/\//g)].map((m) => m.index);
  const swapped = SEPARATORS.flatMap((sep) =>
    slashes.map((at) => route.slice(0, at) + sep + route.slice(at + 1))
  );
  const after = BACK.flatMap((back) =>
    ['/', ...SEPARATORS].map((sep) => `${route}${sep}${back}${sep}goals`)
  );
  const into = BACK.map((back) => `/goals/${back}${route}`);
  const ids = route.startsWith(`${K.GATEWAY_PATH}/`)
    ? [...BACK, '.', '%2e', ...SEPARATORS.map((sep) => `notes${sep}x`)].map(
        (id) => `${K.GATEWAY_PATH}/${id}`
      )
    : [];
  return [...swapped, ...after, ...into, ...ids];
}

test('no exception route passes when written so that a router could read it as another path', () => {
  assert.equal(ROUTES.length, K.EXCEPTION_ROUTES.length);
  for (const route of ROUTES) assert.equal(K.isExceptionPath(route), true, route);
  const variants = ROUTES.flatMap(rereadable);
  for (const token of ['%2e%2e', '%2f', '%5c', '\\', '//', '/./', '/../'])
    assert.ok(
      variants.some((v) => v.includes(token)),
      `no variant holds ${token}`
    );
  assert.deepEqual(
    variants.filter((v) => K.isExceptionPath(v)),
    []
  );
});

test('a route parameter matches no escape, backslash, dot or slash, so the path decodes to itself', () => {
  const whole = new RegExp(`^${K.PARAM}$`);
  assert.equal(whole.test('gmail-2'), true);
  for (const c of ['%', '\\', '.', '/']) {
    assert.equal(whole.test(c), false, c);
    assert.equal(whole.test(`gmail${c}2`), false, c);
  }
});
