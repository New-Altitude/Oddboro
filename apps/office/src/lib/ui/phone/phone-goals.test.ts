// What the phone's Goals tab and a goal's page say, and a goal's work with
// what waits on the owner woven in. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AskRow, Desk, TaskRow } from '@oddboro/ledger';
import type { GoalEntry } from '#lib/server/phone-goals.ts';
import { cardButtons } from './phone-desk.ts';
import {
  chatEvents,
  goalLines,
  metaLine,
  progressLine,
  underWay,
  waitingBadge,
  workLine
} from './phone-goals.ts';

test('progress says parts done and the latest health, never a percentage', () => {
  assert.equal(
    progressLine({ done: 3, total: 5, health: 'on_track' }),
    '3 of 5 parts done · On track'
  );
  assert.equal(progressLine({ done: 0, total: 1 }), '0 of 1 part done');
  assert.equal(
    progressLine({ done: 0, total: 0, health: 'blocked' }),
    'No work started yet · Blocked'
  );
});

test('the card lines', () => {
  assert.equal(metaLine({ when: 'By Jan 15' }, 'Cindy'), 'By Jan 15 · Cindy leads');
  assert.equal(metaLine({ when: 'Ongoing' }, undefined), 'Ongoing');
  assert.equal(waitingBadge(1), '1 waiting on you');
  assert.equal(underWay(3), '3 under way');
});

const entry = (e: Partial<GoalEntry>): GoalEntry => ({
  key: 'handed-1',
  at: '2026-11-13T18:58:00.000Z',
  by: 'cindy',
  name: 'Cindy',
  kind: 'handed',
  text: 'Pull the sign-ups by week.',
  work: { title: 'Sign-ups by week, Q4', to: 'Jamal' },
  ...e
});

test('a step names who the work went to or came back to, in plain words', () => {
  assert.equal(workLine(entry({})), 'Handed off to Jamal');
  assert.equal(
    workLine(entry({ kind: 'back', work: { title: 'x', to: 'Cindy', outcome: 'done' } })),
    'Back to Cindy'
  );
  assert.equal(
    workLine(entry({ kind: 'back', work: { title: 'x', to: 'Cindy', outcome: 'failed' } })),
    'Could not finish it. Back to Cindy'
  );
  assert.equal(workLine(entry({ kind: 'next', work: undefined })), undefined);
});

const ask = (a: Partial<AskRow>): AskRow =>
  ({
    id: 7,
    staffId: 'ziva',
    kind: 'approval',
    title: 'Send the launch email',
    why: 'To 1,240 subscribers.',
    createdAt: new Date('2026-11-13T19:40:00Z'),
    ...a
  }) as AskRow;
const task = (t: Partial<TaskRow>): TaskRow =>
  ({
    id: 8,
    staffId: 'jamal',
    title: 'Connect Linear',
    why: '',
    steps: [],
    createdAt: new Date('2026-11-13T18:00:00Z'),
    ...t
  }) as TaskRow;

test("what waits on the owner sits in the goal's work by when it landed", () => {
  const desk: Desk = { asks: [ask({})], tasks: [task({})], reports: [] } as unknown as Desk;
  const lines = goalLines(
    [entry({}), entry({ key: 'back-1-0', kind: 'back', at: '2026-11-13T19:20:00.000Z' })],
    [
      { kind: 'ask', id: 7, title: 'Send the launch email' },
      { kind: 'task', id: 8, title: 'Connect Linear' },
      // Already answered: the desk no longer holds it.
      { kind: 'ask', id: 99, title: 'Gone' }
    ],
    desk
  );
  assert.deepEqual(
    lines.map((l) => (l.kind === 'entry' ? l.entry.key : l.card.key)),
    ['task-8', 'handed-1', 'back-1-0', 'ask-7']
  );
});

test('an item that may send gets Open only, as on the Desk tab', () => {
  const desk = {
    asks: [ask({ kind: 'reply' }), ask({ id: 9, kind: 'call', call: null })],
    tasks: [],
    reports: []
  } as unknown as Desk;
  const lines = goalLines(
    [],
    [
      { kind: 'ask', id: 7, title: '' },
      { kind: 'ask', id: 9, title: '' }
    ],
    desk
  );
  for (const l of lines) {
    assert.equal(l.kind, 'desk');
    if (l.kind === 'desk')
      assert.deepEqual(
        cardButtons(l.card).map((b) => b.id),
        ['open']
      );
  }
});

test("the chat route's events are read as they arrive", () => {
  const first = chatEvents('data: {"type":"delta","text":"Hi"}\n\ndata: {"type":"do');
  assert.deepEqual(first.events, [{ type: 'delta', text: 'Hi' }]);
  const rest = chatEvents(`${first.rest}ne","text":"Hi there"}\n\n`);
  assert.deepEqual(rest.events, [{ type: 'done', text: 'Hi there' }]);
  assert.equal(rest.rest, '');
});
