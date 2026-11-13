// Random sequences of run, ask and task events through the work core's
// deciders. After each event the rows the deciders leave are checked against
// the test's own record, which it builds from the events alone with today's
// rules written out in the models beside it (work-model.ts and each
// work-<family>-model.ts), never from what the deciders answered. Pure: rows
// in memory, no database.
// Run with `npm test -w @oddboro/ledger`; set WORK_SEQUENCES_SEEDS for a longer run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StaffRow } from '../src/office.ts';
import type { Decision } from '../src/office-asks.ts';
import { ASK_KINDS, type Outcome } from '../src/schema.ts';
import { explore, type Explore } from '../src/sequences.ts';
import type { TaskEnded } from '../src/task-parking.ts';
import type { Decided } from '../src/transition.ts';
import { decide } from '../src/work/decide.ts';
import type {
  Claimed,
  EventOf,
  LiveKind,
  NewAsk,
  NewTask,
  WorkEvent,
  WorkResults
} from '../src/work/events.ts';
import { OUTCOME_TITLE } from '../src/work/runs.ts';
import { applyChange, type Change, type Prepared, type WorkRows } from '../src/work/snapshot.ts';
import { followUpRow, parseFollowUp, type FollowUp } from '../src/work/state.ts';
import {
  decideAsk,
  DECISIONS,
  dropConnectTasks,
  endTask,
  FOLDER,
  give,
  giveKey,
  GMAIL,
  KINDS,
  PLACES,
  RAISE,
  raise,
  raiseKey
} from './work-answers-model.ts';
import {
  cardOf,
  fresh,
  met,
  parkOf,
  recordOf,
  show,
  titleOf,
  type AskRec,
  type Delivery,
  type Heard,
  type Model,
  type TaskRec
} from './work-model.ts';
import { ask, minutes, odd, recordingEffects, rowsOf, run, T0, task, thread } from './work-rows.ts';
import { claim, finish, OWED, queue } from './work-runs-model.ts';

// How many seeds the test runs; set WORK_SEQUENCES_SEEDS for a longer run.
const SEEDS = Number(process.env.WORK_SEQUENCES_SEEDS ?? 200);
const LENGTH = 30;

const ABOUT = 'the work';
// OUTCOME_TITLE has a title for every outcome, so its keys are every outcome.
const OUTCOMES = Object.keys(OUTCOME_TITLE.resume) as Outcome[];

// The office every sequence starts from. Ada leads at Act, Rico works at
// Draft, Tess at Read. Theo left the office, so the work he led stopped. Jo
// was brought back after her leaving failed her runs.
const ODDS = [
  odd('ada'),
  odd('rico', { level: 'draft' }),
  odd('tess', { level: 'read' }),
  odd('theo', { leftAt: T0 }),
  odd('jo')
];

const given = (from: string, title: string) => ({ from, title, brief: `Please ${title}.` });
const back = (from: string, title: string, outcome: Outcome, more = {}) => ({
  ...given(from, title),
  outcome,
  ...more
});
const running = { is: 'running', startedAt: T0, unparked: null } as const;
const queued = { is: 'queued' } as const;
const connect = (connector: string) => [
  { text: 'Sign in', done: false, action: { kind: 'oauth', connector } as const }
];

function office(): WorkRows {
  return rowsOf({
    staff: ODDS,
    threads: [
      // Ada parked this on her open task 1.
      thread(1, 'ada', { park: { on: 'task', task: 1 } }),
      // Ada picks up Rico's result, which her claim lifted a park on task 2 for.
      thread(2, 'ada'),
      thread(3, 'theo', { status: 'stopped', endedAt: T0 }),
      // Ada's hand-offs to Rico and Tess; Rico raised ask 1 on it, still open.
      thread(4, 'ada', { holderId: 'rico' }),
      // A job of Ada's that works on this thread is running.
      thread(5, 'ada', { runs: ['ada job'] }),
      thread(6, 'tess', { park: { on: 'time', at: minutes(500) } }),
      // The usage window holds Ada's work until the owner answers ask 4.
      thread(7, 'ada', { park: { on: 'window', at: minutes(300), ask: 4 } }),
      // Jo's leaving stopped the work she led.
      thread(8, 'jo', { status: 'stopped', endedAt: T0 }),
      // Ada parked this on her open task 4.
      thread(9, 'ada', { park: { on: 'task', task: 4 } })
    ],
    tasks: [
      task(1, 'ada'),
      task(2, 'ada', { status: 'done', doneAt: T0 }),
      // The office's own, on Jo's stopped work.
      task(3, null, { threadId: 8, steps: connect('gmail') }),
      task(4, 'ada', { steps: connect('gmail') }),
      // Rico gave it on Ada's hand-off.
      task(5, 'rico', { handOffId: 6, threadId: 4 }),
      // The connect task of Rico's approved ask 5.
      task(6, 'rico', { askId: 5, steps: connect('gmail') })
    ],
    asks: [
      ask(1, 'rico', { handOffId: 6, threadId: 4 }),
      ask(2, 'rico', { handOffId: 8, threadId: 4, status: 'approved', decidedAt: T0 }),
      ask(3, 'ada', { status: 'approved', decidedAt: T0 }),
      // The office's window ask, filed under Ada.
      ask(4, 'ada', { kind: 'window' }),
      ask(5, 'rico', {
        kind: 'access',
        access: GMAIL,
        handOffId: 8,
        threadId: 4,
        status: 'approved',
        decidedAt: T0
      }),
      // Rico asks to leave the office, from no work.
      ask(6, 'rico', { kind: 'remove', odd: 'rico' }),
      // Twins: Rico asks for one folder from no work and from Ada's hand-off.
      ask(7, 'rico', { kind: 'folder', folder: FOLDER }),
      ask(8, 'rico', { kind: 'folder', folder: FOLDER, handOffId: 6, threadId: 4 })
    ],
    followUps: [
      run(1, 'ada', 'resume', queued, { threadId: 1 }),
      run(
        2,
        'ada',
        'handed_back',
        { ...running, unparked: { task: 2 } },
        { threadId: 2, handOff: back('rico', 'Sort the invoices', 'done', { id: 3 }) }
      ),
      run(
        3,
        'rico',
        'hand_off',
        { is: 'ended', outcome: 'done', result: 'Sorted', doneAt: T0, startedAt: T0 },
        { threadId: 2, handOff: given('ada', 'Sort the invoices') }
      ),
      run(4, 'ada', 'handed_back', queued, {
        threadId: 2,
        handOff: back('tess', 'Read the contract', 'done')
      }),
      run(5, 'ada', 'handed_back', queued, {
        threadId: 2,
        handOff: back('rico', 'Check the totals', 'done')
      }),
      run(6, 'rico', 'hand_off', running, { threadId: 4, handOff: given('ada', 'Book the venue') }),
      // Raised nothing on its hand-off.
      run(7, 'tess', 'hand_off', queued, { threadId: 4, handOff: given('ada', 'List the guests') }),
      // Raised ask 2, which the owner approved.
      run(8, 'rico', 'hand_off', queued, { threadId: 4, handOff: given('ada', 'Order the food') }),
      run(9, 'rico', 'carry_out', queued, { threadId: 4, askId: 2 }),
      run(10, 'theo', 'handed_back', running, {
        threadId: 3,
        handOff: back('rico', 'Write the brief', 'done')
      }),
      run(
        11,
        'rico',
        'hand_off',
        { is: 'ended', outcome: 'done', result: 'Written', doneAt: T0, startedAt: T0 },
        { threadId: 3, handOff: given('theo', 'Write the brief') }
      ),
      // The owner's own answer came back, which no run followed.
      run(12, 'theo', 'handed_back', queued, {
        threadId: 3,
        handOff: back('rico', 'Answer the supplier', 'done', { answered: true })
      }),
      run(13, 'theo', 'handed_back', queued, {
        threadId: 3,
        handOff: back('tess', 'Price the rooms', 'waiting')
      }),
      run(14, 'tess', 'hand_off', running, {
        threadId: 3,
        handOff: given('theo', 'Find a printer')
      }),
      run(15, 'ada', 'resume', queued, { threadId: 5 }),
      run(16, 'tess', 'resume', queued, { threadId: 6 }),
      run(17, 'rico', 'answered', queued),
      run(18, 'ada', 'carry_out', queued, { askId: 3, reportWhenDone: true }),
      // Jo's leaving failed these before they started.
      run(19, 'jo', 'task_done', {
        is: 'ended',
        outcome: 'failed',
        result: 'Jo left.',
        doneAt: T0,
        startedAt: null
      }),
      run(
        20,
        'jo',
        'resume',
        { is: 'ended', outcome: 'failed', result: 'Jo left.', doneAt: T0, startedAt: null },
        { threadId: 8 }
      )
    ],
    runsGoing: ['ada job']
  });
}

/** Where the owner gets a task, and from whom. */
const GIVE: {
  staffId: string | null;
  handOffId?: number;
  threadId?: number;
  connector?: string;
}[] = [
  { staffId: 'ada' },
  { staffId: 'ada', threadId: 1 },
  { staffId: 'rico', handOffId: 6, threadId: 4 },
  // The office's own, on Jo's stopped work.
  { staffId: null, threadId: 8 },
  // Connect tasks, given only when no open one connects that tool.
  { staffId: 'ada', connector: 'github' },
  { staffId: null, connector: 'gmail' }
];

const DROPS: WorkEvent[] = [
  { kind: 'connectTasksDropped', connector: 'gmail' },
  { kind: 'connectTasksDropped', connector: 'gmail', staffId: 'rico' },
  { kind: 'connectTasksDropped', connector: 'github' }
];

/** The fakes every answer passes for its after-commit I/O; deciding calls none of them. */
const fakes = recordingEffects();
/** A goal or plan yes's own write in the transaction, which sets the goal or approves the plan. */
const PLANNING = [{ name: 'approval_work', run: async () => undefined }];

type State = {
  rows: WorkRows;
  /** The rows before the last event, so a check can tell a new row or line from an old one. */
  prev: WorkRows;
  at: number;
  last?: Decided<Change<WorkResults[WorkEvent['kind']]>>;
};
type Broken = { rule: string; detail: string };

const RULE = {
  secondFinish: 'a run that ended already is refused a second finish',
  claimNotQueued: 'a claim of a run that is not waiting to start is refused',
  onceAtATime: 'an Odd runs once at a time on a piece of work, other than its hand-offs',
  ceiling: 'every run claimed acts at exactly the ceiling its kind and its Odd give it',
  joined:
    "a lead's pick-up of a result joins its other queued results there, which stay queued until it ends them",
  leadLeft:
    'a run on work whose lead left puts no report on the Desk, and a colleague whose result no lead takes pokes the owner once',
  failure:
    'a run that fails and hands nothing back, with its Odd and its lead in the office, puts exactly one report on the Desk',
  waitingBack:
    'a hand-off that ends waiting goes back unless everything raised on it is answered, and no other waiting run goes back',
  wake: 'no open work stays parked on a task that ended, and its lead hears of the end in the same change',
  delivered:
    'every answer that goes to a lead lands in exactly one of its pick-ups waiting to start, never in one that ended, and nothing is written for a lead that left',
  heard:
    'every ask the owner decides and every task the owner ends is heard by exactly one run of the Odd that raised it, unless the answer is one that reaches no run of that Odd today',
  card: "a chat answer comes back under its card only in a run of the Odd whose chat it is, never in a twin's, a lesson's or another Odd's run",
  settled: "every thread's status and holder are what today's rule makes of its runs",
  model: 'every run, park, ask, task, refusal, report and poke is what the record expects'
} as const;

const notesOf = (f: FollowUp | undefined) => (f?.note ? f.note.split('\n') : []);
/** The kinds of run that hear an answer, by where it was raised; on its own work a lead's pick-up hears it too. */
const HEARS: Record<Heard['place'], LiveKind[]> = {
  none: ['answered', 'carry_out', 'rework', 'denied', 'task_done'],
  own: ['carry_out', 'rework', 'task_done'],
  other: ['carry_out', 'rework', 'task_done']
};

function broken(s: State, r: Model, events: WorkEvent[]): Broken[] {
  const e = events.at(-1)!;
  const x = r.expected;
  const d = s.last!;
  const change = 'change' in d ? d.change : undefined;
  const out: Broken[] = [];
  const fail = (rule: string, detail: string) => out.push({ rule, detail });
  const reports = (change?.outside ?? []).flatMap((o) =>
    o.kind === 'report' ? [{ staffId: o.staffId, title: o.title }] : []
  );
  const pokes = (change?.outside ?? []).flatMap((o) => (o.kind === 'poke' ? [o] : []));
  // The lines a row gained in this event: all of a new row's.
  const newLines = (g: FollowUp) => notesOf(g).slice(notesOf(s.prev.followUps.get(g.id)).length);
  const touched = (g: FollowUp) => !s.prev.followUps.has(g.id) || newLines(g).length > 0;

  if (e.kind === 'runFinished' && (x.refused === 'ended') !== !change)
    fail(RULE.secondFinish, `run ${e.id}: expected ${x.refused ?? 'a change'}, got ${show(d)}`);

  if (e.kind === 'runClaimed' && x.refused === 'not waiting' && change)
    fail(RULE.claimNotQueued, `run ${e.id} was claimed`);

  if (e.kind === 'runClaimed' && x.refused === 'held' && change)
    fail(RULE.onceAtATime, `run ${e.id} was claimed while held`);
  for (const t of s.rows.threads.values()) {
    const going = new Map<string, number>();
    for (const f of s.rows.followUps.values())
      if (f.threadId === t.id && f.kind !== 'hand_off' && f.run.is === 'running')
        going.set(f.staffId, (going.get(f.staffId) ?? 0) + 1);
    for (const [who, n] of going)
      if (n > 1) fail(RULE.onceAtATime, `${who} has ${n} runs going on thread ${t.id}`);
  }

  if (e.kind === 'runClaimed' && x.ceiling && change) {
    const got = (change.result as Claimed).ceiling;
    if (got !== x.ceiling) fail(RULE.ceiling, `run ${e.id}: expected ${x.ceiling}, got ${got}`);
  }

  if (e.kind === 'runClaimed' && x.joined && change) {
    const got = (change.result as Claimed).joined.map((g) => g.id);
    if (show(got) !== show(x.joined))
      fail(RULE.joined, `run ${e.id}: expected ${show(x.joined)}, got ${show(got)}`);
    for (const j of x.joined)
      if (s.rows.followUps.get(j)?.run.is !== 'queued')
        fail(RULE.joined, `run ${j}, joined into ${e.id}, is not queued`);
  }
  for (const { id, outcome } of x.ended) {
    const g = s.rows.followUps.get(id)?.run;
    if (g?.is !== 'ended' || g.outcome !== outcome)
      fail(RULE.joined, `run ${id} should have ended ${outcome}, is ${show(g)}`);
  }

  if (x.leadLeft) {
    if (reports.length > 0) fail(RULE.leadLeft, `reports ${show(reports)}`);
    const want = x.pokes;
    const ok =
      pokes.length === want.length &&
      want.every(
        (p, i) =>
          pokes[i].staffId === p.staffId &&
          pokes[i].message.includes(p.lead) &&
          pokes[i].message.includes(`"${p.title}"`)
      );
    if (!ok) fail(RULE.leadLeft, `expected pokes ${show(want)}, got ${show(pokes)}`);
  }

  if (x.failureReport && (e.kind === 'runFinished' || e.kind === 'staleRunsClosed')) {
    const f = r.runs.get(e.id)!;
    const title = titleOf(r, f.kind, 'failed', ABOUT);
    const mine = reports.filter((p) => p.staffId === f.staffId && p.title === title);
    if (mine.length !== 1) fail(RULE.failure, `run ${e.id}: ${mine.length} reports`);
  }

  if (e.kind === 'runFinished' && e.ended.outcome === 'waiting' && change) {
    const got = handedBack(change);
    if (show(got) !== show(x.handedBack))
      fail(RULE.waitingBack, `run ${e.id}: expected ${show(x.handedBack)}, got ${show(got)}`);
  }

  for (const t of s.rows.threads.values()) {
    if (t.status !== 'open' || t.park.on !== 'task') continue;
    if (s.rows.tasks.get(t.park.task)?.status !== 'open')
      fail(RULE.wake, `thread ${t.id} is parked on task ${t.park.task}, which ended`);
  }
  if (x.wake) {
    const f = s.rows.followUps.get(x.wake.runId);
    const line = notesOf(f).at(-1) ?? '';
    const said =
      f?.kind === 'resume' &&
      f.run.is === 'queued' &&
      line.includes(`"${x.wake.title}"`) &&
      line.includes('was set going when the task ended') === x.wake.ownRunEarlier;
    if (!said) fail(RULE.wake, `run ${x.wake.runId} holds ${show(f?.note)}`);
  }

  // A run that ended stays ended, whatever a loader makes of its row.
  for (const f of r.runs.values())
    if (f.is === 'ended' && s.rows.followUps.get(f.id)?.run.is !== 'ended')
      fail(RULE.delivered, `run ${f.id} ended, and reads ${show(s.rows.followUps.get(f.id)?.run)}`);
  const deliveries = new Map<string, { to: Delivery; n: number }>();
  for (const to of x.delivered) {
    const key = show(to);
    deliveries.set(key, { to, n: (deliveries.get(key)?.n ?? 0) + 1 });
  }
  for (const { to, n } of deliveries.values()) {
    const changed = [...s.rows.followUps.values()].filter(
      (g) => g.staffId === to.lead && g.threadId === to.threadId && touched(g)
    );
    if (to.leadLeft) {
      if (changed.length > 0)
        fail(RULE.delivered, `${to.lead} left, and gained ${show(changed.map((g) => g.id))}`);
      continue;
    }
    const holding = changed.filter(
      (g) => g.kind === to.kind && newLines(g).some((l) => l.includes(to.marker))
    );
    // Answers to one lead's work join one pick-up there; each hand-back is a row of its own.
    const want = to.kind === 'resume' ? 1 : n;
    const waiting = holding.every(
      (g) => g.run.is === 'queued' && r.runs.get(g.id)?.is === 'queued'
    );
    if (holding.length !== want || !waiting)
      fail(
        RULE.delivered,
        `${to.marker} to ${to.lead} on thread ${to.threadId}: expected ${want} waiting ${to.kind}, got ${show(holding)}`
      );
  }

  for (const h of x.heard) {
    const fresh = [...s.rows.followUps.values()].filter(
      (g) => g.staffId === h.staffId && !s.prev.followUps.has(g.id)
    );
    let n = fresh.filter(
      (g) =>
        HEARS[h.place].includes(g.kind as LiveKind) &&
        (h.askIds.includes(g.askId ?? -1) || h.taskIds.includes(g.taskId ?? -1))
    ).length;
    if (h.place === 'own')
      n += [...s.rows.followUps.values()].filter(
        (g) =>
          g.staffId === h.staffId &&
          g.kind === 'resume' &&
          g.threadId === h.threadId &&
          newLines(g).some((l) => l.includes(h.marker))
      ).length;
    if (h.planning)
      n += (change?.outside ?? []).filter(
        (o) => o.kind === 'perKind' && o.effect.name === 'approval_work'
      ).length;
    if (n !== h.runs)
      fail(
        RULE.heard,
        `${h.marker} for ${h.staffId} on ${h.place} work: expected ${h.runs} runs, got ${n}`
      );
  }

  for (const f of s.rows.followUps.values()) {
    const want = r.runs.get(f.id)?.card ?? null;
    if (cardOf(f) !== want) fail(RULE.card, `run ${f.id}: expected card ${want}, got ${cardOf(f)}`);
  }

  for (const t of r.threads.values()) {
    const got = s.rows.threads.get(t.id)!;
    if (got.status !== t.status || got.holderId !== t.holder)
      fail(
        RULE.settled,
        `thread ${t.id}: expected ${t.status} held by ${t.holder}, got ${got.status} held by ${got.holderId}`
      );
  }

  // The whole model, last, so each rule above names its own failure first.
  if ((x.refused !== undefined) !== !change)
    fail(RULE.model, `${show(e)}: expected ${x.refused ?? 'a change'}, got ${show(d)}`);
  if (fakes.calls.length > 0)
    fail(RULE.model, `deciding called its after-commit I/O: ${show(fakes.calls)}`);
  if ((e.kind === 'askRaised' || e.kind === 'taskGiven') && change) {
    const want = x.already === undefined ? null : { already: x.already };
    if (show(change.result) !== show(want))
      fail(RULE.model, `expected ${show(want)}, got ${show(change.result)}`);
  }
  if (show(reports) !== show(x.reports))
    fail(RULE.model, `expected reports ${show(x.reports)}, got ${show(reports)}`);
  if (pokes.length !== x.pokes.length) fail(RULE.model, `expected pokes ${show(x.pokes)}`);
  if (change && show(handedBack(change)) !== show(x.handedBack))
    fail(RULE.model, `expected hand-backs ${show(x.handedBack)}, got ${show(handedBack(change))}`);
  if (s.rows.followUps.size !== r.runs.size)
    fail(RULE.model, `expected ${r.runs.size} runs, got ${s.rows.followUps.size}`);
  for (const f of r.runs.values()) {
    const g = s.rows.followUps.get(f.id);
    const same =
      g?.staffId === f.staffId &&
      g.kind === f.kind &&
      g.threadId === f.threadId &&
      g.askId === f.askId &&
      g.taskId === f.taskId &&
      g.run.is === f.is &&
      (g.run.is !== 'ended' || g.run.outcome === f.outcome) &&
      notesOf(g).length === f.lines;
    if (!same) fail(RULE.model, `run ${f.id}: expected ${show(f)}, got ${show(g)}`);
  }
  const asks = r.asks.map((a) => [a.id, a.status]);
  const gotAsks = [...s.rows.asks.values()].map((a) => [a.id, a.status]);
  if (show(gotAsks) !== show(asks))
    fail(RULE.model, `expected asks ${show(asks)}, got ${show(gotAsks)}`);
  const tasks = [...r.tasks.values()].map((k) => [k.id, k.status]);
  const gotTasks = [...s.rows.tasks.values()].map((k) => [k.id, k.status]);
  if (show(gotTasks) !== show(tasks))
    fail(RULE.model, `expected tasks ${show(tasks)}, got ${show(gotTasks)}`);
  for (const t of r.threads.values()) {
    const got = s.rows.threads.get(t.id)!;
    const park = got.status !== 'open' ? { on: 'none' } : parkOf(got.park);
    if (show(park) !== show(t.park))
      fail(RULE.model, `thread ${t.id}: expected park ${show(t.park)}, got ${show(park)}`);
  }
  return out;
}

/** The results a change hands back to a lead, as new `handed_back` rows. */
function handedBack(change: Change<unknown>) {
  return change.put.flatMap((p) =>
    'ref' in p && p.table === 'followUps' && p.insert.kind === 'handed_back'
      ? [
          {
            staffId: p.insert.staffId,
            from: p.insert.handOff!.from,
            outcome: p.insert.handOff!.outcome!,
            threadId: p.insert.threadId
          }
        ]
      : []
  );
}

/**
 * A run as a loader reads it: through its row and back. `followUpRow` names
 * the kind as the state's own union, which the row's column type holds.
 */
const loaded = (f: FollowUp): FollowUp =>
  parseFollowUp(followUpRow(f) as Parameters<typeof parseFollowUp>[0]);

/** What the loader prepares for an answer to this ask, read from the rows as a loader reads them. */
function preparedFor(rows: WorkRows, id: number): Prepared {
  const a = rows.asks.get(id);
  const o = a && rows.staff.get(a.staffId);
  if (!a || !o) return {};
  if (a.kind === 'folder') return { folderTitle: `Let ${o.name} read and change ${FOLDER.path}` };
  if (a.kind === 'switch')
    return {
      // The answer reads only the Odd's name from the staff row the loader read.
      switches: { before: { name: o.name } as StaffRow, off: ['web'], networkBody: undefined }
    };
  if (a.held) return { sharing: { from: a.held.from, title: a.held.title, brief: a.held.brief } };
  return {};
}

/** Every ask an Odd may raise now, each place raising each kind at most twice. */
function raises(r: Model): WorkEvent[] {
  const title = `Ask ${Math.max(...r.asks.map((a) => a.id)) + 1}`;
  return ASK_KINDS.flatMap((kind) =>
    RAISE[kind].at.flatMap((name): WorkEvent[] => {
      const p = PLACES[name];
      const a: NewAsk = {
        kind,
        title,
        why: 'It is needed',
        ifApproved: 'I do it',
        ...p,
        ...RAISE[kind].with?.(p)
      };
      return (r.raised.get(raiseKey(a)) ?? 0) < 2 ? [{ kind: 'askRaised', ask: a }] : [];
    })
  );
}

/** Every answer the owner may give an ask now: each decision, with and without words, on the Desk and in chat. */
function answers(a: AskRec): WorkEvent[] {
  const decided = (
    decision: Decision,
    reason: string | null,
    inChat: boolean,
    more: Partial<EventOf<'askDecided'>> = {}
  ): WorkEvent => ({
    kind: 'askDecided',
    id: a.id,
    decision,
    reason,
    inChat,
    perKind: [],
    effects: fakes.effects,
    ...more
  });
  const done = RAISE[a.kind].done;
  const yes = {
    ...(done && { done }),
    ...(KINDS[a.kind].yes.includes('planning') && { perKind: PLANNING })
  };
  if (a.status !== 'open') return [decided('approve', null, false, yes)];
  return [
    ...DECISIONS.flatMap((decision) =>
      [null, 'Go ahead'].flatMap((reason) =>
        [false, true].map((inChat) =>
          decided(decision, reason, inChat, decision === 'approve' ? yes : {})
        )
      )
    ),
    decided('deny', null, false, { withdrawn: `"${a.title}" was taken off the desk.` }),
    // A bare yes to a kind the office approves only by doing it.
    ...(done ? [decided('approve', null, false)] : [])
  ];
}

/** Every way a task may end now. */
function ends(t: TaskRec): WorkEvent[] {
  const ended = (how: TaskEnded, inChat: boolean, note: string | null = null): WorkEvent => ({
    kind: 'taskEnded',
    id: t.id,
    ended: how,
    note,
    inChat
  });
  if (t.status !== 'open') return [ended('done', false)];
  return [
    ...(['done', 'dropped'] as const).flatMap((how) =>
      [false, true].map((inChat) => ended(how, inChat))
    ),
    ended('withdrawn', false, `"${t.title}" was taken off the desk.`)
  ];
}

/** Every task an Odd or the office may give now, each giver at most twice. */
function gives(r: Model): WorkEvent[] {
  const title = `Task ${Math.max(...r.tasks.keys()) + 1}`;
  return GIVE.flatMap(({ connector, ...at }): WorkEvent[] => {
    const k: NewTask = {
      ...at,
      title,
      why: 'It is needed',
      steps: connector ? connect(connector) : []
    };
    if ((r.raised.get(giveKey(k)) ?? 0) >= 2) return [];
    return [{ kind: 'taskGiven', task: k, ...(connector && { oneOpen: { connector } }) }];
  });
}

const sequences: Explore<State, WorkEvent, Model> = {
  // One fixed office: the draw only picks events.
  start: () => {
    const seed = office();
    // The system reads each run as a loader does, through its row; the record reads the seed.
    const rows = {
      ...seed,
      followUps: new Map([...seed.followUps].map(([id, f]) => [id, loaded(f)] as const))
    };
    return { state: { rows, prev: rows, at: 0 }, record: recordOf(seed) };
  },
  next: (r) => [
    ...[...r.runs.keys()].flatMap((id): WorkEvent[] => [
      { kind: 'runClaimed', id },
      { kind: 'staleRunsClosed', id, about: ABOUT },
      ...OUTCOMES.map((outcome): WorkEvent => ({
        kind: 'runFinished',
        id,
        about: ABOUT,
        ended: { outcome, result: `Ran: ${outcome}`, joined: r.runs.get(id)!.joined }
      }))
    ]),
    ...OWED.filter((_, i) => !r.owedSent.has(i)),
    ...raises(r),
    ...r.asks.flatMap(answers),
    ...gives(r),
    ...[...r.tasks.values()].flatMap(ends),
    ...DROPS
  ],
  step: (s, e) => {
    const at = s.at + 1;
    const rows =
      e.kind === 'askDecided' ? { ...s.rows, prepared: preparedFor(s.rows, e.id) } : s.rows;
    const last = decide(rows, e, minutes(at));
    return {
      rows: 'change' in last ? applyChange(rows, last.change) : s.rows,
      prev: s.rows,
      at,
      last
    };
  },
  note: (r, e) => {
    r.at++;
    r.expected = fresh(Math.max(...r.runs.keys()) + 1);
    if (e.kind === 'runQueued') queue(r, e);
    if (e.kind === 'runClaimed') claim(r, e.id);
    if (e.kind === 'runFinished') finish(r, e.id, e.ended.outcome, e.ended.joined, e.about);
    if (e.kind === 'staleRunsClosed') {
      if (r.runs.get(e.id)!.is !== 'running') r.expected.refused = 'not running';
      else finish(r, e.id, 'failed', [], e.about);
    }
    if (e.kind === 'askRaised') raise(r, e.ask);
    if (e.kind === 'askDecided') decideAsk(r, e);
    if (e.kind === 'taskGiven') give(r, e);
    if (e.kind === 'taskEnded') endTask(r, e);
    if (e.kind === 'connectTasksDropped') dropConnectTasks(r, e);
    if (e.kind === 'goalStatusChanged') r.owedSent.add(OWED.indexOf(e));
  },
  broken
};

/** The cases each rule must have met in the sequences, so none passes on nothing. */
const CASES: Record<keyof typeof RULE, string[]> = {
  secondFinish: ['a second finish'],
  claimNotQueued: ['a claim of a run not waiting to start'],
  onceAtATime: [
    'a claim held while its Odd runs on that work',
    "a lead's claim held while its job runs on that work"
  ],
  ceiling: [
    'a claim at draft by an Odd at act',
    'a claim at act by an Odd at act',
    'a claim at draft by an Odd at draft',
    'a claim at read by an Odd at read'
  ],
  joined: ['a claim joining results', 'a finish ending joined results'],
  leadLeft: [
    'a report held back because the lead left',
    'a colleague pokes the owner for a lead that left'
  ],
  failure: ['a failure no lead hears of'],
  waitingBack: [
    'a hand-off ends waiting with something raised still open',
    'a hand-off that raised nothing ends waiting',
    'a hand-off ends waiting with everything raised answered',
    'a run serving a hand-off ends waiting'
  ],
  wake: ['a park given back on a task that ended'],
  delivered: [
    "an answer joining a lead's queued pick-up",
    "an answer starting a lead's pick-up",
    'an answer handed back to the lead that handed on the work',
    'an answer for a lead that left',
    'an answer to a lead whose pick-up there ended starts a new one'
  ],
  heard: [
    'an answer heard on none work',
    'an answer on no work heard by the lesson run',
    'twins at one place heard once',
    'an answer heard on own work',
    'an answer heard on other work',
    'an answer its kind lets go unheard',
    "a yes to an Odd's own leaving, raised on no work",
    'twins on no work carried out at another place',
    "a goal's yes heard by its planning run",
    "a task's end heard on none work",
    "a task's end heard on own work",
    "a task's end heard on other work"
  ],
  card: [
    "a chat answer carried under its card by its own Odd's run",
    "a chat answer reaching another Odd's pick-up, which takes no card",
    'twins answered in chat, under the asked one only',
    'a chat answer joining a pick-up, which takes its card',
    'a task answered in chat going back to work, with no card'
  ],
  settled: ['a thread ended', 'a thread kept open only because its last run ended waiting'],
  model: [
    'a result handed back to its lead',
    'a held call raised again while it is open',
    'a connect task given while one is open',
    'an answer refused before the ask closes',
    'an answer to an ask answered already',
    "a tool's connect tasks dropped"
  ]
};

test('random sequences of run, ask and task events keep every rule', async (t) => {
  const failure = explore(sequences, { seeds: SEEDS, length: LENGTH });
  for (const key of Object.keys(RULE) as (keyof typeof RULE)[]) {
    await t.test(RULE[key], () => {
      assert.equal(
        failure?.rule === RULE[key] ? failure : undefined,
        undefined,
        `seed ${failure?.seed}: ${failure?.detail}\n${show(failure?.events)}`
      );
      // A run that stopped at another rule's failure met fewer cases, so only a full run counts them.
      if (!failure)
        for (const c of CASES[key]) assert.ok((met.get(c) ?? 0) > 0, `no sequence met: ${c}`);
    });
  }
  assert.equal(failure, undefined, show(failure));
});
