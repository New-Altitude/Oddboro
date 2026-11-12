// Which requests the office answers: `guardOffice`, the first step of the
// server's `handle`, in front of the real routes, over the office's own database (local-db.ts) in a
// throwaway folder on a free port. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import type { RequestEvent } from '@sveltejs/kit';
import { REQUEST_TARGETS } from '@oddboro/ledger/request-targets';
import { ROUTES, routeIds } from './route-ids.ts';

const folder = mkdtempSync(join(tmpdir(), 'oddboro-owner-page-'));
const port = await new Promise<number>((done) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => done(p));
  });
});
const TOKEN = 'shell-token-for-tests';
// Set before the office's modules load: they read where everything is, the
// shell's token and the app's ORIGIN as they start.
Object.assign(process.env, {
  ODDBORO_HOME: folder,
  ODDBORO_DB_PORT: String(port),
  // A file that does not exist, so no .env reaches this office.
  ODDBORO_ENV: join(folder, 'none.env'),
  DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
  ODDBORO_LOCAL_DB: '1',
  OLLAMA_URL: 'http://127.0.0.1:9',
  ODDBORO_UPDATE_TOKEN: TOKEN,
  ORIGIN: 'http://office.test:4500',
  // An empty home of its own, so the office never finds the owner's own
  // tools there (a real grok in ~/.grok/bin), and no tool's maker is asked
  // for its newest version (versions.ts).
  HOME: join(folder, 'home'),
  ODDBORO_NO_LATEST: '1'
});
mkdirSync(join(folder, 'home'), { recursive: true });
const { startLocalDatabase } = await import('@oddboro/ledger/local-db');
const stopDatabase = await startLocalDatabase();
const { bringUpToDate } = await import('@oddboro/ledger/upgrade');
await bringUpToDate();
const L = await import('@oddboro/ledger');
const { OFFICE_PORT } = await import('@oddboro/ledger/home');
const {
  EXCEPTION_ROUTES,
  GATEWAY_PATH,
  NOT_THE_OWNER_PAGE,
  NOT_THE_OWNER_TEXT,
  OWNER_PARAM,
  ownerCookie,
  ownerKey,
  UPDATE_PATH
} = await import('@oddboro/ledger/owner-key');
const { fromOwnerPage, guardOffice } = await import('./owner-page.ts');
const { closeGateway, openGateway } = await import('./gateway.ts');
const askRoute = await import('../../routes/api/asks/[id]/+server.ts');
const updateRoute = await import('../../routes/api/update/+server.ts');
const openRoute = await import('../../routes/api/files/open/+server.ts');
const staffRoute = await import('../../routes/api/staff/[id]/+server.ts');
const agentsRoute = await import('../../routes/api/agents/+server.ts');
const toolRoute = await import('../../routes/api/agents/[tool]/+server.ts');
const hooks = await import('../../hooks.server.ts');

after(async () => {
  await L.pg.end();
  await stopDatabase();
  rmSync(folder, { recursive: true, force: true });
});

await L.pg`insert into staff ${L.pg({
  id: 'paige',
  name: 'Paige',
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Paige.'
})}`;

type Route = (event: RequestEvent) => Response | Promise<Response>;
type Sent = {
  method?: string;
  /** The office's address the request reaches: its own loopback one unless set. */
  at?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  params?: Record<string, string>;
  from?: string;
};

const OFFICE = 'http://127.0.0.1:4500';

// Kit's own helpers for the suffixes its router strips from a data or route
// request before `handle` runs. The file imports nothing, and Kit ships no
// types for it, so the functions used are typed here.
const kit = (await import(
  pathToFileURL(
    join(
      dirname(createRequire(import.meta.url).resolve('@sveltejs/kit/package.json')),
      'src/pathname.js'
    )
  ).href
)) as {
  has_data_suffix: (path: string) => boolean;
  strip_data_suffix: (path: string) => string;
  has_resolution_suffix: (path: string) => boolean;
  strip_resolution_suffix: (path: string) => string;
};

/**
 * Kit's prefix for a remote function call. Kit's own test for it lives in a
 * module that imports the built app's paths, which a test cannot load, so the
 * prefix is written here.
 */
const isRemote = (request: Request) => new URL(request.url).pathname.startsWith('/_app/remote/');

/**
 * `event.url` as Kit's `respond` gives it to `handle`: the request's own
 * address, with Kit's data or route suffix taken off. On a remote function
 * call Kit takes the path and query from the client's own headers instead.
 * Kit adds back a trailing slash only when its own query asks, which no target
 * here does.
 */
function kitUrl(request: Request): URL {
  const url = new URL(request.url);
  if (kit.has_resolution_suffix(url.pathname))
    url.pathname = kit.strip_resolution_suffix(url.pathname);
  else if (kit.has_data_suffix(url.pathname))
    url.pathname = kit.strip_data_suffix(url.pathname) || '/';
  else if (isRemote(request)) {
    const pathname = request.headers.get('x-sveltekit-pathname');
    if (pathname !== null) {
      url.pathname = pathname;
      url.search = request.headers.get('x-sveltekit-search') ?? '';
    }
  }
  return url;
}

/**
 * Send a request through `guardOffice` to `route`, as the server does: its
 * status, whether the route ran, and what the guard or the route answered.
 * The request is built from the raw target as Kit's dev server and
 * adapter-node build it.
 */
async function send(
  route: Route,
  s: Sent
): Promise<{ status: number; ran: boolean; text: string; headers: Headers }> {
  const method = s.method ?? 'POST';
  const at = s.at ?? OFFICE;
  const request = new Request(`${at}${s.path ?? '/api/goals'}`, {
    method,
    headers: { host: new URL(at).host, ...s.headers },
    body: method === 'GET' || method === 'HEAD' ? undefined : (s.body ?? '{}')
  });
  const event = {
    request,
    url: kitUrl(request),
    params: s.params ?? {},
    isRemoteRequest: isRemote(request),
    getClientAddress: () => s.from ?? '127.0.0.1'
  } as unknown as RequestEvent;
  let ran = false;
  try {
    const res = await guardOffice({
      event,
      resolve: async (e) => {
        ran = true;
        return route(e);
      }
    });
    return { status: res.status, ran, text: await res.text(), headers: res.headers };
  } catch (e) {
    // A route's `error()` throws; SvelteKit turns it into this status and message.
    const thrown = e as { status: number; body?: { message?: string } };
    return { status: thrown.status, ran, text: thrown.body?.message ?? '', headers: new Headers() };
  }
}

const ok: Route = () => new Response('ok');
/** The headers the owner's page sends with an action, without its key. */
const PAGE = { 'sec-fetch-site': 'same-origin', origin: OFFICE };
/** What the owner's page sends: those headers, and its key's cookie. */
const OWNER = { ...PAGE, cookie: ownerCookie() };

/** A fresh open approval from Paige, and its status read back. */
async function openAsk(
  kind = 'approval'
): Promise<{ id: string; status: () => Promise<string | undefined> }> {
  const [{ id }] = await L.pg<{ id: number }[]>`
    insert into asks (staff_id, kind, title, why, if_approved)
    values ('paige', ${kind}, 'Send the brief', 'It is ready', 'Paige sends it')
    returning id`;
  return { id: String(id), status: async () => (await L.ask(id))?.status };
}

test('every route request passes the guard before anything else', async () => {
  // The server's handle is a sequence, which needs the request store Kit gives each request.
  const { page, sender } = await import('./diagnostics-harness.ts');
  const send = sender(hooks.handle);
  const owner = await page();
  const refused = await send({
    route: '/api/ledger',
    headers: { ...owner, host: 'rebind.evil.example:4500' }
  });
  assert.deepEqual(refused, { status: 403, ran: false });
  // The same request from the office's own name reaches the route.
  assert.deepEqual(await send({ route: '/api/ledger', headers: owner }), {
    status: 200,
    ran: true
  });
});

test('an approval sent from another site is refused, and the ask stays open', async () => {
  const a = await openAsk();
  const r = await send(askRoute.POST as Route, {
    path: `/api/asks/${a.id}`,
    params: { id: a.id },
    headers: {
      'sec-fetch-site': 'cross-site',
      origin: 'https://evil.example',
      'content-type': 'text/plain;charset=UTF-8'
    },
    body: JSON.stringify({ decision: 'approve' })
  });
  assert.deepEqual([r.status, r.ran], [403, false]);
  assert.equal(await a.status(), 'open');
  assert.equal(r.text, "Only the office's own page can do that");
});

test("the owner's own page approves the same kind of ask", async () => {
  const a = await openAsk();
  const r = await send(askRoute.POST as Route, {
    path: `/api/asks/${a.id}`,
    params: { id: a.id },
    headers: { ...OWNER, 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approve' })
  });
  assert.deepEqual([r.status, r.ran], [200, true]);
  assert.equal(await a.status(), 'approved');
});

test('a hire is approved by hiring, not from the desk, and a word that is not a decision is refused', async () => {
  const decide = async (id: string, decision: string) =>
    send(askRoute.POST as Route, {
      path: `/api/asks/${id}`,
      params: { id },
      headers: { ...OWNER, 'content-type': 'application/json' },
      body: JSON.stringify({ decision })
    }).then((r) => [r.status, r.text]);
  const hire = await openAsk('hire');
  assert.deepEqual(await decide(hire.id, 'approve'), [400, 'Approve a hire by hiring']);
  assert.equal(await hire.status(), 'open');
  assert.deepEqual(await decide(hire.id, 'maybe'), [400, 'Say approve, deny or iterate']);
});

test('a browser that sends no Sec-Fetch-Site passes when its Origin names the host it asked', async () => {
  const r = await send(ok, { headers: { origin: OFFICE, cookie: OWNER.cookie } });
  assert.deepEqual([r.status, r.ran], [200, true]);
});

test("an action with neither Sec-Fetch-Site nor Origin is refused, even with the owner's key", async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await send(ok, { method, headers: { cookie: OWNER.cookie } });
    assert.deepEqual([method, r.status, r.ran], [method, 403, false]);
  }
});

test("a read with the owner's key passes without saying where it comes from", async () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const r = await send(ok, {
      method,
      headers: { 'sec-fetch-site': 'cross-site', cookie: OWNER.cookie }
    });
    assert.deepEqual([method, r.status, r.ran], [method, 200, true]);
  }
});

test('a name the office does not answer to is refused, for a read and an action alike', async () => {
  const host = 'rebind.evil.example:4500';
  for (const method of ['GET', 'POST']) {
    // The browser thinks a rebound page is same-origin, so only the name gives it away.
    // The key is sent too, so the name alone is what refuses it.
    const r = await send(ok, {
      method,
      headers: { ...OWNER, host, origin: `http://${host}` }
    });
    assert.deepEqual([method, r.status, r.ran], [method, 403, false]);
    assert.equal(r.text, 'This office answers only at its own address');
  }
  for (const host of [
    '',
    'evil.example@127.0.0.1',
    '127.0.0.1.evil.example',
    'localhost.evil.example'
  ]) {
    const r = await send(ok, { method: 'GET', headers: { host, cookie: OWNER.cookie } });
    assert.deepEqual([host, r.status], [host, 403]);
  }
});

test('the office answers on loopback, its addresses through Caddy and the app ORIGIN, on any port', async () => {
  for (const host of [
    '127.0.0.1:4570',
    'localhost:4500',
    '[::1]:4500',
    'local.oddboro.com',
    'oddboro.localhost',
    'Oddboro.Localhost:4500',
    'office.test:4500'
  ]) {
    const r = await send(ok, { method: 'GET', headers: { host, cookie: OWNER.cookie } });
    assert.deepEqual([host, r.status], [host, 200]);
  }
});

test('the shell reports an update with its token, and nothing else reports one', async () => {
  const report = { path: '/api/update', body: JSON.stringify({ checked: true }) };
  const shell = await send(updateRoute.POST as Route, {
    ...report,
    headers: { 'x-oddboro-update-token': TOKEN, 'content-type': 'application/json' }
  });
  assert.deepEqual([shell.status, shell.ran], [200, true]);
  for (const token of ['', 'wrong-token-for-tests']) {
    const r = await send(updateRoute.POST as Route, {
      ...report,
      headers: { 'x-oddboro-update-token': token }
    });
    assert.deepEqual([token, r.status, r.ran], [token, 403, false]);
  }
  // The token counts only from this computer, and only for updates.
  const away = await send(updateRoute.POST as Route, {
    ...report,
    from: '192.168.1.20',
    headers: { 'x-oddboro-update-token': TOKEN }
  });
  assert.deepEqual([away.status, away.ran], [403, false]);
  const elsewhere = await send(ok, { headers: { 'x-oddboro-update-token': TOKEN } });
  assert.deepEqual([elsewhere.status, elsewhere.ran], [403, false]);
  // The owner's page reaches the route, which still refuses a report without the token.
  const page = await send(updateRoute.POST as Route, {
    ...report,
    headers: { ...OWNER, 'x-oddboro-update-token': 'wrong-token-for-tests' }
  });
  assert.deepEqual([page.status, page.ran], [403, true]);
});

test("a run's token reaches its gateway while the run goes, and nothing else", async () => {
  const notes = {
    id: 'notes',
    name: 'Notes',
    readTools: [],
    tools: [],
    config: {}
  } as unknown as import('@oddboro/ledger').ConnectorRow;
  const { token } = openGateway([{ connector: notes, level: 'read' }], 60_000);
  const call = { path: '/api/gateway/notes', body: '{}' };
  const run = await send(ok, { ...call, headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual([run.status, run.ran], [200, true]);
  for (const auth of ['', 'Bearer wrong-token-for-tests', token]) {
    const r = await send(ok, { ...call, headers: { authorization: auth } });
    assert.deepEqual([auth, r.status, r.ran], [auth, 403, false]);
  }
  // The token opens only the gateway, never another route.
  const elsewhere = await send(ok, { headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual([elsewhere.status, elsewhere.ran], [403, false]);
  // Once the run ends, its token opens nothing.
  await closeGateway(token);
  const ended = await send(ok, { ...call, headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual([ended.status, ended.ran], [403, false]);
});

test("only the owner's page reaches the route that opens a page", async () => {
  // No such file: the route answers 404 once reached, and nothing opens either way.
  mkdirSync(join(folder, 'staff', 'paige'), { recursive: true });
  const open = (headers: Record<string, string>) =>
    send(openRoute.POST as Route, {
      path: '/api/files/open',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ staff: 'paige', path: 'nothing.html' })
    });
  const away = await open({ 'sec-fetch-site': 'cross-site' });
  assert.deepEqual([away.status, away.ran], [403, false]);
  const page = await open(OWNER);
  assert.deepEqual([page.status, page.ran], [404, true]);
});

test('the "Runs on" picker lists the tools and moves an Odd to another from the owner\'s page, and from no other', async () => {
  const listed = await send(agentsRoute.GET as Route, {
    method: 'GET',
    path: '/api/agents',
    headers: OWNER
  });
  assert.deepEqual([listed.status, listed.ran], [200, true]);
  assert.deepEqual(
    (JSON.parse(listed.text) as { tools: { id: string }[] }).tools.map((a) => a.id),
    L.agentsOn(process.platform)
  );
  const move = (agent: string, headers: Record<string, string>) =>
    send(staffRoute.PATCH as Route, {
      method: 'PATCH',
      path: '/api/staff/paige',
      params: { id: 'paige' },
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ agent })
    });
  const away = await move('grok', {
    'sec-fetch-site': 'cross-site',
    origin: 'https://evil.example'
  });
  assert.deepEqual([away.status, away.ran], [403, false]);
  assert.equal((await L.staffer('paige'))?.agent, 'claude');
  const page = await move('grok', OWNER);
  assert.deepEqual([page.status, page.ran], [200, true]);
  assert.equal((await L.staffer('paige'))?.agent, 'grok');
  assert.equal((await move('claude', OWNER)).status, 200);
});

test('signing a tool in is refused from another site, and never starts its command', async () => {
  // A stand-in grok first on PATH, so the Mac's own never runs: it only leaves a mark.
  const standIns = join(folder, 'sign-in-bin');
  const mark = join(folder, 'grok-ran');
  mkdirSync(standIns, { recursive: true });
  writeFileSync(join(standIns, 'grok'), `#!/bin/sh\necho "$1" >> '${mark}'\n`);
  chmodSync(join(standIns, 'grok'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${standIns}:/usr/bin:/bin`;
  const signIn = (headers: Record<string, string>) =>
    send(toolRoute.POST as Route, {
      path: '/api/agents/grok',
      params: { tool: 'grok' },
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ action: 'sign-in' })
    });
  try {
    const away = await signIn({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
    assert.deepEqual([away.status, away.ran], [403, false]);
    assert.ok(!existsSync(mark), 'a sign-in from another site started grok');
    // The same request from the owner's page starts it, so the mark can show.
    const page = await signIn(OWNER);
    assert.deepEqual([page.status, page.ran], [200, true]);
    assert.ok(existsSync(mark), "the owner's page did not start grok");
  } finally {
    process.env.PATH = path;
  }
});

const from = (headers: Record<string, string>) =>
  fromOwnerPage(new Request('http://local.oddboro.com/api/goals', { method: 'POST', headers }));

test("the owner's page passes when the browser says the request is from the same origin", () => {
  assert.equal(from({ 'sec-fetch-site': 'same-origin', host: 'local.oddboro.com' }), true);
});

test('another site, or another page on this computer, is refused whatever its Origin says', () => {
  const origin = 'https://local.oddboro.com';
  const host = 'local.oddboro.com';
  assert.equal(from({ 'sec-fetch-site': 'cross-site', origin, host }), false);
  assert.equal(from({ 'sec-fetch-site': 'same-site', origin, host }), false);
  assert.equal(from({ 'sec-fetch-site': 'none', origin, host }), false);
});

test('with no Sec-Fetch-Site, an Origin naming the host asked passes, whatever its scheme', () => {
  // Caddy serves the page over https and reaches the office over http.
  assert.equal(from({ origin: 'https://local.oddboro.com', host: 'local.oddboro.com' }), true);
  assert.equal(from({ origin: 'http://127.0.0.1:4500', host: '127.0.0.1:4500' }), true);
});

test('with no Sec-Fetch-Site, a foreign, unreadable or missing Origin is refused', () => {
  const host = '127.0.0.1:4500';
  assert.equal(from({ origin: 'https://example.com', host }), false);
  assert.equal(from({ origin: 'http://127.0.0.1:8080', host }), false);
  assert.equal(from({ origin: 'null', host }), false);
  assert.equal(from({ host }), false);
});

test('the app allows a screenshot in chat while other actions keep their smaller limit', async () => {
  const before = process.env.ODDBORO_APP;
  process.env.ODDBORO_APP = '1';
  const body = 'x'.repeat(2 * 1024 * 1024);
  try {
    for (const header of [{}, { 'content-length': String(body.length) }]) {
      const headers = { ...OWNER, ...header } as Record<string, string>;
      const large = await send(ok, { path: '/api/staff/paige/chat', body, headers });
      assert.equal(large.status, 200);
      const uploaded = await send(ok, { path: '/api/staff/paige/attachments', body, headers });
      assert.equal(uploaded.status, 200);
      const other = await send(ok, { path: '/api/goals', body, headers });
      assert.equal(other.status, 413);
      assert.equal(other.ran, false);
    }
  } finally {
    if (before === undefined) delete process.env.ODDBORO_APP;
    else process.env.ODDBORO_APP = before;
  }
});

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const NOTES = {
  id: 'notes',
  name: 'Notes',
  readTools: [],
  tools: [],
  config: {}
} as unknown as import('@oddboro/ledger').ConnectorRow;

/** Each route file by its route id, with what it answers: each method a `+server.ts` exports, a page's load by GET. */
async function routeFiles(): Promise<{ route: string; methods: string[] }[]> {
  const server = await Promise.all(
    routeIds('+server.ts').map(async (route) => {
      const module = (await import(join(ROUTES, route, '+server.ts'))) as Record<string, unknown>;
      return { route, methods: METHODS.filter((m) => m in module) };
    })
  );
  const pages = routeIds('+page.server.ts').map((route) => ({ route, methods: ['GET'] }));
  return [...server, ...pages];
}

/** An address a route id answers, each parameter filled with one plain word. */
const addressOf = (route: string) => route.replace(/\[[^\]]+\]/g, 'x');
const isException = (route: string) => (EXCEPTION_ROUTES as readonly string[]).includes(route);

test("every route refuses a request without the owner's key, reads included", async () => {
  const files = await routeFiles();
  // The exceptions and the routes cannot drift: each exception is a route.
  for (const route of EXCEPTION_ROUTES)
    assert.ok(
      files.some((f) => f.route === route),
      `${route} is no route`
    );
  let checked = 0;
  for (const { route, methods } of files.filter((f) => !isException(f.route))) {
    assert.ok(methods.length > 0, `${route} answers nothing`);
    for (const method of methods) {
      const r = await send(ok, { method, path: addressOf(route), headers: PAGE });
      assert.deepEqual([method, route, r.status, r.ran], [method, route, 403, false]);
    }
    checked++;
  }
  assert.ok(checked > 0);
  assert.equal(checked + EXCEPTION_ROUTES.length, files.length);
});

test("every route lets in the owner's page with its key", async () => {
  const files = await routeFiles();
  assert.ok(files.length > 0);
  for (const { route, methods } of files)
    for (const method of methods) {
      const r = await send(ok, { method, path: addressOf(route), headers: OWNER });
      assert.deepEqual([method, route, r.ran], [method, route, true]);
    }
});

test("a program on this computer that says it is the page is refused, and the page's key alone does not let another page act", async () => {
  const a = await openAsk();
  const approve = (headers: Record<string, string>) =>
    send(askRoute.POST as Route, {
      path: `/api/asks/${a.id}`,
      params: { id: a.id },
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ decision: 'approve' })
    });
  // Every header the page sends, but no key.
  const program = await approve({ 'sec-fetch-site': 'same-origin', origin: OFFICE });
  assert.deepEqual([program.status, program.ran], [403, false]);
  // A page on another port of this computer is same-site, so the browser sends it the key.
  const otherPage = await approve({
    cookie: OWNER.cookie,
    'sec-fetch-site': 'same-site',
    origin: 'http://127.0.0.1:4600'
  });
  assert.deepEqual([otherPage.status, otherPage.ran], [403, false]);
  assert.equal(await a.status(), 'open');
});

test('a device on the network through Caddy gets the refusal page, not the office', async () => {
  const caddy = { at: 'https://local.oddboro.com', headers: { 'sec-fetch-site': 'same-origin' } };
  const page = await send(ok, { ...caddy, method: 'GET', path: '/' });
  assert.deepEqual([page.status, page.ran], [403, false]);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(page.text, NOT_THE_OWNER_PAGE);
  const action = await send(ok, { ...caddy, path: '/api/goals' });
  assert.deepEqual([action.status, action.ran, action.text], [403, false, NOT_THE_OWNER_TEXT]);
  // The same header the dev server's guard sends (vite-config.test.ts).
  assert.equal(action.headers.get('content-type'), 'text/plain; charset=utf-8');
});

test("the key in the address lets the owner's browser in once and leaves the address clean", async () => {
  const key = ownerKey();
  const answers: { headers: Headers; text: string }[] = [];
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const r = await send(ok, { method: 'GET', path, headers });
    answers.push(r);
    return r;
  };
  const moved = (r: { status: number; ran: boolean; headers: Headers }) => [
    r.status,
    r.ran,
    r.headers.get('location')
  ];

  const first = await get(`/?${OWNER_PARAM}=${key}`);
  assert.deepEqual(moved(first), [303, false, '/']);
  // Named by the office's own port, so two offices on 127.0.0.1 keep their own cookie.
  const [cookie, ...flags] = (first.headers.get('set-cookie') ?? '').split('; ');
  assert.equal(cookie, `oddboro-owner-${OFFICE_PORT}=${key}`);
  assert.deepEqual(flags, ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=34560000']);

  const deeper = await get(`/x?a=1&${OWNER_PARAM}=${key}`);
  assert.deepEqual(moved(deeper), [303, false, '/x?a=1']);
  assert.ok(deeper.headers.has('set-cookie'));

  // The parameter alone lets nothing through: a wrong key gets the refusal page.
  const wrong = await get(`/?${OWNER_PARAM}=wrong`);
  assert.deepEqual([wrong.status, wrong.ran, wrong.text], [403, false, NOT_THE_OWNER_PAGE]);
  assert.equal(wrong.headers.get('set-cookie'), null);

  // An old key left in the address cannot lock out a browser that holds the right one.
  const stale = await get(`/?${OWNER_PARAM}=stale`, { cookie: OWNER.cookie });
  assert.deepEqual(moved(stale), [303, false, '/']);
  assert.equal(stale.headers.get('set-cookie'), null);

  // A browser reads `//evil.example/` as another site, so the address keeps one leading slash.
  for (const [path, headers] of [
    [`//evil.example/?${OWNER_PARAM}=x`, { cookie: OWNER.cookie }],
    [`//evil.example/?${OWNER_PARAM}=${key}`, {}],
    [`/\\evil.example/?${OWNER_PARAM}=${key}`, {}]
  ] as const) {
    const r = await get(path, headers);
    assert.deepEqual([path, ...moved(r)], [path, 303, false, '/evil.example/']);
  }

  for (const r of answers) {
    assert.ok(!(r.headers.get('location') ?? '').includes(key), 'the key in an address');
    assert.ok(!r.text.includes(key), 'the key in a page');
  }
});

test('a sign-in coming back reaches its page without the key, and nothing else there does', async () => {
  for (const path of ['/account/callback', '/connect/callback']) {
    const back = await send(ok, { method: 'GET', path: `${path}?code=c&state=s` });
    assert.deepEqual([path, back.status, back.ran], [path, 200, true]);
    const posted = await send(ok, { path, headers: PAGE });
    assert.deepEqual([path, posted.status, posted.ran], [path, 403, false]);
  }
});

test('a remote function call that names a sign-in page in its headers is refused without the key', async () => {
  const r = await send(ok, {
    method: 'GET',
    path: '/_app/remote/abc/q',
    headers: { 'x-sveltekit-pathname': '/account/callback' }
  });
  assert.deepEqual([r.status, r.ran], [403, false]);
});

test("Odds, their tools' web fetch and other programs on this computer cannot read the office or load its pages", async () => {
  // Nothing but the Host, as an AI tool's web fetch or curl sends.
  const offices = ['http://127.0.0.1:4500', 'https://local.oddboro.com'];
  // A public name for 127.0.0.1 the office does not answer to: kept, so a wider list of names cannot open it.
  for (const at of [...offices, 'http://127.0.0.1.nip.io'])
    for (const path of ['/api/ledger', '/api/staff/paige', '/']) {
      const r = await send(ok, { method: 'GET', at, path });
      assert.deepEqual([at, path, r.status, r.ran], [at, path, 403, false]);
      if (path === '/' && offices.includes(at)) assert.equal(r.text, NOT_THE_OWNER_PAGE, at);
    }
});

test("the guard answers the owner's page in well under a millisecond", async (t) => {
  const request = new Request(`${OFFICE}/api/ledger`, {
    headers: { host: '127.0.0.1:4500', ...OWNER }
  });
  const event = {
    request,
    url: new URL(request.url),
    params: {},
    getClientAddress: () => '127.0.0.1'
  } as unknown as RequestEvent;
  const answer = new Response('ok');
  const resolve = async () => answer;
  for (let i = 0; i < 100; i++) await guardOffice({ event, resolve });
  const start = performance.now();
  for (let i = 0; i < 10_000; i++) await guardOffice({ event, resolve });
  const ms = performance.now() - start;
  t.diagnostic(`10,000 calls took ${ms.toFixed(1)} ms`);
  assert.ok(ms < 1000, `${ms} ms`);
});

test("guardOffice passes a request without the owner's key only to an exact exception route, judged on Kit's own path, and a wrong key in the address gets the refusal", async () => {
  const { token } = openGateway([{ connector: NOTES, level: 'read' }], 60_000);
  const run = { authorization: `Bearer ${token}` };
  const shell = { 'x-oddboro-update-token': TOKEN };
  let rows = 0;
  try {
    for (const { target, office } of REQUEST_TARGETS) {
      // The dev server's root, as its guard's test fills it in; any folder serves here.
      const path = target.replace('<root>', ROUTES);
      rows++;
      if (office === 'unparsed') {
        // Kit cannot make a request of it, so it answers before `handle`.
        assert.throws(() => new Request(`${OFFICE}${path}`), TypeError, target);
        continue;
      }
      if (office === 'refused') {
        for (const headers of [{}, run, shell]) {
          const r = await send(ok, { method: 'GET', path, headers });
          assert.deepEqual([target, r.status, r.ran], [target, 403, false]);
        }
        continue;
      }
      // An exception: its own proof lets it in, picked by the path Kit routes on.
      const routed = kitUrl(new Request(`${OFFICE}${path}`)).pathname;
      const proof =
        routed === UPDATE_PATH
          ? { method: 'POST', headers: shell }
          : routed.startsWith(`${GATEWAY_PATH}/`)
            ? { method: 'POST', headers: run }
            : { method: 'GET', headers: {} };
      const proved = await send(ok, { path, ...proof });
      assert.deepEqual([target, proved.status, proved.ran], [target, 200, true]);
      // Without that proof, an action there is refused like anywhere else.
      const unproved = await send(ok, { path, headers: PAGE });
      assert.deepEqual([target, unproved.status, unproved.ran], [target, 403, false]);
    }
  } finally {
    await closeGateway(token);
  }
  assert.ok(rows > 0);
  assert.equal(rows, REQUEST_TARGETS.length);

  const wrong = await send(ok, { method: 'GET', path: `/api/ledger?${OWNER_PARAM}=wrong` });
  assert.deepEqual([wrong.status, wrong.ran, wrong.text], [403, false, NOT_THE_OWNER_TEXT]);
  assert.equal(wrong.headers.get('set-cookie'), null);
});
