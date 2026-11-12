// The owner's key: made once in the office's own folder, readable by the owner
// alone, the same for every process; a planted cookie cannot log the owner
// out; and only an exact exception route passes without the key, over the
// one table of request targets. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { REQUEST_TARGETS } from './request-targets.ts';

// home.ts reads where the office is as it loads, so the fresh office is named first.
const office = mkdtempSync(join(tmpdir(), 'oddboro-owner-key-'));
after(() => rmSync(office, { recursive: true, force: true }));
process.env.ODDBORO_HOME = office;
const K = await import('../src/owner-key.ts');
const { home } = await import('../src/home.ts');

const OWNER_KEY_URL = new URL('../src/owner-key.ts', import.meta.url).href;

/** The key another process reads from `folder`: a plain node process, not a test. */
function keyFromAnotherProcess(folder: string): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, ODDBORO_HOME: folder };
  // A child that inherits the runner's context would report to it instead of running.
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { ownerKey } from ${JSON.stringify(OWNER_KEY_URL)}; process.stdout.write(ownerKey());`
    ],
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
