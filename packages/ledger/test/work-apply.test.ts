// The work core's database side: the loader reads what a decider needs under
// its locks, and `applyWork` writes a change so the rows read back equal the
// rows `applyChange` gives in memory. PGlite runs one transaction at a time,
// so the lock tests here prove which rows are locked and in what order, not
// that a second transaction waits. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { desc, eq, sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Level } from '../src/access-words.ts';
import type { Decision } from '../src/office-asks.ts';
import {
  asks,
  attachments,
  followUps,
  goals,
  jobs,
  owner,
  planLimits,
  pokes,
  reports,
  staff,
  tasks,
  threads,
  type HandOff,
  type Step
} from '../src/schema.ts';
import { random } from '../src/sequences.ts';
import type { Tx } from '../src/threads.ts';
import type { After, Decided } from '../src/transition.ts';
import { decide } from '../src/work/decide.ts';
import type {
  AskEffects,
  EventOf,
  LeaveEffects,
  WorkEvent,
  WorkResults
} from '../src/work/events.ts';
import {
  applyChange,
  type Change,
  type Odd,
  type Put,
  type WorkRows
} from '../src/work/snapshot.ts';
import { parseAsk, parseFollowUp, parseTask, parseThread } from '../src/work/state.ts';
import { newRun } from '../src/work/threads.ts';
import { db } from './pglite.ts';

// Nothing answers here, so a ledger line is written with no embedding.
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { LOCK_ORDER, transition } = await import('../src/transition.ts');
const { loadWork, queuedRows } = await import('../src/work/load.ts');
const { applyWork } = await import('../src/work/apply.ts');
const { threadPart } = await import('../src/threads.ts');
// The office's own handle, which is PGlite's here, so a transaction has the type the core takes.
const { db: officeDb } = await import('../src/db.ts');
const { networkNote } = await import('../src/office-staff.ts');
const { gaveFolder } = await import('../src/office-folders.ts');
const { MANAGER_ROLE } = await import('../src/managers.ts');

/** Sequences per run; `WORK_APPLY_SEEDS` runs more. Sized so the file stays well under 5 seconds. */
const SEEDS = Number(process.env.WORK_APPLY_SEEDS ?? 2);
const LENGTH = 60;
const T0 = new Date('2026-11-12T09:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const OWNER = 'Sam';

const ODDS: Odd[] = [
  { id: 'lia', name: 'Lia', level: 'act', leftAt: null },
  { id: 'cal', name: 'Cal', level: 'draft', leftAt: null },
  { id: 'rae', name: 'Rae', level: 'read', leftAt: null },
  { id: 'gus', name: 'Gus', level: 'act', leftAt: minutes(-60) },
  { id: 'kit', name: 'Kit', level: 'read', leftAt: null }
].map((o) => ({ ...o, level: o.level as Level, agent: 'claude', manager: false }));

const handOff = (from: string, more: Partial<HandOff> = {}): HandOff => ({
  from,
  title: `Work from ${from}`,
  brief: 'Do it.',
  ...more
});

/**
 * One office with a run in each state the runs family decides: queued and
 * running pick-ups, a colleague's hand-off with an open ask on it, a result
 * from one that left, a thread parked on an open task, a running pick-up
 * whose lifted task ended meanwhile, work whose lead left, and work that
 * nothing names but its lead.
 */
async function seedOffice(): Promise<void> {
  await db.execute(
    sql`truncate staff, threads, follow_ups, asks, tasks, reports, pokes, goals, attachments, jobs, ledger, owner, plan_limits restart identity cascade`
  );
  await db.insert(owner).values({ name: OWNER });
  await db.insert(staff).values(
    ODDS.map((o) => ({
      id: o.id,
      name: o.name,
      role: 'r',
      variant: 'v',
      portrait: 'p',
      remit: 'r',
      desk: 'd',
      agent: o.agent,
      permission: o.level,
      leftAt: o.leftAt
    }))
  );
  const task = { why: 'w', steps: [], createdAt: T0 };
  // 1: open, the park of thread 1. 2: done while run 2 ran, which lifted it.
  await db.insert(tasks).values([
    { ...task, staffId: 'lia', title: 'Sign the form' },
    { ...task, staffId: 'lia', title: 'Read the draft', status: 'done', doneAt: minutes(-5) }
  ]);
  const thread = (hubId: string, title: string) => ({
    hubId,
    holderId: hubId,
    title,
    createdAt: T0
  });
  await db
    .insert(threads)
    .values([
      { ...thread('lia', 'Parked work'), resumeOnTask: 1 },
      { ...thread('lia', 'Results coming back') },
      { ...thread('gus', 'Work its lead left'), status: 'stopped', endedAt: minutes(-60) },
      { ...thread('lia', 'Colleagues at work') },
      { ...thread('lia', 'A run goes here'), runs: ['k1'] },
      { ...thread('lia', 'Parked on the ended task'), resumeOnTask: 2 }
    ]);
  // Asks before runs, which point at them; an ask names its hand-off with no key.
  const ask = { why: 'w', ifApproved: 'i', createdAt: T0, threadId: 4 };
  await db.insert(asks).values([
    { ...ask, staffId: 'cal', title: 'May I?', handOffId: 6 },
    {
      ...ask,
      staffId: 'cal',
      title: 'Approved one',
      handOffId: 8,
      status: 'approved',
      decidedAt: minutes(-2)
    }
  ]);
  const run = { createdAt: T0 };
  const started = { startedAt: minutes(-10) };
  await db.insert(followUps).values([
    { ...run, staffId: 'lia', kind: 'resume', threadId: 1 },
    {
      ...run,
      ...started,
      staffId: 'lia',
      kind: 'handed_back',
      threadId: 2,
      unparkedTask: 2,
      handOff: handOff('cal', { outcome: 'done', id: 3 })
    },
    {
      ...run,
      ...started,
      staffId: 'cal',
      kind: 'hand_off',
      threadId: 2,
      handOff: handOff('lia'),
      outcome: 'done',
      result: 'Done.',
      doneAt: minutes(-20)
    },
    {
      ...run,
      staffId: 'lia',
      kind: 'handed_back',
      threadId: 2,
      handOff: handOff('rae', { outcome: 'done' })
    },
    {
      ...run,
      staffId: 'lia',
      kind: 'handed_back',
      threadId: 2,
      handOff: handOff('cal', { outcome: 'failed' })
    },
    { ...run, ...started, staffId: 'cal', kind: 'hand_off', threadId: 4, handOff: handOff('lia') },
    { ...run, staffId: 'rae', kind: 'hand_off', threadId: 4, handOff: handOff('lia') },
    { ...run, staffId: 'cal', kind: 'hand_off', threadId: 4, handOff: handOff('lia') },
    { ...run, staffId: 'cal', kind: 'carry_out', threadId: 4, askId: 2 },
    {
      ...run,
      ...started,
      staffId: 'gus',
      kind: 'handed_back',
      threadId: 3,
      handOff: handOff('cal', { outcome: 'done' })
    },
    { ...run, ...started, staffId: 'rae', kind: 'hand_off', threadId: 3, handOff: handOff('gus') },
    { ...run, staffId: 'lia', kind: 'resume', threadId: 5 },
    { ...run, staffId: 'cal', kind: 'answered', reportWhenDone: true },
    {
      ...run,
      staffId: 'rae',
      kind: 'task_done',
      taskId: 2,
      outcome: 'failed',
      result: 'Rae left.',
      doneAt: minutes(-30)
    }
  ]);
  await seedAnswers();
  // 10: no run, ask or task names it, so only the search for the work an Odd leads finds it.
  await db
    .insert(threads)
    .values({ hubId: 'kit', holderId: 'kit', title: 'Kit alone', createdAt: T0 });
}

const FOLDER = { path: '/srv/plans', level: 'read' } as const;
const SLACK_POST = { connector: 'slack', tool: 'post', arguments: { text: 'Hello.' } };
const HELD = { from: 'lia', to: 'rae', title: 'Check the figures', brief: 'Check them.' };
const DRIVE_STEP: Step = {
  text: 'Sign in',
  done: false,
  action: { kind: 'oauth', connector: 'drive' }
};
const AWS_STEP: Step = {
  text: 'Add the keys',
  done: false,
  action: { kind: 'aws', connector: 'aws' }
};

/**
 * What the owner has to answer, beside the runs: an access ask and its twin
 * off any work, a folder, a switch, a held hand-off, the usage window's ask
 * holding work, a held call, an ask of an Odd that left, an answered
 * access ask with its twin whose connect task has work parked on it, and an
 * ask to bring back the Odd that left.
 */
async function seedAnswers(): Promise<void> {
  const ask = { why: 'w', ifApproved: 'i', createdAt: T0 };
  const gmail = { connector: 'gmail', level: 'read' } as const;
  const drive = { connector: 'drive', level: 'read' } as const;
  const decided = { status: 'approved', decidedAt: minutes(-3) } as const;
  // 3 to 13. Thread 7 is the window's hold and 8 the held hand-off's work, put in below.
  await db.insert(asks).values([
    { ...ask, staffId: 'cal', kind: 'access', title: 'Gmail', access: gmail, threadId: 2 },
    { ...ask, staffId: 'cal', kind: 'access', title: 'Gmail again', access: gmail },
    { ...ask, staffId: 'rae', kind: 'folder', title: 'The plans', folder: FOLDER },
    {
      ...ask,
      staffId: 'cal',
      kind: 'switch',
      title: 'Commands',
      switches: ['commands', 'web'],
      threadId: 4
    },
    { ...ask, staffId: 'lia', kind: 'hand_offs', title: 'One more', threadId: 8, held: HELD },
    { ...ask, staffId: 'lia', kind: 'window', title: 'Carry on?' },
    { ...ask, staffId: 'cal', kind: 'call', title: 'Post it', call: SLACK_POST },
    { ...ask, staffId: 'gus', title: 'Before I went' },
    { ...ask, ...decided, staffId: 'cal', kind: 'access', title: 'Drive', access: drive },
    {
      ...ask,
      ...decided,
      staffId: 'cal',
      kind: 'access',
      title: 'Drive too',
      access: drive,
      threadId: 4
    },
    { ...ask, staffId: 'lia', kind: 'bring_back', odd: 'gus', title: 'Bring Gus back?' }
  ]);
  const task = { why: 'w', createdAt: T0 };
  // 3: the connect task of ask 11; 4: on work; 5: the office's own.
  await db.insert(tasks).values([
    { ...task, staffId: 'cal', askId: 11, title: 'Connect Drive', steps: [DRIVE_STEP] },
    { ...task, staffId: 'rae', title: 'Look it over', steps: [], threadId: 2 },
    { ...task, staffId: null, title: 'Connect AWS', steps: [AWS_STEP] }
  ]);
  const thread = (hubId: string, title: string) => ({
    hubId,
    holderId: hubId,
    title,
    createdAt: T0
  });
  await db
    .insert(threads)
    .values([
      { ...thread('lia', 'Held for the window'), resumeAt: minutes(120), heldBy: 8 },
      { ...thread('lia', 'A hand-off waits on a yes') },
      { ...thread('cal', 'Parked on a connect task'), resumeOnTask: 3 }
    ]);
}

/** The four tables a change puts rows in, by their names in the database. */
const TABLES = {
  threads: 'threads',
  asks: 'asks',
  tasks: 'tasks',
  followUps: 'follow_ups'
} as const;
type Table = keyof typeof TABLES;
const TABLE_KEYS = Object.keys(TABLES) as Table[];

/** Every row of the four tables, as states. */
async function readRows(): Promise<Pick<WorkRows, Table>> {
  const byId = <T extends { id: number }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  return {
    threads: byId((await db.select().from(threads)).map(parseThread)),
    followUps: byId((await db.select().from(followUps)).map(parseFollowUp)),
    asks: byId((await db.select().from(asks)).map(parseAsk)),
    tasks: byId((await db.select().from(tasks)).map(parseTask))
  };
}

/** The whole office in memory, as a loader that read everything would give it. */
async function readWorld(): Promise<WorkRows> {
  return {
    ...(await readRows()),
    staff: new Map(ODDS.map((o) => [o.id, o])),
    window: null,
    runsGoing: new Set(),
    owner: OWNER,
    prepared: {}
  };
}

/**
 * Moves each table's serial into a band of its own, past the ids a decider
 * guesses for new rows (the next after the highest it loaded), so a guessed
 * id written anywhere, or an id taken from the wrong table, shows. Gives the
 * id each table's next row gets.
 */
async function idsOffset(rows: Pick<WorkRows, Table>): Promise<Record<Table, number>> {
  const next = { threads: 0, asks: 0, tasks: 0, followUps: 0 };
  for (const [i, table] of TABLE_KEYS.entries()) {
    // One change inserts far fewer than 100 rows into a table, so no guess reaches the serial.
    const last = Math.max((i + 1) * 1_000_000, ...rows[table].keys()) + 100;
    await db.execute(sql`select setval(pg_get_serial_sequence(${TABLES[table]}, 'id'), ${last})`);
    next[table] = last + 1;
  }
  return next;
}

/**
 * The rows `change` leaves in memory, each new row at the id the database
 * gives it next. `applyChange` gives a new row the id after its table's
 * highest, so a stand-in row just below the serial's next id, taken out
 * after, makes each new row's id, and each id pointing at it, the real one.
 */
function applyAtSerials(rows: WorkRows, change: Change, next: Record<Table, number>): WorkRows {
  const standIn = <T>(m: Map<number, T>, id: number) => new Map(m).set(id, [...m.values()][0]);
  const after = applyChange(
    {
      ...rows,
      threads: standIn(rows.threads, next.threads - 1),
      asks: standIn(rows.asks, next.asks - 1),
      tasks: standIn(rows.tasks, next.tasks - 1),
      followUps: standIn(rows.followUps, next.followUps - 1)
    },
    change
  );
  for (const table of TABLE_KEYS) after[table].delete(next[table] - 1);
  return after;
}

/** The real ids `applyWork` gives for the rows a written change names. */
type RealId = Awaited<ReturnType<typeof applyWork>>;

/**
 * One event through the shell, on the office's database, with the core's own
 * loader and writer, the rows it loaded, and the real ids of a change it wrote.
 */
async function run(
  e: WorkEvent,
  now: Date
): Promise<{ got: Decided<Change>; loaded: WorkRows; real: RealId | undefined }> {
  let loaded: WorkRows | undefined;
  let real: RealId | undefined;
  const got = await officeDb.transaction((tx) =>
    transition(
      {
        name: e.kind,
        load: async (q: Tx) => (loaded = await loadWork(q, e)),
        decide: (rows: WorkRows, at: Date) => decide(rows, e, at),
        apply: async (q: Tx, c: Change) => {
          real = await applyWork(q, c);
        }
      },
      // The shell hands the after-effects back unrun: the effects test below runs them.
      { tx, now }
    )
  );
  if (!loaded) throw new Error('The shell decided without loading.');
  return { got, loaded, real };
}

/** An after-effect that runs a closure, by its name: a closure made in each decide is a new function. */
const named = (d: Decided<Change>) =>
  'change' in d
    ? { ...d, after: d.after.map((a: After) => ('record' in a ? a : { then: a.then })) }
    : d;

/**
 * A decision with its puts left out, for the sequences, which compare the
 * puts by the rows they leave: a decider guesses a new row's id from the
 * rows it read, so the loaded rows and the whole office guess apart, and a
 * row pointing at a new one holds that guess until the apply writes the
 * real id.
 */
const unput = (d: Decided<Change>) => {
  const n = named(d);
  return 'change' in n ? { ...n, change: { ...n.change, put: [] } } : n;
};

/** Each call an answer's effects make, by name. No decider may make one: the shell runs them after the commit. */
const calls: string[] = [];
const fakes: AskEffects = {
  grantAccess: async (staffId) => {
    calls.push(`grantAccess ${staffId}`);
    return { task: false, connector: 'gmail' };
  },
  pointAsksAtConnector: async (ids) => void calls.push(`pointAsksAtConnector ${ids.join(' ')}`),
  carryOutTogether: async (together) =>
    void calls.push(`carryOutTogether ${together.map((a) => a.id).join(' ')}`),
  oweCatchUp: async (a) => void calls.push(`oweCatchUp ${a.id}`),
  removeOdd: async (id) => void calls.push(`removeOdd ${id}`),
  bringBack: async (id) => void calls.push(`bringBack ${id}`)
};
/** A leaving's call after its commit, recorded with the answers' calls. */
const leaveFakes: LeaveEffects = { stopRuns: (id) => void calls.push(`stopRuns ${id}`) };

/** The owner lets an Odd go, as the staff route's Remove sends it. */
const leaving = (staffId: string): EventOf<'oddRemoved'> => ({
  kind: 'oddRemoved',
  staffId,
  line: { kind: 'hire', actor: 'owner', title: `Let ${staffId} go`, body: `${staffId} left.` },
  about: new Map(),
  effects: leaveFakes
});

/** The owner's yes to bringing an Odd back. */
const bringingBack = (staffId: string): EventOf<'oddBroughtBack'> => ({
  kind: 'oddBroughtBack',
  staffId,
  line: { kind: 'hire', actor: 'owner', title: `Brought ${staffId} back`, body: 'Back.' }
});

/** The owner's answer to an ask, as the desk sends it. */
const answer = (
  id: number,
  decision: Decision,
  more: Partial<EventOf<'askDecided'>> = {}
): WorkEvent => ({
  kind: 'askDecided',
  id,
  decision,
  reason: decision === 'approve' ? null : 'Because.',
  inChat: id % 2 === 0,
  perKind: [],
  effects: fakes,
  ...more
});

/** The usage window past its guard, by default resetting long after ask 8 was raised, so no ask of this window is on the desk yet. */
async function windowPastGuard(
  resetsAt = minutes(400)
): Promise<{ share: number; resetsAt: Date }> {
  const share = 0.9;
  await db
    .insert(planLimits)
    .values({ fiveHour: share, fiveHourResetsAt: resetsAt, sevenDay: 0.1 });
  return { share, resetsAt };
}

/**
 * The usage windows the sequences run under, five hours long as `WINDOW_MS`
 * in usage-window.ts has them: one that began a moment after ask 8 was
 * raised, so the first hand-off it holds raises its ask, and one that began
 * before, so ask 8 holds work until the window resets mid-sequence.
 */
const WINDOWS = [
  { resetsAt: minutes(300.5), began: minutes(0.5) },
  { resetsAt: minutes(30), began: minutes(-270) }
];

/** The usage window as the whole office reads it: its ask is the last window ask raised since it began. */
function windowOf(
  w: WorkRows,
  window: { share: number; resetsAt: Date; began: Date }
): WorkRows['window'] {
  const [ask] = [...w.asks.values()]
    .filter((a) => a.kind === 'window' && a.createdAt > window.began)
    .sort((a, b) => b.id - a.id);
  return {
    share: window.share,
    resetsAt: window.resetsAt,
    ask: ask ? { id: ask.id, status: ask.status } : null
  };
}

/** A hand-off from Lia, on work it leads or on new work it opens. */
const handOffOf = (
  thread: EventOf<'handedOff'>['thread'],
  more: Partial<EventOf<'handedOff'>> = {}
): EventOf<'handedOff'> => ({
  kind: 'handedOff',
  from: 'lia',
  to: 'cal',
  work: { title: 'Check it', brief: 'Check.' },
  thread,
  carry: [],
  ...more
});

/** Every event the work core takes now, from the rows in memory and each claim's joined results. */
function offered(w: WorkRows, joined: Map<number, number[]>): WorkEvent[] {
  const events: WorkEvent[] = [
    {
      kind: 'runQueued',
      run: { staffId: 'lia', kind: 'resume', note: 'Go on.', threadId: 2 },
      onlyWhileOpen: true
    },
    {
      kind: 'runQueued',
      run: { staffId: 'gus', kind: 'resume', note: 'Go on.', threadId: 3 },
      onlyWhileOpen: true
    },
    { kind: 'runQueued', run: { staffId: 'cal', kind: 'carry_out', note: null, askId: 2 } },
    { kind: 'runQueued', run: { staffId: 'lia', kind: 'task_done', note: null, taskId: 1 } },
    { kind: 'runQueued', run: { staffId: 'rae', kind: 'edited', note: null } },
    ...answersOffered(w),
    ...threadsOffered(w)
  ];
  for (const [id, f] of w.followUps) {
    events.push({ kind: 'runClaimed', id });
    // A restart closes only the runs it cut off, the running ones. Offered for every run, the
    // kind was refused so often that it never got through at the default seeds.
    if (f.run.is === 'running') events.push({ kind: 'staleRunsClosed', id, about: 'the work' });
    for (const outcome of ['done', 'failed', 'waiting'] as const)
      events.push({
        kind: 'runFinished',
        id,
        about: 'the work',
        ended: { outcome, result: `Ran: ${outcome}`, joined: joined.get(id) ?? [] }
      });
  }
  return events;
}

/** Every event the answers family takes now: asks and tasks raised, and each answered every way. */
function answersOffered(w: WorkRows): WorkEvent[] {
  const ask = { why: 'w', ifApproved: 'i' };
  const events: WorkEvent[] = [
    {
      kind: 'askRaised',
      ask: { ...ask, staffId: 'cal', kind: 'call', title: 'Post it', call: SLACK_POST }
    },
    {
      kind: 'askRaised',
      ask: { ...ask, staffId: 'lia', kind: 'approval', title: 'May I send it?', threadId: 2 },
      attach: ['notes/a.md'],
      run: 'k2'
    },
    {
      kind: 'askRaised',
      ask: { ...ask, staffId: 'cal', kind: 'approval', title: 'A new version', revises: 1 }
    },
    {
      kind: 'taskGiven',
      task: { staffId: 'rae', title: 'Read this', why: 'w', steps: [], threadId: 4 },
      attach: ['notes/b.md'],
      run: 'k3'
    },
    {
      kind: 'taskGiven',
      task: { staffId: null, title: 'Connect AWS', why: 'w', steps: [AWS_STEP] },
      oneOpen: { connector: 'aws', aws: true }
    },
    {
      kind: 'taskGiven',
      task: { staffId: 'cal', title: 'Connect Drive', why: 'w', steps: [DRIVE_STEP] },
      oneOpen: { connector: 'drive' }
    },
    { kind: 'connectTasksDropped', connector: 'drive' },
    { kind: 'connectTasksDropped', connector: 'aws', staffId: 'cal' },
    { kind: 'goalStatusChanged', goalId: 1, status: 'met' }
  ];
  for (const a of w.asks.values()) {
    const given = a.folder && { done: { folder: { ...a.folder, given: FOLDER } } };
    events.push(
      answer(a.id, 'approve', given ?? {}),
      answer(a.id, 'deny'),
      answer(a.id, 'iterate')
    );
  }
  for (const id of w.tasks.keys())
    events.push(
      { kind: 'taskEnded', id, ended: 'done', note: 'Done it.', inChat: id % 2 === 0 },
      { kind: 'taskEnded', id, ended: 'dropped', note: null, inChat: false },
      { kind: 'taskEnded', id, ended: 'withdrawn', note: 'Taken off the desk.', inChat: false }
    );
  return events;
}

/**
 * Every event the threads and leaving families take now: hand-offs, the
 * owner's words passed to a lead, parks, the clock, and each Odd leaving and
 * coming back. Cal works on threads 2 and 4, which Lia leads.
 */
function threadsOffered(w: WorkRows): WorkEvent[] {
  const told = {
    said: 'Send it on Friday, please.',
    words: 'on Friday',
    reading: 'It waits for Friday.',
    exchange: '',
    files: []
  };
  const events: WorkEvent[] = [
    handOffOf({ open: { title: 'New work', hubId: 'lia' } }, { run: 'k4' }),
    // New work for a goal Cal leads, which opens though this hand-off does not go.
    handOffOf({ open: { title: 'Goal work', hubId: 'cal' } }),
    handOffOf({ id: 2 }, { to: 'rae' }),
    handOffOf({ id: 2 }, { to: 'gus' }),
    { kind: 'parked', staffId: 'lia', threadId: 2, on: { task: 1 }, worksOn: new Set() },
    { kind: 'parked', staffId: 'lia', threadId: 1, on: { task: 4 }, worksOn: new Set() },
    { kind: 'parked', staffId: 'lia', threadId: 4, on: { at: minutes(20) }, worksOn: new Set() },
    { kind: 'parked', staffId: 'cal', threadId: 9, on: { at: minutes(40) }, worksOn: new Set() }
  ];
  for (const id of w.threads.keys())
    events.push(
      handOffOf({ id }),
      { kind: 'toldLead', staffId: 'cal', threadId: id, worksOn: new Set([2, 4]), ...told },
      { kind: 'clockWoke', threadId: id }
    );
  for (const id of w.staff.keys()) events.push(leaving(id), bringingBack(id));
  return events;
}

type Written = {
  reports: { staffId: string; title: string; body: string }[];
  pokes: { staffId: string; message: string }[];
};

/** The reports and pokes written after the given ids. */
async function writtenAfter(last: { report: number; poke: number }): Promise<Written> {
  const r = await db.select().from(reports).orderBy(reports.id);
  const p = await db.select().from(pokes).orderBy(pokes.id);
  return {
    reports: r
      .filter((x) => x.id > last.report)
      .map(({ staffId, title, body }) => ({ staffId, title, body })),
    pokes: p.filter((x) => x.id > last.poke).map(({ staffId, message }) => ({ staffId, message }))
  };
}

function outsideOf(change: Change): Written {
  return {
    reports: change.outside.flatMap((o) =>
      o.kind === 'report' ? [{ staffId: o.staffId, title: o.title, body: o.body }] : []
    ),
    pokes: change.outside.flatMap((o) =>
      o.kind === 'poke' ? [{ staffId: o.staffId, message: o.message }] : []
    )
  };
}

/** A kind each event kind is named in, so a kind added to `WorkEvent` fails the type check here until the sequences run it. */
const KINDS = Object.keys({
  runQueued: 0,
  runClaimed: 0,
  runFinished: 0,
  staleRunsClosed: 0,
  askRaised: 0,
  askDecided: 0,
  taskGiven: 0,
  taskEnded: 0,
  connectTasksDropped: 0,
  goalStatusChanged: 0,
  parked: 0,
  clockWoke: 0,
  oddRemoved: 0,
  oddBroughtBack: 0,
  handedOff: 0,
  toldLead: 0
} satisfies Record<WorkEvent['kind'], 0>);

test('every work event decides on the loaded rows as on the whole office, and writes the rows applyChange gives', async () => {
  let events = 0;
  let changes = 0;
  const changedBy = new Set<string>();
  for (let seed = 0; seed < SEEDS; seed++) {
    const rnd = random(seed);
    await seedOffice();
    const window = WINDOWS[seed % WINDOWS.length];
    await windowPastGuard(window.resetsAt);
    let world = await readWorld();
    const joined = new Map<number, number[]>();
    let last = { report: 0, poke: 0 };
    for (let n = 1; n <= LENGTH; n++) {
      // Each kind as likely as any other, so a kind with few events still runs at the default seeds.
      const choices = offered(world, joined);
      const kinds = [...new Set(choices.map((c) => c.kind))];
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const ofKind = choices.filter((c) => c.kind === kind);
      const e = ofKind[Math.floor(rnd() * ofKind.length)];
      const at = `seed ${seed}, event ${n}: ${JSON.stringify(e)}`;
      const now = minutes(n);
      const next = await idsOffset(world);
      const { got, loaded } = await run(e, now);
      // What an answer reads that takes I/O comes from the loader alone; the prepare test checks it.
      const whole = {
        ...world,
        window: windowOf(world, { ...window, share: 0.9 }),
        prepared: loaded.prepared
      };
      const expected = decide(whole, e, now);
      assert.deepStrictEqual(
        unput(got),
        unput(expected),
        `the loaded rows decide as the whole office does, ${at}`
      );
      events++;
      if (!('change' in expected && 'change' in got)) continue;
      changes++;
      changedBy.add(e.kind);
      const before = world;
      world = applyAtSerials(before, expected.change, next);
      assert.deepStrictEqual(
        applyAtSerials(before, got.change, next),
        world,
        `the loaded rows' puts leave the office as the whole office's do, ${at}`
      );
      if (e.kind === 'runClaimed' && 'change' in got)
        joined.set(
          e.id,
          (got.change.result as { joined: { id: number }[] }).joined.map((g) => g.id)
        );
      const rows = await readRows();
      for (const table of TABLE_KEYS)
        assert.deepStrictEqual(rows[table], world[table], `${table} read back as in memory, ${at}`);
      const written = await writtenAfter(last);
      assert.deepStrictEqual(written, outsideOf(expected.change), `reports and pokes, ${at}`);
      last = {
        report: last.report + written.reports.length,
        poke: last.poke + written.pokes.length
      };
    }
  }
  // A kind that never got through would check nothing of its loader or its writes.
  assert.deepStrictEqual(
    [...changedBy].sort(),
    KINDS.toSorted(),
    `${changes} of ${events} events changed rows`
  );
  assert.deepStrictEqual(calls, [], 'no decider ran an effect while deciding');
});

test('an Odd the owner let go is given no run, no ask and no task', async () => {
  await seedOffice();
  const before = await readRows();
  const events: WorkEvent[] = [
    { kind: 'runQueued', run: { staffId: 'gus', kind: 'edited', note: null } },
    {
      kind: 'askRaised',
      ask: { staffId: 'gus', kind: 'approval', title: 'One more', why: 'w', ifApproved: 'i' }
    },
    { kind: 'taskGiven', task: { staffId: 'gus', title: 'Sign this', why: 'w', steps: [] } }
  ];
  // Gus left before any of these. The sequences above reach an ask or a task for an Odd that
  // left only after a leaving, which the default seeds may not draw.
  for (const e of events) {
    await run(e, minutes(1));
    assert.deepStrictEqual(await readRows(), before, `${e.kind} wrote nothing`);
  }
});

test('new rows written together point at each other and at an effect id by ref, as in memory', async () => {
  await seedOffice();
  const world = await readWorld();
  let goalId = 0;
  const change: Change = {
    put: [
      {
        table: 'threads',
        ref: 'work',
        insert: {
          hubId: 'lia',
          holderId: 'lia',
          title: 'New work',
          goalId: null,
          handOffsUsed: 0,
          runs: [],
          createdAt: T0,
          status: 'open',
          park: { on: 'none' }
        },
        points: { goalId: 'goal' }
      },
      {
        table: 'asks',
        ref: 'asked',
        insert: {
          ...[...world.asks.values()][0],
          status: 'open',
          title: 'Raised on the new work',
          threadId: null,
          handOffId: null
        },
        points: { threadId: 'work' }
      },
      {
        table: 'followUps',
        ref: 'run',
        insert: newRun({ staffId: 'lia', kind: 'resume' }, T0),
        points: { threadId: 'work', askId: 'asked', goalId: 'goal' }
      }
    ],
    outside: [
      {
        kind: 'perKind',
        effect: {
          name: 'goal',
          run: async (tx) => {
            const [g] = await tx
              .insert(goals)
              .values({ title: 'A goal' })
              .returning({ id: goals.id });
            goalId = g.id;
            return g;
          }
        }
      },
      { kind: 'attachments', staffId: 'lia', paths: ['notes/a.md'], to: { ask: 'asked' } }
    ],
    result: null
  };
  await officeDb.transaction((tx) => applyWork(tx, change));

  const expected = applyChange(world, change);
  // In memory the effect's id is made up as -1; the database gave the real one.
  for (const t of expected.threads.values()) if (t.goalId === -1) t.goalId = goalId;
  for (const f of expected.followUps.values()) if (f.goalId === -1) f.goalId = goalId;
  const rows = await readRows();
  for (const table of ['threads', 'followUps', 'asks', 'tasks'] as const)
    assert.deepStrictEqual(rows[table], expected[table], table);
  const newAsk = Math.max(...expected.asks.keys());
  const files = await db.select().from(attachments);
  assert.deepStrictEqual(
    files.map(({ staffId, path, askId, taskId }) => ({ staffId, path, askId, taskId })),
    [{ staffId: 'lia', path: 'notes/a.md', askId: newAsk, taskId: null }]
  );
});

test('a change that cannot be written leaves nothing behind, its effect included', async () => {
  await seedOffice();
  const before = await readRows();
  const change: Change = {
    put: [
      { table: 'threads', row: { ...before.threads.get(2)!, title: 'Renamed' } },
      {
        table: 'followUps',
        ref: 'run',
        insert: newRun({ staffId: 'lia', kind: 'resume' }, T0),
        points: { askId: 'no such ref' }
      }
    ],
    outside: [
      {
        kind: 'perKind',
        effect: {
          name: 'goal',
          run: async (tx) => {
            await tx.insert(goals).values({ title: 'A goal' });
          }
        }
      }
    ],
    result: null
  };
  await assert.rejects(
    officeDb.transaction((tx) => applyWork(tx, change)),
    /points at a ref no earlier put made/
  );
  assert.deepStrictEqual(await readRows(), before);
  assert.deepStrictEqual(await db.select().from(goals), []);
});

test('an Odd that leaves has its jobs off and its waiting pokes cancelled, and coming back turns the same jobs on', async () => {
  await seedOffice();
  const schedule = { every: 'day', at: '09:00' } as const;
  const job = { staffId: 'lia', instructions: 'i', schedule };
  await db.insert(jobs).values([
    { ...job, name: 'On' },
    { ...job, name: 'Off already', enabled: false }
  ]);
  await db.insert(pokes).values({ staffId: 'lia', at: minutes(30), message: 'Later.' });
  const at = minutes(1);
  const apply = (outside: Change['outside']) =>
    officeDb.transaction((tx) => applyWork(tx, { put: [], outside, result: null }));

  await apply([
    { kind: 'leave', staffId: 'lia', at },
    { kind: 'cancelPokes', staffId: 'lia' }
  ]);
  const [left] = await db.select().from(staff).where(eq(staff.id, 'lia'));
  assert.deepStrictEqual(
    { leftAt: left.leftAt, jobsOff: left.jobsOff },
    { leftAt: at, jobsOff: [1] }
  );
  assert.deepStrictEqual(
    (await db.select().from(jobs).orderBy(jobs.id)).map((j) => j.enabled),
    [false, false]
  );
  assert.deepStrictEqual(
    (await db.select().from(pokes)).map((p) => p.status),
    ['cancelled']
  );

  await apply([{ kind: 'comeBack', staffId: 'lia' }]);
  const [back] = await db.select().from(staff).where(eq(staff.id, 'lia'));
  assert.deepStrictEqual(
    { leftAt: back.leftAt, jobsOff: back.jobsOff },
    { leftAt: null, jobsOff: null }
  );
  const after = await db.select().from(jobs).orderBy(jobs.id);
  assert.deepStrictEqual(
    after.map((j) => j.enabled),
    [true, false]
  );
  assert.ok(after[0].nextRunAt, 'the job turned back on has its next run');
});

test('a run that failed before it started, or of a retired kind, is not queued', async () => {
  await seedOffice();
  // The column's type lists only the live kinds, so a retired row goes in as plain SQL.
  await db.execute(
    sql`insert into follow_ups (staff_id, kind, created_at) values ('lia', 'feedback', now())`
  );
  const queued = await db.select({ id: followUps.id }).from(followUps).where(queuedRows);
  const world = await readWorld();
  const expected = [...world.followUps.values()]
    .filter((f) => f.run.is === 'queued')
    .map((f) => ({ id: f.id }));
  assert.deepStrictEqual(queued, expected);
  // The office holds both kinds of row the test is about.
  const failed = world.followUps.get(14)?.run;
  assert.ok(failed?.is === 'ended' && failed.startedAt === null);
  assert.ok([...world.followUps.values()].some((f) => f.kind === 'feedback'));
});

/** Each lock a loader takes, by table, in order, with its mode and ids. */
type Lock = { table: string; mode: string; ids: string[] };

/** Load an event's rows in a transaction of their own, with every lock the loader took. */
async function loadLocked(e: WorkEvent): Promise<{ rows: WorkRows; locks: Lock[] }> {
  const dialect = new PgDialect();
  const locks: Lock[] = [];
  const rows = await officeDb.transaction(async (tx) => {
    const execute = tx.execute.bind(tx);
    mock.method(tx, 'execute', (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      const lock = /from "(\w+)" .* for (update|share)$/.exec(text);
      if (lock) locks.push({ table: lock[1], mode: lock[2], ids: params.map(String) });
      return execute(query);
    });
    return loadWork(tx, e);
  });
  return { rows, locks };
}

const WRITES_HERE = new Set<WorkEvent['kind']>([
  'handedOff',
  'toldLead',
  'parked',
  'clockWoke',
  'oddRemoved',
  'oddBroughtBack'
]);

test('every loader locks in the one table order each row its decider reads, and for update each it writes', async () => {
  await seedOffice();
  const events: WorkEvent[] = [
    {
      kind: 'runQueued',
      // An ask on work with asks, and a task: this one locks every table it can.
      run: { staffId: 'cal', kind: 'carry_out', note: null, askId: 2, taskId: 1, threadId: 1 }
    },
    { kind: 'runClaimed', id: 1 },
    {
      kind: 'runFinished',
      id: 2,
      about: 'the work',
      ended: { outcome: 'failed', result: 'r', joined: [4, 5] }
    },
    { kind: 'staleRunsClosed', id: 6, about: 'the work' },
    {
      kind: 'askRaised',
      ask: {
        staffId: 'cal',
        kind: 'call',
        title: 'Post it',
        why: 'w',
        ifApproved: 'i',
        call: { ...SLACK_POST, tool: 'edit' },
        revises: 9,
        threadId: 4
      }
    },
    answer(3, 'approve'),
    answer(3, 'deny'),
    answer(5, 'approve', { done: { folder: { ...FOLDER, given: FOLDER } } }),
    answer(6, 'approve'),
    answer(7, 'approve'),
    answer(7, 'deny'),
    answer(8, 'approve'),
    answer(10, 'deny'),
    {
      kind: 'taskGiven',
      task: { staffId: 'rae', title: 'Read this', why: 'w', steps: [], threadId: 4 }
    },
    {
      kind: 'taskGiven',
      task: { staffId: 'cal', title: 'Connect Drive', why: 'w', steps: [DRIVE_STEP] },
      oneOpen: { connector: 'drive' }
    },
    { kind: 'taskEnded', id: 3, ended: 'done', note: null, inChat: false },
    { kind: 'taskEnded', id: 4, ended: 'withdrawn', note: 'Gone.', inChat: false },
    { kind: 'connectTasksDropped', connector: 'drive' },
    { kind: 'goalStatusChanged', goalId: 1, status: 'met' },
    {
      kind: 'handedOff',
      from: 'lia',
      to: 'cal',
      work: { title: 'Check it', brief: 'Check.' },
      thread: { id: 2 },
      carry: []
    },
    {
      kind: 'toldLead',
      staffId: 'cal',
      threadId: 4,
      said: 'Send it on Friday.',
      words: 'on Friday',
      reading: 'It waits for Friday.',
      exchange: '',
      worksOn: new Set([4]),
      files: []
    },
    { kind: 'parked', staffId: 'lia', threadId: 2, on: { task: 1 }, worksOn: new Set() },
    { kind: 'parked', staffId: 'lia', threadId: 2, on: { at: minutes(30) }, worksOn: new Set() },
    // Thread 7, which the window's ask 8 holds, due: the ask leaves the desk with it.
    { kind: 'clockWoke', threadId: 7 },
    leaving('cal'),
    // Ask 13 is another ask to bring Gus back, which the bring-back withdraws.
    bringingBack('gus')
  ];
  await db
    .update(threads)
    .set({ resumeAt: minutes(-1) })
    .where(eq(threads.id, 7));
  const every = new Set<string>();
  for (const e of events) {
    const { rows, locks } = await loadLocked(e);
    const at = `${e.kind} ${JSON.stringify(e)} locked ${locks.map((l) => `${l.table} ${l.mode} ${l.ids.join(',')}`).join('; ')}`;
    const order = locks.map((l) => LOCK_ORDER.indexOf(l.table as (typeof LOCK_ORDER)[number]));
    for (const l of locks) every.add(l.table);
    // Only a hand-off holds work for the window, under the plan's lock, which the clock waits on.
    if (e.kind === 'handedOff' || e.kind === 'clockWoke')
      assert.equal(locks[0]?.table, 'plan_limits', at);
    assert.ok(!order.includes(-1), at);
    assert.deepStrictEqual(
      order,
      order.toSorted((a, b) => a - b),
      at
    );
    const locked = (table: string, mode?: string) =>
      new Set(locks.flatMap((l) => (l.table === table && (!mode || l.mode === mode) ? l.ids : [])));
    for (const [key, table] of Object.entries(TABLES)) {
      const held = locked(table);
      for (const id of rows[key as keyof typeof TABLES].keys())
        assert.ok(held.has(String(id)), `${table} ${id} was read unlocked: ${at}`);
    }
    const decided = decide(rows, e, minutes(1));
    // Each of these writes here, so its update locks are checked against real writes.
    if (WRITES_HERE.has(e.kind))
      assert.ok('change' in decided && decided.change.put.length, `writes nothing: ${at}`);
    const written = 'change' in decided ? decided.change.put.filter((p) => 'row' in p) : [];
    for (const p of written as Extract<Put, { row: unknown }>[])
      assert.ok(
        locked(TABLES[p.table], 'update').has(String(p.row.id)),
        `${p.table} ${p.row.id} was written without its update lock: ${at}`
      );
    // The Odd a leaving or a bring-back writes.
    for (const o of 'change' in decided ? decided.change.outside : [])
      if (o.kind === 'leave' || o.kind === 'comeBack')
        assert.ok(locked('staff', 'update').has(o.staffId), `staff ${o.staffId}: ${at}`);
    // The Odd a switch yes changes with the claim.
    const turned = rows.prepared.switches?.before.id;
    if (turned) assert.ok(locked('staff', 'update').has(turned), `staff ${turned}: ${at}`);
  }
  // Each table a decider reads was locked, the plan's row by a hand-off and the clock among them.
  assert.deepStrictEqual([...every].sort(), LOCK_ORDER.toSorted());
});

test('a task that work parks on while it ends refuses the end, so the parked work is never left waiting', async () => {
  await seedOffice();
  await assert.rejects(
    officeDb.transaction(async (tx) => {
      const execute = tx.execute.bind(tx);
      // A park that lands between the thread locks and the task's, as one from another transaction would.
      mock.method(tx, 'execute', async (query: SQL) => {
        if (/from "tasks" .* for update$/.test(new PgDialect().sqlToQuery(query).sql))
          await tx.update(threads).set({ resumeOnTask: 4 }).where(eq(threads.id, 5));
        return execute(query);
      });
      await loadWork(tx, { kind: 'taskEnded', id: 4, ended: 'done', note: null, inChat: false });
    }),
    /parked on the task as it ended/
  );
});

test('a yes to a switch, a folder or a held hand-off is decided on what the loader prepares under its locks', async () => {
  await seedOffice();
  const prepared = async (e: WorkEvent) =>
    (await officeDb.transaction((tx) => loadWork(tx, e))).prepared;
  const turned = (await prepared(answer(6, 'approve'))).switches;
  assert.ok(turned, 'a switch yes has its switches');
  const { before, off, networkBody } = turned;
  assert.deepStrictEqual(
    { id: before.id, commands: before.commands, web: before.web, off },
    { id: 'cal', commands: false, web: false, off: ['commands', 'web'] }
  );
  assert.equal(networkBody, networkNote(before, { ...before, commands: true, web: true }).body);
  assert.deepStrictEqual(
    await prepared(answer(5, 'approve', { done: { folder: { ...FOLDER, given: FOLDER } } })),
    { folderTitle: gaveFolder('Rae', FOLDER.path, FOLDER.level) }
  );
  assert.deepStrictEqual(await prepared(answer(7, 'approve')), {
    sharing: { from: 'lia', title: HELD.title, brief: HELD.brief }
  });
  for (const no of [answer(6, 'deny'), answer(5, 'iterate'), answer(7, 'deny')])
    assert.deepStrictEqual(await prepared(no), {}, 'a no or a send-back prepares nothing');
});

test('an answer and a leaving run their effects after the commit, never while they are decided', async () => {
  /** The calls one event makes, in order, with when it was decided and committed. */
  const callsOf = async (e: WorkEvent): Promise<string[]> => {
    await seedOffice();
    calls.length = 0;
    const commit = officeDb.transaction.bind(officeDb);
    mock.method(officeDb, 'transaction', async (inTx: Parameters<typeof commit>[0]) => {
      const done = await commit(inTx);
      calls.push('committed');
      return done;
    });
    try {
      await transition(
        {
          name: e.kind,
          load: (q: Tx) => loadWork(q, e),
          decide: (rows: WorkRows, at: Date) => {
            calls.push('deciding');
            const d = decide(rows, e, at);
            calls.push('decided');
            return d;
          },
          // A transition's `apply` gives nothing back, and this test reads no real ids.
          apply: async (q: Tx, c: Change) => {
            await applyWork(q, c);
          }
        },
        { now: minutes(1) }
      );
    } finally {
      mock.restoreAll();
    }
    const made = [...calls];
    calls.length = 0;
    return made;
  };
  // The twin off any work is answered with it, and carried out with it.
  assert.deepStrictEqual(
    await callsOf(
      answer(3, 'approve', { carryOut: async (a) => void calls.push(`carryOut ${a.id}`) })
    ),
    ['deciding', 'decided', 'committed', 'carryOut 3', 'grantAccess cal', 'carryOutTogether 3 4']
  );
  // The office stops a run of the Odd only once its leaving is in the database.
  assert.deepStrictEqual(await callsOf(leaving('cal')), [
    'deciding',
    'decided',
    'committed',
    'stopRuns cal'
  ]);
});

test('the usage window ask goes under the earliest hired manager, whatever their names', async () => {
  await seedOffice();
  const manager = { role: MANAGER_ROLE, variant: 'v', portrait: 'p', remit: 'r', desk: 'd' };
  // Zed was hired first, and sorts after Amy by name.
  await db.insert(staff).values([
    { ...manager, id: 'zed', name: 'Zed', hiredAt: minutes(-100) },
    { ...manager, id: 'amy', name: 'Amy', hiredAt: minutes(-10) }
  ]);
  await windowPastGuard();
  const { got } = await run(handOffOf({ id: 2 }), minutes(1));
  assert.ok('change' in got, 'the hand-off is held, and its change commits');
  const [asked] = await db.select().from(asks).orderBy(desc(asks.id)).limit(1);
  assert.deepStrictEqual(
    { kind: asked.kind, staffId: asked.staffId },
    { kind: 'window', staffId: 'zed' }
  );
});

/** A file outside the office for a hand-off to carry. */
function fileToCarry(): { real: string; name: string; named: string } {
  const real = join(mkdtempSync(join(tmpdir(), 'oddboro-carry-')), 'notes.md');
  writeFileSync(real, 'Notes.');
  return { real, name: 'notes.md', named: 'notes.md' };
}

test('a hand-off the usage window holds on work already open points the work at the new window ask', async () => {
  await seedOffice();
  await idsOffset(await readRows());
  const { resetsAt } = await windowPastGuard();
  const { got } = await run(handOffOf({ id: 2 }), minutes(1));
  assert.ok('change' in got, 'the hand-off is held, and its change commits');
  const [asked] = await db.select().from(asks).orderBy(desc(asks.id)).limit(1);
  assert.ok(asked.kind === 'window' && asked.id > 200, `ask ${asked.id} is the new window ask`);
  const [t] = await db.select().from(threads).where(eq(threads.id, 2));
  assert.deepStrictEqual(
    { heldBy: t.heldBy, resumeAt: t.resumeAt },
    { heldBy: asked.id, resumeAt: resetsAt }
  );
});

test('a hand-off that opens new work copies its files into that work by its real number', async () => {
  await seedOffice();
  await idsOffset(await readRows());
  const file = fileToCarry();
  const { got } = await run(
    handOffOf({ open: { title: 'New work', hubId: 'lia' } }, { carry: [file] }),
    minutes(1)
  );
  assert.ok('change' in got);
  const [made] = await db.select().from(threads).orderBy(desc(threads.id)).limit(1);
  assert.ok(made.id > 100, `work ${made.id} is the new work`);
  assert.ok(existsSync(join(threadPart(made.id, 'lia'), file.name)), 'the file is in the new work');
});

test("a taken hand-off's result names the real run and work, never the decider's guesses", async () => {
  await seedOffice();
  await idsOffset(await readRows());
  const { got, real } = await run(
    handOffOf({ open: { title: 'New work', hubId: 'lia' } }),
    minutes(1)
  );
  assert.ok('change' in got && real);
  const result = got.change.result as WorkResults['handedOff'];
  assert.ok('id' in result, 'the hand-off was taken');
  const [run1] = await db.select().from(followUps).orderBy(desc(followUps.id)).limit(1);
  assert.deepStrictEqual(
    { id: real(result.id), thread: real(result.thread), kind: run1.kind },
    { id: run1.id, thread: run1.threadId, kind: 'hand_off' }
  );
  assert.ok(run1.id > 300 && (run1.threadId ?? 0) > 100, 'both are new rows past the offset');
});

test('a hand-off whose files cannot be carried writes no row, and its caller gets the reason', async () => {
  await seedOffice();
  const before = await readRows();
  const gone = {
    real: join(tmpdir(), 'oddboro-no-such-file.md'),
    name: 'notes.md',
    named: 'notes.md'
  };
  await assert.rejects(run(handOffOf({ id: 2 }, { carry: [gone] }), minutes(1)), {
    message:
      'The office cannot open notes.md to copy it. Make it readable, or leave it out, and call hand_off again.'
  });
  assert.deepStrictEqual(await readRows(), before);
});

test('a held hand-off yes to a colleague that left decides as on the whole office, and starts no run for it', async () => {
  // Thread 8 has no run, so the yes reaches Rae only through the colleague its ask holds.
  await seedOffice();
  await db
    .update(staff)
    .set({ leftAt: minutes(-5) })
    .where(eq(staff.id, 'rae'));
  const world = await readWorld();
  const rae = world.staff.get('rae');
  assert.ok(rae);
  world.staff.set('rae', { ...rae, leftAt: minutes(-5) });
  const e = answer(7, 'approve');
  const { got, loaded } = await run(e, minutes(1));
  const expected = decide({ ...world, prepared: loaded.prepared }, e, minutes(1));
  assert.deepStrictEqual(unput(got), unput(expected));
  assert.ok('change' in got && 'change' in expected);
  assert.deepStrictEqual(
    applyChange(world, got.change).followUps,
    applyChange(world, expected.change).followUps
  );
});

test('the clock waking one of two threads the window ask holds keeps the ask on the desk', async () => {
  await seedOffice();
  await db
    .update(threads)
    .set({ resumeAt: minutes(-1) })
    .where(eq(threads.id, 7));
  await db
    .update(threads)
    .set({ resumeAt: minutes(30), heldBy: 8 })
    .where(eq(threads.id, 2));
  const world = await readWorld();
  const e: WorkEvent = { kind: 'clockWoke', threadId: 7 };
  const { got } = await run(e, minutes(1));
  assert.deepStrictEqual(unput(got), unput(decide(world, e, minutes(1))));
  const [a] = await db.select().from(asks).where(eq(asks.id, 8));
  assert.equal(a.status, 'open', 'ask 8 still holds thread 2');
});
