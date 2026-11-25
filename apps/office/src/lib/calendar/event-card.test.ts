import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HeldEvent } from '@oddboro/ledger';
import { attachmentOf, consequence, startOf, timesOf, versionOf, type Held } from './event-card.ts';

const calendars = [
  {
    id: 'owner@example.com',
    name: 'Owner',
    primary: true,
    timeZone: 'America/New_York',
    reminders: [{ method: 'popup', minutes: 10 }],
    meet: true
  },
  { id: 'team@group.calendar.google.com', name: 'Team', meet: true }
];
const created: Held = {
  tool: 'create_event',
  arguments: {
    summary: 'Q1 planning',
    start_time: '2026-11-20T10:00:00',
    end_time: '2026-11-20T11:30:00',
    time_zone: 'America/New_York',
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR'],
    attendees: [
      'ada@example.com',
      { email: 'cy@example.com', optional: true },
      'owner@example.com'
    ],
    google_meet: true,
    description: 'Agenda\n\nAdded by Oddboro: https://oddboro.com'
  },
  event: { account: 'owner@example.com', others: [], calendars }
};

test("a new event's form is the Odd's call, and sends it back as it was", () => {
  const f = startOf(created);
  assert.equal(f.startDate, '2026-11-20');
  assert.equal(f.startTime, '10:00');
  assert.equal(f.endTime, '11:30');
  // The owner is the organiser, never a guest chip.
  assert.deepEqual(
    f.guests.map((g) => [g.email, g.optional]),
    [
      ['ada@example.com', false],
      ['cy@example.com', true]
    ]
  );
  assert.equal(f.remindersDefault, true);
  assert.deepEqual(f.reminders, [{ method: 'popup', minutes: 10 }]);
  const v = versionOf(created, f, startOf(created));
  assert.deepEqual(v.attendees, ['ada@example.com', { email: 'cy@example.com', optional: true }]);
  assert.equal(v.start_time, '2026-11-20T10:00:00');
  assert.equal(v.time_zone, 'America/New_York');
  assert.deepEqual(v.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=FR']);
  assert.equal(v.google_meet, true);
  assert.equal(v.calendar_id, 'primary');
  assert.deepEqual(consequence(created, v, f).lines, [
    'Google will email an invite to ada@example.com and cy@example.com.'
  ]);
});

test('unticking All day brings back the times it had', () => {
  const f = startOf(created);
  f.allDay = true;
  assert.deepEqual(timesOf(f), {
    start_time: '2026-11-20',
    end_time: '2026-11-21',
    all_day: true
  });
  f.allDay = false;
  assert.equal((timesOf(f) as { start_time: string }).start_time, '2026-11-20T10:00:00');
  assert.equal((timesOf(f) as { end_time: string }).end_time, '2026-11-20T11:30:00');
  f.endTime = '09:00';
  assert.deepEqual(timesOf(f), { problem: 'The end is not after the start.' });
  // A flight: the end in its own zone.
  f.endTime = '13:00';
  f.endZone = 'America/Los_Angeles';
  assert.equal((timesOf(f) as { end_time_zone: string }).end_time_zone, 'America/Los_Angeles');
});

const event: HeldEvent = {
  account: 'owner@example.com',
  others: ['ada@example.com', 'bo@example.com'],
  calendars,
  before: {
    id: 'series_20261120T150000Z',
    recurringEventId: 'series',
    summary: 'Planning',
    start: { dateTime: '2026-11-20T10:00:00-05:00', timeZone: 'America/New_York' },
    end: { dateTime: '2026-11-20T11:00:00-05:00', timeZone: 'America/New_York' },
    attendees: [
      { email: 'owner@example.com', self: true, organizer: true },
      { email: 'ada@example.com', displayName: 'Ada', responseStatus: 'accepted' },
      { email: 'bo@example.com', displayName: 'Bo', optional: true }
    ],
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 1440 }] },
    conference: { meet: false, name: 'Zoom Meeting', uri: 'https://zoom.example.com/j/1' }
  },
  series: {
    id: 'series',
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR'],
    start: { dateTime: '2026-11-06T10:00:00-05:00', timeZone: 'America/New_York' }
  }
};
const changed: Held = {
  tool: 'update_event',
  arguments: {
    event_id: 'series_20261120T150000Z',
    scope: 'following',
    location: 'Cafe',
    removed_attendee_emails: ['bo@example.com']
  },
  event
};

test('a change starts from the event as Google had it, with the guest it takes off set aside', () => {
  const f = startOf(changed);
  assert.equal(f.summary, 'Planning');
  assert.equal(f.location, 'Cafe');
  assert.equal(f.scope, 'following');
  assert.deepEqual(f.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=FR']);
  assert.deepEqual(f.reminders, [{ method: 'email', minutes: 1440 }]);
  assert.equal(f.remindersDefault, false);
  assert.equal(f.meet, false);
  assert.deepEqual(
    f.guests.map((g) => g.email),
    ['ada@example.com']
  );
  assert.deepEqual(
    f.removed.map((g) => g.email),
    ['bo@example.com']
  );
  // Only what the Odd set or the owner changed goes back.
  const first = startOf(changed);
  assert.deepEqual(versionOf(changed, f, first), {
    location: 'Cafe',
    scope: 'following',
    removed_attendee_emails: ['bo@example.com']
  });
  assert.deepEqual(consequence(changed, versionOf(changed, f, first), f).lines, [
    'Changes this and every following event.',
    'Google will email the change to Ada.',
    'Removing Bo: Google emails a cancellation.'
  ]);
  // Put back, made required, one more added, and moved an hour.
  f.guests.push({ ...f.removed[0], optional: false });
  f.removed = [];
  f.guests.push({ email: 'di@example.com', optional: true, existing: false });
  f.startTime = '11:00';
  f.endTime = '12:00';
  const v = versionOf(changed, f, first);
  assert.deepEqual(v.removed_attendee_emails, []);
  assert.deepEqual(v.marked_required, ['bo@example.com']);
  assert.deepEqual(v.added_attendees, [{ email: 'di@example.com', optional: true }]);
  assert.equal(v.start_time, '2026-11-20T11:00:00');
});

test('reminders or the colour alone email nobody', () => {
  const mine: Held = {
    ...changed,
    arguments: { event_id: changed.arguments.event_id, scope: 'this', color_id: '7' }
  };
  const f = startOf(mine);
  f.remindersDefault = true;
  const v = versionOf(mine, f, startOf(mine));
  assert.deepEqual(v, { color_id: '7', reminders: { use_default: true }, scope: 'this' });
  const c = consequence(mine, v, f);
  assert.equal(c.emails, false);
  assert.deepEqual(c.lines, [
    'Changes only this event in the series.',
    'Nobody else gets an email: only you see reminders and the colour.'
  ]);
});

test('a pasted Drive link is a file, and any other link is not', () => {
  assert.deepEqual(
    attachmentOf('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit'),
    {
      fileUrl: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit'
    }
  );
  assert.equal(attachmentOf('https://example.com/file.pdf'), undefined);
});
