// The office's own Caddyfile (`ownCaddyfile` in address.ts) on each system,
// the look at port 80 (`port80`), which of its commands may show a window,
// what a failed Make it secure says on each system and on one the office does
// not know (`secureAddress`), the proxy header on every one of Caddy's
// routes, and the office's look at its own address (`answers`), which proves
// it without ever sending the owner's key.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, mock, test } from 'node:test';
import { isHttpError } from '@sveltejs/kit';
import { PROXY_HEADER, proxySecret } from '@oddboro/ledger/office-proof';
import { OWNER_COOKIE, OWNER_PARAM, ownerKey } from '@oddboro/ledger/owner-key';
import { openUrl, probe, type Probe, type System } from '@oddboro/ledger/platform';
import { GET as proofRoute } from '../../routes/api/office-proof/+server.ts';
import { POST as addressRoute } from '../../routes/api/setup/address/+server.ts';
import {
  answers,
  keepAddress,
  ownCaddyfile,
  port80,
  secureAddress,
  type Port80
} from './address.ts';

/** A key in the shape the office makes, for the Caddyfile's text alone. */
const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const SYSTEMS: System[] = ['mac', 'linux', 'windows'];

const binds = (system: Parameters<typeof ownCaddyfile>[0]) =>
  ownCaddyfile(system, KEY)
    .split('\n')
    .filter((l) => /^\s*(default_)?bind\b/.test(l));

test("the office's own Caddy listens on the loopback addresses only on Windows; on a Mac, where a user binds a low port only on every address, and on Linux, unmeasured, it names no address", () => {
  assert.deepEqual(binds('windows'), ['\tdefault_bind 127.0.0.1 [::1]']);
  assert.deepEqual(binds('mac'), []);
  assert.deepEqual(binds('linux'), []);
});

/** The value each `header_up` in a Caddyfile sets the proxy header to. */
const headerUps = (caddyfile: string) =>
  [...caddyfile.matchAll(/^\t\theader_up (\S+) "([^"]*)"$/gm)].map((m) => [m[1], m[2]]);

test("every reverse_proxy in the office's own Caddyfile sets the proxy header from the key, on all three systems", () => {
  for (const system of SYSTEMS) {
    const caddyfile = ownCaddyfile(system, KEY);
    const proxies = caddyfile.match(/^\treverse_proxy /gm) ?? [];
    assert.ok(proxies.length > 0, system);
    assert.deepEqual(
      headerUps(caddyfile),
      proxies.map(() => [PROXY_HEADER, `${proxySecret(KEY)} {http.request.scheme}`]),
      system
    );
    assert.ok(!caddyfile.includes(KEY), `${system}: the Caddyfile holds the key itself`);
    assert.notDeepEqual(headerUps(ownCaddyfile(system, `${KEY.slice(1)}A`)), headerUps(caddyfile));
  }
});

const folder = mkdtempSync(join(tmpdir(), 'oddboro-port80-'));
after(() => rmSync(folder, { recursive: true, force: true }));

/** A folder holding one stand-in command, a shell script with this body. */
function standIn(name: string, body: string): string {
  const dir = mkdtempSync(join(folder, `${name}-`));
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
  return dir;
}
const empty = mkdtempSync(join(folder, 'empty-'));

/**
 * `fn` as on `platform`, with PATH only `path`. The office's own `onPlatform`
 * lives in office-under-test.ts, which starts a whole office as it loads.
 */
async function on<T>(platform: NodeJS.Platform, path: string, fn: () => Promise<T>): Promise<T> {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  const was = process.env.PATH;
  Object.defineProperty(process, 'platform', { value: platform });
  process.env.PATH = path;
  try {
    return await fn();
  } finally {
    if (real) Object.defineProperty(process, 'platform', real);
    process.env.PATH = was;
  }
}

const SHELL_STAND_INS = {
  skip: process.platform === 'win32' && 'the stand-ins are shell scripts'
};

test(
  'on Linux, with no ss, the port 80 check says it could not look, never that the port is free',
  SHELL_STAND_INS,
  async () => {
    assert.deepEqual(await on('linux', empty, port80), { status: 'unchecked' });
    assert.deepEqual(await on('linux', standIn('ss', 'exit 0'), port80), { status: 'free' });
    assert.deepEqual(await on('linux', standIn('ss', 'exit 1'), port80), { status: 'unchecked' });
    assert.deepEqual(
      await on('linux', standIn('ss', 'echo "LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*"'), port80),
      { status: 'held', by: 'another program' }
    );
    assert.deepEqual(
      await on(
        'linux',
        standIn('ss', `echo 'LISTEN 0 4096 *:80 *:* users:(("caddy",pid=812,fd=9))'`),
        port80
      ),
      { status: 'held', by: 'caddy' }
    );
  }
);

/**
 * The look at port 80 on `platform`, with every command it starts coming back
 * as `answer`, the way `probe` would read it. Gives the commands it started
 * and what it found. The Mac's lsof goes by its full path, which no PATH
 * stand-in can take the place of, so the stand-in goes on execFile.
 */
async function port80On(
  platform: NodeJS.Platform,
  answer: Probe
): Promise<{ started: string[]; port80: Port80 }> {
  const started: string[] = [];
  mock.method(
    childProcess,
    'execFile',
    (
      cmd: string,
      _args: string[],
      _options: object,
      done: (e: Error | null, out: string, err: string) => void
    ) => {
      started.push(cmd);
      switch (answer.status) {
        case 'ok':
          done(null, answer.out, answer.err);
          break;
        case 'failed':
          done(Object.assign(new Error('exited'), { code: answer.code }), answer.out, answer.err);
          break;
        // As Node reports a command that is not there, and one its timer stopped.
        case 'missing':
          done(
            Object.assign(new Error('not there'), { code: 'ENOENT', syscall: `spawn ${cmd}` }),
            '',
            ''
          );
          break;
        case 'timeout':
          done(Object.assign(new Error('stopped'), { killed: true }), '', '');
          break;
      }
      return {};
    }
  );
  syncBuiltinESMExports();
  try {
    return { started, port80: await on(platform, empty, port80) };
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
}

const ok = (out: string): Probe => ({ status: 'ok', out, err: '' });
const exited = (code: number, out = '', err = ''): Probe => ({ status: 'failed', code, out, err });

test('each system looks at port 80 with its own command: lsof by its full path on a Mac, ss by name on Linux, PowerShell on Windows', async () => {
  // Keyed by system, so a system added to the office fails the type check here until it is listed.
  const RUNS: Record<System, { platform: NodeJS.Platform; cmd: string }> = {
    mac: { platform: 'darwin', cmd: '/usr/sbin/lsof' },
    linux: { platform: 'linux', cmd: 'ss' },
    windows: { platform: 'win32', cmd: 'powershell.exe' }
  };
  for (const [system, { platform, cmd }] of Object.entries(RUNS))
    assert.deepEqual((await port80On(platform, ok(''))).started, [cmd], system);
});

test('on a Mac, a missing lsof is not a free port', async () => {
  const mac = async (answer: Probe) => (await port80On('darwin', answer)).port80;
  assert.deepEqual(await mac({ status: 'missing' }), { status: 'unchecked' });
  assert.deepEqual(await mac(exited(1)), { status: 'free' });
  assert.deepEqual(await mac(exited(1, '', 'lsof: a problem\n')), { status: 'free' });
  assert.deepEqual(await mac(exited(1, 'p1\n')), { status: 'unchecked' });
  assert.deepEqual(await mac(ok('p812\ncnginx\n')), { status: 'held', by: 'nginx' });
  assert.deepEqual(await mac({ status: 'timeout' }), { status: 'unchecked' });
});

test('on Windows, only an answer naming nothing is a free port: one naming a program is held, and a failed, missing or stopped look is unchecked', async () => {
  const windows = async (answer: Probe) => (await port80On('win32', answer)).port80;
  assert.deepEqual(await windows(ok('')), { status: 'free' });
  assert.deepEqual(await windows(ok('nginx\r\n')), { status: 'held', by: 'nginx' });
  assert.deepEqual(await windows(exited(1)), { status: 'unchecked' });
  assert.deepEqual(await windows({ status: 'missing' }), { status: 'unchecked' });
  assert.deepEqual(await windows({ status: 'timeout' }), { status: 'unchecked' });
});

test("on Windows, a command runs with no window unless it opens one the owner must see: certutil's trust dialog and the browser", async () => {
  const started: { cmd: string; args: string[]; options: object }[] = [];
  const page = 'https://local.oddboro.com';
  // probe reaches execFile through its import, so the stand-in goes on the
  // module and the import is brought up to date with it.
  mock.method(
    childProcess,
    'execFile',
    (cmd: string, args: string[], options: object, done: (e: Error) => void) => {
      started.push({ cmd, args, options });
      done(Object.assign(new Error('a stand-in that fails'), { code: 1 }));
      return {};
    }
  );
  // Caddy's admin API, asked for the root certificate, answers with one.
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ root_certificate: 'a root certificate' })
  );
  syncBuiltinESMExports();
  try {
    await on('win32', empty, async () => {
      await probe('anything', []);
      await assert.rejects(secureAddress(), /The certificate was not trusted/);
      await openUrl(page);
    });
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  const hides = (what: string, which: (s: (typeof started)[number]) => boolean) => {
    const o = started.find(which)?.options;
    assert.ok(o, `${what} never started`);
    return 'windowsHide' in o ? o.windowsHide : 'not set';
  };
  assert.equal(
    hides('a command', (s) => s.cmd === 'anything'),
    true
  );
  assert.equal(
    hides('certutil', (s) => s.cmd === 'certutil.exe'),
    'not set'
  );
  assert.equal(
    hides('the opener', (s) => s.args.some((arg) => arg === page)),
    'not set'
  );
});

test('on a system the office does not know, Make it secure runs nothing, and the setup route answers 502 with the words the owner sees', async () => {
  const started: string[] = [];
  mock.method(
    childProcess,
    'execFile',
    (cmd: string, _args: string[], _options: object, done: (e: Error) => void) => {
      started.push(cmd);
      done(Object.assign(new Error('a stand-in that fails'), { code: 1 }));
      return {};
    }
  );
  // Caddy's admin API, asked for the root certificate, answers with one.
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ root_certificate: 'a root certificate' })
  );
  syncBuiltinESMExports();
  try {
    const request = new Request('http://127.0.0.1/api/setup/address', {
      method: 'POST',
      body: JSON.stringify({ action: 'secure' })
    });
    const answer = await on('freebsd', empty, () =>
      // The route reads only the request, so the rest of Kit's event is left out.
      Promise.resolve(addressRoute({ request } as Parameters<typeof addressRoute>[0])).then(
        () => undefined,
        (e: unknown) => e
      )
    );
    assert.ok(isHttpError(answer), `the route answered ${String(answer)}`);
    assert.deepEqual(
      [answer.status, answer.body.message],
      [502, 'The certificate was not trusted. Try again, and enter your password.']
    );
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(started, []);
});

/** What a failed Make it secure tells the owner on each system, written out. */
const NOT_TRUSTED: [NodeJS.Platform, string][] = [
  ['darwin', 'The certificate was not trusted. Try again, and enter your password.'],
  ['linux', 'The certificate was not trusted. Try again, and enter your password.'],
  ['win32', 'The certificate was not trusted. Try again, and confirm when Windows asks.']
];

test('when Make it secure fails, the setup route tells a Mac or Linux owner to enter their password, and a Windows owner to confirm when Windows asks', async () => {
  const started: string[] = [];
  // Every system's trust command fails.
  mock.method(
    childProcess,
    'execFile',
    (cmd: string, _args: string[], _options: object, done: (e: Error) => void) => {
      started.push(cmd);
      done(Object.assign(new Error('a stand-in that fails'), { code: 1 }));
      return {};
    }
  );
  // Caddy's admin API, asked for the root certificate, answers with one.
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ root_certificate: 'a root certificate' })
  );
  syncBuiltinESMExports();
  try {
    for (const [platform, words] of NOT_TRUSTED) {
      const request = new Request('http://127.0.0.1/api/setup/address', {
        method: 'POST',
        body: JSON.stringify({ action: 'secure' })
      });
      const answer = await on(platform, empty, () =>
        // The route reads only the request, so the rest of Kit's event is left out.
        Promise.resolve(addressRoute({ request } as Parameters<typeof addressRoute>[0])).then(
          () => undefined,
          (e: unknown) => e
        )
      );
      assert.ok(isHttpError(answer), `${platform}: the route answered ${String(answer)}`);
      assert.deepEqual([answer.status, answer.body.message], [502, words], platform);
    }
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  // Each system's own trust command ran and failed, so each line is the failure's.
  assert.deepEqual(started, ['osascript', 'pkexec', 'certutil.exe']);
});

type Seen = { url?: string; headers: string[] };

/** A listener on 127.0.0.1 at a free port that records every request whole. */
async function listen(handle: (req: IncomingMessage, res: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, headers: req.rawHeaders });
    handle(req, res);
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  after(() => server.close());
  return { port: (server.address() as AddressInfo).port, seen };
}

/** The office's proof route itself, answering at a listener. */
async function office(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (typeof value === 'string') headers.set(name, value);
  // The route reads only the address and the headers, so the rest of Kit's event is left out.
  const answer = await proofRoute({ url, request: new Request(url, { headers }) } as Parameters<
    typeof proofRoute
  >[0]);
  res.writeHead(answer.status).end(await answer.text());
}

/** A stand-in for the office's own Caddy: it sets the proxy header as its Caddyfile says, and hands the request to the office. */
function caddy(scheme: 'http' | 'https') {
  const [[name, value]] = headerUps(ownCaddyfile('mac', ownerKey()));
  return (req: IncomingMessage, res: ServerResponse) => {
    req.headers[name.toLowerCase()] = value.replace('{http.request.scheme}', scheme);
    void office(req, res);
  };
}

/** Nothing a listener saw holds the owner's key, its cookie or the address parameter that carries it. */
function heldNoKey(...listeners: { seen: Seen[] }[]) {
  const all = JSON.stringify(listeners.flatMap((l) => l.seen)).toLowerCase();
  for (const word of [ownerKey(), OWNER_COOKIE, OWNER_PARAM, 'cookie'])
    assert.ok(!all.includes(word.toLowerCase()), `a listener saw ${word}`);
}

test("a squatter on the office's address that answers 404 is not the office, and never sees the owner's key", async () => {
  const squatter = await listen((_req, res) => res.writeHead(404).end());
  assert.equal(await answers(`http://127.0.0.1:${squatter.port}`), false);
  assert.equal(squatter.seen.length, 1);
  heldNoKey(squatter);
});

test("a squatter that answers as the office's old probe did is not the office, and never sees the owner's key", async () => {
  const squatter = await listen((_req, res) => res.end(JSON.stringify({ office: true })));
  assert.equal(await answers(`http://127.0.0.1:${squatter.port}`), false);
  heldNoKey(squatter);
});

test("the office through its Caddy is the office's address, and the office's own port, or a program that hands the proof to it, is not", async () => {
  const through = await listen(caddy('http'));
  assert.equal(await answers(`http://127.0.0.1:${through.port}`), true);
  const direct = await listen((req, res) => void office(req, res));
  assert.equal(await answers(`http://127.0.0.1:${direct.port}`), false);
  heldNoKey(through, direct);
});

/**
 * A stand-in for the owner's Caddy admin API, holding the office's routes by
 * their ids. Gives every change the office asked of it.
 */
function adminApi(routes: Record<string, unknown>) {
  const changes: { method: string; path: string; body: unknown }[] = [];
  mock.method(globalThis, 'fetch', async (input: string, init: RequestInit = {}) => {
    const path = new URL(input).pathname;
    const method = init.method ?? 'GET';
    if (method !== 'GET') {
      changes.push({ method, path, body: JSON.parse(String(init.body)) });
      return new Response('{}');
    }
    if (path === '/config/apps/http/servers')
      return Response.json({ srv0: { listen: [':80'] }, srv1: { listen: [':443'] } });
    const id = path.match(/^\/id\/(.+)$/)?.[1];
    if (id && id in routes) return Response.json(routes[id]);
    return new Response('not found', { status: 404 });
  });
  return changes;
}

/** A route as the office writes it, as far as these tests read it. */
type ProxyRoute = {
  '@id': string;
  handle: { headers?: { request: { set: Record<string, string[]> } } }[];
};

/** Each route's proxy header, as the office sets it in the owner's Caddy. */
const routeHeaders = (changes: { body: unknown }[]) =>
  changes.map((c) => (c.body as ProxyRoute).handle[0].headers?.request.set);

test("in the owner's Caddy the office adds its routes with the proxy header, replaces one whose header is stale, and leaves one that is current", async () => {
  const was = process.env.OFFICE_ADDRESS;
  process.env.OFFICE_ADDRESS = 'shared';
  const [[, value]] = headerUps(ownCaddyfile('mac', ownerKey()));
  const set = { [PROXY_HEADER]: [value] };
  try {
    // None there yet: both routes go first on the owner's servers.
    const added = adminApi({ 'oddboro-tls': {} });
    await keepAddress();
    assert.deepEqual(
      added.map((c) => [c.method, c.path]),
      [
        ['PUT', '/config/apps/http/servers/srv0/routes/0'],
        ['PUT', '/config/apps/http/servers/srv1/routes/0']
      ]
    );
    assert.deepEqual(routeHeaders(added), [set, set]);
    const current = Object.fromEntries(
      added.map((c) => [(c.body as ProxyRoute)['@id'], c.body as ProxyRoute])
    );
    mock.restoreAll();

    // Left from an older key, or from a version before the header: each is replaced where it stands.
    const stale = structuredClone(current);
    stale.oddboro.handle[0].headers = {
      request: { set: { [PROXY_HEADER]: ['an older secret {http.request.scheme}'] } }
    };
    delete stale['oddboro-https'].handle[0].headers;
    const replaced = adminApi({ ...stale, 'oddboro-tls': {} });
    await keepAddress();
    assert.deepEqual(
      replaced.map((c) => [c.method, c.path]),
      [
        ['PATCH', '/id/oddboro'],
        ['PATCH', '/id/oddboro-https']
      ]
    );
    assert.deepEqual(routeHeaders(replaced), [set, set]);
    mock.restoreAll();

    // Current: nothing changes.
    const kept = adminApi({ ...current, 'oddboro-tls': {} });
    await keepAddress();
    assert.deepEqual(kept, []);
  } finally {
    mock.restoreAll();
    if (was === undefined) delete process.env.OFFICE_ADDRESS;
    else process.env.OFFICE_ADDRESS = was;
  }
});
