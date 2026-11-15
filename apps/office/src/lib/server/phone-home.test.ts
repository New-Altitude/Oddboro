// The phone's Home data: each Odd's next job, and the goals with work handed
// on or back today. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HandOffLine } from '@oddboro/ledger';
import { setZone } from '@oddboro/ledger/time';
import { ownerWords } from '../../../../../packages/ledger/test/owner-words.ts';
import { happeningToday, soonest } from './phone-home.ts';

setZone('America/New_York');
const now = new Date('2026-11-13T19:41:00Z');
const goals = [
  { id: 1, title: 'Launch the Q1 plan', threads: [{ id: 10 }] },
  { id: 2, title: 'Tidy the inbox', threads: [{ id: 20 }] }
];
const line = (h: Partial<HandOffLine>): HandOffLine =>
  ({
    id: 1,
    threadId: 10,
    at: new Date('2026-11-13T15:00:00Z'),
    title: 'Draft the launch email',
    brief: '',
    from: 'Cindy',
    to: 'Ziva',
    fromId: 'cindy',
    toId: 'ziva',
    gave: true,
    status: 'done',
    answered: false,
    backs: [],
    ...h
  }) as HandOffLine;

test('a goal shows its latest step today, with the Odds who took part today', () => {
  const got = happeningToday(
    goals,
    [
      line({
        backs: [
          {
            at: new Date('2026-11-13T18:00:00Z'),
            outcome: 'done',
            text: '',
            answered: false,
            pickUp: { status: 'done' }
          }
        ] as HandOffLine['backs']
      }),
      line({ id: 2, from: 'Jamal', fromId: 'jamal', at: new Date('2026-11-13T16:00:00Z') })
    ],
    now
  );
  assert.deepEqual(got, [
    {
      goalId: 1,
      title: 'Launch the Q1 plan',
      line: 'Ziva handed back to Cindy: Draft the launch email',
      at: '2026-11-13T18:00:00.000Z',
      faces: ['ziva', 'cindy', 'jamal']
    }
  ]);
  ownerWords(got[0].line);
});

test('yesterday, the same line from both sides, and work for no goal stay out', () => {
  const yesterday = line({ at: new Date('2026-11-12T15:00:00Z') });
  assert.deepEqual(happeningToday(goals, [yesterday, yesterday], now), []);
  assert.deepEqual(happeningToday(goals, [line({ threadId: 99 })], now), []);
  assert.deepEqual(happeningToday(goals, [line({ threadId: null })], now), []);
  assert.equal(happeningToday(goals, [line({}), line({})], now).length, 1);
});

test("a hand-back that only carries the owner's answer is no news", () => {
  const got = happeningToday(
    goals,
    [
      line({
        at: new Date('2026-11-12T15:00:00Z'),
        backs: [
          {
            at: new Date('2026-11-13T18:00:00Z'),
            outcome: 'done',
            text: '',
            answered: true,
            pickUp: { status: 'done' }
          }
        ] as HandOffLine['backs']
      })
    ],
    now
  );
  assert.deepEqual(got, []);
});

test("an Odd's next job is its soonest enabled one", () => {
  assert.equal(
    soonest([
      { enabled: true, nextRunAt: new Date('2026-11-14T12:00:00Z') },
      { enabled: false, nextRunAt: new Date('2026-11-13T20:00:00Z') },
      { enabled: true, nextRunAt: new Date('2026-11-13T22:00:00Z') },
      { enabled: true, nextRunAt: null }
    ]),
    '2026-11-13T22:00:00.000Z'
  );
  assert.equal(soonest([]), undefined);
});
