// Which requests the office answers: `guardOffice`, the first step of the
// server's `handle`, in front of the real routes, over the office's own database (local-db.ts) in a
// throwaway folder on a free port. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { RequestEvent } from '@sveltejs/kit';

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
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  params?: Record<string, string>;
  from?: string;
};

/** Send a request through `guardOffice` to `route`, as the server does: its status, and whether the route ran. */
async function send(
  route: Route,
  s: Sent
): Promise<{ status: number; ran: boolean; text: string }> {
  const method = s.method ?? 'POST';
  const request = new Request(`http://127.0.0.1:4500${s.path ?? '/api/goals'}`, {
    method,
    headers: { host: '127.0.0.1:4500', ...s.headers },
    body: method === 'GET' || method === 'HEAD' ? undefined : (s.body ?? '{}')
  });
  const event = {
    request,
    url: new URL(request.url),
    params: s.params ?? {},
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
    return { status: res.status, ran, text: await res.text() };
  } catch (e) {
    // A route's `error()` throws; SvelteKit turns it into this status.
    return { status: (e as { status: number }).status, ran, text: '' };
  }
}

const ok: Route = () => new Response('ok');
const PAGE = { 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:4500' };

/** A fresh open approval from Paige, and its status read back. */
async function openAsk(): Promise<{ id: string; status: () => Promise<string | undefined> }> {
  const [{ id }] = await L.pg<{ id: number }[]>`
    insert into asks (staff_id, kind, title, why, if_approved)
    values ('paige', 'approval', 'Send the brief', 'It is ready', 'Paige sends it')
    returning id`;
  return { id: String(id), status: async () => (await L.ask(id))?.status };
}

test('every route request passes the guard before anything else', async () => {
  // The server's handle is a sequence, which needs the request store Kit gives each request.
  const { sender } = await import('./diagnostics-harness.ts');
  const send = sender(hooks.handle);
  const refused = await send({
    route: '/api/ledger',
    headers: { host: 'rebind.evil.example:4500' }
  });
  assert.deepEqual(refused, { status: 403, ran: false });
  // The same request from the office's own name reaches the route.
  assert.deepEqual(await send({ route: '/api/ledger' }), { status: 200, ran: true });
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
    headers: { ...PAGE, 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approve' })
  });
  assert.deepEqual([r.status, r.ran], [200, true]);
  assert.equal(await a.status(), 'approved');
});

test('a browser that sends no Sec-Fetch-Site passes when its Origin names the host it asked', async () => {
  const r = await send(ok, { headers: { origin: 'http://127.0.0.1:4500' } });
  assert.deepEqual([r.status, r.ran], [200, true]);
});

test('an action with neither Sec-Fetch-Site nor Origin is refused', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await send(ok, { method });
    assert.deepEqual([method, r.status, r.ran], [method, 403, false]);
  }
});

test('reads pass without saying where they come from', async () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const r = await send(ok, { method, headers: { 'sec-fetch-site': 'cross-site' } });
    assert.deepEqual([method, r.status, r.ran], [method, 200, true]);
  }
});

test('a name the office does not answer to is refused, for a read and an action alike', async () => {
  const host = 'rebind.evil.example:4500';
  for (const method of ['GET', 'POST']) {
    // The browser thinks a rebound page is same-origin, so only the name gives it away.
    const r = await send(ok, {
      method,
      headers: { host, 'sec-fetch-site': 'same-origin', origin: `http://${host}` }
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
    const r = await send(ok, { method: 'GET', headers: { host } });
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
    const r = await send(ok, { method: 'GET', headers: { host } });
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
    headers: { ...PAGE, 'x-oddboro-update-token': 'wrong-token-for-tests' }
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
  const page = await open(PAGE);
  assert.deepEqual([page.status, page.ran], [404, true]);
});

test('the "Runs on" picker lists the tools and moves an Odd to another from the owner\'s page, and from no other', async () => {
  const listed = await send(agentsRoute.GET as Route, {
    method: 'GET',
    path: '/api/agents',
    headers: PAGE
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
  const page = await move('grok', PAGE);
  assert.deepEqual([page.status, page.ran], [200, true]);
  assert.equal((await L.staffer('paige'))?.agent, 'grok');
  assert.equal((await move('claude', PAGE)).status, 200);
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
    const page = await signIn(PAGE);
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
