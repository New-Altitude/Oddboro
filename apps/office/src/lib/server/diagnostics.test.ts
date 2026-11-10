// Error and trace reports: nothing leaves before the owner's yes, what leaves
// goes to the address set, and the gate, the relay and the trace rules hold.
// A fake door on a free port records every request. Requests go through the
// server's real `handle` (the guard, then Sentry's). Nothing here reaches the
// owner's office: the settings file, home and database port are all temp.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { parseEnvelope, shouldIgnoreSpan, type Envelope } from '@sentry/core';
import {
  ENVELOPE_PATH,
  items,
  ofType,
  PAGE,
  recorder,
  sender,
  tempOffice,
  throwing,
  traceHeader,
  until,
  type Got,
  type Route
} from './diagnostics-harness.ts';

// Marks for T2. They stay up here: a report keeps the lines of code around
// each frame, and a line that wrote one of them would carry it to the door.
const [COOKIE, HEADER, BODY, QUERY] = ['MARK1', 'MARK2', 'MARK3', 'MARK4'];

const door = await recorder();
const thirdParty = await recorder();
const { folder, settings } = tempOffice('diagnostics');
Object.assign(process.env, {
  ODDBORO_DIAGNOSTICS_DSN: `http://oddboro@127.0.0.1:${door.port}/oddboro/0`,
  // Both would route reports around the gate if the options did not pin them.
  SENTRY_SPOTLIGHT: `http://127.0.0.1:${door.port}/spotlight`,
  SENTRY_TRACE_LIFECYCLE: 'static'
});

await import('../../instrumentation.server.ts');
const Sentry = await import('@sentry/sveltekit');
const { fixedError } = await import('@oddboro/ledger/errors');
const hooks = await import('../../hooks.server.ts');
const answerRoute = await import('../../routes/api/diagnostics/+server.ts');
const relayRoute = await import('../../routes/api/diagnostics/envelope/+server.ts');
const { pageOptions } = await import('#lib/diagnostics.ts');

after(() => {
  door.close();
  thirdParty.close();
  rmSync(folder, { recursive: true, force: true });
});

const send = sender(hooks.handle);

const answer = (a: string) =>
  send({
    route: '/api/diagnostics',
    method: 'PUT',
    headers: { ...PAGE, 'content-type': 'application/json' },
    body: a,
    resolve: answerRoute.PUT as Route
  });

const atDoor = (from = 0) => door.got.slice(from).filter((g) => g.url.startsWith(ENVELOPE_PATH));
const flush = () => Sentry.flush(5000);

test('nothing leaves until the owner says yes, and an error arrives once they do', async () => {
  const sampled = { 'sentry-trace': traceHeader() };
  await send({
    route: '/api/goals',
    headers: sampled,
    resolve: throwing(() => fixedError('T1 before an answer'))
  });
  await flush();
  assert.equal(door.got.length, 0, 'nothing at all, the spotlight path included');

  assert.equal((await answer('{"answer":"no"}')).status, 200);
  await send({
    route: '/api/goals',
    headers: { 'sentry-trace': traceHeader() },
    resolve: throwing(() => fixedError('T1 after no'))
  });
  await flush();
  assert.equal(door.got.length, 0);

  assert.equal((await answer('{"answer":"yes"}')).status, 200);
  await send({
    route: '/api/goals',
    headers: { 'sentry-trace': traceHeader() },
    resolve: throwing(() => fixedError('T1 fixed message'))
  });
  await flush();
  const got = atDoor();
  assert.ok(got.length >= 1);
  assert.ok(got.some((g) => g.body.includes('T1 fixed message')));
  assert.ok(ofType(got, 'span').length >= 1);
  assert.equal(ofType(got, 'transaction').length, 0);
  assert.equal(door.got.filter((g) => g.url.startsWith('/spotlight')).length, 0);
});

test('a report carries no IP, cookie, header, body, query string, hostname, username or home folder', async () => {
  await answer('{"answer":"yes"}');
  const from = door.got.length;
  await send({
    route: '/api/goals',
    method: 'POST',
    path: `/api/goals?code=${QUERY}`,
    headers: { ...PAGE, cookie: `c=${COOKIE}`, 'x-custom': HEADER, 'sentry-trace': traceHeader() },
    body: BODY,
    resolve: throwing(() => new Error(`T2 failed in ${homedir()}`))
  });
  await flush();
  const got = atDoor(from);
  assert.ok(got.length >= 1);
  const os = items(got).flatMap(([, p]) => {
    const c = (p as { contexts?: { os?: Record<string, string> } }).contexts?.os;
    return c ? Object.values(c) : [];
  });
  for (const g of got) {
    const bytes = g.url + g.body;
    for (const mark of [COOKIE, HEADER, BODY, QUERY, userInfo().username, homedir()])
      assert.ok(!bytes.includes(mark), mark);
    // The system's own name and version are kept; a computer named after its
    // system (`cachyos`) shows there, and nowhere else.
    const withoutOs = os.reduce((b, v) => b.replaceAll(JSON.stringify(v), ''), bytes);
    assert.ok(!withoutOs.includes(hostname()), 'hostname');
  }
  for (const type of ['session', 'sessions', 'client_report'])
    assert.equal(ofType(got, type).length, 0, type);
});

test('turning reports off stops them at once, and on again starts them, with no restart', async () => {
  const counts = [];
  for (const [phase, a] of [
    [1, 'yes'],
    [2, 'no'],
    [3, 'yes']
  ] as const) {
    await answer(JSON.stringify({ answer: a }));
    const from = door.got.length;
    await send({
      route: '/api/goals',
      resolve: throwing(() => fixedError(`phase ${phase}`))
    });
    await flush();
    counts.push(ofType(atDoor(from), 'event').length);
  }
  assert.deepEqual(counts, [1, 0, 1]);
});

/** A page's envelope as the browser SDK makes it: its own placeholder DSN and key. */
function pageEnvelope(): string {
  const id = randomBytes(16).toString('hex');
  const header = {
    event_id: id,
    sent_at: new Date().toISOString(),
    dsn: 'http://page@127.0.0.1/0',
    trace: { trace_id: randomBytes(16).toString('hex'), public_key: 'page' }
  };
  const event = {
    event_id: id,
    platform: 'javascript',
    exception: { values: [{ type: 'TypeError', value: 'renderFloor is not a function' }] }
  };
  return [header, { type: 'event' }, event].map((x) => JSON.stringify(x)).join('\n');
}

const relay = (headers: Record<string, string>, resolve?: Route) =>
  send({
    route: '/api/diagnostics/envelope',
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1:4500',
      'content-type': 'application/x-sentry-envelope',
      ...headers
    },
    body: pageEnvelope(),
    resolve: resolve ?? (relayRoute.POST as Route)
  });

test("a page report reaches the door through the office only after yes, under the office's own key", async () => {
  await answer('{"answer":"no"}');
  let from = door.got.length;
  assert.equal((await relay({ 'sec-fetch-site': 'same-origin' })).status, 200);
  await flush();
  assert.equal(door.got.length - from, 0);

  await answer('{"answer":"yes"}');
  from = door.got.length;
  assert.equal((await relay({ 'sec-fetch-site': 'same-origin' })).status, 200);
  await flush();
  const got = atDoor(from);
  assert.equal(got.length, 1);
  assert.match(got[0].url, /[?&]sentry_key=oddboro(&|$)/);
  const [header] = parseEnvelope(got[0].body) as Envelope;
  assert.ok(!('dsn' in header));
  assert.equal((header.trace as { public_key?: string }).public_key, 'oddboro');
});

test("every span container the door gets tells Sentry never to infer the owner's address", async () => {
  await answer('{"answer":"yes"}');
  const from = door.got.length;
  await send({ route: '/api/ledger', headers: { 'sentry-trace': traceHeader() } });
  const trace = randomBytes(16).toString('hex');
  const pageSpans = [
    { sent_at: new Date().toISOString(), trace: { trace_id: trace, public_key: 'page' } },
    { type: 'span', item_count: 1, content_type: 'application/vnd.sentry.items.span.v2+json' },
    {
      version: 2,
      // The page's SDK sets `never` itself. A page that asks for `auto` gets `never` too.
      ingest_settings: { infer_ip: 'auto', infer_user_agent: 'never' },
      items: [
        {
          trace_id: trace,
          span_id: randomBytes(8).toString('hex'),
          name: '/',
          start_timestamp: 1,
          end_timestamp: 2,
          status: 'ok',
          is_segment: true,
          attributes: { 'sentry.segment.name.source': { type: 'string', value: 'route' } }
        }
      ]
    }
  ];
  await send({
    route: '/api/diagnostics/envelope',
    method: 'POST',
    headers: { ...PAGE, 'content-type': 'application/x-sentry-envelope' },
    body: pageSpans.map((x) => JSON.stringify(x)).join('\n'),
    resolve: relayRoute.POST as Route
  });
  await flush();
  type Named = Omit<SpanContainer, 'items'> & { items: { name: string }[] };
  const containers = () => ofType(atDoor(from), 'span').map(([, p]) => p as Named);
  const holding = (name: string) => containers().find((c) => c.items.some((s) => s.name === name));
  await until(() => !!holding('GET /api/ledger') && !!holding('/'));
  assert.deepEqual(holding('GET /api/ledger')?.ingest_settings, { infer_ip: 'never' });
  assert.deepEqual(holding('/')?.ingest_settings, { infer_ip: 'never', infer_user_agent: 'never' });
});

test('a request the guard refuses never reaches the relay or Sentry', async () => {
  await answer('{"answer":"yes"}');
  const from = door.got.length;
  let spied = false;
  const spy: Route = (e) => {
    spied = true;
    return (relayRoute.POST as Route)(e);
  };
  const refused = await relay({ 'sec-fetch-site': 'cross-site' }, spy);
  assert.deepEqual([refused.status, refused.ran, spied], [403, false, false]);
  // A route that is traced, from another site, whose caller sampled the
  // trace and whose caller did not. Only Sentry's handle could report them.
  for (const sampled of [true, false]) {
    const crossSite = await send({
      route: '/api/goals',
      method: 'PUT',
      headers: { 'sec-fetch-site': 'cross-site', 'sentry-trace': traceHeader(sampled) },
      body: '{}'
    });
    assert.deepEqual([crossSite.status, crossSite.ran], [403, false], `sampled ${sampled}`);
  }
  await flush();
  assert.equal(door.got.length - from, 0);
  // The same request from the page goes through.
  assert.equal((await relay({ 'sec-fetch-site': 'same-origin' }, spy)).status, 200);
});

test('the server never adds trace headers to a request it makes to another site', async () => {
  await answer('{"answer":"yes"}');
  const from = door.got.length;
  await send({
    route: '/api/connectors',
    headers: { 'sentry-trace': traceHeader() },
    resolve: async () => {
      await fetch(`http://127.0.0.1:${thirdParty.port}/elsewhere`);
      return new Response('ok');
    }
  });
  await flush();
  await until(() => ofType(atDoor(from), 'span').length > 0);
  const asked = thirdParty.got.at(-1);
  assert.ok(asked);
  assert.equal(asked.headers['sentry-trace'], undefined);
  assert.equal(asked.headers.baggage, undefined);
  const names = ofType(atDoor(from), 'span').flatMap(([, p]) =>
    (p as { items: { name: string }[] }).items.map((s) => s.name)
  );
  assert.ok(names.includes('GET /api/connectors'), names.join(', '));
});

test('the event stream, the shell updates and the relay are never traced', async () => {
  await answer('{"answer":"yes"}');
  const from = door.got.length;
  const routes = fileURLToPath(new URL('../../routes', import.meta.url));
  // Named here, not read from `QUIET_ROUTES`, so a route dropped from that
  // list fails this test.
  const quiet = ['/api/events', '/api/update', '/api/diagnostics/envelope'];
  for (const id of quiet) {
    assert.ok(existsSync(join(routes, id, '+server.ts')), id);
    await send({ route: id, headers: { 'sentry-trace': traceHeader() } });
  }
  await send({ route: '/api/ledger', headers: { 'sentry-trace': traceHeader() } });
  await flush();
  await until(() => ofType(atDoor(from), 'span').length > 0);
  type Span = { name: string; attributes: Record<string, { value: unknown }> };
  const spans = ofType(atDoor(from), 'span').flatMap(([, p]) => (p as { items: Span[] }).items);
  for (const id of quiet) assert.ok(!spans.some((s) => s.name.includes(id)), id);
  const traced = spans.find((s) => s.name === 'GET /api/ledger');
  assert.ok(traced, spans.map((s) => s.name).join(', '));
  assert.equal(traced.attributes['sentry.segment.name.source'].value, 'route');
});

test('the page sends no span for each file it fetches, and keeps its own spans', () => {
  // The SDK's own check, which it runs as each streamed span starts.
  const { ignoreSpans } = pageOptions(() => 'yes');
  const dropped = (op: string) => shouldIgnoreSpan({ description: 'x', op }, ignoreSpans ?? []);
  for (const op of ['resource.script', 'resource.css', 'resource.other', 'resource.link'])
    assert.ok(dropped(op), op);
  for (const op of ['pageload', 'navigation', 'http.client', 'browser.paint'])
    assert.ok(!dropped(op), op);
});

test('an unhandled rejection still ends the server', async () => {
  const from = door.got.length;
  const instrumentation = fileURLToPath(
    new URL('../../instrumentation.server.ts', import.meta.url)
  );
  // Not spawnSync: the door runs in this process and must answer the child.
  const code = await new Promise<number | null>((done) => {
    const child = execFile(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(instrumentation)}); Promise.reject(new TypeError('notDefinedInT8 is not defined'));`
      ],
      { env: { ...process.env, OFFICE_DIAGNOSTICS: 'yes' }, timeout: 30_000 }
    );
    child.on('exit', done);
  });
  assert.notEqual(code, 0);
  assert.ok(atDoor(from).some((g) => g.body.includes('notDefinedInT8 is not defined')));
});

test('the answer route refuses anything but yes or no, and leaves the setting as it was', async () => {
  writeFileSync(settings, 'OFFICE_DIAGNOSTICS=no\n');
  for (const body of ['{"answer":"maybe"}', '{}', 'not json']) {
    assert.equal((await answer(body)).status, 400, body);
    assert.match(readFileSync(settings, 'utf8'), /^OFFICE_DIAGNOSTICS=no$/m, body);
  }
  assert.equal((await answer('{"answer":"yes"}')).status, 200);
  assert.match(readFileSync(settings, 'utf8'), /^OFFICE_DIAGNOSTICS=yes$/m);
});

// A value JSON writes at 6 bytes a character.
const PLANT = '\u0001'.repeat(500) + 'x'.repeat(500);
const DOOR_LIMIT = 1_000_000;

type SentSpan = { span_id: string; attributes: Record<string, { value: unknown }> };
type SpanContainer = { items: unknown[]; ingest_settings?: Record<string, unknown> };

/** One traced request that makes 999 heavy spans, then every span the door got for it. */
async function heavyTrace(oversize?: number): Promise<{ got: Got[]; spans: SentSpan[] }> {
  const from = door.got.length;
  await send({
    route: '/api/staff/[id]',
    path: '/api/staff/paige',
    headers: { 'sentry-trace': traceHeader() },
    resolve: () => {
      for (let i = 0; i < 999; i++) {
        const even = i % 2 === 0;
        Sentry.startSpan(
          {
            name: even ? 'OPTIONS https://outside.example/x' : 'heavy',
            op: even ? 'http.client' : i === oversize ? 'z'.repeat(1_100_000) : PLANT,
            attributes: {
              'http.response.status_code': 503,
              'sentry.origin': PLANT,
              // The SDK types this as a source name; a careless caller can set any string.
              'sentry.segment.name.source': PLANT as never,
              'db.system': PLANT,
              ...(even && { 'http.request.method': PLANT })
            }
          },
          () => {}
        );
      }
      return new Response('ok');
    }
  });
  await flush();
  const want = oversize === undefined ? 1000 : 999;
  const spansIn = (got: Got[]) =>
    ofType(got, 'span').flatMap(([, p]) => (p as { items: SentSpan[] }).items);
  await until(() => spansIn(atDoor(from)).length >= want);
  const got = atDoor(from);
  return { got, spans: spansIn(got) };
}

test('a full batch of spans with long values reaches the door in pieces under its size cap', async (t) => {
  await answer('{"answer":"yes"}');
  const logged = t.mock.method(console, 'error', () => {});

  const run1 = await heavyTrace();
  assert.ok(run1.got.length > 1, 'split');
  for (const g of run1.got) assert.ok(Buffer.byteLength(g.body) <= DOOR_LIMIT, `${g.body.length}`);
  for (const [h, p] of ofType(run1.got, 'span')) {
    const container = p as SpanContainer;
    assert.equal(h.item_count, container.items.length);
    assert.equal(container.ingest_settings?.infer_ip, 'never');
  }
  assert.equal(run1.spans.length, 1000);
  assert.equal(new Set(run1.spans.map((s) => s.span_id)).size, 1000);
  assert.ok(run1.spans.some((s) => s.attributes['sentry.origin']?.value === PLANT));

  const run2 = await heavyTrace(1);
  assert.equal(run2.spans.length, 999);
  for (const g of run2.got) assert.ok(Buffer.byteLength(g.body) <= DOOR_LIMIT);
  const lines = logged.mock.calls.map((c) => String(c.arguments[0]));
  assert.equal(
    lines.filter((l) => l === "[diagnostics] dropped 1 span(s) over the door's size limit").length,
    1
  );
});
