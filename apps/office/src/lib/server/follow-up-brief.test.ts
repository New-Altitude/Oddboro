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

test("a finished task's run hears only the owner's choice answers", () => {
  const steps = [
    {
      text: 'Paste the key',
      done: true,
      answer: 'not-for-the-odd',
      action: { kind: 'secret', connector: 'c', name: 'n' }
    },
    {
      text: 'Pick a blue',
      done: true,
      answer: 'Navy',
      action: { kind: 'choice', options: ['Navy', 'Teal'] }
    }
  ] as TaskRow['steps'];
  const lines = briefOf('task_done', { t: { row: { ...task.row, steps }, files: [] } });
  assert.ok(lines.includes('- They answered "Pick a blue" with: Navy'), lines.join('\n'));
  assert.ok(!lines.join('\n').includes('not-for-the-odd'), lines.join('\n'));
});

test("a task given in a chat brings the owner's words there to the run that picks it up, beside their note, and a task given elsewhere is briefed as before", () => {
  const said = 'Give me a task asking for my favourite colour.\nThen write my answer to colour.md.';
  const plain = briefOf('task_done');
  const lines = briefOf('task_done', { t: { row: { ...task.row, ownerSaid: said }, files: [] } });
  const quoted =
    '- What {owner} said in chat when you gave it: "Give me a task asking for my favourite colour. Then write my answer to colour.md."';
  assert.ok(lines.includes(quoted), lines.join('\n'));
  assert.ok(
    lines.indexOf(quoted) < lines.indexOf('- Their note: Their words'),
    'it sits with what the owner gave, before their note'
  );
  assert.ok(
    lines.some((l) => l.startsWith('2. Do what they asked for in chat, or the next step')),
    lines.join('\n')
  );
  assert.ok(!plain.join('\n').includes('in chat'), plain.join('\n'));
  assert.equal(lines.length, plain.length + 1, 'the quoted line is the only line added');
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

test("a finished task's brief names each work that picked up on its own, and is the same as before when none did", () => {
  const alone = followUpBrief({ ...followUp('task_done'), pickedUp: null }, ask, report, task);
  const told = followUpBrief(
    { ...followUp('task_done'), pickedUp: ['Print\nrun', 'Frame it'] },
    ask,
    report,
    task
  );
  const lines = [
    '- "Print run" was waiting on this too and has picked up on its own; leave that work to it.',
    '- "Frame it" was waiting on this too and has picked up on its own; leave that work to it.'
  ];
  assert.deepEqual(
    told.filter((l) => !lines.includes(l)),
    alone,
    'the lines are the only change'
  );
  const note = told.indexOf('- Their note: Their words');
  assert.deepEqual(
    lines.map((l) => told.indexOf(l)),
    [note + 1, note + 2],
    'each line sits with what the owner gave, before the steps'
  );
  assert.ok(!alone.some((l) => l.includes('picked up on its own')));
});

test("a carry-out started by a connect task's end names each work that picked up on its own, after the ask, and is the same as before when none did", () => {
  const asked: AskRow[] = [
    { ...ask, kind: 'access', access: { connector: 'gmail', level: 'read' } } as AskRow,
    {
      ...ask,
      kind: 'folder',
      folder: { path: '/tmp/taxes', level: 'read', given: { path: '/tmp/taxes', level: 'read' } }
    } as AskRow,
    { ...ask, kind: 'switch', switches: ['web'] } as AskRow,
    ask
  ];
  const line =
    '- "Inbox sort" was waiting on this too and has picked up on its own; leave that work to it.';
  for (const a of asked) {
    const alone = followUpBrief({ ...followUp('carry_out'), pickedUp: null }, a);
    const told = followUpBrief({ ...followUp('carry_out'), pickedUp: ['Inbox\nsort'] }, a);
    assert.deepEqual(
      told.filter((l) => l !== line),
      alone,
      `${a.kind}: the line is the only change`
    );
    const at = told.indexOf(line);
    assert.ok(
      at > told.indexOf(`- What you said would happen: ${a.ifApproved}`) &&
        at < told.findIndex((l) => l.startsWith('1. ')),
      `${a.kind}: the line sits with the ask, before the steps`
    );
  }
});

// Each kind keeps its words in the diff, including the fallback kinds. The run
// tests separately check that the office passes these words to its AI tool.
for (const kind of FOLLOW_UP_KINDS) {
  test(`${kind} keeps the words its run receives`, (t) => {
    t.assert.snapshot(briefOf(kind));
  });
}
