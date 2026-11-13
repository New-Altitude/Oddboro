// Random sequences of run events through the work core's deciders. After
// each event the rows the deciders leave are checked against the test's own
// record, which it builds from the events alone with today's rules written
// out here, never from what the deciders answered. Pure: rows in memory, no
// database.
// Run with `npm test -w @oddboro/ledger`; set WORK_SEQUENCES_SEEDS for a longer run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Level } from '../src/access-words.ts';
import type { Outcome } from '../src/schema.ts';
import { explore, type Explore } from '../src/sequences.ts';
import type { Decided } from '../src/transition.ts';
import { decide } from '../src/work/decide.ts';
import type { Claimed, LiveKind, WorkEvent } from '../src/work/events.ts';
import { SERVES_NO_THREAD } from '../src/work/kinds.ts';
import { CUT_OFF_RESULT, OUTCOME_TITLE } from '../src/work/runs.ts';
import { applyChange, type Change, type WorkRows } from '../src/work/snapshot.ts';
import type { FollowUp } from '../src/work/state.ts';
import { ask, minutes, odd, rowsOf, run, T0, task, thread } from './work-rows.ts';

// How many seeds the test runs; set WORK_SEQUENCES_SEEDS for a longer run.
const SEEDS = Number(process.env.WORK_SEQUENCES_SEEDS ?? 200);
const LENGTH = 30;

const ABOUT = 'the work';
// OUTCOME_TITLE has a title for every outcome, so its keys are every outcome.
const OUTCOMES = Object.keys(OUTCOME_TITLE.resume) as Outcome[];

// The office every sequence starts from. Ada leads at Act, Rico works at
// Draft, Tess at Read. Theo left the office, so the work he led stopped. Jo
// was brought back after her leaving failed her run.
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
      thread(6, 'tess', { park: { on: 'time', at: minutes(500) } })
    ],
    tasks: [task(1, 'ada'), task(2, 'ada', { status: 'done', doneAt: T0 })],
    asks: [
      ask(1, 'rico', { handOffId: 6, threadId: 4 }),
      ask(2, 'rico', { handOffId: 8, threadId: 4, status: 'approved', decidedAt: T0 }),
      ask(3, 'ada', { status: 'approved', decidedAt: T0 })
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
      // Jo's leaving failed this before it started.
      run(19, 'jo', 'task_done', {
        is: 'ended',
        outcome: 'failed',
        result: 'Jo left.',
        doneAt: T0,
        startedAt: null
      })
    ],
    runsGoing: ['ada job']
  });
}

/** The runs an entry function may owe, each offered once. */
const OWED: WorkEvent[] = [
  // A project's result, which starts nothing once its work ended.
  {
    kind: 'runQueued',
    run: { staffId: 'ada', kind: 'resume', threadId: 2, note: 'A project result came back.' },
    onlyWhileOpen: true
  },
  // Works on the thread ask 2 was raised on.
  { kind: 'runQueued', run: { staffId: 'rico', kind: 'carry_out', askId: 2, note: null } },
  {
    kind: 'runQueued',
    run: { staffId: 'tess', kind: 'edited', note: null, edit: { path: 'notes.md', before: '' } }
  }
];

// The test's own record of the office, from the events alone.

type Park = { on: 'none' } | { on: 'task'; task: number } | { on: 'time'; at: number };
type RunRec = {
  id: number;
  staffId: string;
  kind: LiveKind;
  threadId: number | null;
  askId: number | null;
  handOff: { from: string; title: string; outcome?: Outcome; answered?: boolean } | null;
  reportWhenDone: boolean;
  is: 'queued' | 'running' | 'ended';
  outcome?: Outcome;
  /** The event the run ended at. */
  doneAt?: number;
  unparked: { task: number } | { at: number } | null;
  /** The results its claim joined. */
  joined: number[];
  lines: number;
};
type ThreadRec = {
  id: number;
  hub: string;
  holder: string;
  status: 'open' | 'done' | 'failed' | 'stopped';
  park: Park;
  leadsJobGoing: boolean;
};
type Poke = { staffId: string; lead: string; title: string };
type Expected = {
  refused?: 'not waiting' | 'held' | 'ended' | 'not running';
  reports: { staffId: string; title: string }[];
  pokes: Poke[];
  ceiling?: Level;
  joined?: number[];
  /** Runs this event ends, with the outcome each gets. */
  ended: { id: number; outcome: Outcome }[];
  handedBack: { staffId: string; from: string; outcome: Outcome; threadId: number | null }[];
  wake?: { runId: number; title: string; ownRunEarlier: boolean };
  /** The work's lead has left the office. */
  leadLeft?: boolean;
  /** A run of an Odd in the office, on work whose lead is here or on no work, failed and handed nothing back. */
  failureReport?: boolean;
};
/** The test's own record of the office, and what it expects of the last event. */
type Model = {
  at: number;
  owner: string;
  odds: Map<string, { name: string; level: Level; left: boolean }>;
  threads: Map<number, ThreadRec>;
  runs: Map<number, RunRec>;
  asks: { id: number; open: boolean; handOffId: number | null; threadId: number | null }[];
  tasks: Map<number, { title: string; open: boolean; done: boolean; byOdd: boolean }>;
  owedSent: Set<number>;
  expected: Expected;
};

/** The kinds a run of which acts at Draft at most, written out here so a change to the code's list shows. */
const DRAFT_KINDS: ReadonlySet<LiveKind> = new Set([
  'hand_off',
  'handed_back',
  'resume',
  'answered',
  'denied',
  'edited'
]);

const fresh = (): Expected => ({ reports: [], pokes: [], ended: [], handedBack: [] });

function recordOf(rows: WorkRows): Model {
  const runs = new Map<number, RunRec>();
  for (const f of rows.followUps.values()) {
    const r = f.run;
    runs.set(f.id, {
      id: f.id,
      staffId: f.staffId,
      // The office holds no row of a retired kind.
      kind: f.kind as LiveKind,
      threadId: f.threadId,
      askId: f.askId,
      handOff: f.handOff,
      reportWhenDone: f.reportWhenDone,
      is: r.is,
      ...(r.is === 'ended' && { outcome: r.outcome, doneAt: 0 }),
      unparked:
        r.is !== 'running' || !r.unparked
          ? null
          : 'task' in r.unparked
            ? r.unparked
            : { at: r.unparked.at.getTime() },
      joined: [],
      lines: 0
    });
  }
  return {
    at: 0,
    owner: rows.owner,
    odds: new Map(
      [...rows.staff.values()].map((o) => [
        o.id,
        { name: o.name, level: o.level, left: !!o.leftAt }
      ])
    ),
    threads: new Map(
      [...rows.threads.values()].map((t) => [
        t.id,
        {
          id: t.id,
          hub: t.hubId,
          holder: t.holderId,
          status: t.status,
          park:
            t.status !== 'open' || t.park.on === 'none'
              ? { on: 'none' }
              : t.park.on === 'task'
                ? { on: 'task', task: t.park.task }
                : { on: 'time', at: t.park.at.getTime() },
          leadsJobGoing: t.runs.some((k) => rows.runsGoing.has(k))
        }
      ])
    ),
    runs,
    asks: [...rows.asks.values()].map((a) => ({
      id: a.id,
      open: a.status === 'open',
      handOffId: a.handOffId,
      threadId: a.threadId
    })),
    tasks: new Map(
      [...rows.tasks.values()].map((k) => [
        k.id,
        {
          title: k.title,
          open: k.status === 'open',
          done: k.status === 'done',
          byOdd: k.staffId !== null
        }
      ])
    ),
    owedSent: new Set(),
    expected: fresh()
  };
}

/** How often a sequence met the case each rule is about; a rule never met proves nothing. */
const met = new Map<string, number>();
const meet = (c: string) => met.set(c, (met.get(c) ?? 0) + 1);

/** The title the owner reads for a run that ended so. */
const titleOf = (r: Model, kind: LiveKind, outcome: Outcome, about: string) =>
  `${OUTCOME_TITLE[kind][outcome].replace('{owner}', r.owner)}: ${about}`;

const left = (r: Model, id: string) => !!r.odds.get(id)?.left;

/** Today's rule for where a thread stands, run on the threads an event touches, as today's code does. */
function settle(r: Model, threadId: number | null): void {
  const t = threadId === null ? undefined : r.threads.get(threadId);
  if (t?.status !== 'open') return;
  const on = [...r.runs.values()].filter((f) => f.threadId === t.id);
  const pending = on.filter((f) => f.is !== 'ended').sort((a, b) => b.id - a.id)[0];
  const last = on
    .filter((f) => f.is === 'ended')
    .sort((a, b) => b.doneAt! - a.doneAt! || b.id - a.id)[0];
  const raised = r.asks.filter((a) => a.threadId === t.id);
  const raisedOpen = raised.some((a) => a.open);
  t.holder = pending?.staffId ?? t.hub;
  if (pending || t.park.on !== 'none' || !last || raisedOpen) return;
  if (last.outcome === 'waiting') {
    meet('a thread kept open only because its last run ended waiting');
    return;
  }
  meet('a thread ended');
  t.status = last.outcome!;
}

function insert(r: Model, f: Omit<RunRec, 'id'>): number {
  const id = Math.max(...r.runs.keys()) + 1;
  r.runs.set(id, { ...f, id });
  settle(r, f.threadId);
  return id;
}

const newRun = (f: Pick<RunRec, 'staffId' | 'kind' | 'threadId'> & Partial<RunRec>) => ({
  askId: null,
  handOff: null,
  reportWhenDone: false,
  is: 'queued' as const,
  unparked: null,
  joined: [],
  lines: 0,
  ...f
});

/** The hand-off a run's work serves: its own, or the one the ask it carries out was raised in. */
function servedHandOff(r: Model, f: RunRec): RunRec | undefined {
  if (f.kind === 'hand_off') return f;
  if (SERVES_NO_THREAD[f.kind] || f.askId === null) return undefined;
  const link = r.asks.find((a) => a.id === f.askId)?.handOffId;
  const origin = link == null ? undefined : r.runs.get(link);
  return origin?.kind === 'hand_off' ? origin : undefined;
}

/** The owner answered everything the hand-off raised: it raised something, and none is open. */
function answeredAll(r: Model, handOffId: number): boolean {
  const raised = r.asks.filter((a) => a.handOffId === handOffId);
  return raised.length > 0 && raised.every((a) => !a.open);
}

function queue(r: Model, e: Extract<WorkEvent, { kind: 'runQueued' }>): void {
  r.owedSent.add(OWED.indexOf(e));
  const o = e.run;
  const raisedOn =
    o.askId === undefined ? null : (r.asks.find((a) => a.id === o.askId)?.threadId ?? null);
  const threadId = o.threadId ?? (SERVES_NO_THREAD[o.kind] ? null : raisedOn);
  const open = threadId !== null && r.threads.get(threadId)?.status === 'open';
  if (e.onlyWhileOpen && !open) return;
  insert(
    r,
    newRun({
      staffId: o.staffId,
      kind: o.kind,
      threadId,
      askId: o.askId ?? null,
      lines: o.note === null ? 0 : 1
    })
  );
}

function claim(r: Model, id: number): void {
  const x = r.expected;
  const f = r.runs.get(id)!;
  if (f.is !== 'queued') {
    x.refused = 'not waiting';
    meet('a claim of a run not waiting to start');
    return;
  }
  const t = f.threadId === null ? undefined : r.threads.get(f.threadId);
  if (f.kind !== 'hand_off' && t) {
    const ownRun = [...r.runs.values()].some(
      (g) => g.staffId === f.staffId && g.threadId === t.id && g.is === 'running'
    );
    const jobGoing = t.hub === f.staffId && t.leadsJobGoing;
    if (ownRun) meet('a claim held while its Odd runs on that work');
    if (jobGoing) meet("a lead's claim held while its job runs on that work");
    if (ownRun || jobGoing) {
      x.refused = 'held';
      return;
    }
  }
  f.is = 'running';
  f.unparked = null;
  if (t?.status === 'open' && t.hub === f.staffId && t.park.on !== 'none') {
    f.unparked = t.park.on === 'task' ? { task: t.park.task } : { at: t.park.at };
    t.park = { on: 'none' };
  }
  f.joined =
    f.kind === 'handed_back' && t
      ? [...r.runs.values()]
          .filter(
            (g) =>
              g.id !== f.id &&
              g.staffId === f.staffId &&
              g.threadId === t.id &&
              g.kind === 'handed_back' &&
              g.is === 'queued'
          )
          .map((g) => g.id)
          .sort((a, b) => a - b)
      : [];
  if (f.joined.length > 0) meet('a claim joining results');
  x.joined = f.joined;
  const level = r.odds.get(f.staffId)!.level;
  x.ceiling = level === 'read' ? 'read' : DRAFT_KINDS.has(f.kind) ? 'draft' : level;
  meet(`a claim at ${x.ceiling} by an Odd at ${level}`);
}

function finish(r: Model, id: number, outcome: Outcome, joinedIds: number[], about: string): void {
  const x = r.expected;
  const f = r.runs.get(id)!;
  if (f.is === 'ended') {
    x.refused = 'ended';
    meet('a second finish');
    return;
  }
  const wasRunning = f.is === 'running';
  const t = f.threadId === null ? undefined : r.threads.get(f.threadId);
  const origin = servedHandOff(r, f);
  const lead = origin ? origin.handOff!.from : t?.hub;
  const goesBack =
    !!origin?.handOff &&
    (outcome !== 'waiting' || (f.kind === 'hand_off' && !answeredAll(r, origin.id)));
  x.leadLeft = lead !== undefined && left(r, lead);
  const wouldReport = outcome === 'failed' ? !goesBack : outcome === 'done' && f.reportWhenDone;
  if (x.leadLeft && wouldReport) meet('a report held back because the lead left');
  if (!x.leadLeft && wouldReport)
    x.reports.push({
      staffId: f.staffId,
      title: titleOf(r, f.kind, outcome, about)
    });
  x.failureReport = outcome === 'failed' && !goesBack && !left(r, f.staffId) && !x.leadLeft;
  if (x.failureReport) meet('a failure no lead hears of');
  if (outcome === 'waiting' && origin) {
    if (f.kind !== 'hand_off') meet('a run serving a hand-off ends waiting');
    else if (goesBack)
      meet(
        r.asks.some((a) => a.handOffId === origin.id)
          ? 'a hand-off ends waiting with something raised still open'
          : 'a hand-off that raised nothing ends waiting'
      );
    else meet('a hand-off ends waiting with everything raised answered');
  }

  const ending = joinedIds
    .map((j) => r.runs.get(j)!)
    .filter((g) => g.staffId === f.staffId && g.kind === 'handed_back' && g.is === 'queued');
  if (ending.length > 0) meet('a finish ending joined results');

  if (goesBack && left(r, origin!.handOff!.from) && outcome !== 'waiting')
    x.pokes.push({
      staffId: f.staffId,
      lead: r.odds.get(origin!.handOff!.from)!.name,
      title: origin!.handOff!.title
    });
  if (t?.hub === f.staffId && left(r, f.staffId))
    for (const g of [f, ...ending]) {
      const h = g.handOff;
      if (g.kind !== 'handed_back' || !h?.outcome || h.outcome === 'waiting' || h.answered)
        continue;
      x.pokes.push({ staffId: h.from, lead: r.odds.get(f.staffId)!.name, title: h.title });
    }
  if (x.pokes.length > 0) meet('a colleague pokes the owner for a lead that left');

  for (const g of [f, ...ending]) {
    g.is = 'ended';
    g.outcome = outcome;
    g.doneAt = r.at;
    x.ended.push({ id: g.id, outcome });
  }

  const lifted = outcome === 'failed' && wasRunning ? f.unparked : null;
  const givesBack = !!lifted && t?.status === 'open' && t.park.on === 'none';
  if (givesBack && lifted)
    t!.park = 'task' in lifted ? { on: 'task', ...lifted } : { on: 'time', ...lifted };

  const wentBack = goesBack && !left(r, origin!.handOff!.from);
  if (wentBack) {
    const h = {
      staffId: origin!.handOff!.from,
      from: f.staffId,
      outcome,
      threadId: origin!.threadId
    };
    x.handedBack.push(h);
    meet('a result handed back to its lead');
    insert(
      r,
      newRun({
        staffId: h.staffId,
        kind: 'handed_back',
        threadId: h.threadId,
        handOff: { from: f.staffId, title: origin!.handOff!.title, outcome },
        lines: 1
      })
    );
  } else settle(r, f.threadId);

  const k = givesBack && lifted && 'task' in lifted ? r.tasks.get(lifted.task) : undefined;
  if (k && !k.open) wake(r, lifted && 'task' in lifted ? lifted.task : -1);
}

/** The task ended: every open thread parked on it picks up, its lead told in a queued resume. */
function wake(r: Model, taskId: number): void {
  const k = r.tasks.get(taskId)!;
  meet('a park given back on a task that ended');
  for (const t of [...r.threads.values()].sort((a, b) => a.id - b.id)) {
    if (t.status !== 'open' || t.park.on !== 'task' || t.park.task !== taskId) continue;
    t.park = { on: 'none' };
    if (left(r, t.hub)) continue;
    const waiting = [...r.runs.values()]
      .filter(
        (f) =>
          f.staffId === t.hub && f.threadId === t.id && f.kind === 'resume' && f.is === 'queued'
      )
      .sort((a, b) => a.id - b.id)[0];
    let runId: number;
    if (waiting) {
      waiting.lines++;
      runId = waiting.id;
    } else runId = insert(r, newRun({ staffId: t.hub, kind: 'resume', threadId: t.id, lines: 1 }));
    // A done task an Odd gave starts that Odd's own run as it ends, before this wake.
    r.expected.wake = { runId, title: k.title, ownRunEarlier: k.done && k.byOdd };
  }
}

type State = { rows: WorkRows; at: number; last?: Decided<Change<Claimed | null>> };
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
  settled: "every thread's status and holder are what today's rule makes of its runs",
  model: 'every run, park, refusal, report and poke is what the record expects'
} as const;

const notesOf = (f: FollowUp | undefined) => (f?.note ? f.note.split('\n') : []);
const show = (v: unknown) => JSON.stringify(v);

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

  if (x.failureReport && e.kind !== 'runQueued' && e.kind !== 'runClaimed') {
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
      g.run.is === f.is &&
      (g.run.is !== 'ended' || g.run.outcome === f.outcome) &&
      notesOf(g).length === f.lines;
    if (!same) fail(RULE.model, `run ${f.id}: expected ${show(f)}, got ${show(g)}`);
  }
  for (const t of r.threads.values()) {
    const got = s.rows.threads.get(t.id)!;
    const park =
      got.status !== 'open' || got.park.on === 'none'
        ? { on: 'none' }
        : got.park.on === 'task'
          ? { on: 'task', task: got.park.task }
          : { on: got.park.on, at: got.park.at.getTime() };
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

const sequences: Explore<State, WorkEvent, Model> = {
  // One fixed office: the draw only picks events.
  start: () => {
    const rows = office();
    return { state: { rows, at: 0 }, record: recordOf(rows) };
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
    ...OWED.filter((_, i) => !r.owedSent.has(i))
  ],
  step: (s, e) => {
    const at = s.at + 1;
    const last = decide(s.rows, e, minutes(at));
    return { rows: 'change' in last ? applyChange(s.rows, last.change) : s.rows, at, last };
  },
  note: (r, e) => {
    r.at++;
    r.expected = fresh();
    if (e.kind === 'runQueued') queue(r, e);
    if (e.kind === 'runClaimed') claim(r, e.id);
    if (e.kind === 'runFinished') finish(r, e.id, e.ended.outcome, e.ended.joined, e.about);
    if (e.kind === 'staleRunsClosed') {
      if (r.runs.get(e.id)!.is !== 'running') r.expected.refused = 'not running';
      else finish(r, e.id, 'failed', [], e.about);
    }
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
  settled: ['a thread ended', 'a thread kept open only because its last run ended waiting'],
  model: ['a result handed back to its lead']
};

test('random sequences of run events keep every rule', async (t) => {
  const failure = explore(sequences, { seeds: SEEDS, length: LENGTH });
  for (const key of Object.keys(RULE) as (keyof typeof RULE)[]) {
    await t.test(RULE[key], () => {
      assert.equal(
        failure?.rule === RULE[key] ? failure : undefined,
        undefined,
        `seed ${failure?.seed}: ${failure?.detail}\n${show(failure?.events)}`
      );
      for (const c of CASES[key]) assert.ok((met.get(c) ?? 0) > 0, `no sequence met: ${c}`);
    });
  }
  assert.equal(failure, undefined, show(failure));
});
