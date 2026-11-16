// Random sequences of run, ask, task, thread and leaving events through the work core's
// deciders. After each event the rows the deciders leave are checked against
// the test's own record, which it builds from the events alone with today's
// rules written out in the models beside it (work-model.ts and each
// work-<family>-model.ts), never from what the deciders answered. The rules a
// sequence keeps, and the check of the rows against them, are in
// work-sequences-rules.ts. Pure: rows in memory, no database.
// Run with `npm test -w @oddboro/ledger`; set WORK_SEQUENCES_SEEDS for a longer run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StaffRow } from '../src/office.ts';
import type { Decision } from '../src/office-asks.ts';
import { ASK_KINDS, type Outcome } from '../src/schema.ts';
import { explore, type Explore } from '../src/sequences.ts';
import type { TaskEnded } from '../src/task-parking.ts';
import { effectsOf } from '../src/work/answers.ts';
import { decide } from '../src/work/decide.ts';
import type { EventOf, NewAsk, NewTask, WorkEvent } from '../src/work/events.ts';
import { OUTCOME_TITLE } from '../src/work/runs.ts';
import { applyChange, type Prepared, type WorkRows } from '../src/work/snapshot.ts';
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
  fresh,
  met,
  recordOf,
  show,
  WINDOW,
  type AskRec,
  type Model,
  type TaskRec
} from './work-model.ts';
import { ask, minutes, odd, rowsOf, run, T0, task, thread } from './work-rows.ts';
import { claim, finish, OWED, queue } from './work-runs-model.ts';
import {
  ABOUT,
  bringBack,
  clockWake,
  handOff,
  newRounds,
  park,
  removeOdd,
  tellLead,
  threadEvents
} from './work-threads-model.ts';
import { broken, fakes, RULE, type State } from './work-sequences-rules.ts';

// How many seeds the test runs; set WORK_SEQUENCES_SEEDS for a longer run.
// Enough that each rule's rarer cases meet, such as a run owed to an Odd that left.
const SEEDS = Number(process.env.WORK_SEQUENCES_SEEDS ?? 1000);
const LENGTH = 30;

// OUTCOME_TITLE has a title for every outcome, so its keys are every outcome.
const OUTCOMES = Object.keys(OUTCOME_TITLE.resume) as Outcome[];

// The office every sequence starts from. Ada leads at Act, Rico works at
// Draft, Tess at Read on Codex, so the usage window holds no hand-off to her.
// Theo left the office, so the work he led stopped. Jo was brought back after
// her leaving failed her runs.
const ODDS = [
  odd('ada'),
  odd('rico', { level: 'draft' }),
  odd('tess', { level: 'read', agent: 'codex' }),
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
      // A job of Ada's that works on this thread is running; one hand-off is left in its round.
      thread(5, 'ada', { runs: ['ada job'], handOffsUsed: 7 }),
      thread(6, 'tess', { park: { on: 'time', at: minutes(500) } }),
      // The usage window holds Ada's work until the owner answers ask 4, or it resets.
      thread(7, 'ada', { park: { on: 'window', at: minutes(WINDOW.resetsAt), ask: 4 } }),
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
/** A goal or plan yes's own write in the transaction, which sets the goal or approves the plan. */
const PLANNING = [{ name: 'approval_work', run: async () => undefined }];

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
  if (a.kind === 'level' || a.kind === 'office_tool')
    return { setting: { title: `Raised ${o.name} from draft to act` } };
  if (a.held) return { sharing: { from: a.held.from, title: a.held.title, brief: a.held.brief } };
  return {};
}

/** The usage window as the loader reads it under the plan's lock, with its ask. */
function windowOf(rows: WorkRows): WorkRows['window'] {
  const ask = rows.asks.get(WINDOW.ask);
  return {
    share: WINDOW.share,
    resetsAt: minutes(WINDOW.resetsAt),
    ask: ask ? { id: ask.id, status: ask.status } : null
  };
}

/** What the loader reads beside the rows for this event: the window only for a hand-off, new or held. */
function loadedFor(rows: WorkRows, e: WorkEvent): WorkRows {
  if (e.kind === 'askDecided') {
    const a = rows.asks.get(e.id);
    const startsHeld = !!a && effectsOf(a.kind, e.decision).includes('start_held');
    return {
      ...rows,
      window: startsHeld ? windowOf(rows) : null,
      prepared: preparedFor(rows, e.id)
    };
  }
  if (e.kind !== 'handedOff') return rows;
  return {
    ...rows,
    window: windowOf(rows),
    prepared: { sharing: { from: e.from, title: e.work.title, brief: e.work.brief } }
  };
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
    const record = recordOf(seed);
    record.broughtBack.add('jo');
    return { state: { rows, prev: rows, at: 0 }, record };
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
    // From an Odd that left too: its last run may still raise or be owed
    // work as the owner lets it go, the race the rule on leaving closes.
    ...OWED.filter((_, i) => !r.owedSent.has(i)),
    ...raises(r),
    ...gives(r),
    ...r.asks.flatMap(answers),
    ...[...r.tasks.values()].flatMap(ends),
    ...DROPS,
    ...threadEvents(r)
  ],
  step: (s, e) => {
    const at = s.at + 1;
    const rows = loadedFor(s.rows, e);
    const last = decide(rows, e, minutes(at));
    return {
      rows: 'change' in last ? applyChange(rows, last.change) : s.rows,
      prev: s.rows,
      at,
      last
    };
  },
  note: (r, e) => {
    const was = new Map([...r.threads].map(([id, t]) => [id, t.status]));
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
    if (e.kind === 'parked') park(r, e);
    if (e.kind === 'clockWoke') clockWake(r, e);
    if (e.kind === 'handedOff') handOff(r, e);
    if (e.kind === 'toldLead') tellLead(r, e);
    if (e.kind === 'oddRemoved') removeOdd(r, e);
    if (e.kind === 'oddBroughtBack') bringBack(r, e);
    newRounds(r, e, was);
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
    "an answer on no work joining its Odd's queued answered run",
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
  stoppedFinal: [
    'a hand-off on stopped work',
    'words for stopped work',
    'a hand-off from an Odd that left'
  ],
  onePark: [
    'a task park replacing a time park',
    'a time park replacing a task park',
    'a time park replacing a window hold',
    'a hand-off held for the usage window'
  ],
  leftClosed: [
    "a leaving stopping the Odd's work",
    'a leaving withdrawing an ask',
    'a leaving withdrawing a task',
    'a leaving failing a run yet to start',
    'an ask raised by an Odd that left',
    'a task given by an Odd that left',
    'a run owed to an Odd that left'
  ],
  broughtBack: [
    'an Odd brought back',
    'a hand-off to an Odd brought back',
    'a return withdrawing an ask to bring it back'
  ],
  clockWake: [
    'a clock wake joining a queued resume',
    'a clock wake starting a resume',
    'a usage window reset waking held work',
    'a clock wake with nothing due'
  ],
  filesGo: [
    'a hand-off taken with files',
    'words told to a lead with files',
    'a hand-off past the round asking the owner'
  ],
  pointed: ['a hand-off taken on new work'],
  model: [
    'a result handed back to its lead',
    'a held call raised again while it is open',
    'a connect task given while one is open',
    'an answer refused before the ask closes',
    'an answer to an ask answered already',
    "a tool's connect tasks dropped",
    "a hand-off opening a goal's work its sender does not lead",
    'a hand-off taken',
    'words told to a lead',
    'a yes to a hand-off the usage window holds',
    'a leaving of an Odd gone already'
  ]
};

test('random sequences of run, ask, task, thread and leaving events keep every rule', async (t) => {
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
