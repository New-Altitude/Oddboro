// The phone's Goals tab and a goal's page: the lead, progress, what waits on
// the owner, and a goal's work as one conversation. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GoalThread, GoalWithThreads, HandOffLine, ThreadLine } from '@oddboro/ledger';
import { ownerWords } from '../../../../../packages/ledger/test/owner-words.ts';
import { goalCards, goalConversation, leadOf, progressOf } from './phone-goals.ts';

const here = new Set(['manny', 'cindy', 'jamal', 'ziva']);
const thread = (t: Partial<GoalThread>): GoalThread => ({
  id: 10,
  title: 'Launch the Q1 plan',
  goalId: 1,
  hubId: 'cindy',
  holderId: 'cindy',
  stage: 'under_way',
  held: false,
  waiting: [],
  ...t
});
const goal = (g: Partial<GoalWithThreads>): GoalWithThreads =>
  ({
    id: 1,
    title: 'Launch the Q1 plan',
    why: 'Sign-ups doubled after each newsletter.',
    doneWhen: 'The launch email is out.',
    horizon: 'date',
    due: '2027-01-15',
    area: 'work',
    status: 'active',
    createdAt: new Date('2026-11-01T12:00:00Z'),
    updatedAt: new Date('2026-11-01T12:00:00Z'),
    staff: [],
    progress: [],
    threads: [],
    ...g
  }) as GoalWithThreads;

test("a goal's lead is the hub of its newest open thread", () => {
  const threads = [
    thread({ id: 12, hubId: 'ziva', stage: 'done' }),
    thread({ id: 11, hubId: 'cindy', stage: 'waiting_on_you' }),
    thread({ id: 10, hubId: 'jamal', stage: 'under_way' })
  ];
  assert.equal(leadOf(threads, 'manny', here), 'cindy');
});

test('with no open thread, or none at all, the Office Manager leads', () => {
  assert.equal(
    leadOf([thread({ stage: 'done' }), thread({ stage: 'failed' })], 'manny', here),
    'manny'
  );
  assert.equal(leadOf([], 'manny', here), 'manny');
  assert.equal(leadOf([], undefined, here), undefined);
});

test('an Odd who left the office leads nothing', () => {
  assert.equal(leadOf([thread({ hubId: 'gone' })], 'manny', here), 'manny');
});

test('progress is threads done out of all, with the newest health', () => {
  const p = progressOf(
    [thread({ stage: 'done' }), thread({ stage: 'done' }), thread({ stage: 'under_way' })],
    [
      { health: 'slipping', note: 'Waiting on the list.' },
      { health: 'on_track', note: 'Older.' }
    ]
  );
  assert.deepEqual(p, { done: 2, total: 3, health: 'slipping', note: 'Waiting on the list.' });
  assert.deepEqual(progressOf([], []), { done: 0, total: 0 });
});

test('the tab lists active goals only, newest first, with the lead first among the faces', () => {
  const cards = goalCards(
    [
      goal({ id: 1, createdAt: new Date('2026-11-01T12:00:00Z') }),
      goal({
        id: 2,
        title: 'Inbox at zero',
        horizon: 'ongoing',
        due: null,
        area: 'home',
        createdAt: new Date('2026-11-05T12:00:00Z'),
        staff: [
          { staffId: 'jamal', name: 'Jamal', part: 'Sorts' },
          { staffId: 'ziva', name: 'Ziva', part: 'Leads' },
          { staffId: 'gone', name: 'Gone', part: 'Left' }
        ],
        threads: [
          thread({
            id: 20,
            hubId: 'ziva',
            waiting: [
              { kind: 'ask', id: 1, title: 'Send it' },
              { kind: 'task', id: 2, title: 'Sign in' }
            ]
          })
        ]
      }),
      goal({ id: 3, status: 'paused' }),
      goal({ id: 4, status: 'met' })
    ],
    'manny',
    here
  );
  assert.deepEqual(
    cards.map((c) => c.id),
    [2, 1]
  );
  assert.equal(cards[0].when, 'Ongoing');
  assert.equal(cards[1].when, 'By Jan 15');
  assert.deepEqual(cards[0].faces, ['ziva', 'jamal']);
  assert.equal(cards[0].waiting, 2);
  assert.equal(cards[1].leadId, 'manny');
});

const line = (h: Partial<HandOffLine>): HandOffLine =>
  ({
    id: 1,
    threadId: 10,
    at: new Date('2026-11-13T18:58:00Z'),
    title: 'Sign-ups by week, Q4',
    brief: "Pull last quarter's sign-ups by week. I need it for the plan.",
    from: 'Cindy',
    to: 'Jamal',
    fromId: 'cindy',
    toId: 'jamal',
    gave: true,
    status: 'done',
    answered: false,
    backs: [],
    ...h
  }) as HandOffLine;

test("a goal's work reads as one conversation, oldest first, each hand-off once", () => {
  const handOff = line({
    backs: [
      {
        at: new Date('2026-11-13T19:20:00Z'),
        outcome: 'done',
        text: 'Done. Weeks 6 and 9 spiked, both after the newsletter.',
        answered: false,
        pickUp: {
          status: 'done',
          at: new Date('2026-11-13T19:31:00Z'),
          text: 'Good catch. Ziva will draft a launch email we can send the same way.'
        }
      },
      {
        at: new Date('2026-11-13T19:25:00Z'),
        outcome: 'done',
        text: 'Approved',
        answered: true,
        pickUp: { status: 'queued' }
      }
    ]
  });
  const runs: ThreadLine[] = [
    {
      id: 10,
      at: new Date('2026-11-13T18:00:00Z'),
      title: 'Launch the Q1 plan',
      hub: 'Cindy',
      holder: 'Cindy',
      stage: 'under_way',
      held: false,
      waiting: [],
      runs: [
        { at: new Date('2026-11-13T18:30:00Z'), outcome: 'done', text: 'Planned the launch.' },
        { at: new Date('2026-11-13T18:40:00Z') }
      ]
    },
    { ...({} as ThreadLine), id: 99, runs: [{ at: new Date(), text: 'Other work.' }] }
  ];
  const got = goalConversation(
    new Set([10]),
    new Map([[10, { id: 'cindy', name: 'Cindy' }]]),
    // The same hand-off read from the giver's lines and the colleague's.
    [handOff, handOff, line({ id: 2, threadId: 77 })],
    runs
  );
  assert.deepEqual(
    got.map((e) => [e.kind, e.name, e.work?.to]),
    [
      ['run', 'Cindy', undefined],
      ['handed', 'Cindy', 'Jamal'],
      ['back', 'Jamal', 'Cindy'],
      ['next', 'Cindy', undefined]
    ]
  );
  for (const e of got) {
    assert.ok(!e.text.includes('@'), e.text);
    ownerWords(e.text);
  }
});
