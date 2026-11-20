// Exercise the same MCP tools a run receives. Only Google's HTTP reply is a fixture.
import assert from 'node:assert/strict';
import { after, test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readsOnly } from '@oddboro/ledger';
import { calendarServer, ownerEdit, withEventFooter } from './calendar.ts';
import { OWNER_META } from './http.ts';

const [ours, theirs] = InMemoryTransport.createLinkedPair();
const server = calendarServer(async () => 'test-token', 'reader@example.com');
await server.connect(ours);
const client = new Client({ name: 'calendar-test', version: '1' });
await client.connect(theirs);
after(async () => {
  await client.close();
  await server.close();
});

const calendar_id = 'room#1@group.calendar.google.com';
const period = { time_min: '2026-11-15T00:00:00-08:00', time_max: '2026-11-16T00:00:00-08:00' };

test('a read grant gets four calendar tools and each names its own account', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools
      .filter(readsOnly)
      .map((t) => t.name)
      .sort(),
    ['check_availability', 'get_event', 'list_calendars', 'list_events']
  );
  assert.ok(tools.every((t) => t.description?.includes('reader@example.com')));
});

test('calendar and event lists keep continuation tokens and the bounds on recurring events', async (t) => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
    urls.push(new URL(input));
    return Response.json({ nextPageToken: 'following', items: [{ summary: 'A <meeting>' }] });
  });
  await client.callTool({ name: 'list_calendars', arguments: { page_token: 'second page' } });
  assert.equal(urls[0].pathname, '/calendar/v3/users/me/calendarList');
  assert.equal(urls[0].searchParams.get('pageToken'), 'second page');
  const r = await client.callTool({
    name: 'list_events',
    arguments: { calendar_id, ...period, page_token: 'next' }
  });
  assert.equal(
    urls[1].pathname,
    '/calendar/v3/calendars/room%231%40group.calendar.google.com/events'
  );
  const params = urls[1].searchParams;
  assert.equal(params.get('timeMin'), period.time_min);
  assert.equal(params.get('timeMax'), period.time_max);
  assert.equal(params.get('singleEvents'), 'true');
  assert.equal(params.get('orderBy'), 'startTime');
  assert.equal(params.get('pageToken'), 'next');
  assert.match(JSON.stringify(r.content), /following/);
  assert.match(JSON.stringify(r.content), /untrusted/);
});

test('get_event reads the selected occurrence and a busy check keeps errors by calendar', async (t) => {
  const sent: Request[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    sent.push(new Request(url, init));
    return Response.json({ calendars: { secondary: { errors: [{ reason: 'notFound' }] } } });
  });
  await client.callTool({
    name: 'get_event',
    arguments: { calendar_id: 'primary', event_id: 'abc_20261115T140000Z' }
  });
  assert.equal(
    new URL(sent[0].url).pathname,
    '/calendar/v3/calendars/primary/events/abc_20261115T140000Z'
  );
  const r = await client.callTool({
    name: 'check_availability',
    arguments: { calendar_ids: ['primary', 'secondary'], ...period }
  });
  assert.equal(sent[1].method, 'POST');
  assert.equal(new URL(sent[1].url).pathname, '/calendar/v3/freeBusy');
  assert.deepEqual(await sent[1].json(), {
    timeMin: period.time_min,
    timeMax: period.time_max,
    items: [{ id: 'primary' }, { id: 'secondary' }]
  });
  assert.match(JSON.stringify(r.content), /notFound/);
  const bad = await client.callTool({
    name: 'list_events',
    arguments: { calendar_id, ...period, time_max: period.time_min }
  });
  assert.equal(bad.isError, true);
  assert.equal(sent.length, 2);
});

test('only create_event and update_event change anything, and no tool deletes', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools
      .filter((t) => !readsOnly(t))
      .map((t) => t.name)
      .sort(),
    ['create_event', 'update_event']
  );
  assert.ok(tools.every((t) => !t.annotations?.destructiveHint));
});

/** Every call to Google, with its body, and an event on the calendar with these attendees. */
function stand(t: TestContext, on: object[] = []) {
  const sent: { method: string; url: URL; body?: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    sent.push({
      method,
      url: new URL(url),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    });
    return Response.json(method === 'GET' ? { summary: 'Standup', attendees: on } : { id: 'e1' });
  });
  return sent;
}
const yes = { _meta: { [OWNER_META]: true } };
const lunch = {
  summary: 'Lunch',
  start_time: '2026-11-20T12:00:00-08:00',
  end_time: '2026-11-20T13:00:00-08:00'
};

test("an event with guests is refused from a run, and goes with sendUpdates=all on the owner's click", async (t) => {
  const sent = stand(t);
  const refused = await client.callTool({
    name: 'create_event',
    arguments: { ...lunch, attendees: ['ada@example.com'] }
  });
  assert.equal(refused.isError, true);
  assert.match(JSON.stringify(refused.content), /only when the owner clicks/);
  assert.equal(sent.length, 0);
  // Only the owner's own address on it: nobody else is emailed, so it goes.
  const own = await client.callTool({
    name: 'create_event',
    arguments: { ...lunch, attendees: ['Reader@example.com'] }
  });
  assert.notEqual(own.isError, true);
  assert.equal(sent[0].url.searchParams.get('sendUpdates'), 'none');
  const r = await client.callTool({
    name: 'create_event',
    arguments: { ...lunch, attendees: ['ada@example.com'], description: 'Bring cake.' },
    ...yes
  });
  assert.notEqual(r.isError, true);
  assert.equal(sent[1].url.searchParams.get('sendUpdates'), 'all');
  // On the click the description is the owner's: the office adds nothing.
  assert.equal(sent[1].body?.description, 'Bring cake.');
  assert.match(JSON.stringify(r.content), /emailed an invite to ada@example\.com/);
});

test('an all-day event takes dates, and an end before its start is refused', async (t) => {
  const sent = stand(t);
  await client.callTool({
    name: 'create_event',
    arguments: { summary: 'Off', start_time: '2026-12-24', end_time: '2026-12-27', all_day: true }
  });
  assert.deepEqual(sent[0].body?.start, { date: '2026-12-24' });
  assert.deepEqual(sent[0].body?.end, { date: '2026-12-27' });
  const back = await client.callTool({
    name: 'create_event',
    arguments: { ...lunch, end_time: '2026-11-20T11:00:00-08:00' }
  });
  assert.equal(back.isError, true);
  const zoneless = await client.callTool({
    name: 'create_event',
    arguments: { summary: 'x', start_time: '2026-11-20T12:00:00', end_time: '2026-11-20T13:00:00' }
  });
  assert.equal(zoneless.isError, true);
  assert.equal(sent.length, 1);
});

test('a change to an event with guests on it waits for the click, and keeps the guests it does not take off', async (t) => {
  const sent = stand(t, [
    { email: 'reader@example.com', self: true },
    { email: 'bo@example.com', responseStatus: 'accepted' },
    { email: 'cy@example.com' }
  ]);
  const refused = await client.callTool({
    name: 'update_event',
    arguments: { event_id: 'e1', location: 'Cafe' }
  });
  assert.equal(refused.isError, true);
  assert.ok(sent.every((s) => s.method === 'GET'));
  await client.callTool({
    name: 'update_event',
    arguments: {
      event_id: 'e1',
      added_attendees: ['di@example.com'],
      removed_attendee_emails: ['cy@example.com']
    },
    ...yes
  });
  const patch = sent.find((s) => s.method === 'PATCH')!;
  assert.equal(patch.url.pathname, '/calendar/v3/calendars/primary/events/e1');
  assert.equal(patch.url.searchParams.get('sendUpdates'), 'all');
  assert.deepEqual(patch.body?.attendees, [
    { email: 'reader@example.com', self: true },
    { email: 'bo@example.com', responseStatus: 'accepted' },
    { email: 'di@example.com' }
  ]);
});

test('the line Oddboro adds goes in once, and the owner edits only the event itself', () => {
  assert.equal(withEventFooter(undefined), 'Added by Oddboro: https://oddboro.com');
  assert.equal(withEventFooter('Agenda'), 'Agenda\n\nAdded by Oddboro: https://oddboro.com');
  assert.equal(withEventFooter(withEventFooter('Agenda')), withEventFooter('Agenda'));
  const held = { calendar_id: 'team', event_id: 'e1', summary: 'Old', location: 'Here' };
  const event = {
    others: [],
    calendars: [
      { id: 'team', name: 'Team' },
      { id: 'home', name: 'Home' }
    ]
  };
  // An emptied place is the owner's: no place. Which event never changes.
  assert.deepEqual(
    ownerEdit(
      'update_event',
      held,
      {
        event_id: 'e2',
        calendar_id: 'mine',
        summary: 'New',
        location: '',
        added_attendees: ['ada@example.com'],
        move_to_calendar_id: 'home'
      },
      event
    ),
    {
      calendar_id: 'team',
      event_id: 'e1',
      summary: 'New',
      location: '',
      added_attendees: ['ada@example.com'],
      move_to_calendar_id: 'home'
    }
  );
  // A new event may go on any calendar the desk offered, and no other.
  assert.equal(
    ownerEdit('create_event', { summary: 'x' }, { calendar_id: 'home' }, event).calendar_id,
    'home'
  );
  assert.throws(
    () => ownerEdit('create_event', { summary: 'x' }, { calendar_id: 'someone-else' }, event),
    /calendars the desk offers/
  );
  assert.throws(() => ownerEdit('list_events', held, {}), /Only a calendar event/);
});

/**
 * Google as a store of events by ID: a GET reads one, a PATCH changes it, a
 * POST makes one, and every call is kept with its body.
 */
function store(t: TestContext, held: Record<string, Record<string, unknown>>) {
  const sent: { method: string; url: URL; body?: Record<string, unknown> }[] = [];
  let made = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const u = new URL(url);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    sent.push({ method, url: u, body });
    const [, eventId, more] = /\/events\/([^/]+)(?:\/(\w+))?$/.exec(u.pathname) ?? [];
    if (more === 'instances')
      return Response.json({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    if (method === 'GET' && eventId)
      return held[eventId] ? Response.json(held[eventId]) : new Response('{}', { status: 404 });
    if (method === 'PATCH') return Response.json({ id: eventId, ...held[eventId], ...body });
    if (more === 'move') return Response.json({ id: eventId });
    return Response.json({ id: `new-${++made}` });
  });
  return sent;
}
const writesOf = (sent: ReturnType<typeof store>) => sent.filter((s) => s.method !== 'GET');

test('a new event carries everything Google Calendar offers, and Meet goes with conferenceDataVersion=1', async (t) => {
  const sent = store(t, {});
  const r = await client.callTool({
    name: 'create_event',
    arguments: {
      summary: 'Flight',
      start_time: '2026-11-20T10:00:00',
      end_time: '2026-11-20T18:00:00',
      time_zone: 'America/Los_Angeles',
      end_time_zone: 'America/New_York',
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=4'],
      reminders: { use_default: false, overrides: [{ method: 'email', minutes: 1440 }] },
      google_meet: true,
      show_as: 'free',
      visibility: 'private',
      guests_can_modify: true,
      guests_can_invite_others: false,
      color_id: '7',
      attachments: [{ file_id: '1AbCdEfGhIjKlMnOpQrStUvWx', title: 'Boarding pass.pdf' }],
      attendees: [OWN_ADDRESS]
    }
  });
  assert.notEqual(r.isError, true, JSON.stringify(r.content));
  const [made] = writesOf(sent);
  const q = made.url.searchParams;
  assert.equal(q.get('sendUpdates'), 'none');
  assert.equal(q.get('conferenceDataVersion'), '1');
  assert.equal(q.get('supportsAttachments'), 'true');
  const b = made.body!;
  assert.deepEqual(b.end, { dateTime: '2026-11-20T18:00:00', timeZone: 'America/New_York' });
  assert.deepEqual(b.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=4']);
  assert.deepEqual(b.reminders, {
    useDefault: false,
    overrides: [{ method: 'email', minutes: 1440 }]
  });
  const conference = b.conferenceData as { createRequest: Record<string, unknown> };
  assert.deepEqual(conference.createRequest.conferenceSolutionKey, { type: 'hangoutsMeet' });
  assert.match(String(conference.createRequest.requestId), /^[\w-]{36}$/);
  assert.equal(b.transparency, 'transparent');
  assert.equal(b.visibility, 'private');
  assert.equal(b.guestsCanModify, true);
  assert.equal(b.guestsCanInviteOthers, false);
  assert.equal(b.guestsCanSeeOtherGuests, undefined);
  assert.equal(b.colorId, '7');
  assert.deepEqual(b.attachments, [
    {
      fileUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view?usp=drivesdk',
      title: 'Boarding pass.pdf'
    }
  ]);
  // An optional guest is still a guest, and still waits for the click.
  const optional = await client.callTool({
    name: 'create_event',
    arguments: { ...lunch, attendees: [{ email: 'ada@example.com', optional: true }] }
  });
  assert.equal(optional.isError, true);
  await client.callTool({
    name: 'create_event',
    arguments: {
      ...lunch,
      attendees: [{ email: 'ada@example.com', optional: true }, 'cy@example.com']
    },
    ...yes
  });
  assert.deepEqual(writesOf(sent)[1].body?.attendees, [
    { email: 'ada@example.com', optional: true },
    { email: 'cy@example.com' }
  ]);
  const notDrive = await client.callTool({
    name: 'create_event',
    arguments: { ...lunch, attachments: [{ file_url: 'https://example.com/a.pdf' }] }
  });
  assert.equal(notDrive.isError, true);
});

const OWN_ADDRESS = 'reader@example.com';
const guests = [
  { email: OWN_ADDRESS, self: true, organizer: true, responseStatus: 'accepted' },
  { email: 'ada@example.com', responseStatus: 'accepted' },
  { email: 'bo@example.com', optional: true }
];
/** A weekly series on Fridays at 10 in Los Angeles, with a Zoom call, and its third Friday. */
const weekly = {
  id: 'series',
  summary: 'Planning',
  start: { dateTime: '2026-11-06T10:00:00-08:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-11-06T11:00:00-08:00', timeZone: 'America/Los_Angeles' },
  recurrence: [
    'RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=FR',
    'EXDATE;TZID=America/Los_Angeles:20261127T100000'
  ],
  attendees: guests,
  conferenceData: {
    conferenceId: 'zoom-1',
    conferenceSolution: { key: { type: 'addOn' }, name: 'Zoom Meeting' },
    entryPoints: [{ entryPointType: 'video', uri: 'https://zoom.example.com/j/1' }]
  },
  reminders: { useDefault: true }
};
const third = {
  id: 'series_20261120T180000Z',
  recurringEventId: 'series',
  summary: 'Planning',
  originalStartTime: { dateTime: '2026-11-20T10:00:00-08:00', timeZone: 'America/Los_Angeles' },
  start: { dateTime: '2026-11-20T10:00:00-08:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-11-20T11:00:00-08:00', timeZone: 'America/Los_Angeles' },
  attendees: guests
};

test('an occurrence of a repeating event needs a scope, and "this event" changes it alone', async (t) => {
  const sent = store(t, { series: weekly, [third.id]: third });
  const bare = await client.callTool({
    name: 'update_event',
    arguments: { event_id: third.id, reminders: { use_default: true } }
  });
  assert.equal(bare.isError, true);
  assert.match(JSON.stringify(bare.content), /scope/);
  // Reminders alone: only the owner sees them, so a run makes it and nobody is emailed.
  const mine = await client.callTool({
    name: 'update_event',
    arguments: {
      event_id: third.id,
      scope: 'this',
      reminders: { use_default: false, overrides: [{ method: 'popup', minutes: 30 }] },
      color_id: '11'
    }
  });
  assert.notEqual(mine.isError, true, JSON.stringify(mine.content));
  assert.match(JSON.stringify(mine.content), /Nobody was emailed/);
  const [patch] = writesOf(sent);
  assert.equal(patch.url.pathname, `/calendar/v3/calendars/primary/events/${third.id}`);
  assert.equal(patch.url.searchParams.get('sendUpdates'), 'none');
  // Anything the guests see waits for the owner's click.
  const place = await client.callTool({
    name: 'update_event',
    arguments: { event_id: third.id, scope: 'this', location: 'Cafe' }
  });
  assert.equal(place.isError, true);
  const meet = await client.callTool({
    name: 'update_event',
    arguments: { event_id: third.id, scope: 'this', google_meet: true }
  });
  assert.equal(meet.isError, true);
  const files = await client.callTool({
    name: 'update_event',
    arguments: { event_id: third.id, scope: 'this', attachments: [] }
  });
  assert.equal(files.isError, true);
  const rule = await client.callTool({
    name: 'update_event',
    arguments: { event_id: third.id, scope: 'this', recurrence: ['RRULE:FREQ=DAILY'] },
    ...yes
  });
  assert.match(JSON.stringify(rule.content), /cannot repeat on its own/);
});

test('"all events" from one occurrence moves the whole series as far as that one moved', async (t) => {
  const sent = store(t, { series: weekly, [third.id]: third });
  const r = await client.callTool({
    name: 'update_event',
    arguments: {
      event_id: third.id,
      scope: 'all',
      start_time: '2026-11-20T11:30:00',
      end_time: '2026-11-20T12:00:00',
      time_zone: 'America/Los_Angeles'
    },
    ...yes
  });
  assert.notEqual(r.isError, true, JSON.stringify(r.content));
  const [patch] = writesOf(sent);
  assert.equal(patch.url.pathname, '/calendar/v3/calendars/primary/events/series');
  assert.equal(patch.url.searchParams.get('sendUpdates'), 'all');
  assert.deepEqual(patch.body?.start, {
    dateTime: '2026-11-06T11:30:00',
    timeZone: 'America/Los_Angeles'
  });
  assert.deepEqual(patch.body?.end, {
    dateTime: '2026-11-06T12:00:00',
    timeZone: 'America/Los_Angeles'
  });
  // A Zoom call comes from an add-on: Oddboro never takes it off.
  const zoom = await client.callTool({
    name: 'update_event',
    arguments: { event_id: 'series', google_meet: false },
    ...yes
  });
  assert.match(JSON.stringify(zoom.content), /Zoom Meeting, which Oddboro cannot change/);
});

test('"this and following" ends the series the day before and starts a new one with the change', async (t) => {
  const sent = store(t, { series: weekly, [third.id]: third });
  const refused = await client.callTool({
    name: 'update_event',
    arguments: { event_id: third.id, scope: 'following', summary: 'Planning v2' }
  });
  assert.equal(refused.isError, true);
  assert.equal(writesOf(sent).length, 0);
  const r = await client.callTool({
    name: 'update_event',
    arguments: {
      event_id: third.id,
      scope: 'following',
      summary: 'Planning v2',
      removed_attendee_emails: ['bo@example.com']
    },
    ...yes
  });
  assert.notEqual(r.isError, true, JSON.stringify(r.content));
  assert.match(
    JSON.stringify(r.content),
    /emailed the change to ada@example\.com, bo@example\.com/
  );
  const [ended, started] = writesOf(sent);
  assert.equal(ended.method, 'PATCH');
  assert.equal(ended.url.pathname, '/calendar/v3/calendars/primary/events/series');
  assert.equal(ended.url.searchParams.get('sendUpdates'), 'all');
  assert.deepEqual(ended.body, {
    recurrence: [
      'RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261120T075959Z',
      'EXDATE;TZID=America/Los_Angeles:20261127T100000'
    ]
  });
  assert.equal(started.method, 'POST');
  assert.equal(started.url.searchParams.get('conferenceDataVersion'), '1');
  const b = started.body!;
  assert.equal(b.summary, 'Planning v2');
  // Three of ten came before, so seven are left, and the skipped date still is.
  assert.deepEqual(b.recurrence, [
    'RRULE:FREQ=WEEKLY;COUNT=7;BYDAY=FR',
    'EXDATE;TZID=America/Los_Angeles:20261127T100000'
  ]);
  assert.deepEqual(b.start, {
    dateTime: '2026-11-20T10:00:00-08:00',
    timeZone: 'America/Los_Angeles'
  });
  assert.deepEqual(b.attendees, [{ email: OWN_ADDRESS }, { email: 'ada@example.com' }]);
  // The same Zoom link, carried over, never a new one.
  assert.equal((b.conferenceData as { conferenceId: string }).conferenceId, 'zoom-1');
});

test('a new series that fails gives the old one its rule back', async (t) => {
  const sent: { method: string; body?: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    sent.push({ method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const id = /\/events\/([^/?]+)/.exec(new URL(url).pathname)?.[1];
    if (method === 'GET' && !url.includes('/instances'))
      return Response.json(
        id === 'series' ? { ...weekly, attendees: [] } : { ...third, attendees: [] }
      );
    if (method === 'POST') return Response.json({ error: { message: 'Nope' } }, { status: 400 });
    return Response.json({ items: [], id });
  });
  const r = await client.callTool({
    name: 'update_event',
    arguments: { event_id: third.id, scope: 'following', location: 'Cafe' }
  });
  assert.equal(r.isError, true);
  const patches = sent.filter((s) => s.method === 'PATCH');
  assert.equal(patches.length, 2);
  assert.deepEqual(patches[1].body, { recurrence: weekly.recurrence });
});

test('a move to another calendar goes through events.move', async (t) => {
  const sent = store(t, { solo: { id: 'solo', summary: 'Gym', attendees: [] } });
  const r = await client.callTool({
    name: 'update_event',
    arguments: { event_id: 'solo', move_to_calendar_id: 'home@group.calendar.google.com' }
  });
  assert.notEqual(r.isError, true, JSON.stringify(r.content));
  const [move] = writesOf(sent);
  assert.equal(move.method, 'POST');
  assert.equal(move.url.pathname, '/calendar/v3/calendars/primary/events/solo/move');
  assert.equal(move.url.searchParams.get('destination'), 'home@group.calendar.google.com');
  assert.equal(move.url.searchParams.get('sendUpdates'), 'none');
});
