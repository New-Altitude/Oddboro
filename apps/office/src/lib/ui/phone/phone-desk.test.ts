// The phone Desk's cards: each ask kind's buttons, that nothing that may send
// goes in one tap, and the order. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASK_KINDS, type AskRow, type Desk, type ReportRow, type TaskRow } from '@oddboro/ledger';
import {
  askButtons,
  cardButtons,
  chipCounts,
  deskCards,
  sendsOut,
  taskProgress,
  waitingOnYou
} from './phone-desk.ts';

const ask = (a: Partial<AskRow>): AskRow =>
  ({
    id: 1,
    staffId: 'ziva',
    kind: 'approval',
    title: 'Send the weekly brief',
    why: 'It is Friday.',
    ifApproved: 'I send it.',
    createdAt: new Date('2026-11-13T10:00:00Z'),
    ...a
  }) as AskRow;
const task = (t: Partial<TaskRow>): TaskRow =>
  ({
    id: 1,
    staffId: 'jamal',
    title: 'Connect Linear',
    why: 'To see the board.',
    steps: [],
    createdAt: new Date('2026-11-13T09:00:00Z'),
    ...t
  }) as TaskRow;
const report = (r: Partial<ReportRow>): ReportRow =>
  ({
    id: 1,
    staffId: 'cindy',
    title: 'Inbox this week',
    body: '12 replies drafted.',
    createdAt: new Date('2026-11-13T08:00:00Z'),
    readAt: null,
    ...r
  }) as ReportRow;
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
const labels = (a: AskRow) => askButtons(a).map((b) => b.label);

test('each ask kind gets the buttons the plan gives it', () => {
  assert.deepEqual(labels(ask({ kind: 'approval' })), ['Deny', 'Open', 'Approve']);
  assert.deepEqual(labels(ask({ kind: 'switch' })), ['Deny', 'Open', 'Turn on']);
  assert.deepEqual(labels(ask({ kind: 'window' })), ['Pause it', 'Let it carry on']);
  for (const kind of [
    'access',
    'hire',
    'goal',
    'plan',
    'hand_offs',
    'reply',
    'filter',
    'folder',
    'remove',
    'bring_back'
  ] as const)
    assert.deepEqual(labels(ask({ kind })), ['Open'], kind);
});

test('every ask kind in the ledger has a card', () => {
  for (const kind of ASK_KINDS) assert.ok(askButtons(ask({ kind })).length, kind);
});

test('a held call the office put in words is one tap, any other is Open only', () => {
  const archive = ask({
    kind: 'call',
    call: { connector: 'gmail', tool: 'update_labels', arguments: {}, said: 'Archive: 26 emails' }
  });
  const unknown = ask({
    kind: 'call',
    call: { connector: 'linear', tool: 'create_issue', arguments: {} }
  });
  assert.equal(sendsOut(archive), false);
  assert.deepEqual(labels(archive), ['Deny', 'Open', 'Make this call']);
  assert.equal(sendsOut(unknown), true);
  assert.deepEqual(labels(unknown), ['Open']);
  assert.equal(sendsOut(ask({ kind: 'call' })), true);
});

test('a one-tap button posts what the drawer posts', () => {
  const a = ask({ id: 7 });
  const [no, , yes] = askButtons(a);
  assert.ok('post' in no && 'post' in yes);
  assert.deepEqual(no.post, {
    url: '/api/asks/7',
    body: { decision: 'deny', reason: '', report: false }
  });
  assert.deepEqual(yes.post, {
    url: '/api/asks/7',
    body: { decision: 'approve', reason: '', report: false }
  });
  const call = askButtons(
    ask({ id: 8, kind: 'call', call: { connector: 'gmail', tool: 't', arguments: {}, said: 'x' } })
  )[2];
  assert.ok('post' in call);
  assert.deepEqual(call.post, { url: '/api/asks/8/call', body: {} });
  const read = cardButtons({ kind: 'report', key: 'report-3', row: report({ id: 3 }) });
  assert.deepEqual(
    read.map((b) => b.label),
    ['Reply', 'Read']
  );
  assert.deepEqual('post' in read[1] && read[1].post, { url: '/api/reports/3', body: {} });
});

test('the desk lists newest first, and Waiting on you holds the asks alone', () => {
  const d = desk({
    asks: [ask({ id: 1 }), ask({ id: 2, createdAt: new Date('2026-11-13T11:00:00Z') })],
    tasks: [task({ createdAt: new Date('2026-11-13T12:00:00Z') })],
    reports: [report({})]
  });
  assert.deepEqual(
    deskCards(d).map((c) => c.key),
    ['task-1', 'ask-2', 'ask-1', 'report-1']
  );
  assert.deepEqual(
    waitingOnYou(d).map((c) => c.key),
    ['ask-2', 'ask-1']
  );
  assert.deepEqual(chipCounts(d), { all: 4, asks: 2, tasks: 1, reports: 1 });
  assert.deepEqual(
    deskCards(d, 'reports').map((c) => c.key),
    ['report-1']
  );
});

test("a task's card counts its steps and says when a sign-in waits at the office", () => {
  const t = task({
    steps: [
      { text: 'Make a key', done: true },
      { text: 'Sign in', done: false, action: { kind: 'oauth', connector: 'linear' } },
      { text: 'Check', done: false }
    ] as TaskRow['steps']
  });
  assert.deepEqual(taskProgress(t), { line: '1 of 3 steps done', done: 1 / 3, signIn: true });
  assert.equal(
    taskProgress(task({ steps: [{ text: 'a', done: false }] })).line,
    '0 of 1 step done'
  );
});
