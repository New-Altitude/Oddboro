// Where setup opens the office (`src/setup-address.ts`): it waits for the
// office's key file without making one, sends the key only to an address
// proven in this run, and opens the best proven address. Real listeners on
// random ports stand in for the office, its Caddy and squatters; names
// resolve through a stand-in lookup, so no test reaches a name server.
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import http, { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import type { AddressInfo } from 'node:net';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { home } from '../src/home.ts';
import {
  answerProof,
  NONCE_PARAM,
  OFFICE_PROOF_PATH,
  PROXY_HEADER,
  proxySecret
} from '../src/office-proof.ts';
import { OWNER_COOKIE, OWNER_KEY_FILE } from '../src/owner-key.ts';
import { setupAddress, type Ports } from '../src/setup-address.ts';

/** A key in the shape the office makes, so no real key is ever near these tests. */
const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const KEY_FILE = home(OWNER_KEY_FILE);
const QUICK = { tries: 3, pause: 10 };

type Seen = { url?: string; headers: string[] };

/** A listener on `host` (port 0 for a free one) that records every request whole, then answers with `handle`. */
async function listen(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
  host = '127.0.0.1',
  port = 0
) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, headers: req.rawHeaders });
    handle(req, res);
  });
  await new Promise<void>((ready, fail) => {
    server.once('error', fail);
    server.listen(port, host, ready);
  });
  after(() => server.close());
  return { port: (server.address() as AddressInfo).port, seen };
}

/** A free port with nothing on it. */
async function nothing(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

/** The office: its proof route, and with its key, its page and whether https is set up. */
function office(secure = false) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://office');
    if (url.pathname === OFFICE_PROOF_PATH) {
      const header = req.headers[PROXY_HEADER.toLowerCase()];
      const { status, body } = answerProof(
        KEY,
        url.searchParams.get(NONCE_PARAM),
        typeof header === 'string' ? header : null
      );
      return void res.writeHead(status).end(body);
    }
    if (req.headers.cookie !== `${OWNER_COOKIE}=${KEY}`) return void res.writeHead(403).end();
    if (url.pathname === '/api/setup/address') return void res.end(JSON.stringify({ secure }));
    res.end('the office');
  };
}

/** The office on 127.0.0.1 and [::1] at one port, as it runs. */
async function bothOffices(secure = false) {
  const v4 = await listen(office(secure));
  const v6 = await listen(office(secure), '::1', v4.port);
  return { port: v4.port, listeners: [v4, v6] };
}

/** A relay to the office's port, setting the proxy header when one is given, as Caddy's header_up does. */
function relay(port: number, header?: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const headers = { ...req.headers };
    if (header !== undefined) headers[PROXY_HEADER.toLowerCase()] = header;
    const out = http.request({ host: '127.0.0.1', port, path: req.url, headers }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    out.on('error', () => res.writeHead(502).end());
    out.end();
  };
}

/** Answers 200 with the office's old probe answer to anything. */
const squat = (_req: IncomingMessage, res: ServerResponse) => res.end('{"office":true}');

/** Nothing any listener saw holds the key, a cookie or the address parameter that carries it. */
function heldNoKey(...listeners: { seen: Seen[] }[]) {
  const all = JSON.stringify(listeners.flatMap((l) => l.seen));
  for (const word of [KEY, 'oddboro-owner', 'oddboro-key', 'cookie'])
    assert.ok(!all.toLowerCase().includes(word.toLowerCase()), `a listener saw ${word}`);
}

/** Each name resolves as `names` says, as public DNS and the system resolve them here. */
function resolve(names: Record<string, string[]>) {
  mock.method(dns, 'lookup', async (name: string) => {
    const found = names[name];
    if (!found) throw Object.assign(new Error(`no ${name}`), { code: 'ENOTFOUND' });
    return found.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  });
  syncBuiltinESMExports();
}
const NAMES_HERE = {
  'local.oddboro.com': ['127.0.0.1'],
  'oddboro.localhost': ['::1', '127.0.0.1']
};
/** As on a computer where public DNS does not point local.oddboro.com here, or none answers. */
const LOCALHOST_ONLY = { 'oddboro.localhost': ['::1', '127.0.0.1'] };

beforeEach(() => writeFileSync(KEY_FILE, KEY, { mode: 0o600 }));
afterEach(() => {
  rmSync(KEY_FILE, { force: true });
  mock.restoreAll();
  syncBuiltinESMExports();
});

const ports = async (office: number, take: Partial<Ports> = {}): Promise<Ports> => ({
  office,
  http: take.http ?? (await nothing()),
  https: take.https ?? (await nothing())
});

test('before the office has made its key, setup waits, makes no key of its own and sends nothing', async () => {
  rmSync(KEY_FILE);
  resolve(NAMES_HERE);
  const { port, listeners } = await bothOffices();
  assert.equal(await setupAddress(await ports(port), QUICK), undefined);
  assert.equal(existsSync(KEY_FILE), false);
  assert.deepEqual(
    listeners.map((l) => l.seen.length),
    [0, 0]
  );
});

test('while a squatter holds the office’s port, setup never sends it the key and gives up', async () => {
  resolve(NAMES_HERE);
  const squatter = await listen(squat);
  assert.equal(await setupAddress(await ports(squatter.port), QUICK), undefined);
  assert.equal(squatter.seen.length, QUICK.tries, 'one proof a try, and nothing more');
  heldNoKey(squatter);
});

test('with only the office at its own port proven, setup opens oddboro.localhost at that port, as it did before', async () => {
  resolve(LOCALHOST_ONLY);
  const { port, listeners } = await bothOffices();
  const caddy = await listen(squat);
  assert.deepEqual(await setupAddress(await ports(port, { http: caddy.port }), QUICK), {
    key: KEY,
    address: `http://oddboro.localhost:${port}`
  });
  heldNoKey(caddy);
  // The office's first request is a proof, before any that carries the key.
  assert.ok(listeners[0].seen[0].url?.startsWith(OFFICE_PROOF_PATH));
});

test('a port 80 relay that hands only the proof to the office is never opened', async () => {
  resolve(NAMES_HERE);
  const { port, listeners } = await bothOffices();
  const squatter = await listen(relay(port));
  const found = await setupAddress(await ports(port, { http: squatter.port }), QUICK);
  // It passes local.oddboro.com through the squatter, and opens the name at the office's own port.
  assert.equal(found?.address, `http://local.oddboro.com:${port}`);
  // The relay passed on the office's own answers, never a request with the key.
  heldNoKey(squatter);
  assert.ok(listeners[0].seen.length > 0);
});

test('the office through its Caddy proves itself, and setup opens Caddy’s address', async () => {
  resolve(NAMES_HERE);
  const { port } = await bothOffices();
  const caddy = await listen(relay(port, `${proxySecret(KEY)} http`));
  const found = await setupAddress(await ports(port, { http: caddy.port }), QUICK);
  assert.equal(found?.address, `http://local.oddboro.com:${caddy.port}`);
  heldNoKey(caddy);
});

test('when the office says https is set up, setup opens https only once it proves through Caddy', async () => {
  resolve(LOCALHOST_ONLY);
  const { port } = await bothOffices(true);
  // A plain listener where Caddy's https should be: no TLS, so no proof.
  const squatter = await listen(squat);
  const found = await setupAddress(await ports(port, { https: squatter.port }), QUICK);
  assert.equal(found?.address, `http://oddboro.localhost:${port}`);
  heldNoKey(squatter);
});

test('when something else holds [::1] at the office’s port, setup opens 127.0.0.1, which the office proved, and never oddboro.localhost', async () => {
  resolve(LOCALHOST_ONLY);
  const real = await listen(office());
  const squatter = await listen(squat, '::1', real.port);
  const found = await setupAddress(await ports(real.port), QUICK);
  assert.equal(found?.address, `http://127.0.0.1:${real.port}`);
  heldNoKey(squatter);
});
