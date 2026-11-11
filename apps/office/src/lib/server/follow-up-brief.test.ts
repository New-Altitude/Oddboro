// What a follow-up run is told, kind by kind. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FOLLOW_UP_KINDS,
  type AskRow,
  type FollowUpKind,
  type FollowUpRow,
  type GoalRow,
  type ReportRow,
  type TaskRow
} from '@oddboro/ledger';
import { followUpBrief } from './follow-up-brief.ts';

// Only the fields a brief reads are filled in; the rest of each row stays out.
const followUp = (kind: FollowUpKind) => ({ kind, note: 'Their words' }) as FollowUpRow;
const ask = {
  id: 7,
  kind: 'approval',
  status: 'approved',
  title: 'Send it',
  why: 'Because',
  ifApproved: 'It goes'
} as AskRow;
const report = { id: 3, title: 'Weekly', body: 'All well' } as ReportRow;
const task = {
  row: { id: 4, title: 'Sign in', why: 'Needed', steps: [] } as unknown as TaskRow,
  files: []
};
const goal = {
  id: 2,
  title: 'More clients',
  area: 'work',
  horizon: 'ongoing',
  why: null,
  doneWhen: null
} as unknown as GoalRow;

const FEEDBACK = /^\{owner\} read your report "Weekly" and gave feedback\./;
const briefOf = (
  kind: FollowUpKind,
  rows: { t?: typeof task; g?: GoalRow } = { t: task, g: goal }
) => followUpBrief(followUp(kind), ask, report, rows.t, rows.g);

test('a call the office made tells the Odd not to make it again, with what came back', () => {
  const lines = followUpBrief(followUp('carry_out'), {
    ...ask,
    kind: 'call',
    call: {
      connector: 'notes',
      tool: 'capture',
      arguments: { text: 'a thought' },
      result: { ok: true, text: 'captured', at: '2026-11-09T00:00:00.000Z' }
    }
  });
  assert.match(lines[0], /the office made it for you\. Do not make it again\./);
  assert.ok(lines.includes('- What it returned: captured'));
});

test('a switch the owner turned on tells the Odd its run has it, names what it asked for, and does the work once for a twin ask', () => {
  const asked = { ...ask, kind: 'switch', switches: ['web'] } as AskRow;
  const twin = { ...ask, id: 8 } as AskRow;
  const lines = followUpBrief(followUp('carry_out'), asked, undefined, undefined, undefined, [
    twin
  ]);
  assert.equal(
    lines[0],
    '{owner} approved your ask #7 and turned on Browse the web for you. This run has it.'
  );
  assert.match(lines[1], /^This also answers your ask #8, /);
  assert.ok(lines.includes('- What you asked to turn on: Browse the web'));
});

test('every follow-up kind gets its own brief, and feedback gets the feedback brief, as do a hand-off with no hand-off row, a goal with no goal and a task_done with no task', () => {
  // A hand-off, a hand-back and an edit are briefed before this when their row is there.
  const feedbackKinds: FollowUpKind[] = ['feedback', 'hand_off', 'handed_back', 'edited'];
  const firstLines = new Set<string>();
  for (const kind of FOLLOW_UP_KINDS) {
    const first = briefOf(kind)[0];
    if (feedbackKinds.includes(kind)) {
      assert.match(first, FEEDBACK, kind);
      continue;
    }
    assert.doesNotMatch(first, FEEDBACK, kind);
    assert.ok(!firstLines.has(first), `${kind} shares its brief with another kind`);
    firstLines.add(first);
  }
  assert.match(briefOf('goal', { t: task })[0], FEEDBACK);
  assert.match(briefOf('task_done', { g: goal })[0], FEEDBACK);
});
