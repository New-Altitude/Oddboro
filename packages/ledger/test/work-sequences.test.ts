// Random sequences of run, ask and task events through the work core's
// deciders. After each event the rows the deciders leave are checked against
// the test's own record, which it builds from the events alone with today's
// rules written out here, never from what the deciders answered. Pure: rows
// in memory, no database.
// Run with `npm test -w @oddboro/ledger`; set WORK_SEQUENCES_SEEDS for a longer run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Level } from '../src/access-words.ts';
import type { StaffRow } from '../src/office.ts';
import type { Decision } from '../src/office-asks.ts';
import {
  ASK_KINDS,
  type AskKind,
  type AskStatus,
  type HeldCall,
  type Outcome,
  type ReplyDraft
} from '../src/schema.ts';
import type { GmailFilter } from '../src/filter-words.ts';
import { explore, type Explore } from '../src/sequences.ts';
import type { TaskEnded } from '../src/task-parking.ts';
import type { Decided } from '../src/transition.ts';
import { decide } from '../src/work/decide.ts';
import type {
  AskDone,
  Claimed,
  EventOf,
  LiveKind,
  NewAsk,
  NewTask,
  WorkEvent,
  WorkResults
} from '../src/work/events.ts';
import { SERVES_NO_THREAD } from '../src/work/kinds.ts';
import { CUT_OFF_RESULT, OUTCOME_TITLE } from '../src/work/runs.ts';
import { applyChange, type Change, type Prepared, type WorkRows } from '../src/work/snapshot.ts';
import { followUpRow, parseFollowUp, type FollowUp } from '../src/work/state.ts';
import { TWINNED } from '../src/work/twins.ts';
import { ask, minutes, odd, recordingEffects, rowsOf, run, T0, task, thread } from './work-rows.ts';

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
const GMAIL = { connector: 'gmail', level: 'act' } as const;

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

/** Events offered once each: the runs an entry function may owe, and a goal's change of status. */
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
  },
  // Decides nothing: a goal's status tells its Odds nothing yet.
  { kind: 'goalStatusChanged', goalId: 1, status: 'paused' }
];

// Where an Odd raises an ask, and who. Each place is one kind of answer path.
type Place = { staffId: string; handOffId: number | null; threadId: number | null };
const PLACES = {
  /** Rico, on no work. */
  none: { staffId: 'rico', handOffId: null, threadId: null },
  /** Ada, on the work she leads. */
  lead: { staffId: 'ada', handOffId: null, threadId: 1 },
  /** Rico, on Ada's hand-off to him. */
  handOff: { staffId: 'rico', handOffId: 6, threadId: 4 },
  /** Tess, on a hand-off from Theo, who left. */
  leadLeft: { staffId: 'tess', handOffId: 14, threadId: 3 },
  /** Jo, on the work she led before her leaving stopped it. */
  broughtBack: { staffId: 'jo', handOffId: null, threadId: 8 },
  /** Rico, on work Ada leads: a plan only. */
  notLead: { staffId: 'rico', handOffId: null, threadId: 2 }
} satisfies Record<string, Place>;
type PlaceName = keyof typeof PLACES;
const ANYWHERE: PlaceName[] = ['none', 'lead', 'handOff', 'leadLeft', 'broughtBack'];

const FOLDER = { path: '/office/papers', level: 'write' } as const;
const REPLY: ReplyDraft = {
  to: ['supplier@example.com'],
  cc: [],
  subject: 'Re: the venue',
  body: 'That date works.',
  summary: 'They asked for a date.'
};
const FILTER: GmailFilter = {
  criteria: { from: 'news@example.com' },
  action: { skipInbox: true },
  summary: 'Newsletters'
};
const CALL: HeldCall = { connector: 'gmail', tool: 'archive', arguments: { id: 'm1' } };
const AT = T0.toISOString();

/**
 * Each ask kind the generator raises: where, with what, and what the office
 * did for a yes it approves by doing. The generator asks for one tool, one
 * folder and one set of switches, so every open ask of one Odd and one of
 * those kinds is a twin of the others.
 */
const RAISE: Record<
  AskKind,
  { at: PlaceName[]; with?: (p: Place) => Partial<NewAsk>; done?: AskDone }
> = {
  approval: { at: ANYWHERE },
  access: { at: ANYWHERE, with: () => ({ access: GMAIL }) },
  hire: { at: ANYWHERE },
  goal: { at: ANYWHERE },
  plan: {
    at: ['lead', 'broughtBack', 'notLead'],
    with: () => ({ plan: { goalId: 1, items: [] } })
  },
  hand_offs: {
    at: ['lead'],
    with: () => ({ held: { from: 'ada', to: 'rico', title: 'Check the menu', brief: 'Please.' } })
  },
  window: { at: ['none'] },
  reply: {
    at: ANYWHERE,
    with: () => ({ reply: REPLY }),
    done: { reply: { ...REPLY, sent: { action: 'send', at: AT, gmailId: 'g1' } } }
  },
  filter: {
    at: ANYWHERE,
    with: () => ({ filter: FILTER }),
    done: { filter: { ...FILTER, created: { at: AT, gmailId: 'f1', tidied: 2 } } }
  },
  folder: {
    at: ANYWHERE,
    with: () => ({ folder: FOLDER }),
    done: { folder: { ...FOLDER, given: FOLDER } }
  },
  switch: { at: ANYWHERE, with: () => ({ switches: ['web'] }) },
  call: {
    at: ANYWHERE,
    with: () => ({ call: CALL }),
    done: { call: { ...CALL, result: { ok: true, text: 'Archived', at: AT } } }
  },
  // Its own leaving.
  remove: { at: ANYWHERE, with: (p) => ({ odd: p.staffId }) },
  bring_back: { at: ANYWHERE, with: () => ({ odd: 'theo' }) },
  catch_up: { at: ['none'] },
  standing: { at: ANYWHERE }
};

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
// Every decision, through the status each gives the ask. office-asks.ts
// reaches the database, so its list is not imported here.
const STATUS_OF: Record<Decision, AskStatus> = {
  approve: 'approved',
  deny: 'denied',
  iterate: 'revise'
};
const DECISIONS = Object.keys(STATUS_OF) as Decision[];

// The test's own record of the office, from the events alone.

type Park =
  | { on: 'none' }
  | { on: 'task'; task: number }
  | { on: 'time'; at: number }
  | { on: 'window'; at: number; ask: number };
type RunRec = {
  id: number;
  staffId: string;
  kind: LiveKind;
  threadId: number | null;
  askId: number | null;
  taskId: number | null;
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
  /** The chat card it replies under, as `ask:7` or `task:3`. */
  card: string | null;
};
type ThreadRec = {
  id: number;
  hub: string;
  holder: string;
  status: 'open' | 'done' | 'failed' | 'stopped';
  park: Park;
  leadsJobGoing: boolean;
};
type AskRec = {
  id: number;
  staffId: string;
  kind: AskKind;
  title: string;
  odd: string | null;
  held: { from: string; to: string; title: string } | null;
  status: AskStatus;
  /** The event it was decided at. */
  decidedAt?: number;
  handOffId: number | null;
  threadId: number | null;
};
type TaskRec = {
  id: number;
  staffId: string | null;
  title: string;
  status: 'open' | 'done' | 'dropped';
  askId: number | null;
  handOffId: number | null;
  threadId: number | null;
  connectors: string[];
};
/** The owner answered in the chat of `staffId`, on the card `card`. */
type Chat = { staffId: string; card: string };
type Poke = { staffId: string; lead: string; title: string };
/** An answer for a lead: the run that should hold the marker, or nothing when the lead left. */
type Delivery = {
  lead: string;
  threadId: number | null;
  kind: 'resume' | 'handed_back';
  marker: string;
  leadLeft: boolean;
};
/** Where an answer is heard: on no work, on work its Odd leads, or on another's. */
type Heard = {
  staffId: string;
  place: 'none' | 'own' | 'other';
  threadId: number | null;
  askIds: number[];
  taskIds: number[];
  marker: string;
  /** A goal's yes, whose planning run is its own write in the transaction. */
  planning: boolean;
  runs: 0 | 1;
};
type Expected = {
  refused?:
    'not waiting' | 'held' | 'ended' | 'not running' | 'answer refused' | 'answered already';
  /** The open item a raise or a gift found already there. */
  already?: number;
  /** The first id a run this event puts gets. */
  firstNew: number;
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
  delivered: Delivery[];
  heard: Heard[];
};
/** The test's own record of the office, and what it expects of the last event. */
type Model = {
  at: number;
  owner: string;
  odds: Map<string, { name: string; level: Level; left: boolean }>;
  threads: Map<number, ThreadRec>;
  runs: Map<number, RunRec>;
  asks: AskRec[];
  tasks: Map<number, TaskRec>;
  owedSent: Set<number>;
  /** How many asks of each kind each place raised, and tasks each giver gave. */
  raised: Map<string, number>;
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

const fresh = (firstNew: number): Expected => ({
  firstNew,
  reports: [],
  pokes: [],
  ended: [],
  handedBack: [],
  delivered: [],
  heard: []
});

const cardOf = (f: FollowUp) => (f.chatCard ? `${f.chatCard.kind}:${f.chatCard.id}` : null);
const parkOf = (p: Park | { on: 'time' | 'window'; at: Date; ask?: number }): Park =>
  p.on === 'none' || p.on === 'task'
    ? p
    : p.on === 'time'
      ? { on: 'time', at: +p.at }
      : { on: 'window', at: +p.at, ask: p.ask! };

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
      taskId: f.taskId,
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
      lines: 0,
      card: cardOf(f)
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
          park: t.status !== 'open' ? { on: 'none' } : parkOf(t.park),
          leadsJobGoing: t.runs.some((k) => rows.runsGoing.has(k))
        }
      ])
    ),
    runs,
    asks: [...rows.asks.values()].map((a) => ({
      id: a.id,
      staffId: a.staffId,
      kind: a.kind,
      title: a.title,
      odd: a.odd,
      held: a.held,
      status: a.status,
      ...(a.status !== 'open' && { decidedAt: 0 }),
      handOffId: a.handOffId,
      threadId: a.threadId
    })),
    tasks: new Map(
      [...rows.tasks.values()].map((k) => [
        k.id,
        {
          id: k.id,
          staffId: k.staffId,
          title: k.title,
          status: k.status,
          askId: k.askId,
          handOffId: k.handOffId,
          threadId: k.threadId,
          connectors: k.steps.flatMap((s) =>
            s.action && 'connector' in s.action ? [s.action.connector] : []
          )
        }
      ])
    ),
    owedSent: new Set(),
    raised: new Map(),
    expected: fresh(0)
  };
}

/** How often a sequence met the case each rule is about; a rule never met proves nothing. */
const met = new Map<string, number>();
const meet = (c: string) => met.set(c, (met.get(c) ?? 0) + 1);

/** The title the owner reads for a run that ended so. */
const titleOf = (r: Model, kind: LiveKind, outcome: Outcome, about: string) =>
  `${OUTCOME_TITLE[kind][outcome].replace('{owner}', r.owner)}: ${about}`;

const left = (r: Model, id: string) => !!r.odds.get(id)?.left;
const askOf = (r: Model, id: number | null) =>
  id === null ? undefined : r.asks.find((a) => a.id === id);

/** Something raised on the thread is still open: an ask, or a task given on it or from an ask raised on it. */
function raisedOpen(r: Model, threadId: number): boolean {
  const raised = r.asks.filter((a) => a.threadId === threadId);
  return (
    raised.some((a) => a.status === 'open') ||
    [...r.tasks.values()].some(
      (k) =>
        k.status === 'open' && (k.threadId === threadId || raised.some((a) => a.id === k.askId))
    )
  );
}

/** Today's rule for where a thread stands, run on the threads an event touches, as today's code does. */
function settle(r: Model, threadId: number | null): void {
  const t = threadId === null ? undefined : r.threads.get(threadId);
  if (t?.status !== 'open') return;
  const on = [...r.runs.values()].filter((f) => f.threadId === t.id);
  const pending = on.filter((f) => f.is !== 'ended').sort((a, b) => b.id - a.id)[0];
  const last = on
    .filter((f) => f.is === 'ended')
    .sort((a, b) => b.doneAt! - a.doneAt! || b.id - a.id)[0];
  t.holder = pending?.staffId ?? t.hub;
  if (pending || t.park.on !== 'none' || !last || raisedOpen(r, t.id)) return;
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
  taskId: null,
  handOff: null,
  reportWhenDone: false,
  is: 'queued' as const,
  unparked: null,
  joined: [],
  lines: 0,
  card: null,
  ...f
});

/** The hand-off a run's work serves: its own, or the one the ask or task it follows was raised in. */
function servedHandOff(r: Model, f: RunRec): RunRec | undefined {
  if (f.kind === 'hand_off') return f;
  if (SERVES_NO_THREAD[f.kind]) return undefined;
  const link =
    f.askId !== null
      ? askOf(r, f.askId)?.handOffId
      : f.taskId !== null
        ? r.tasks.get(f.taskId)?.handOffId
        : null;
  const origin = link == null ? undefined : r.runs.get(link);
  return origin?.kind === 'hand_off' ? origin : undefined;
}

/** The owner answered everything the hand-off raised: it raised an ask or a task, and none is open. */
function answeredAll(r: Model, handOffId: number): boolean {
  const raised = r.asks.filter((a) => a.handOffId === handOffId);
  const tasks = [...r.tasks.values()].filter(
    (k) => k.handOffId === handOffId || raised.some((a) => a.id === k.askId)
  );
  const all = [...raised, ...tasks];
  return all.length > 0 && all.every((a) => a.status !== 'open');
}

function queue(r: Model, e: Extract<WorkEvent, { kind: 'runQueued' }>): void {
  r.owedSent.add(OWED.indexOf(e));
  const o = e.run;
  const raisedOn = o.askId === undefined ? null : (askOf(r, o.askId)?.threadId ?? null);
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
  // A lead's claim lifts a park on a task or a time, never the usage window's hold.
  if (
    t?.status === 'open' &&
    t.hub === f.staffId &&
    (t.park.on === 'task' || t.park.on === 'time')
  ) {
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
  if (k && k.status !== 'open') {
    meet('a park given back on a task that ended');
    // A done task an Odd gave starts that Odd's own run as it ends, before this wake.
    wake(r, k.id, k.status === 'done' && k.staffId !== null);
  }
}

/**
 * An answer reaches a thread's lead, as today: it joins the lead's oldest
 * queued resume there, a line, or starts one; nothing for a lead that left.
 * The chat card goes only to a lead whose chat it is, and a join takes it.
 */
function answerLead(
  r: Model,
  threadId: number,
  marker: string,
  o: { askId?: number; chat?: Chat } = {}
): number | undefined {
  const lead = r.threads.get(threadId)!.hub;
  const leadLeft = left(r, lead);
  r.expected.delivered.push({ lead, threadId, kind: 'resume', marker, leadLeft });
  if (leadLeft) {
    meet('an answer for a lead that left');
    return undefined;
  }
  const card = o.chat?.staffId === lead ? o.chat.card : null;
  if (o.chat && !card) meet("a chat answer reaching another Odd's pick-up, which takes no card");
  const mine = [...r.runs.values()]
    .filter((f) => f.staffId === lead && f.threadId === threadId && f.kind === 'resume')
    .sort((a, b) => a.id - b.id);
  const waiting = mine.find((f) => f.is === 'queued');
  if (waiting) {
    waiting.lines++;
    meet("an answer joining a lead's queued pick-up");
    if (card) {
      waiting.card = card;
      meet('a chat answer joining a pick-up, which takes its card');
    }
    return waiting.id;
  }
  meet(
    mine.some((f) => f.is === 'ended')
      ? 'an answer to a lead whose pick-up there ended starts a new one'
      : "an answer starting a lead's pick-up"
  );
  return insert(
    r,
    newRun({ staffId: lead, kind: 'resume', threadId, askId: o.askId ?? null, card, lines: 1 })
  );
}

/** The task ended: every open thread parked on it picks up, its lead told in a queued resume. */
function wake(r: Model, taskId: number, ownRunEarlier: boolean): void {
  const k = r.tasks.get(taskId)!;
  for (const t of [...r.threads.values()].sort((a, b) => a.id - b.id)) {
    if (t.status !== 'open' || t.park.on !== 'task' || t.park.task !== taskId) continue;
    t.park = { on: 'none' };
    const runId = answerLead(r, t.id, `"${k.title}"`);
    if (runId !== undefined) r.expected.wake = { runId, title: k.title, ownRunEarlier };
  }
}

/** An answer goes back to the hand-off or thread it was raised on; false when it was raised on neither. */
function answerBack(
  r: Model,
  on: { handOffId: number | null; threadId: number | null; askId?: number },
  back: { outcome: Outcome; marker: string; chat?: Chat }
): boolean {
  if (on.handOffId) {
    const origin = r.runs.get(on.handOffId);
    if (origin?.kind !== 'hand_off') return true;
    const lead = origin.handOff!.from;
    const leadLeft = left(r, lead);
    r.expected.delivered.push({
      lead,
      threadId: origin.threadId,
      kind: 'handed_back',
      marker: back.marker,
      leadLeft
    });
    if (leadLeft) {
      meet('an answer for a lead that left');
      return true;
    }
    meet('an answer handed back to the lead that handed on the work');
    r.expected.handedBack.push({
      staffId: lead,
      from: origin.staffId,
      outcome: back.outcome,
      threadId: origin.threadId
    });
    insert(
      r,
      newRun({
        staffId: lead,
        kind: 'handed_back',
        threadId: origin.threadId,
        handOff: {
          from: origin.staffId,
          title: origin.handOff!.title,
          outcome: back.outcome,
          answered: true
        },
        lines: 1
      })
    );
    return true;
  }
  if (on.threadId === null) return false;
  answerLead(r, on.threadId, back.marker, { askId: on.askId, chat: back.chat });
  return true;
}

/** A run an answer owes an Odd, on the thread its ask or task was raised on unless its kind serves none. */
function oweRun(
  r: Model,
  o: {
    staffId: string;
    kind: LiveKind;
    askId?: number;
    taskId?: number;
    lines: number;
    chat?: Chat;
  }
): void {
  const raisedOn = SERVES_NO_THREAD[o.kind]
    ? null
    : o.askId !== undefined
      ? (askOf(r, o.askId)?.threadId ?? null)
      : o.taskId !== undefined
        ? (r.tasks.get(o.taskId)?.threadId ?? null)
        : null;
  const card = o.chat?.staffId === o.staffId ? o.chat.card : null;
  if (card) meet("a chat answer carried under its card by its own Odd's run");
  insert(
    r,
    newRun({
      staffId: o.staffId,
      kind: o.kind,
      threadId: raisedOn,
      askId: o.askId ?? null,
      taskId: o.taskId ?? null,
      lines: o.lines,
      card
    })
  );
}

/** One carry-out per place a result goes back to: a hand-off's first, then a thread's, and no work's only alone. */
function carryOuts(r: Model, together: AskRec[], chat?: Chat): void {
  const rank = (a: AskRec) => (a.handOffId ? 0 : a.threadId ? 1 : 2);
  const places = new Set<string>();
  let started = 0;
  if (together.length > 1 && chat) meet('twins answered in chat, under the asked one only');
  for (const a of [...together].sort((p, q) => rank(p) - rank(q) || p.id - q.id)) {
    const place = a.handOffId
      ? `hand-off ${a.handOffId}`
      : a.threadId
        ? `thread ${a.threadId}`
        : '';
    if (places.has(place) || (place === '' && started > 0)) continue;
    places.add(place);
    started++;
    oweRun(r, {
      staffId: a.staffId,
      kind: 'carry_out',
      askId: a.id,
      lines: 0,
      chat: chat?.card === `ask:${a.id}` ? chat : undefined
    });
  }
}

/** The answer to items raised on no work reaches their Odd once, unless this change already starts it a run for one. */
function offWorkAnswer(
  r: Model,
  o: { staffId: string; item: 'ask' | 'task'; ids: number[]; asked: number; chat?: Chat }
): void {
  if (!o.ids.length || left(r, o.staffId)) return;
  const started = [...r.runs.values()].some(
    (f) =>
      f.id >= r.expected.firstNew &&
      f.staffId === o.staffId &&
      o.ids.includes((o.item === 'ask' ? f.askId : f.taskId) ?? -1)
  );
  if (started) return;
  const id = o.ids.includes(o.asked) ? o.asked : Math.min(...o.ids);
  oweRun(r, {
    staffId: o.staffId,
    kind: 'answered',
    ...(o.item === 'ask' ? { askId: id } : { taskId: id }),
    lines: 1,
    chat: id === o.asked ? o.chat : undefined
  });
}

/** Done or failed work opens again for something raised on it; stopped work only for a plan. */
function raisedOn(r: Model, threadId: number, plan: boolean): void {
  const t = r.threads.get(threadId)!;
  if (t.status === 'done' || t.status === 'failed' || (plan && t.status === 'stopped')) {
    meet(t.status === 'stopped' ? 'a plan opening stopped work again' : 'ended work opened again');
    t.status = 'open';
    t.park = { on: 'none' };
  }
  settle(r, threadId);
}

/** Each place raises each kind at most twice, so twins and a repeated held call happen, and the draw stays varied. */
const raiseKey = (a: Pick<NewAsk, 'kind' | 'staffId' | 'handOffId' | 'threadId'>) =>
  show([a.kind, a.staffId, a.handOffId ?? null, a.threadId ?? null]);
const giveKey = (k: NewTask) => show([k.staffId, k.handOffId ?? null, k.threadId ?? null, k.steps]);
const count = (r: Model, key: string) => r.raised.set(key, (r.raised.get(key) ?? 0) + 1);

function raise(r: Model, a: NewAsk): void {
  count(r, raiseKey(a));
  // The generator holds one call, so an open call of the same Odd is the same call.
  const same =
    a.kind === 'call'
      ? r.asks.find((k) => k.staffId === a.staffId && k.kind === 'call' && k.status === 'open')
      : undefined;
  if (same) {
    r.expected.already = same.id;
    meet('a held call raised again while it is open');
    return;
  }
  r.asks.push({
    id: Math.max(...r.asks.map((k) => k.id)) + 1,
    staffId: a.staffId,
    kind: a.kind,
    title: a.title,
    odd: a.odd ?? null,
    held: a.held ?? null,
    status: 'open',
    handOffId: a.handOffId ?? null,
    threadId: a.threadId ?? null
  });
  if (a.threadId) raisedOn(r, a.threadId, !!a.plan);
}

/** What an answer to an ask does, a step at a time, in the order the code takes them. */
type Step =
  | 'carryOut'
  | 'carryOuts'
  | 'rework'
  | 'held'
  | 'handOffs'
  | 'window'
  | 'back'
  | 'lesson'
  | 'planning'
  | 'leaves';
const NO: Step[] = ['back', 'lesson'];
/**
 * Today's answers to each kind of ask, written out, and when the rule that
 * every answer is heard lets one go unheard by any run, whatever its place.
 * A kind with no `sendBack` refuses Iterate.
 */
const KINDS: Record<
  AskKind,
  {
    yes: Step[];
    no: Step[];
    sendBack: boolean;
    unheard?: (o: { yes: boolean; reason: string | null }) => boolean;
  }
> = {
  approval: { yes: ['carryOut'], no: NO, sendBack: true },
  // Its yes reaches the Odd through the grant, after the commit.
  access: { yes: [], no: NO, sendBack: true, unheard: (o) => o.yes },
  hire: { yes: ['back'], no: NO, sendBack: true },
  goal: { yes: ['planning', 'back'], no: NO, sendBack: true },
  plan: { yes: ['planning', 'back'], no: NO, sendBack: true },
  // A yes with no words is heard through the held hand-off's result.
  hand_offs: {
    yes: ['held', 'handOffs'],
    no: ['handOffs', 'lesson'],
    sendBack: false,
    unheard: (o) => o.yes && !o.reason
  },
  // The office's own: a yes reaches the held work's leads, and a no nobody.
  window: { yes: ['window'], no: [], sendBack: false, unheard: () => true },
  reply: { yes: ['back'], no: NO, sendBack: true },
  filter: { yes: ['back'], no: NO, sendBack: true },
  folder: { yes: ['carryOuts'], no: NO, sendBack: true },
  switch: { yes: ['carryOuts'], no: NO, sendBack: true },
  call: { yes: ['carryOut'], no: NO, sendBack: true },
  remove: { yes: ['back', 'leaves'], no: NO, sendBack: false },
  bring_back: { yes: ['back'], no: NO, sendBack: false },
  // The office's own: a yes owes the job its missed runs, and a no needs nothing.
  catch_up: { yes: [], no: [], sendBack: false, unheard: () => true },
  standing: { yes: ['back'], no: NO, sendBack: false }
};

const WINDOW_MARKER = 'until the usage window resets';

function decideAsk(r: Model, e: EventOf<'askDecided'>): void {
  const x = r.expected;
  const a = askOf(r, e.id)!;
  const how = KINDS[a.kind];
  const yes = e.decision === 'approve';
  if (
    (e.decision === 'iterate' && (!e.reason || !how.sendBack)) ||
    (yes && RAISE[a.kind].done && !e.done)
  ) {
    x.refused = 'answer refused';
    meet('an answer refused before the ask closes');
    return;
  }
  if (a.status !== 'open') {
    x.refused = 'answered already';
    meet('an answer to an ask answered already');
    return;
  }
  const reason = e.reason || null;
  const twins =
    TWINNED.includes(a.kind) && e.decision !== 'iterate'
      ? r.asks.filter(
          (k) =>
            k.status === 'open' && k.id !== a.id && k.staffId === a.staffId && k.kind === a.kind
        )
      : [];
  for (const k of [a, ...twins]) {
    k.status = STATUS_OF[e.decision];
    k.decidedAt = r.at;
  }
  const chat = e.inChat ? { staffId: a.staffId, card: `ask:${a.id}` } : undefined;
  const marker = `"${a.title}"`;
  const outcome: Outcome = e.decision === 'deny' ? 'failed' : 'done';
  const offWork: AskRec[] = [];
  const steps: Step[] = e.decision === 'iterate' ? ['rework'] : yes ? how.yes : how.no;
  for (const step of steps)
    switch (step) {
      case 'carryOut':
        oweRun(r, {
          staffId: a.staffId,
          kind: 'carry_out',
          askId: a.id,
          lines: reason ? 1 : 0,
          chat
        });
        break;
      case 'carryOuts':
        carryOuts(r, [a, ...twins], chat);
        break;
      case 'rework':
        oweRun(r, { staffId: a.staffId, kind: 'rework', askId: a.id, lines: 1, chat });
        break;
      case 'held':
        if (a.held && a.threadId !== null) handOn(r, a.threadId, a.held);
        break;
      case 'handOffs':
        if (a.threadId !== null) answerHandOffs(r, a, { yes, reason, marker });
        else if (!answerBack(r, a, { outcome, marker })) offWork.push(a);
        break;
      case 'window':
        if (yes) answerWindow(r, a);
        break;
      case 'back':
        if (twins.length > 0 && chat) meet('twins answered in chat, under the asked one only');
        for (const k of [a, ...twins])
          if (
            !answerBack(
              r,
              { ...k, askId: k.id },
              { outcome, marker, chat: k === a ? chat : undefined }
            )
          )
            offWork.push(k);
        break;
      case 'lesson':
        if (reason && !e.withdrawn)
          oweRun(r, { staffId: a.staffId, kind: 'denied', askId: a.id, lines: 1 });
        break;
      case 'planning':
      case 'leaves':
        break;
      default:
        step satisfies never;
    }
  const ownLeave = steps.includes('leaves') && a.odd === a.staffId;
  if (!e.withdrawn && !steps.includes('planning') && !ownLeave)
    offWorkAnswer(r, {
      staffId: a.staffId,
      item: 'ask',
      ids: offWork.map((k) => k.id),
      asked: a.id,
      chat
    });
  hearAsk(r, { a, twins, steps, yes, reason, withdrawn: !!e.withdrawn, ownLeave });
}

/** Which runs of the Odd that raised it hear an answer, by place, from the record alone. */
function hearAsk(
  r: Model,
  o: {
    a: AskRec;
    twins: AskRec[];
    steps: Step[];
    yes: boolean;
    reason: string | null;
    withdrawn: boolean;
    ownLeave: boolean;
  }
): void {
  const { a, steps } = o;
  if (o.withdrawn || left(r, a.staffId)) return;
  const groups = new Map<string, AskRec[]>();
  for (const k of [a, ...o.twins]) {
    const key = k.handOffId ? `hand-off ${k.handOffId}` : `thread ${k.threadId}`;
    groups.set(key, [...(groups.get(key) ?? []), k]);
  }
  const excepted = KINDS[a.kind].unheard?.({ yes: o.yes, reason: o.reason }) ?? false;
  const starts = steps.some((s) => s === 'carryOut' || s === 'carryOuts' || s === 'rework');
  for (const group of groups.values()) {
    const g = group[0];
    const place = g.handOffId
      ? 'other'
      : g.threadId === null
        ? 'none'
        : r.threads.get(g.threadId)!.hub === a.staffId
          ? 'own'
          : 'other';
    let runs: 0 | 1 = 1;
    if (excepted) {
      runs = 0;
      meet('an answer its kind lets go unheard');
    } else if (place === 'none' && o.ownLeave) {
      runs = 0;
      meet("a yes to an Odd's own leaving, raised on no work");
    } else if (place === 'none' && steps.includes('carryOuts') && groups.size > 1) {
      runs = 0;
      meet('twins on no work carried out at another place');
    } else if (place === 'other' && !starts) continue;
    if (runs === 1) meet(`an answer heard on ${place} work`);
    if (group.length > 1 && runs === 1) meet('twins at one place heard once');
    if (place === 'none' && steps.includes('lesson') && o.reason && runs === 1)
      meet('an answer on no work heard by the lesson run');
    const planning = place === 'none' && steps.includes('planning');
    if (planning) meet("a goal's yes heard by its planning run");
    r.expected.heard.push({
      staffId: a.staffId,
      place,
      threadId: g.threadId,
      askIds: group.map((k) => k.id),
      taskIds: [],
      marker: `"${a.title}"`,
      planning,
      runs
    });
  }
}

/** A held hand-off starts as the first of a new round; done or failed work opens again for it. */
function handOn(r: Model, threadId: number, held: NonNullable<AskRec['held']>): void {
  const t = r.threads.get(threadId)!;
  if (t.status === 'done' || t.status === 'failed') {
    t.status = 'open';
    t.park = { on: 'none' };
  }
  insert(
    r,
    newRun({
      staffId: held.to,
      kind: 'hand_off',
      threadId,
      handOff: { from: held.from, title: held.title }
    })
  );
}

/** A no stops the work and tells its lead; a yes tells the lead only when the owner wrote something. */
function answerHandOffs(
  r: Model,
  a: AskRec,
  o: { yes: boolean; reason: string | null; marker: string }
): void {
  const t = r.threads.get(a.threadId!)!;
  if (!o.yes) {
    t.status = 'stopped';
    t.park = { on: 'none' };
    meet('a no to more hand-offs stops the work');
  } else if (a.held && !o.reason) return;
  answerLead(r, t.id, o.marker, { askId: a.id });
}

/** A yes to the usage window frees every open thread it holds and tells each one's lead. */
function answerWindow(r: Model, a: AskRec): void {
  const held = [...r.threads.values()]
    .filter((t) => t.status === 'open' && t.park.on === 'window' && t.park.ask === a.id)
    .sort((p, q) => p.id - q.id);
  for (const t of held) t.park = { on: 'none' };
  for (const t of held) answerLead(r, t.id, WINDOW_MARKER, { askId: a.id });
}

function give(r: Model, e: EventOf<'taskGiven'>): void {
  const k = e.task;
  count(r, giveKey(k));
  const one = e.oneOpen;
  const there = one
    ? [...r.tasks.values()]
        .sort((p, q) => p.id - q.id)
        .find(
          (t) =>
            t.status === 'open' &&
            (k.staffId === null || t.staffId === k.staffId) &&
            t.connectors.includes(one.connector)
        )
    : undefined;
  if (there) {
    r.expected.already = there.id;
    meet('a connect task given while one is open');
    return;
  }
  const id = Math.max(...r.tasks.keys()) + 1;
  r.tasks.set(id, {
    id,
    staffId: k.staffId,
    title: k.title,
    status: 'open',
    askId: k.askId ?? null,
    handOffId: k.handOffId ?? null,
    threadId: k.threadId ?? null,
    connectors: k.steps.flatMap((s) =>
      s.action && 'connector' in s.action ? [s.action.connector] : []
    )
  });
  if (k.threadId) raisedOn(r, k.threadId, false);
}

/** The asks one answer settled with `from`: the same Odd and kind, decided at the same event the same way. */
const answeredWith = (r: Model, from: AskRec) =>
  r.asks.filter(
    (k) =>
      k.id !== from.id &&
      k.staffId === from.staffId &&
      k.kind === from.kind &&
      k.status !== 'open' &&
      k.status === from.status &&
      k.decidedAt === from.decidedAt
  );

function endTask(r: Model, e: EventOf<'taskEnded'>): void {
  const t = r.tasks.get(e.id)!;
  if (t.status !== 'open') {
    r.expected.refused = 'answered already';
    meet('an end of a task ended already');
    return;
  }
  const done = e.ended === 'done';
  t.status = done ? 'done' : 'dropped';
  const marker = `"${t.title}"`;
  const chat = e.inChat && t.staffId ? { staffId: t.staffId, card: `task:${t.id}` } : undefined;
  const from = askOf(r, t.askId);
  const fromAccess = done && from?.kind === 'access';
  const on = {
    handOffId: t.handOffId ?? from?.handOffId ?? null,
    threadId: t.threadId ?? from?.threadId ?? null
  };
  if (!done) {
    // To a thread or a hand-off it carries no chat card.
    const went = answerBack(r, on, { outcome: 'failed', marker });
    if (went && e.inChat) meet('a task answered in chat going back to work, with no card');
    if (!went && t.staffId && e.ended !== 'withdrawn')
      offWorkAnswer(r, { staffId: t.staffId, item: 'task', ids: [t.id], asked: t.id, chat });
  } else if (t.staffId && fromAccess) carryOuts(r, [from!, ...answeredWith(r, from!)]);
  else if (t.staffId)
    oweRun(r, { staffId: t.staffId, kind: 'task_done', taskId: t.id, lines: e.note ? 1 : 0, chat });
  wake(r, t.id, false);

  if (e.ended === 'withdrawn' || !t.staffId || left(r, t.staffId)) return;
  const place = on.handOffId
    ? 'other'
    : on.threadId === null
      ? 'none'
      : r.threads.get(on.threadId)!.hub === t.staffId
        ? 'own'
        : 'other';
  if (place === 'other' && !done) return;
  meet(`a task's end heard on ${place} work`);
  r.expected.heard.push({
    staffId: t.staffId,
    place,
    threadId: on.threadId,
    askIds: fromAccess ? [from!.id, ...answeredWith(r, from!).map((k) => k.id)] : [],
    taskIds: [t.id],
    marker,
    planning: false,
    runs: 1
  });
}

/** A tool's connect tasks are dropped, and the work parked on each wakes; nobody else is told. */
function dropConnectTasks(r: Model, e: EventOf<'connectTasksDropped'>): void {
  const stale = [...r.tasks.values()]
    .filter(
      (t) =>
        t.status === 'open' &&
        (e.staffId === undefined || t.staffId === e.staffId) &&
        t.connectors.includes(e.connector)
    )
    .sort((p, q) => p.id - q.id);
  for (const t of stale) t.status = 'dropped';
  if (stale.length > 0) meet("a tool's connect tasks dropped");
  for (const t of stale) wake(r, t.id, false);
}

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
const show = (v: unknown) => JSON.stringify(v);
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
