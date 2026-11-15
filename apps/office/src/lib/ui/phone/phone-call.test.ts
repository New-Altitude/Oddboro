// The phone's call: its timer, the "also" line, what waits on the owner, the
// captions it opens with, and reading a streamed reply. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AskRow, Desk, ReportRow, TaskRow } from '@oddboro/ledger';
import type { ChatEntry, ChatEvent } from '#lib/staff/chat.ts';
import type { Work } from '#lib/staff/work.ts';
import {
  alsoLine,
  CAPTIONS_KEPT,
  captionsFrom,
  clock,
  readChatStream,
  waitingFor
} from './phone-call.ts';

const now = new Date('2026-11-13T19:41:00Z');
const work = (w: Partial<Work>): Work => ({
  id: 1,
  kind: 'job',
  label: 'Planning the Q1 goal',
  detail: '',
  since: '2026-11-13T19:37:00Z',
  queued: false,
  steps: 0,
  ...w
});

test('the timer reads minutes and seconds, and hours past an hour', () => {
  assert.equal(clock(0), '00:00');
  assert.equal(clock(134_000), '02:14');
  assert.equal(clock(3_722_000), '1:02:02');
  assert.equal(clock(-5), '00:00');
});

test('the also line names running work and its minutes', () => {
  assert.equal(alsoLine([work({})], now), 'also planning the Q1 goal, 4 min');
  assert.equal(
    alsoLine([work({}), work({ id: 2, label: 'Inbox' })], now),
    'also planning the Q1 goal and 1 more, 4 min'
  );
});

test('work waiting for a slot or to start is not running', () => {
  assert.equal(alsoLine(undefined, now), '');
  assert.equal(alsoLine([work({ queued: true }), work({ id: 2, toStart: true })], now), '');
});

const desk = (d: Partial<Desk>): Desk => ({
  projectWork: [],
  recent: [],
  away: [],
  asks: [],
  tasks: [],
  reports: [],
  attachments: [],
  folders: {},
  ...d
});

test("what waits on the owner is that Odd's asks, newest first, as on Home", () => {
  const d = desk({
    asks: [
      { id: 1, staffId: 'cindy', title: 'Old', createdAt: new Date('2026-11-13T08:00:00Z') },
      { id: 2, staffId: 'cindy', title: 'New', createdAt: new Date('2026-11-13T10:00:00Z') },
      { id: 3, staffId: 'ziva', title: 'Hers', createdAt: new Date('2026-11-13T11:00:00Z') }
    ] as AskRow[],
    tasks: [
      {
        id: 4,
        staffId: 'cindy',
        title: 'Task',
        steps: [],
        createdAt: new Date('2026-11-13T09:00:00Z')
      }
    ] as unknown as TaskRow[],
    reports: [
      { id: 5, staffId: 'cindy', title: 'Report', createdAt: new Date('2026-11-13T12:00:00Z') }
    ] as ReportRow[]
  });
  assert.deepEqual(
    waitingFor(d, 'cindy').map((c) => c.key),
    ['ask-2', 'ask-1']
  );
});

test('a call opens on the last spoken lines of the chat', () => {
  const at = '2026-11-13T19:41:00Z';
  const lines: ChatEntry[] = [
    ...Array.from({ length: 8 }, (_, i) => ({
      at,
      from: i % 2 ? ('staff' as const) : ('owner' as const),
      text: `line ${i}`
    })),
    { at, from: 'staff', text: '', item: { kind: 'ask', id: 1, title: 'x', status: 'open' } }
  ];
  const got = captionsFrom(lines);
  assert.equal(got.length, CAPTIONS_KEPT);
  assert.deepEqual(got.at(-1), { from: 'staff', text: 'line 7' });
});

test('a streamed reply is read event by event, across chunk breaks', async () => {
  const events: ChatEvent[] = [
    { type: 'delta', text: 'On your desk' },
    { type: 'tool', name: 'Read' },
    { type: 'done', text: 'On your desk now.' }
  ];
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(c) {
      c.enqueue(bytes.slice(0, 7));
      c.enqueue(bytes.slice(7, 40));
      c.enqueue(bytes.slice(40));
      c.close();
    }
  });
  const got: ChatEvent[] = [];
  await readChatStream(body, (e) => got.push(e));
  assert.deepEqual(got, events);
});
