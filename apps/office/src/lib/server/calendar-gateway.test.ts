// Google Calendar through the gateway, as a run reaches it, and the owner's
// click on the desk. Read only reaches the four read tools. With write, an
// event that emails nobody follows the level (Act goes, Draft waits), and one
// that would make Google email anyone waits on the desk at every level, goes
// with sendUpdates=all only on the owner's click, and goes as the owner left
// it. Google itself is a stand-in `fetch`. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { HeldCall } from '@oddboro/ledger';
import { L, odd, request, secrets } from './office-under-test.ts';

process.env.ODDBORO_GOOGLE_CLIENT_SECRET = 'a-client-secret-for-tests';
const { closeGateway, gateway, openGateway } = await import('./gateway.ts');
const { listTools } = await import('./access.ts');

const ID = 'google-calendar';
const OWNER = 'owner@example.com';
const READ = 'https://www.googleapis.com/auth/calendar.readonly';
const EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const EMAIL = 'https://www.googleapis.com/auth/userinfo.email';
const signedIn = (scope: string) =>
  JSON.stringify({
    tokens: { access_token: 'ya29.calendar', refresh_token: '1//r', expires_in: 3600, scope },
    savedAt: Date.now()
  });
secrets.set(`${ID}:oauth`, signedIn(`${READ} ${EVENTS} ${EMAIL}`));

/** What reached Google, and the attendees of the event the stand-in holds. */
const google: { method: string; url: URL; body?: Record<string, unknown> }[] = [];
let onEvent: { email: string; self?: boolean }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://accounts.google.com/'))
    return url.endsWith('/.well-known/openid-configuration')
      ? Response.json({
          issuer: 'https://accounts.google.com',
          authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          token_endpoint: 'https://oauth2.googleapis.com/token',
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['plain', 'S256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
          jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256']
        })
      : new Response('', { status: 404 });
  if (!/googleapis\.com/.test(url)) return realFetch(input, init);
  const method = init?.method ?? 'GET';
  google.push({
    method,
    url: new URL(url),
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
  });
  if (method === 'GET' && url.includes('/events/'))
    return Response.json({ summary: 'Team lunch', attendees: onEvent });
  if (url.includes('/calendarList'))
    return Response.json({
      items: [
        {
          id: OWNER,
          summary: OWNER,
          primary: true,
          accessRole: 'owner',
          backgroundColor: '#9fe1e7'
        },
        { id: 'team@group.calendar.google.com', summary: 'Team', accessRole: 'writer' }
      ]
    });
  if (url.includes('/colors')) return Response.json({ event: { '7': { background: '#46d6db' } } });
  return Response.json({ id: 'ev-1' });
}) as typeof fetch;

await L.ensureConnector(ID);
const tools = await listTools(ID);
await L.connectorReady(
  ID,
  tools.map((t) => t.name),
  tools.filter((t) => t.readOnly).map((t) => t.name)
);
const c0 = (await L.connector(ID))!;
await L.setConnectorConfig(ID, { ...c0.config, account: OWNER });
const calendar = async () => (await L.connector(ID))!;
await L.pg`insert into staff ${L.pg([
  { ...odd('cara', 'Cara'), permission: 'draft' },
  odd('abe', 'Abe')
])}`;

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'a-run', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${L.OFFICE_URL}/api/gateway/${ID}`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: (url, init) => gateway(new Request(url, init), ID)
    })
  );
  return client;
}
const said = (r: unknown) => (r as CallToolResult).content.map((p) => (p as { text: string }).text);
const words = { oddboro_title: 'Lunch with the team', oddboro_why: 'You asked for it.' };
const lunch = {
  summary: 'Lunch',
  start_time: '2026-11-20T12:00:00',
  end_time: '2026-11-20T13:00:00',
  time_zone: 'America/Los_Angeles'
};
const writes = () => google.filter((g) => g.method !== 'GET');
const callsOf = async (staffId: string) =>
  (await L.pg`select id, title, status, call from asks where staff_id = ${staffId} and kind = 'call' order by id`) as unknown as {
    id: number;
    title: string;
    status: string;
    call: HeldCall;
  }[];

test('Calendar signs in with calendar.readonly, calendar.events and userinfo.email, and an older sign-in signs in afresh', async () => {
  const { GOOGLE_SCOPES, startSignIn } = await import('./oauth.ts');
  assert.equal(GOOGLE_SCOPES.calendar, `${READ} ${EVENTS} ${EMAIL}`);
  assert.doesNotMatch(GOOGLE_SCOPES.calendar, /auth\/calendar( |$)/);
  const kept = secrets.get(`${ID}:oauth`)!;
  secrets.set(`${ID}:oauth`, signedIn(`${READ} ${EMAIL}`));
  try {
    const { url } = await startSignIn(ID);
    assert.ok(url, 'Google asks for consent again');
    assert.equal(new URL(url).searchParams.get('scope'), `${READ} ${EVENTS} ${EMAIL}`);
  } finally {
    secrets.set(`${ID}:oauth`, kept);
  }
});

test('Read only reaches the four read tools alone, and no tool deletes', async () => {
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'check_availability',
    'create_event',
    'get_event',
    'list_calendars',
    'list_events',
    'update_event'
  ]);
  assert.ok(!tools.some((t) => /delete|remove|clear/.test(t.name)));
  const { token } = openGateway([{ connector: await calendar(), level: 'read' }], 60_000);
  const client = await connect(token);
  try {
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [
      'check_availability',
      'get_event',
      'list_calendars',
      'list_events'
    ]);
    google.length = 0;
    const refused = await client.callTool({ name: 'create_event', arguments: lunch });
    assert.equal(refused.isError, true);
    assert.equal(google.length, 0);
  } finally {
    await client.close();
    await closeGateway(token);
  }
});

test('at Draft an event with no guests waits on the desk, with the line Oddboro adds', async () => {
  const place = { staffId: 'cara', run: 'run-cara-1' };
  const { token } = openGateway(
    [{ connector: await calendar(), level: 'act', waits: true }],
    60_000,
    place
  );
  const client = await connect(token);
  try {
    google.length = 0;
    const r = await client.callTool({ name: 'create_event', arguments: { ...lunch, ...words } });
    assert.match(said(r)[0], /^Held for .*'s yes as ask \d+/);
    assert.equal(writes().length, 0);
  } finally {
    await client.close();
    await closeGateway(token);
  }
  const [held] = await callsOf('cara');
  assert.equal(held.title, `Add "Lunch" to the calendar in ${(await calendar()).name}`);
  assert.equal(held.call.event?.account, OWNER);
  assert.deepEqual(held.call.event?.others, []);
  assert.equal(held.call.arguments.description, 'Added by Oddboro: https://oddboro.com');
  assert.equal(held.call.arguments.oddboro_title, undefined);
});

test('at Act an event with no guests goes at once, and nobody is emailed', async () => {
  const { token } = openGateway([{ connector: await calendar(), level: 'act' }], 60_000, {
    staffId: 'abe',
    run: 'run-abe-1'
  });
  const client = await connect(token);
  try {
    const listed = (await client.listTools()).tools.find((t) => t.name === 'create_event')!;
    // The title and reason are there for an event that waits, and needed only then.
    assert.ok(listed.inputSchema.properties?.oddboro_title);
    assert.ok(!listed.inputSchema.required?.includes('oddboro_title'));
    google.length = 0;
    const r = await client.callTool({ name: 'create_event', arguments: lunch });
    assert.notEqual(r.isError, true);
    assert.match(said(r)[0], /Nobody was emailed/);
    const [made] = writes();
    assert.equal(made.method, 'POST');
    assert.equal(made.url.pathname, '/calendar/v3/calendars/primary/events');
    assert.equal(made.url.searchParams.get('sendUpdates'), 'none');
    assert.equal(made.body?.description, 'Added by Oddboro: https://oddboro.com');
    assert.deepEqual(made.body?.start, {
      dateTime: '2026-11-20T12:00:00',
      timeZone: 'America/Los_Angeles'
    });
  } finally {
    await client.close();
    await closeGateway(token);
  }
  assert.equal((await callsOf('abe')).length, 0);
});

test('at Act an event with guests waits on the desk, and goes as the owner left it only on their click', async () => {
  const { token } = openGateway([{ connector: await calendar(), level: 'act' }], 60_000, {
    staffId: 'abe',
    run: 'run-abe-2'
  });
  const client = await connect(token);
  try {
    google.length = 0;
    // Without the title and reason nothing is held, and nothing reaches Google.
    const bare = await client.callTool({
      name: 'create_event',
      arguments: { ...lunch, attendees: ['ada@example.com'] }
    });
    assert.match(said(bare)[0], /^Nothing was held/);
    const r = await client.callTool({
      name: 'create_event',
      arguments: { ...lunch, ...words, attendees: ['ada@example.com', OWNER, 'cy@example.com'] }
    });
    assert.match(said(r)[0], /Google emails ada@example\.com, cy@example\.com only when/);
    assert.equal(writes().length, 0);
  } finally {
    await client.close();
    await closeGateway(token);
  }
  const [held] = await callsOf('abe');
  assert.match(held.title, /^Invite 2 people to "Lunch"/);
  // The calendars to pick from and Google's colours come as it is held, so the card never calls Google.
  assert.deepEqual(
    held.call.event?.calendars?.map((c) => c.id),
    [OWNER, 'team@group.calendar.google.com']
  );
  assert.equal(held.call.event?.calendars?.[0].color, '#9fe1e7');
  assert.deepEqual(held.call.event?.colors, { '7': '#46d6db' });

  // A calendar the desk did not offer is refused, and nothing reaches Google.
  google.length = 0;
  await assert.rejects(
    request('/api/asks/[id]/call', 'POST', {
      params: { id: String(held.id) },
      body: { arguments: { summary: 'Team lunch', calendar_id: 'other@group.calendar.google.com' } }
    }),
    { status: 400 }
  );
  assert.equal(writes().length, 0);

  google.length = 0;
  const res = await request('/api/asks/[id]/call', 'POST', {
    params: { id: String(held.id) },
    body: {
      arguments: {
        summary: 'Team lunch',
        attendees: ['ada@example.com'],
        description: 'At noon.',
        // The owner may pick another of the account's calendars.
        calendar_id: 'team@group.calendar.google.com',
        start_time: '2026-11-20T12:30:00',
        end_time: '2026-11-20T13:30:00',
        time_zone: 'America/Los_Angeles'
      }
    }
  });
  assert.equal(res.status, 200);
  const [made] = writes();
  assert.equal(made.url.pathname, '/calendar/v3/calendars/team%40group.calendar.google.com/events');
  assert.equal(made.url.searchParams.get('sendUpdates'), 'all');
  assert.equal(made.body?.summary, 'Team lunch');
  assert.deepEqual(made.body?.attendees, [{ email: 'ada@example.com' }]);
  // The owner took the line out, and it stays out.
  assert.equal(made.body?.description, 'At noon.');
  assert.equal((made.body?.start as { dateTime: string }).dateTime, '2026-11-20T12:30:00');
  const [after] = await callsOf('abe');
  assert.equal(after.status, 'approved');
  assert.equal(after.call.arguments.summary, 'Team lunch');
  assert.equal(after.call.result?.ok, true);
});

test('at Act a change to an event with guests on it waits too, and a change to one without goes', async () => {
  const { token } = openGateway([{ connector: await calendar(), level: 'act' }], 60_000, {
    staffId: 'abe',
    run: 'run-abe-3'
  });
  const client = await connect(token);
  try {
    onEvent = [{ email: OWNER, self: true }];
    google.length = 0;
    const alone = await client.callTool({
      name: 'update_event',
      arguments: { event_id: 'ev1', location: 'Home' }
    });
    assert.notEqual(alone.isError, true);
    assert.equal(writes()[0].method, 'PATCH');
    assert.equal(writes()[0].url.searchParams.get('sendUpdates'), 'none');

    onEvent = [{ email: OWNER, self: true }, { email: 'bo@example.com' }];
    google.length = 0;
    const r = await client.callTool({
      name: 'update_event',
      arguments: { event_id: 'ev1', location: 'Cafe', ...words }
    });
    assert.match(said(r)[0], /^Held for/);
    assert.equal(writes().length, 0);
  } finally {
    await client.close();
    await closeGateway(token);
    onEvent = [];
  }
  const held = (await callsOf('abe')).at(-1)!;
  const { account, now, others, before } = held.call.event!;
  assert.deepEqual(
    { account, now, others },
    {
      account: OWNER,
      now: 'Team lunch',
      others: ['bo@example.com']
    }
  );
  // The event as it stood goes with it, for the card to show.
  assert.deepEqual(
    before?.attendees?.map((a) => a.email),
    [OWNER, 'bo@example.com']
  );
  assert.match(held.title, /^Change "Team lunch" and email 1 person/);
});

test('a held change without its event card emails nobody on the click: the tool refuses it', async () => {
  // Google could not be read as it was held, so the desk showed a plain call
  // and never named the guests. The click must not email them.
  const { makeCall } = await import('./gateway.ts');
  onEvent = [{ email: OWNER, self: true }, { email: 'bo@example.com' }];
  google.length = 0;
  try {
    const result = await makeCall(
      { connector: ID, tool: 'update_event', arguments: { event_id: 'ev1', location: 'Cafe' } },
      'abe'
    );
    assert.equal(result.ok, false);
    assert.equal(writes().length, 0);
  } finally {
    onEvent = [];
  }
});

test("at Act the owner's own reminders and colour on an event with guests go at once, and email nobody", async () => {
  const { token } = openGateway([{ connector: await calendar(), level: 'act' }], 60_000, {
    staffId: 'abe',
    run: 'run-abe-4'
  });
  const client = await connect(token);
  const before = (await callsOf('abe')).length;
  try {
    onEvent = [{ email: OWNER, self: true }, { email: 'bo@example.com' }];
    google.length = 0;
    const r = await client.callTool({
      name: 'update_event',
      arguments: {
        event_id: 'ev1',
        reminders: { use_default: false, overrides: [{ method: 'popup', minutes: 15 }] },
        color_id: '7'
      }
    });
    assert.notEqual(r.isError, true, said(r).join());
    const [made] = writes();
    assert.equal(made.method, 'PATCH');
    assert.equal(made.url.searchParams.get('sendUpdates'), 'none');
    // A Meet call is something the guests see: it waits.
    google.length = 0;
    const meet = await client.callTool({
      name: 'update_event',
      arguments: { event_id: 'ev1', google_meet: true, ...words }
    });
    assert.match(said(meet)[0], /^Held for/);
    assert.equal(writes().length, 0);
  } finally {
    await client.close();
    await closeGateway(token);
    onEvent = [];
  }
  assert.equal((await callsOf('abe')).length, before + 1);
});
