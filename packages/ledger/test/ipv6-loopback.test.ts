// The office holds [::1] on its port beside 127.0.0.1, so no relay can sit
// where `oddboro.localhost` reaches first. Real listeners on random ports.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import { createServer as createHttpServer, request, type Server } from 'node:http';
import net, { createServer } from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, mock, test } from 'node:test';
import { holdIpv6Loopback } from '../src/ipv6-loopback.ts';
import { answerProof, provesOffice } from '../src/office-proof.ts';

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const open: Server[] = [];

afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
  for (const s of open.splice(0)) s.close();
});

/** An office stand-in on 127.0.0.1 at a random port: it answers the proof, and anything else after `hold` lets it. */
async function office(hold?: Promise<void>): Promise<{ http: Server; port: number }> {
  const http = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/api/office-proof') {
      const { status, body } = answerProof(KEY, url.searchParams.get('n'), null);
      res.writeHead(status).end(body);
      return;
    }
    await hold;
    res.end(`answered on ${req.socket.localAddress}`);
  });
  open.push(http);
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  return { http, port: (http.address() as net.AddressInfo).port };
}

const listening = (s: net.Server) =>
  new Promise<void>((done, fail) => s.once('listening', done).once('error', fail));

function get(host: string, port: number): Promise<string> {
  return new Promise((done, fail) =>
    request({ host, port, path: '/', agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c)).on('end', () => done(body));
    })
      .on('error', fail)
      .end()
  );
}

/** Whether something else can take [::1] on `port`. */
function relayBinds(port: number): Promise<boolean> {
  const relay = createServer();
  return new Promise((done) =>
    relay
      .once('error', () => done(false))
      .listen({ host: '::1', port }, () => relay.close(() => done(true)))
  );
}

test('the office answers on [::1] at its own port, through its one HTTP server', async () => {
  const { http, port } = await office();
  holdIpv6Loopback(http);
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(await get('::1', port), 'answered on ::1');
  assert.equal(await get('127.0.0.1', port), 'answered on 127.0.0.1');
});

test('a relay cannot bind [::1] at the office port once the office holds it', async () => {
  const { http, port } = await office();
  holdIpv6Loopback(http);
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(await relayBinds(port), false);
});

test('the office holds [::1] even when its HTTP server is not listening yet', async () => {
  const http = createHttpServer((_req, res) => res.end('late'));
  open.push(http);
  holdIpv6Loopback(http);
  http.listen(0, '127.0.0.1');
  await listening(http);
  const { port } = http.address() as net.AddressInfo;
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(await get('::1', port), 'late');
});

test("something already on [::1] at the port is the office's own error, as for 127.0.0.1", async () => {
  const { http, port } = await office();
  const squatter = createServer();
  open.push(squatter as unknown as Server);
  await new Promise<void>((done) => squatter.listen({ host: '::1', port }, done));
  const error = await new Promise<NodeJS.ErrnoException>((done) => {
    http.once('error', done);
    holdIpv6Loopback(http);
  });
  assert.equal(error.code, 'EADDRINUSE');
  assert.equal((error as { address?: string }).address, '::1');
});

test('an office whose [::1] is taken stops, with the port-taken error', async () => {
  // A child with nothing listening for the error, as the built office has none.
  const squatter = createServer();
  open.push(squatter as unknown as Server);
  await new Promise<void>((done) => squatter.listen({ host: '::1', port: 0 }, done));
  const { port } = squatter.address() as net.AddressInfo;
  // A file: URL, since the ESM loader takes no Windows drive path.
  const module = new URL('../src/ipv6-loopback.ts', import.meta.url).href;
  const script = `import { holdIpv6Loopback } from ${JSON.stringify(module)};
    import { createServer } from 'node:http';
    const s = createServer(); s.listen(${port}, '127.0.0.1'); holdIpv6Loopback(s);`;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  // The timeout ends a child whose office never stops, so that fails here
  // rather than hangs the run.
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env,
    timeout: 5000
  });
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  const code = await new Promise<number | null>((done) => child.on('close', done));
  assert.notEqual(code, 0);
  assert.match(stderr, new RegExp(`EADDRINUSE.*::1:${port}`));
});

test('with no IPv6 loopback the office runs on 127.0.0.1, and oddboro.localhost is not proven', async () => {
  const { http, port } = await office();
  const refuse = Object.assign(new Error('listen EADDRNOTAVAIL'), { code: 'EADDRNOTAVAIL' });
  mock.method(net.Server.prototype, 'listen', function (this: net.Server) {
    process.nextTick(() => this.emit('error', refuse));
    return this;
  });
  const errors: Error[] = [];
  http.on('error', (e) => errors.push(e));
  holdIpv6Loopback(http);
  await new Promise((done) => setTimeout(done, 50));
  mock.restoreAll();
  assert.deepEqual(errors, []);
  assert.equal(await get('127.0.0.1', port), 'answered on 127.0.0.1');
  assert.equal(await provesOffice(`http://127.0.0.1:${port}`, KEY, 'direct'), true);
  mock.method(dns, 'lookup', async () => [
    { address: '::1', family: 6 },
    { address: '127.0.0.1', family: 4 }
  ]);
  syncBuiltinESMExports();
  assert.equal(await provesOffice(`http://oddboro.localhost:${port}`, KEY, 'direct'), false);
});

test("the office's close waits for a request that came in on [::1], then frees it", async () => {
  let release = () => {};
  const { http, port } = await office(new Promise<void>((done) => (release = done)));
  holdIpv6Loopback(http);
  await new Promise((done) => setTimeout(done, 50));
  const reply = get('::1', port);
  await new Promise((done) => setTimeout(done, 50));
  let closed = false;
  const close = new Promise<void>((done) =>
    http.close(() => {
      closed = true;
      done();
    })
  );
  await new Promise((done) => setTimeout(done, 100));
  // Released either way, so a close that did not wait fails here rather than hangs.
  release();
  assert.equal(closed, false, 'the close waits for the [::1] request');
  assert.equal(await reply, 'answered on ::1');
  await close;
  assert.equal(await relayBinds(port), true);
});
