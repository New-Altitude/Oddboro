// The dev server answers only this computer, asks for the owner's key before
// Vite answers anything, and launches no editor for any page: Vite's own dev
// server with the office's plugins, in a throwaway folder, and the guard
// plugin's hook on a stand-in server. Run with `npm test -w @oddboro/office`.
import { home } from '@oddboro/ledger/home';
import {
  NOT_THE_OWNER_PAGE,
  NOT_THE_OWNER_TEXT,
  OWNER_COOKIE,
  OWNER_KEY_FILE,
  OWNER_PARAM,
  ownerCookie,
  ownerKey,
  UPDATE_PATH
} from '@oddboro/ledger/owner-key';
import { REQUEST_TARGETS } from '@oddboro/ledger/request-targets';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import {
  createServer as createHttpServer,
  IncomingMessage,
  request,
  type ServerResponse
} from 'node:http';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { after, test } from 'node:test';
import { createServer, type ViteDevServer } from 'vite';
import config, {
  buildOptions,
  ipv6Loopback,
  mapSource,
  noEditorLaunch,
  ownerOnly,
  ownerOnlyMiddleware,
  siteUrl
} from '../vite.config.ts';
import { NOT_THIS_COMPUTER } from './lib/server/this-computer.ts';

const folder = mkdtempSync(join(tmpdir(), 'oddboro-vite-'));
const launched = join(folder, 'launched.log');
// Should the refusal ever break, Vite launches this stub, which only logs, and
// never an editor of the owner's (Vite takes LAUNCH_EDITOR before guessing one).
const editor = join(folder, 'editor.sh');
writeFileSync(editor, `#!/bin/sh\necho "$@" >> '${launched}'\n`);
chmodSync(editor, 0o755);
process.env.LAUNCH_EDITOR = editor;
const target = join(folder, 'secret.txt');
writeFileSync(target, 'secret');

const vite = await createServer({
  configFile: false,
  root: folder,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  plugins: [noEditorLaunch()]
});
const http = createHttpServer(vite.middlewares);
const port = await new Promise<number>((done) =>
  http.listen(0, '127.0.0.1', () => done((http.address() as { port: number }).port))
);

// A dev server as `npm run dev` starts one: listening, with live reload on.
// The key file is looked for on each side of createServer, before anything
// here asks for the key, since the first ask makes it.
const keyFile = home(OWNER_KEY_FILE);
const keyBeforeStart = existsSync(keyFile);
const dev = await createServer({
  configFile: false,
  root: folder,
  logLevel: 'silent',
  appType: 'custom',
  server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null },
  plugins: [ownerOnly(), noEditorLaunch(), ipv6Loopback()]
});
const keyAfterStart = existsSync(keyFile);
await dev.listen();
const devAddress = dev.httpServer?.address();
assert.ok(devAddress && typeof devAddress === 'object', 'the dev server listens on a port');
const devPort = devAddress.port;

after(async () => {
  await new Promise((done) => http.close(done));
  await vite.close();
  await dev.close();
  rmSync(folder, { recursive: true, force: true });
});

/** A websocket upgrade to the dev server's live reload: its status, or 'closed' when the socket closed first. */
function upgrade(headers: Record<string, string>, host = '127.0.0.1'): Promise<number | 'closed'> {
  return new Promise((done, fail) => {
    const req = request({
      host,
      port: devPort,
      path: '/',
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        'sec-websocket-protocol': 'vite-hmr',
        ...headers
      }
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      done(res.statusCode ?? 0);
    });
    req.on('response', (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', (e: NodeJS.ErrnoException) =>
      e.code === 'ECONNRESET' ? done('closed') : fail(e)
    );
    req.end();
  });
}

/** What the middleware did with one request from this computer: whether it handed it on, and what it answered. */
function throughMiddleware(url: string, cookie?: string) {
  const socket = new Socket();
  // A socket that never connected has no address, which counts as another computer.
  Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
  const req = new IncomingMessage(socket);
  req.url = url;
  if (cookie) req.headers.cookie = cookie;
  const answer = { handedOn: 0, status: 0, type: '', body: '' };
  const res = {
    set statusCode(code: number) {
      answer.status = code;
    },
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === 'content-type') answer.type = value;
    },
    end(body: string) {
      answer.body = body;
    }
  };
  // The middleware sets a status, one header and ends with a body; the stub
  // records exactly those, and a call to anything else would throw.
  ownerOnlyMiddleware(req, res as unknown as ServerResponse, () => answer.handedOn++);
  return answer;
}

test('the dev server makes the owner key as it starts, before any request', () => {
  assert.equal(keyBeforeStart, false, 'the test office starts with no key');
  assert.equal(keyAfterStart, true);
});

test('without the key, the dev server hands on only an exact exception route', () => {
  // Vite addresses a file as /@fs/ then its full path with forward slashes,
  // with no second slash on a Mac or Linux.
  const root = dev.config.root.replace(/^\//, '');
  const seen = { passes: 0, refused: 0 };
  for (const row of REQUEST_TARGETS) {
    const url = row.target.replace('<root>', root);
    const answer = throughMiddleware(url);
    seen[row.dev]++;
    if (row.dev === 'passes') {
      assert.deepEqual(answer, { handedOn: 1, status: 0, type: '', body: '' }, url);
    } else {
      assert.equal(answer.handedOn, 0, url);
      assert.equal(answer.status, 403, url);
      assert.ok([NOT_THE_OWNER_TEXT, NOT_THE_OWNER_PAGE].includes(answer.body), url);
    }
  }
  // An empty or one-sided table would prove nothing.
  assert.ok(seen.passes > 0 && seen.refused > 0, JSON.stringify(seen));
});

test("the dev server's refusal is the office's: words on an /api/ path, the page elsewhere", () => {
  assert.deepEqual(throughMiddleware('/api/gateway/../x'), {
    handedOn: 0,
    status: 403,
    type: 'text/plain; charset=utf-8',
    body: NOT_THE_OWNER_TEXT
  });
  assert.deepEqual(throughMiddleware('/@vite/client'), {
    handedOn: 0,
    status: 403,
    type: 'text/html; charset=utf-8',
    body: NOT_THE_OWNER_PAGE
  });
});

test('the dev server hands on any request with the key in its cookie or the right key in its address', () => {
  const handedOn = { handedOn: 1, status: 0, type: '', body: '' };
  assert.deepEqual(throughMiddleware('/@vite/client', ownerCookie()), handedOn);
  assert.deepEqual(throughMiddleware('//x/api/gateway/notes', ownerCookie()), handedOn);
  assert.deepEqual(throughMiddleware(`/?${OWNER_PARAM}=${ownerKey()}`), handedOn);
});

test("the dev server's own client answers only with the key", async () => {
  const without = await fetch(`http://127.0.0.1:${devPort}/@vite/client`);
  assert.equal(without.status, 403);
  assert.equal(await without.text(), NOT_THE_OWNER_PAGE);
  const withKey = await fetch(`http://127.0.0.1:${devPort}/@vite/client`, {
    headers: { cookie: ownerCookie() }
  });
  assert.equal(withKey.status, 200);
  await withKey.arrayBuffer();
});

test('live reload closes an upgrade without the key before it answers, and upgrades one with it', async () => {
  assert.equal(await upgrade({}), 'closed');
  assert.equal(await upgrade({ cookie: `${OWNER_COOKIE}=wrong` }), 'closed');
  assert.equal(await upgrade({ cookie: ownerCookie() }), 101);
});

test('on [::1] at its port the dev server keeps the same key rule and live reload guard', async () => {
  const without = await fetch(`http://[::1]:${devPort}/@vite/client`);
  assert.equal(without.status, 403);
  assert.equal(await without.text(), NOT_THE_OWNER_PAGE);
  const withKey = await fetch(`http://[::1]:${devPort}/@vite/client`, {
    headers: { cookie: ownerCookie() }
  });
  assert.equal(withKey.status, 200);
  await withKey.arrayBuffer();
  assert.equal(await upgrade({}, '::1'), 'closed');
  assert.equal(await upgrade({ cookie: ownerCookie() }, '::1'), 101);
});

test("the office's dev config asks where a request came from and for the key before any other plugin, then refuses the editor route", () => {
  const { plugins } = config({ command: 'serve', mode: 'development' });
  assert.equal((plugins?.[0] as { name?: string }).name, ownerOnly().name);
  assert.equal(ownerOnly().enforce, 'pre');
  assert.equal((plugins?.[1] as { name?: string }).name, noEditorLaunch().name);
});

test('the dev server refuses every request and websocket that is not from this computer, with the key or on an exception route', () => {
  type Middleware = (req: unknown, res: unknown, next: () => void) => void;
  type Upgrade = (req: unknown, socket: unknown) => void;
  let middleware: Middleware | undefined;
  let upgrade: Upgrade | undefined;
  // A real socket here is always loopback, so a stand-in server gives the hook other peers.
  const server = {
    middlewares: { use: (fn: Middleware) => (middleware = fn) },
    httpServer: {
      prependListener: (event: string, fn: Upgrade) => {
        assert.equal(event, 'upgrade');
        upgrade = fn;
      }
    }
  } as unknown as ViteDevServer;
  const hook = ownerOnly().configureServer;
  assert.equal(typeof hook, 'function');
  (hook as (server: ViteDevServer) => void)(server);
  assert.ok(middleware && upgrade);

  const rows: { what: string; peer?: string; header?: string | string[]; ok: boolean }[] = [
    { what: 'a LAN device straight to the port', peer: '192.168.1.103', ok: false },
    { what: 'a LAN device through Caddy', peer: '127.0.0.1', header: '192.168.1.103', ok: false },
    {
      what: 'a forged loopback in front of a LAN address',
      peer: '127.0.0.1',
      header: '127.0.0.1, 192.168.1.103',
      ok: false
    },
    {
      what: 'the header given twice, one from the LAN',
      peer: '127.0.0.1',
      header: ['127.0.0.1', '192.168.1.103'],
      ok: false
    },
    { what: 'a LAN IPv6 device', peer: 'fe80::1', ok: false },
    { what: 'a connection with no address', ok: false },
    { what: 'this computer through Caddy', peer: '127.0.0.1', header: '127.0.0.1', ok: true },
    { what: 'this computer with no header', peer: '127.0.0.1', ok: true },
    { what: 'this computer over IPv6', peer: '::1', header: '::1', ok: true },
    { what: 'this computer as a mapped address', peer: '::ffff:127.0.0.1', ok: true }
  ];
  // Each passes the key rule, so where it comes from is all that can refuse it.
  const keyed = [
    { url: '/@vite/client', cookie: ownerCookie() },
    { url: UPDATE_PATH, cookie: undefined }
  ];
  for (const { what, peer, header, ok } of rows) {
    for (const { url, cookie } of keyed) {
      const req = {
        url,
        headers: {
          ...(header === undefined ? {} : { 'x-forwarded-for': header }),
          ...(cookie === undefined ? {} : { cookie })
        },
        socket: { remoteAddress: peer }
      };
      const res = {
        statusCode: 200,
        body: undefined as string | undefined,
        end: (b: string) => (res.body = b)
      };
      let passed = false;
      middleware(req, res, () => (passed = true));
      assert.equal(passed, ok, `${what} ${url}: next()`);
      assert.equal(res.statusCode, ok ? 200 : 403, `${what} ${url}: status`);
      assert.equal(res.body, ok ? undefined : NOT_THIS_COMPUTER, `${what} ${url}: body`);
    }

    const socket = { destroyed: false, destroy: () => (socket.destroyed = true) };
    upgrade(
      {
        headers: {
          ...(header === undefined ? {} : { 'x-forwarded-for': header }),
          cookie: ownerCookie()
        },
        socket: { remoteAddress: peer }
      },
      socket
    );
    assert.equal(socket.destroyed, !ok, `${what}: websocket closed`);
  }
});

test('the Sentry build plugin never reports the build and uploads only with a token', () => {
  const without = buildOptions({});
  const withToken = buildOptions({ SENTRY_AUTH_TOKEN: 'x' });
  for (const options of [without, withToken]) {
    assert.equal(options.telemetry, false);
    assert.equal(options.release.inject, false);
    // No release is made, so nothing touches one.
    assert.equal(options.release.create, false);
    assert.equal(options.release.finalize, false);
    assert.equal(options.release.setCommits, false);
  }
  assert.equal(without.autoUploadSourceMaps, false);
  assert.equal(withToken.autoUploadSourceMaps, true);
});

test('every release job names a source map entry the same way', () => {
  // The pokes endpoint's map, as each job's build writes it. A Windows map can
  // hold either separator; a Mac or Linux map, only `/`.
  const up = '../../../../../../../';
  const endpoint = 'build/server/entries/endpoints/api/pokes/_id_';
  const jobs = [
    { root: '/Users/runner/work/Oddboro/Oddboro', source: up, paths: path.posix },
    { root: '/home/runner/work/Oddboro/Oddboro', source: up, paths: path.posix },
    { root: 'D:\\a\\Oddboro\\Oddboro', source: up, paths: path.win32 },
    { root: 'D:\\a\\Oddboro\\Oddboro', source: up.replaceAll('/', '\\'), paths: path.win32 }
  ];
  for (const { root, source, paths } of jobs) {
    const mapDir = paths.join(root, 'apps/office', endpoint);
    const file =
      source + ['src', 'routes', 'api', 'pokes', '[id]', '+server.ts'].join(source.at(-1));
    assert.equal(
      mapSource(file, mapDir, root, paths),
      'apps/office/src/routes/api/pokes/[id]/+server.ts'
    );
  }
  // What the release build passes: the map's own folder, from this repository.
  const { rewriteSources } = buildOptions({}).sourcemaps;
  const chunks = join(import.meta.dirname, '../build/server/chunks');
  assert.equal(
    rewriteSources(
      '../../../../../node_modules/@sveltejs/kit/src/index.js',
      {},
      { mapDir: chunks }
    ),
    'node_modules/@sveltejs/kit/src/index.js'
  );
  assert.equal(
    rewriteSources('../../../src/hooks.server.ts', {}, { mapDir: chunks }),
    'apps/office/src/hooks.server.ts'
  );
});

test("the office links to the site's dev server only under a developer's npm run dev", () => {
  assert.equal(siteUrl({ npm_lifecycle_event: 'dev' }), 'http://localhost:4501');
  // A build, and the office npm run setup keeps running, which starts Vite itself.
  assert.equal(siteUrl({ npm_lifecycle_event: 'build' }), 'https://oddboro.com');
  assert.equal(siteUrl({}), 'https://oddboro.com');
  assert.equal(
    siteUrl({ npm_lifecycle_event: 'dev', ODDBORO_SITE_URL: 'http://localhost:4521/' }),
    'http://localhost:4521'
  );
});

test('a page asking the dev server to open a file in an editor is refused, and no editor starts', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/__open-in-editor?file=${target}`, {
    headers: { 'sec-fetch-site': 'cross-site' }
  });
  assert.equal(res.status, 403);
  assert.equal(await res.text(), 'The office opens no editor');
  assert.equal(existsSync(launched), false);
});
