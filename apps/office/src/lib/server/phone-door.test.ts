// The phone's door (phone-door.ts): who it lets through, and what the office
// then sees. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { fromThisComputer } from './this-computer.ts';

const { door, extraHosts, NOT_THE_TAILNET, officeHeaders, phoneLocation, throughTailnet } =
  await import('./phone-door.ts');
const { OFFICE_PORT, OFFICE_URL } = await import('@oddboro/ledger/home');

const NAME = 'home-pc.tail1234.ts.net';
const LOGIN = { 'tailscale-user-login': 'owner@example.com' };

test('the listed names are bare, lower case, from names or addresses', () => {
  assert.deepEqual(extraHosts(' Home-PC.tail1234.ts.net , https://laptop.tail1234.ts.net:443/,'), [
    NAME,
    'laptop.tail1234.ts.net'
  ]);
  assert.deepEqual(extraHosts(undefined), []);
});

test('the door lets in only the tailnet, at a listed name', () => {
  assert.equal(throughTailnet({ host: NAME, ...LOGIN }, [NAME]), true);
  assert.equal(throughTailnet({ host: `${NAME}:443`, ...LOGIN }, [NAME]), true);
  // No tailnet login: a program on this computer, or `tailscale funnel` from the internet.
  assert.equal(throughTailnet({ host: NAME }, [NAME]), false);
  // A name the owner never listed, such as a site pointing its own name here.
  assert.equal(throughTailnet({ host: 'evil.example', ...LOGIN }, [NAME]), false);
  assert.equal(throughTailnet({ host: NAME, ...LOGIN }, []), false);
});

test('the office is asked at its own address, without what Tailscale added', () => {
  const out = officeHeaders({
    host: NAME,
    origin: `https://${NAME}`,
    'sec-fetch-site': 'same-origin',
    'x-forwarded-for': '100.64.0.7',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': NAME,
    'tailscale-user-name': 'Owner',
    cookie: 'a=b',
    ...LOGIN
  });
  assert.deepEqual(out, {
    host: `127.0.0.1:${OFFICE_PORT}`,
    origin: OFFICE_URL,
    'sec-fetch-site': 'same-origin',
    cookie: 'a=b'
  });
  // An Origin from anywhere else stays as it came, so the guard refuses it.
  assert.equal(
    officeHeaders({ host: NAME, origin: 'https://evil.example' }).origin,
    'https://evil.example'
  );
});

test("a Location at the office's address becomes one the phone can follow", () => {
  assert.equal(phoneLocation(`${OFFICE_URL}/desk#desk`), '/desk#desk');
  assert.equal(phoneLocation(OFFICE_URL), '/');
  assert.equal(phoneLocation('/desk'), '/desk');
  assert.equal(phoneLocation(undefined), undefined);
});

/** Listen on a free port on 127.0.0.1 and give back its address. */
const listen = (server: Server) =>
  new Promise<string>((done) =>
    server.listen(0, '127.0.0.1', () =>
      done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    )
  );

/** A request with the headers as given, Host included, which fetch would not send. */
const ask = (url: string, headers: Record<string, string>, method = 'GET', body = '') =>
  new Promise<{ status: number; location?: string; text: string }>((done, fail) => {
    const r = request(url, { method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => done({ status: res.statusCode!, location: res.headers.location, text }));
    });
    r.on('error', fail);
    r.end(body);
  });

test('through the door, the office sees this computer and the browser as it was', async () => {
  let seen: IncomingMessage | undefined;
  let body = '';
  const office = createServer((req, res) => {
    seen = req;
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(303, { location: `${OFFICE_URL}/desk` });
      res.end('moved');
    });
  });
  const front = door(await listen(office));
  const at = await listen(front);
  process.env.ODDBORO_EXTRA_HOSTS = NAME;
  try {
    const refused = await ask(`${at}/desk`, { host: NAME });
    assert.equal(refused.status, 403);
    assert.equal(refused.text, NOT_THE_TAILNET);
    assert.equal(seen, undefined);

    const r = await ask(
      `${at}/api/asks/1`,
      { host: NAME, 'x-forwarded-for': '100.64.0.7', 'content-type': 'text/plain', ...LOGIN },
      'POST',
      'yes'
    );
    assert.equal(r.status, 303);
    assert.equal(r.location, '/desk');
    assert.equal(body, 'yes');
    assert.equal(seen!.url, '/api/asks/1');
    assert.equal(seen!.headers.host, `127.0.0.1:${OFFICE_PORT}`);
    assert.equal(
      fromThisComputer({
        forwardedFor: seen!.headers['x-forwarded-for'] as string | undefined,
        peer: seen!.socket.remoteAddress ?? ''
      }),
      true
    );
  } finally {
    delete process.env.ODDBORO_EXTRA_HOSTS;
    front.close();
    office.close();
  }
});
