// The proof that an address is this office (`src/office-proof.ts`): the
// known answer the app's shell checks too, the route's answer, and the prover
// against real listeners on random ports, none of which ever sees the key.
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import dns from 'node:dns/promises';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http, { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import https, { createServer as createSecureServer } from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { after, afterEach, mock, test } from 'node:test';
import {
  answerProof,
  NONCE_PARAM,
  OFFICE_PROOF_PATH,
  proofAnswer,
  PROXY_HEADER,
  provesOffice,
  proxySecret
} from '../src/office-proof.ts';

/** A key in the shape the office makes, so no real key is ever near these tests. */
const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
});

test('the prover imports only Node’s own modules, so the release scripts can import it by its path', () => {
  const source = readFileSync(new URL('../src/office-proof.ts', import.meta.url), 'utf8');
  const specifiers = [...source.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'/g)].map(
    (m) => m[1] ?? m[2]
  );
  assert.ok(specifiers.length > 0, 'no import to check');
  assert.deepEqual(
    specifiers.filter((s) => !s.startsWith('node:')),
    []
  );
});

test('the proxy secret and the proof answer match the known answer the shell checks too', () => {
  // Worked out with openssl's HMAC-SHA256, not with this module.
  assert.equal(
    proxySecret(KEY),
    '57d69d233ca277588f238304dbc9becc27a567d67f4e4b3b5c6262df03e16445'
  );
  assert.equal(
    proofAnswer(KEY, '00112233445566778899aabbccddeeff', 'proxy:https'),
    '19abd2febf443a57e45c5792a1c8ab1038892f01aed5262c386f57cea5ed860a'
  );
  assert.equal(
    proofAnswer(KEY, '00112233445566778899aabbccddeeff', 'direct'),
    'fe5da38501d71f0d941745ef27bdf1bd4711f009683db3e551a3a5c729988668'
  );
});

const NONCE = '0123456789abcdef0123456789abcdef';

test('the route answers 400 and no hash to a nonce that is missing, the wrong length or not lowercase hex', () => {
  for (const nonce of [null, '', NONCE.slice(1), `${NONCE}0`, NONCE.toUpperCase(), 'g'.repeat(32)])
    assert.deepEqual(
      answerProof(KEY, nonce, null),
      { status: 400, body: 'A proof needs a nonce of 32 lowercase hex characters' },
      String(nonce)
    );
});

test('the route reads a request as through Caddy only when the proxy header holds the key’s secret; any other value is direct', () => {
  const answer = (header: string | null) => answerProof(KEY, NONCE, header);
  assert.deepEqual(answer(null), { status: 200, body: proofAnswer(KEY, NONCE, 'direct') });
  assert.deepEqual(answer(`${proxySecret(KEY)} http`), {
    status: 200,
    body: proofAnswer(KEY, NONCE, 'proxy:http')
  });
  assert.deepEqual(answer(`${proxySecret(KEY)} https`), {
    status: 200,
    body: proofAnswer(KEY, NONCE, 'proxy:https')
  });
  for (const guess of [
    'guess http',
    `${'0'.repeat(64)} http`,
    proxySecret(KEY),
    `${proxySecret(KEY)} ftp`,
    `${proxySecret('another key')} http`
  ])
    assert.deepEqual(
      answer(guess),
      { status: 200, body: proofAnswer(KEY, NONCE, 'direct') },
      guess
    );
});

type Seen = { method?: string; url?: string; headers: string[] };

/** A listener on `host` (port 0 for a free one) that records every request whole, then answers with `handle`. */
async function listen(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
  host = '127.0.0.1',
  port = 0
) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.rawHeaders });
    handle(req, res);
  });
  await new Promise<void>((ready, fail) => {
    server.once('error', fail);
    server.listen(port, host, ready);
  });
  const at = (server.address() as AddressInfo).port;
  after(() => server.close());
  return { port: at, seen };
}

/** The office's answer, as its route gives it. */
function office(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://office');
  if (url.pathname !== OFFICE_PROOF_PATH) return void res.writeHead(404).end();
  const header = req.headers[PROXY_HEADER.toLowerCase()];
  const { status, body } = answerProof(
    KEY,
    url.searchParams.get(NONCE_PARAM),
    typeof header === 'string' ? header : null
  );
  res.writeHead(status).end(body);
}

/** A relay to `port` on 127.0.0.1, setting the proxy header to `header` when one is given, as Caddy's header_up does. */
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

/** Nothing any listener saw holds the key, a cookie or the address parameter that carries it. */
function heldNoKey(...listeners: { seen: Seen[] }[]) {
  const all = JSON.stringify(listeners.flatMap((l) => l.seen));
  for (const word of [KEY, 'oddboro-owner', 'oddboro-key', 'cookie'])
    assert.ok(!all.toLowerCase().includes(word.toLowerCase()), `a listener saw ${word}`);
}

/** Every request the prover sends, by Node's own request functions. */
function countRequests(): () => number {
  const h = mock.method(http, 'request');
  const s = mock.method(https, 'request');
  syncBuiltinESMExports();
  return () => h.mock.callCount() + s.mock.callCount();
}

/** Names resolve to `addresses` alone. Gives how many lookups ran. */
function resolveTo(...addresses: string[]): () => number {
  const lookup = mock.method(dns, 'lookup', async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  );
  syncBuiltinESMExports();
  return () => lookup.mock.callCount();
}

test('a squatter that answers 404 is not the office, and never sees the key', async () => {
  const squatter = await listen((_req, res) => res.writeHead(404).end());
  assert.equal(await provesOffice(`http://127.0.0.1:${squatter.port}`, KEY, 'direct'), false);
  assert.equal(squatter.seen.length, 1);
  heldNoKey(squatter);
});

test('a squatter that answers 200 with any fixed text is not the office, and never sees the key', async () => {
  for (const text of ['{"office":true}', 'ok', proofAnswer(KEY, NONCE, 'direct')]) {
    const squatter = await listen((_req, res) => res.end(text));
    assert.equal(await provesOffice(`http://127.0.0.1:${squatter.port}`, KEY, 'direct'), false);
    heldNoKey(squatter);
  }
});

test('a squatter that replays a proof the office gave earlier is not the office, since each nonce is fresh', async () => {
  const real = await listen(office);
  let captured: string | undefined;
  const squatter = await listen((req, res) => {
    if (captured !== undefined) return void res.end(captured);
    // The first time, it asks the office itself and keeps the answer.
    http.get({ host: '127.0.0.1', port: real.port, path: req.url }, (answer) => {
      let body = '';
      answer.on('data', (c) => (body += c));
      answer.on('end', () => res.end((captured = body)));
    });
  });
  const url = `http://127.0.0.1:${squatter.port}`;
  assert.equal(await provesOffice(url, KEY, 'direct'), true, 'the first relay is the office');
  assert.equal(await provesOffice(url, KEY, 'direct'), false);
  heldNoKey(squatter, real);
});

test('the office at its own port proves itself as direct, and not as through Caddy', async () => {
  const real = await listen(office);
  assert.equal(await provesOffice(`http://127.0.0.1:${real.port}`, KEY, 'direct'), true);
  assert.equal(await provesOffice(`http://127.0.0.1:${real.port}`, KEY, 'proxy:http'), false);
  assert.equal(await provesOffice(`http://127.0.0.1:${real.port}`, 'another key', 'direct'), false);
  heldNoKey(real);
});

test('a port 80 squatter that hands only the proof to the office’s own port fails a proof that expects Caddy', async () => {
  const real = await listen(office);
  const squatter = await listen(relay(real.port));
  const url = `http://127.0.0.1:${squatter.port}`;
  assert.equal(await provesOffice(url, KEY, 'proxy:http'), false);
  // The relay does reach the office: only the listener it names is wrong.
  assert.equal(await provesOffice(url, KEY, 'direct'), true);
  heldNoKey(squatter, real);
});

test('a squatter that sends its own guess at the proxy header gets the direct answer, so it fails a proof through Caddy', async () => {
  const real = await listen(office);
  const squatter = await listen(relay(real.port, `${'0'.repeat(64)} http`));
  assert.equal(await provesOffice(`http://127.0.0.1:${squatter.port}`, KEY, 'proxy:http'), false);
  heldNoKey(squatter, real);
});

test('the office through Caddy, which sets the proxy header from the key, proves itself through Caddy', async () => {
  const real = await listen(office);
  const caddy = await listen(relay(real.port, `${proxySecret(KEY)} http`));
  assert.equal(await provesOffice(`http://127.0.0.1:${caddy.port}`, KEY, 'proxy:http'), true);
  assert.equal(await provesOffice(`http://127.0.0.1:${caddy.port}`, KEY, 'direct'), false);
  heldNoKey(caddy, real);
});

test('a listener that answers the proof with a redirect to the office is not the office: no redirect is followed', async () => {
  const real = await listen(office);
  const squatter = await listen((req, res) =>
    res.writeHead(302, { location: `http://127.0.0.1:${real.port}${req.url}` }).end()
  );
  assert.equal(await provesOffice(`http://127.0.0.1:${squatter.port}`, KEY, 'direct'), false);
  assert.equal(real.seen.length, 0);
  heldNoKey(squatter, real);
});

test('the loopback addresses written as addresses are proven with no lookup', async () => {
  const lookups = resolveTo('192.0.2.1');
  const real = await listen(office);
  const v6 = await listen(office, '::1', real.port).catch(() => undefined);
  assert.equal(await provesOffice(`http://127.0.0.1:${real.port}`, KEY, 'direct'), true);
  if (v6) assert.equal(await provesOffice(`http://[::1]:${real.port}`, KEY, 'direct'), true);
  assert.equal(lookups(), 0);
});

test('a name proves only when every address it resolves to is the office, and each is asked with the name as its Host', async () => {
  const real = await listen(office);
  const v6 = await listen(office, '::1', real.port);
  resolveTo('::1', '127.0.0.1');
  assert.equal(await provesOffice(`http://oddboro.localhost:${real.port}`, KEY, 'direct'), true);
  for (const { seen } of [real, v6]) {
    assert.equal(seen.length, 1);
    const at = seen[0].headers.findIndex((h) => h.toLowerCase() === 'host');
    assert.equal(seen[0].headers[at + 1], `oddboro.localhost:${real.port}`);
  }
  heldNoKey(real, v6);
});

test('a name fails when something other than the office holds one of its addresses, whichever comes first', async () => {
  const real = await listen(office);
  const squatter = await listen((_req, res) => res.writeHead(404).end(), '::1', real.port);
  for (const order of [
    ['127.0.0.1', '::1'],
    ['::1', '127.0.0.1']
  ]) {
    resolveTo(...order);
    assert.equal(
      await provesOffice(`http://oddboro.localhost:${real.port}`, KEY, 'direct'),
      false,
      order.join(' then ')
    );
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  heldNoKey(real, squatter);
});

test('a name that resolves anywhere but 127.0.0.1 and ::1, alone or beside them, is refused with no request sent', async () => {
  for (const addresses of [
    ['192.0.2.1'],
    ['127.0.0.1', '192.0.2.1'],
    ['::1', '2001:db8::1'],
    ['127.0.0.2'],
    ['127.0.0.1', '127.0.0.2'],
    ['::ffff:127.0.0.1'],
    []
  ]) {
    resolveTo(...addresses);
    const requests = countRequests();
    assert.equal(
      await provesOffice('http://local.oddboro.com', KEY, 'proxy:http'),
      false,
      addresses.join(', ')
    );
    assert.equal(requests(), 0, addresses.join(', '));
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  const requests = countRequests();
  for (const url of [
    'http://127.0.0.2',
    'http://10.0.0.1',
    'http://[2001:db8::1]',
    'ftp://127.0.0.1'
  ])
    assert.equal(await provesOffice(url, KEY, 'direct'), false, url);
  assert.equal(requests(), 0);
});

const OPENSSL = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test(
  'over https the office through Caddy proves itself, asked by its name for the certificate, with no key sent',
  { skip: !OPENSSL && 'no openssl here to make a certificate' },
  async () => {
    const folder = mkdtempSync(join(tmpdir(), 'oddboro-proof-tls-'));
    after(() => rmSync(folder, { recursive: true, force: true }));
    const [keyFile, certFile] = [join(folder, 'key.pem'), join(folder, 'cert.pem')];
    // A certificate no one trusts, as Caddy's own authority is to Node.
    execFileSync(
      'openssl',
      // prettier-ignore
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=local.oddboro.com', '-keyout', keyFile, '-out', certFile],
      { stdio: 'ignore' }
    );
    const real = await listen(office);
    const names: TLSSocket['servername'][] = [];
    const seen: Seen[] = [];
    const caddy = createSecureServer(
      { key: readFileSync(keyFile), cert: readFileSync(certFile) },
      (req, res) => {
        names.push((req.socket as TLSSocket).servername);
        seen.push({ method: req.method, url: req.url, headers: req.rawHeaders });
        relay(real.port, `${proxySecret(KEY)} https`)(req, res);
      }
    );
    await new Promise<void>((ready) => caddy.listen(0, '127.0.0.1', ready));
    after(() => caddy.close());
    const { port } = caddy.address() as AddressInfo;
    resolveTo('127.0.0.1');
    assert.equal(await provesOffice(`https://local.oddboro.com:${port}`, KEY, 'proxy:https'), true);
    assert.equal(await provesOffice(`https://local.oddboro.com:${port}`, KEY, 'proxy:http'), false);
    assert.deepEqual(names, ['local.oddboro.com', 'local.oddboro.com']);
    heldNoKey({ seen }, real);
  }
);
