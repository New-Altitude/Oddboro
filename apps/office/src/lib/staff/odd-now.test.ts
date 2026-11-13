// The rules an Odd's live state keeps after any run of events: every screen
// shows the same state, nothing claims work that is not there, the Jobs tab
// follows the runs, a hand-off reads "is on it" only while its run goes, a
// chat reply ranks above background runs, and the card's tabs reload only
// when a run starts or ends. Random event sequences drive the page's
// snapshot; the test keeps its own record of what is true from the events
// alone, and each rule asserts equality with it. Then one fixture per state
// renders every screen that reads an Odd's state (svelte-load.ts compiles
// them) and checks the words each shows against the fixture's own. Run with
// `npm test -w @oddboro/office`; `ODD_NOW_SEEDS` sets how many sequences.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import type { AskRow, Desk, HandOffLine } from '@oddboro/ledger';
import { explore, type Explore } from '@oddboro/ledger/sequences';
import {
  floorMode,
  handOffProgress,
  handOffWords,
  jobRunning,
  lineWords,
  oddNow,
  railCount,
  railRing,
  readerProps,
  runFor,
  runsChanged,
  runWords,
  tagWords,
  workItems,
  type OddNow,
  type Show,
  type Snapshot
} from '#lib/staff/odd-now.ts';
import { ACTIVITY_LABEL, type Activity, type StaffProfile } from '#lib/staff/roster.ts';
import type { Work } from '#lib/staff/work.ts';

const SEEDS = Number(process.env.ODD_NOW_SEEDS ?? 300);
const LENGTH = 40;

const NAMES: Record<string, string> = { ada: 'Ada', bo: 'Bo', cy: 'Cy' };
const IDS = Object.keys(NAMES);
const nameOf = (id: string) => NAMES[id] ?? id;
/** A colleague who has left: the page holds no state for it. */
const GONE = 'dee';

const JOBS = ['Morning brief', 'Inbox sweep'];
/** A catch-up run, as job-brief.ts words one: its label is not the job's name. */
const CATCH_UP = 'Catching up 2 periods of Morning brief';
/** A new hire's hello: a run through the slot, not a chat reply. */
const HELLO = 'Saying hello';
const RUN_LABELS = [...JOBS, CATCH_UP, HELLO];
const HAND_OFF_LABEL = 'Plan the trip';
const TOOLS = ['Read', 'Edit'];
/** Where the floor may put an Odd: at work, elsewhere, and at the owner's door. */
const PLACES: Activity[] = ['work', 'read', 'play', 'wait'];
/** The place an Odd's job puts it. */
const JOB_PLACE: Activity = 'read';
const HEADING = 'Kitchen';
const RUNS_EACH = 3;

type Event =
  | { kind: 'runQueued'; odd: string; key: number; label: string }
  | { kind: 'runStarted'; key: number }
  | { kind: 'toolStep'; key: number; tool: string }
  | { kind: 'runEnded'; key: number }
  | { kind: 'queuedRunDropped'; key: number }
  | { kind: 'followUpAdded'; odd: string; id: number }
  | { kind: 'followUpClaimed'; odd: string; id: number; key: number }
  | { kind: 'chatStarted'; odd: string }
  | { kind: 'chatEnded'; odd: string }
  | { kind: 'askRaised'; odd: string; id: number }
  | { kind: 'askAnswered'; id: number }
  | { kind: 'taskGiven'; odd: string | null; id: number }
  | { kind: 'taskEnded'; id: number }
  | { kind: 'messageSent'; odd: string }
  | { kind: 'messageRead'; odd: string }
  | { kind: 'threadHeld'; hub: string; holder: string; title: string }
  | { kind: 'threadReleased'; title: string }
  | { kind: 'activityChanged'; odd: string; activity: Activity };

/** The test's own record: what is true, from the events alone. */
type Run = {
  key: number;
  odd: string;
  label: string;
  going: boolean;
  followUp?: number;
  steps: number;
};
type Record_ = {
  serial: number;
  /** Every run going or queued, in the order it joined. */
  runs: Run[];
  /** Follow-ups yet to start. */
  waiting: { id: number; odd: string }[];
  /** Every hand-off follow-up ever added. */
  handOffs: number[];
  chats: Set<string>;
  asks: { id: number; odd: string }[];
  tasks: { id: number; odd: string | null }[];
  messages: Set<string>;
  threads: { hub: string; holder: string; title: string }[];
  activity: Record<string, Activity>;
  last?: Event;
};

type State = { snap: Snapshot; before: Record<string, OddNow>; now: Record<string, OddNow> };

const work = (id: number, label: string, more: Partial<Work> = {}): Work => ({
  id,
  kind: 'job',
  label,
  detail: 'A run',
  since: '2026-11-12T09:00:00.000Z',
  queued: true,
  steps: 0,
  ...more
});

/**
 * A Desk with only the asks and tasks. oddNow reads only each one's Odd; the
 * rest of a Desk is the server's, so it is left out here.
 */
const deskOf = (
  asks: { id: number; staffId: string }[],
  tasks: { id: number; staffId: string | null }[]
) => ({ asks, tasks }) as unknown as Desk;

const start = (): { state: State; record: Record_ } => {
  const activity = Object.fromEntries(IDS.map((id) => [id, 'work' as Activity]));
  const snap: Snapshot = {
    ids: IDS,
    inProgress: {},
    toStart: {},
    chatting: [],
    desk: deskOf([], []),
    staff: [],
    messages: {},
    threads: [],
    activity,
    nameOf
  };
  const now = oddNow(snap);
  return {
    state: { snap, before: now, now },
    record: {
      serial: 1,
      runs: [],
      waiting: [],
      handOffs: [],
      chats: new Set(),
      asks: [],
      tasks: [],
      messages: new Set(),
      threads: [],
      activity: { ...activity }
    }
  };
};

/** Every event valid now, each payload listed from the record. */
function next(r: Record_): Event[] {
  const out: Event[] = [];
  const key = r.serial;
  for (const odd of IDS) {
    const runs = r.runs.filter((x) => x.odd === odd).length;
    if (runs < RUNS_EACH)
      for (const label of RUN_LABELS) out.push({ kind: 'runQueued', odd, key, label });
    if (r.waiting.filter((w) => w.odd === odd).length < 2)
      out.push({ kind: 'followUpAdded', odd, id: key });
    out.push(r.chats.has(odd) ? { kind: 'chatEnded', odd } : { kind: 'chatStarted', odd });
    if (!r.asks.some((a) => a.odd === odd)) out.push({ kind: 'askRaised', odd, id: key });
    if (!r.tasks.some((t) => t.odd === odd)) out.push({ kind: 'taskGiven', odd, id: key });
    out.push(r.messages.has(odd) ? { kind: 'messageRead', odd } : { kind: 'messageSent', odd });
    for (const activity of PLACES)
      if (activity !== r.activity[odd]) out.push({ kind: 'activityChanged', odd, activity });
    for (const holder of IDS) {
      const title = `${nameOf(odd)}'s work with ${nameOf(holder)}`;
      if (holder !== odd && r.threads.length < 3 && !r.threads.some((t) => t.title === title))
        out.push({ kind: 'threadHeld', hub: odd, holder, title });
    }
  }
  if (!r.tasks.some((t) => t.odd === null)) out.push({ kind: 'taskGiven', odd: null, id: key });
  for (const x of r.runs) {
    if (x.going) {
      out.push({ kind: 'toolStep', key: x.key, tool: TOOLS[x.steps % TOOLS.length] });
      out.push({ kind: 'runEnded', key: x.key });
    } else {
      out.push({ kind: 'runStarted', key: x.key });
      out.push({ kind: 'queuedRunDropped', key: x.key });
    }
  }
  for (const w of r.waiting)
    if (r.runs.filter((x) => x.odd === w.odd).length < RUNS_EACH)
      out.push({ kind: 'followUpClaimed', odd: w.odd, id: w.id, key });
  for (const a of r.asks) out.push({ kind: 'askAnswered', id: a.id });
  for (const t of r.tasks) out.push({ kind: 'taskEnded', id: t.id });
  for (const t of r.threads) out.push({ kind: 'threadReleased', title: t.title });
  return out;
}

function note(r: Record_, e: Event): void {
  r.last = e;
  const run = (key: number) => r.runs.find((x) => x.key === key);
  switch (e.kind) {
    case 'runQueued':
      r.runs.push({ key: e.key, odd: e.odd, label: e.label, going: false, steps: 0 });
      r.serial++;
      return;
    case 'runStarted':
      run(e.key)!.going = true;
      return;
    case 'toolStep':
      run(e.key)!.steps++;
      return;
    case 'runEnded':
    case 'queuedRunDropped':
      r.runs = r.runs.filter((x) => x.key !== e.key);
      return;
    case 'followUpAdded':
      r.waiting.push({ id: e.id, odd: e.odd });
      r.handOffs.push(e.id);
      r.serial++;
      return;
    case 'followUpClaimed':
      r.waiting = r.waiting.filter((w) => w.id !== e.id);
      r.runs.push({
        key: e.key,
        odd: e.odd,
        label: HAND_OFF_LABEL,
        going: false,
        followUp: e.id,
        steps: 0
      });
      r.serial++;
      return;
    case 'chatStarted':
      r.chats.add(e.odd);
      return;
    case 'chatEnded':
      r.chats.delete(e.odd);
      return;
    case 'askRaised':
      r.asks.push({ id: e.id, odd: e.odd });
      r.serial++;
      return;
    case 'askAnswered':
      r.asks = r.asks.filter((a) => a.id !== e.id);
      return;
    case 'taskGiven':
      r.tasks.push({ id: e.id, odd: e.odd });
      r.serial++;
      return;
    case 'taskEnded':
      r.tasks = r.tasks.filter((t) => t.id !== e.id);
      return;
    case 'messageSent':
      r.messages.add(e.odd);
      return;
    case 'messageRead':
      r.messages.delete(e.odd);
      return;
    case 'threadHeld':
      r.threads.push({ hub: e.hub, holder: e.holder, title: e.title });
      return;
    case 'threadReleased':
      r.threads = r.threads.filter((t) => t.title !== e.title);
      return;
    case 'activityChanged':
      r.activity[e.odd] = e.activity;
      return;
  }
}

/** The page's snapshot after the event, as the server's views would send it. */
function apply(s: Snapshot, e: Event): Snapshot {
  const runs = (each: (w: Work) => Work | undefined) =>
    Object.fromEntries(
      Object.entries(s.inProgress).map(([id, list]) => [id, list.flatMap((w) => each(w) ?? [])])
    );
  const withRun = (odd: string, w: Work) => ({
    ...s.inProgress,
    [odd]: [...(s.inProgress[odd] ?? []), w]
  });
  switch (e.kind) {
    case 'runQueued':
      return { ...s, inProgress: withRun(e.odd, work(e.key, e.label)) };
    case 'runStarted':
      return { ...s, inProgress: runs((w) => (w.id === e.key ? { ...w, queued: false } : w)) };
    case 'toolStep':
      return {
        ...s,
        inProgress: runs((w) => (w.id === e.key ? { ...w, steps: w.steps + 1, doing: e.tool } : w))
      };
    case 'runEnded':
    case 'queuedRunDropped':
      return { ...s, inProgress: runs((w) => (w.id === e.key ? undefined : w)) };
    case 'followUpAdded': {
      const item = work(-e.id, HAND_OFF_LABEL, {
        kind: 'follow-up',
        detail: 'Work handed over',
        toStart: true
      });
      return { ...s, toStart: { ...s.toStart, [e.odd]: [...(s.toStart[e.odd] ?? []), item] } };
    }
    case 'followUpClaimed':
      return {
        ...s,
        toStart: { ...s.toStart, [e.odd]: (s.toStart[e.odd] ?? []).filter((w) => w.id !== -e.id) },
        inProgress: withRun(
          e.odd,
          work(e.key, HAND_OFF_LABEL, { kind: 'follow-up', followUp: e.id })
        )
      };
    case 'chatStarted':
      return { ...s, chatting: [...s.chatting, e.odd] };
    case 'chatEnded':
      return { ...s, chatting: s.chatting.filter((id) => id !== e.odd) };
    case 'askRaised':
      return { ...s, desk: deskOf([...s.desk.asks, { id: e.id, staffId: e.odd }], s.desk.tasks) };
    case 'askAnswered':
      return {
        ...s,
        desk: deskOf(
          s.desk.asks.filter((a) => a.id !== e.id),
          s.desk.tasks
        )
      };
    case 'taskGiven':
      return { ...s, desk: deskOf(s.desk.asks, [...s.desk.tasks, { id: e.id, staffId: e.odd }]) };
    case 'taskEnded':
      return {
        ...s,
        desk: deskOf(
          s.desk.asks,
          s.desk.tasks.filter((t) => t.id !== e.id)
        )
      };
    case 'messageSent':
      return { ...s, messages: { ...s.messages, [e.odd]: 1 } };
    case 'messageRead': {
      const { [e.odd]: _read, ...messages } = s.messages;
      return { ...s, messages };
    }
    case 'threadHeld':
      return {
        ...s,
        threads: [...s.threads, { title: e.title, hubId: e.hub, holderId: e.holder }]
      };
    case 'threadReleased':
      return { ...s, threads: s.threads.filter((t) => t.title !== e.title) };
    case 'activityChanged':
      return { ...s, activity: { ...s.activity, [e.odd]: e.activity } };
  }
}

// What the record says each Odd should show, in the test's own words.

const going = (r: Record_, id: string) => r.runs.filter((x) => x.odd === id && x.going);
const queuedRuns = (r: Record_, id: string) => r.runs.filter((x) => x.odd === id && !x.going);
const waitingOf = (r: Record_, id: string) => r.waiting.filter((w) => w.odd === id);
const waitsOnOwner = (r: Record_, id: string) =>
  r.messages.has(id) || r.asks.some((a) => a.odd === id) || r.tasks.some((t) => t.odd === id);

function expectedShow(r: Record_, id: string): Show['is'] {
  if (r.messages.has(id)) return 'message';
  if (waitsOnOwner(r, id)) return 'waitingOnYou';
  if (r.threads.some((t) => t.holder === id)) return 'holding';
  if (r.threads.some((t) => t.hub === id)) return 'leading';
  if (r.chats.has(id)) return 'chatting';
  if (going(r, id).length > 0) return 'running';
  if (queuedRuns(r, id).length + waitingOf(r, id).length > 0) return 'queued';
  return 'free';
}

/** The Jobs tab's "Running <words> now.", and a running Odd's line: the first run going and how many more. */
function expectedRunWords(r: Record_, id: string): string | undefined {
  const [first, ...more] = going(r, id).map((x) => x.label);
  if (first === undefined) return undefined;
  return more.length > 0 ? `${first} +${more.length} more` : first;
}

function expectedWords(r: Record_, id: string): string {
  const shows = expectedShow(r, id);
  const place = r.activity[id];
  switch (shows) {
    case 'message':
      return 'Has a message for you';
    case 'waitingOnYou':
      return 'Waiting on you';
    case 'holding': {
      const t = r.threads.find((x) => x.holder === id)!;
      return `${t.title} · with ${nameOf(t.hub)}`;
    }
    case 'leading': {
      const t = r.threads.find((x) => x.hub === id)!;
      return going(r, id).length > 0
        ? `${t.title} · with ${nameOf(t.holder)}`
        : `Waiting on ${nameOf(t.holder)}`;
    }
    case 'chatting':
      return 'Replying to you';
    case 'running':
      return expectedRunWords(r, id)!;
    case 'queued':
      return ACTIVITY_LABEL[place];
    case 'free':
      return place === 'work' ? 'At their desk' : ACTIVITY_LABEL[place];
  }
}

/** What every screen shows, read through the word functions the screens call. */
const screens = (n: OddNow) => ({
  show: n.show.is,
  tag: tagWords(n),
  headed: tagWords(n, HEADING),
  line: lineWords(n),
  work: workItems(n).map((w) => [w.id, !!w.toStart]),
  count: railCount(n),
  ring: railRing(n),
  jobsLine: runWords(n),
  runNowLocked: n.runs.length > 0
});

/** The same, from the record. */
const expectedScreens = (r: Record_, id: string) => ({
  show: expectedShow(r, id),
  tag: expectedWords(r, id),
  headed: `→ ${HEADING}`,
  line: expectedWords(r, id),
  work: [
    ...going(r, id).map((x) => [x.key, false]),
    ...queuedRuns(r, id).map((x) => [x.key, false]),
    ...waitingOf(r, id).map((w) => [-w.id, true])
  ],
  count: r.runs.filter((x) => x.odd === id).length + waitingOf(r, id).length,
  ring: waitsOnOwner(r, id),
  jobsLine: expectedRunWords(r, id),
  runNowLocked: going(r, id).length > 0
});

/** Whether the card's tabs reload after each kind of event: only a run starting or ending. */
const RELOADS: Record<Event['kind'], boolean> = {
  runQueued: false,
  runStarted: true,
  toolStep: false,
  runEnded: true,
  queuedRunDropped: false,
  followUpAdded: false,
  followUpClaimed: false,
  chatStarted: false,
  chatEnded: false,
  askRaised: false,
  askAnswered: false,
  taskGiven: false,
  taskEnded: false,
  messageSent: false,
  messageRead: false,
  threadHeld: false,
  threadReleased: false,
  activityChanged: false
};

type Check = (now: Record<string, OddNow>, r: Record_, before: Record<string, OddNow>) => string[];

/**
 * Runs the random sequences against one rule and gathers what they reached,
 * so each test can show its rule met the cases that matter.
 */
function sequences(rule: string, check: Check): { failed: unknown; seen: Set<string> } {
  const seen = new Set<string>();
  const x: Explore<State, Event, Record_> = {
    start: () => start(),
    next,
    step: (state, e) => {
      const snap = apply(state.snap, e);
      return { snap, before: state.now, now: oddNow(snap) };
    },
    note,
    broken: (state, r) => {
      seen.add(r.last!.kind);
      for (const id of IDS) {
        const runs = going(r, id);
        seen.add(`${expectedShow(r, id)}${runs.length > 0 ? ' with a run going' : ''}`);
        if (runs.length > 1) seen.add('two runs going');
        if (runs[0]?.label === HELLO) seen.add('a hello going first');
        if (runs.some((x) => x.label === CATCH_UP) && !runs.some((x) => x.label === JOBS[0]))
          seen.add('a catch-up going without its job');
        if (expectedShow(r, id) === 'holding' && runs.some((x) => x.followUp !== undefined))
          seen.add('holding while its hand-off run goes');
        if (expectedShow(r, id) === 'free' && r.activity[id] === 'work') seen.add('free at work');
      }
      return check(state.now, r, state.before).map((detail) => ({ rule, detail }));
    }
  };
  return { failed: explore(x, { seeds: SEEDS, length: LENGTH }), seen };
}

const reached = (seen: Set<string>, cases: string[]) =>
  assert.deepEqual(
    cases.filter((c) => !seen.has(c)),
    [],
    'the sequences never reached these cases'
  );

test('every screen shows the state the record says, and the work list, rail and Jobs tab follow the runs whatever the Odd shows', () => {
  const { failed, seen } = sequences('every screen shows the state the record says', (now, r) =>
    IDS.flatMap((id) => {
      const shown = JSON.stringify(screens(now[id]));
      const want = JSON.stringify(expectedScreens(r, id));
      return shown === want ? [] : [`${id} shows ${shown}, the record says ${want}`];
    })
  );
  assert.equal(failed, undefined);
  reached(seen, [
    'message with a run going',
    'waitingOnYou with a run going',
    'holding with a run going',
    'leading with a run going',
    'leading',
    'chatting with a run going',
    'running with a run going',
    'queued',
    'free'
  ]);
});

test('an Odd with nothing going on and nothing for the owner says nothing of working, running or waiting on you', () => {
  const idle = (r: Record_, id: string) =>
    r.runs.every((x) => x.odd !== id) &&
    waitingOf(r, id).length === 0 &&
    !r.chats.has(id) &&
    !waitsOnOwner(r, id) &&
    !r.threads.some((t) => t.hub === id || t.holder === id) &&
    // The floor sends an Odd to the owner's door only while it waits on them.
    r.activity[id] !== 'wait';
  const { failed, seen } = sequences('an idle Odd claims no work', (now, r) =>
    IDS.filter((id) => idle(r, id)).flatMap((id) => {
      const n = now[id];
      const said = [tagWords(n), lineWords(n), runWords(n) ?? ''];
      const claims = said.filter((w) => /Working|Running|Waiting on you/.test(w));
      return claims.length > 0 || railRing(n) || railCount(n) > 0
        ? [`${id} is idle and shows ${JSON.stringify(screens(n))}`]
        : [];
    })
  );
  assert.equal(failed, undefined);
  reached(seen, ['free at work']);
});

test('a job shows Running exactly while a run with its name goes, and Run now is locked exactly while any run goes', () => {
  const { failed, seen } = sequences('the Jobs tab follows the runs going', (now, r) =>
    IDS.flatMap((id) => {
      const runs = going(r, id);
      const shown = JOBS.map((job) => jobRunning(now[id], job));
      const want = JOBS.map((job) => runs.some((x) => x.label === job));
      const locked = now[id].runs.length > 0;
      return JSON.stringify(shown) === JSON.stringify(want) && locked === runs.length > 0
        ? []
        : [
            `${id} shows ${JOBS} running as ${shown}, locked ${locked}; the record says ${want}, ${runs.length} going`
          ];
    })
  );
  assert.equal(failed, undefined);
  reached(seen, [
    'two runs going',
    'a catch-up going without its job',
    'waitingOnYou with a run going',
    'holding with a run going'
  ]);
});

test('a colleague is on a hand-off exactly while its run for that hand-off goes, whatever it shows', () => {
  const { failed, seen } = sequences('a hand-off is on it only while its run goes', (now, r) =>
    r.handOffs.flatMap((followUp) =>
      [...IDS, GONE].flatMap((id) => {
        const found = runFor(now[id], followUp)?.id;
        const want = going(r, id).find((x) => x.followUp === followUp)?.key;
        return found === want
          ? []
          : [`${id}'s run for hand-off ${followUp} is ${found}, the record says ${want}`];
      })
    )
  );
  assert.equal(failed, undefined);
  reached(seen, ['holding while its hand-off run goes', 'followUpClaimed', 'runStarted']);
});

test('an Odd shows Replying to you exactly while its chat reply goes and nothing above it holds, and a hello reads as a run', () => {
  const { failed, seen } = sequences(
    'a chat reply shows above runs, and a hello is not one',
    (now, r) =>
      IDS.flatMap((id) => {
        const above = waitsOnOwner(r, id) || r.threads.some((t) => t.hub === id || t.holder === id);
        const replying = r.chats.has(id) && !above;
        const line = lineWords(now[id]);
        if ((line === 'Replying to you') !== replying)
          return [`${id} says "${line}", replying ${replying}`];
        if (
          !replying &&
          !above &&
          going(r, id)[0]?.label === HELLO &&
          line !== expectedRunWords(r, id)
        )
          return [`${id}'s hello reads "${line}"`];
        return [];
      })
  );
  assert.equal(failed, undefined);
  reached(seen, ['chatting with a run going', 'chatting', 'a hello going first']);
});

test("the card's tabs reload when a run starts or ends, and never on a tool step, a queued run or a chat reply", () => {
  const { failed, seen } = sequences(
    "the card's tabs reload only when a run starts or ends",
    (now, r, before) => {
      const kind = r.last!.kind;
      const reloads = runsChanged(before, now);
      return reloads === RELOADS[kind] ? [] : [`after ${kind} the tabs reload: ${reloads}`];
    }
  );
  assert.equal(failed, undefined);
  reached(seen, Object.keys(RELOADS));
});

test("the floor sends an Odd to the door while it waits on the owner, and to its job's place while a run goes or it waits on a colleague", () => {
  const { failed, seen } = sequences('the floor follows the state', (now, r) =>
    IDS.flatMap((id) => {
      const place = floorMode(now[id], JOB_PLACE);
      const want = waitsOnOwner(r, id)
        ? 'wait'
        : going(r, id).length > 0 || expectedShow(r, id) === 'leading'
          ? JOB_PLACE
          : undefined;
      return place === want ? [] : [`${id} goes to ${place}, the record says ${want}`];
    })
  );
  assert.equal(failed, undefined);
  reached(seen, ['leading', 'holding with a run going', 'chatting with a run going', 'queued']);
});

/** A hand-off Ada gave Bo, as the chat lists it; only the fields the words read matter. */
const handOff = (more: Partial<HandOffLine>): HandOffLine => ({
  id: 7,
  threadId: 1,
  at: new Date('2026-11-12T09:00:00.000Z'),
  title: HAND_OFF_LABEL,
  brief: 'Plan it',
  from: 'Ada',
  to: 'Bo',
  fromId: 'ada',
  toId: 'bo',
  gave: true,
  status: 'working',
  answered: false,
  backs: [],
  ...more
});

/** The office with Bo running the hand-off above, and Dee, who has left, not on the roster. */
const handOffOffice = (): Snapshot => ({
  ids: IDS,
  inProgress: { bo: [work(1, HAND_OFF_LABEL, { kind: 'follow-up', queued: false, followUp: 7 })] },
  toStart: {},
  chatting: [],
  desk: deskOf([], []),
  staff: IDS.map((id) => ({ id, name: NAMES[id] }) as StaffProfile),
  messages: {},
  threads: [],
  activity: Object.fromEntries(IDS.map((id) => [id, 'work' as Activity])),
  nameOf
});

test("the page's reader props give an Odd's screens its own state, any colleague's by id, and none for one who has left", () => {
  const snap = handOffOffice();
  const all = oddNow(snap);
  const onplan = (_hires: AskRow[]) => {};
  const props = readerProps(snap, all, 'ada', onplan);
  assert.equal(props.now, all.ada);
  assert.equal(props.nowOf('bo'), all.bo);
  assert.equal(props.nowOf(GONE), undefined);
  assert.equal(props.nowOf('constructor'), undefined);
  assert.equal(props.desk, snap.desk);
  assert.equal(props.staff, snap.staff);
  assert.equal(props.onplan, onplan);
});

test('a hand-off line says the colleague is on it only while its run for that hand-off goes', () => {
  const snap = handOffOffice();
  const { nowOf } = readerProps(snap, oddNow(snap), 'ada', () => {});
  assert.deepEqual(handOffProgress(handOff({}), nowOf), { text: 'Bo is on it', yours: false });
  // Bo's other runs do not count: only its run for this hand-off.
  assert.deepEqual(handOffProgress(handOff({ id: 8 }), nowOf), {
    text: 'Bo has not started yet',
    yours: false
  });
  const idle = { ...snap, inProgress: { bo: [work(2, 'Morning brief', { queued: false })] } };
  assert.deepEqual(
    handOffProgress(handOff({}), readerProps(idle, oddNow(idle), 'ada', () => {}).nowOf),
    {
      text: 'Bo has not started yet',
      yours: false
    }
  );
});

test("a hand-off line keeps its words for a finished step and for a colleague who has left, and says back on it after the owner's answer", () => {
  const snap = handOffOffice();
  const { nowOf } = readerProps(snap, oddNow(snap), 'ada', () => {});
  const left = handOff({ toId: GONE, to: 'Dee', status: 'failed' });
  assert.equal(nowOf(GONE), undefined);
  assert.deepEqual(handOffProgress(left, nowOf), {
    text: 'Dee could not finish · Ada is taking it from here',
    yours: false
  });
  assert.equal(handOffWords(handOff({ status: 'queued' }), false).text, 'Bo has not started yet');
  const back = {
    at: new Date('2026-11-12T10:00:00.000Z'),
    outcome: 'waiting' as const,
    text: 'Asked the owner',
    answered: true,
    pickUp: { status: 'done' as const }
  };
  assert.equal(handOffWords(handOff({ backs: [back] }), true).text, 'Bo is back on it');
  assert.deepEqual(handOffWords(handOff({ status: 'waiting' }), false), {
    text: 'Bo is waiting on you · Ada is taking it from here',
    yours: true
  });
  assert.equal(
    handOffWords(handOff({ status: 'done' }), false).text,
    'Bo finished · Ada is taking it from here'
  );
});

/** An Odd's profile, with only the fields its screens read. Every Odd here is a Writer. */
const profileOf = (id: string) =>
  ({
    id,
    name: NAMES[id],
    role: 'Writer',
    agent: 'claude',
    permission: 'read',
    hired: '2026-11-01',
    remit: 'Writes the briefs.',
    portrait: id,
    sprite: id,
    variant: 'a',
    guesses: 0,
    tools: []
    // The rest of a profile is the server's, and no screen here reads it.
  }) as unknown as StaffProfile;

/** Where the floor put each Odd: Ada at `activity`, the rest at work. */
const adaAt = (activity: Activity): Record<string, Activity> => ({
  ada: activity,
  bo: 'work',
  cy: 'work'
});

/** The office as the page holds it: Ada, Bo and Cy at work with nothing going, then `more`. */
const office = (more: Partial<Snapshot> = {}): Snapshot => ({
  ids: IDS,
  inProgress: {},
  toStart: {},
  chatting: [],
  desk: deskOf([], []),
  staff: IDS.map(profileOf),
  messages: {},
  threads: [],
  activity: Object.fromEntries(IDS.map((id) => [id, 'work' as Activity])),
  nameOf,
  ...more
});

const goingRun = (id: number, label: string, more: Partial<Work> = {}) =>
  work(id, label, { queued: false, ...more });
/** Bo's thread, which Ada holds for it. */
const BOS_THREAD = { title: HAND_OFF_LABEL, hubId: 'bo', holderId: 'ada' };
/** The hand-off Bo gave Ada, as Bo's chat lists it. */
const toAda = handOff({ from: 'Bo', to: 'Ada', fromId: 'bo', toId: 'ada' });

/** A piece of work in the list, by its label, and how it stands. */
type Item = [label: string, stands: 'going' | 'slot' | 'start'];
/** What the info page and the chat's foot say of a piece of work, past its label. */
const ITEM_WORDS = {
  going: { info: 'Thinking · 0 steps', chat: 'Thinking' },
  slot: {
    info: 'Waiting for a free slot: Ada runs up to three things at once.',
    chat: 'waiting for a free slot'
  },
  start: { info: "Starts once Ada's current run on this work ends.", chat: 'waiting to start' }
};

/** What Ada's screens show. */
type Expected = {
  /** The floor tag, the card line and the rail's title. */
  words: string;
  /** The info page's line. */
  info: string;
  work: Item[];
  /** The rail's count and the card's in-progress count. */
  count: number;
  /** Whether the rail rings Ada. */
  ring: boolean;
  /** The Jobs tab's line while a run goes. */
  jobsLine?: string;
  /** The jobs the Jobs tab shows Running. */
  running: string[];
  /** Whether Run now is locked. */
  locked: boolean;
};

/** A hand-off line in the lead's chat, read in `office` (the fixture's own by default). */
type HandOffCheck = {
  lead: string;
  line: HandOffLine;
  office?: Snapshot;
  onIt: boolean;
  text: string;
};

type Fixture = { name: string; snap: Snapshot; expect: Expected; handOffs?: HandOffCheck[] };

/** Ada with nothing going and nothing queued. */
const idle = { work: [], count: 0, ring: false, running: [], locked: false };
/** Ada with the Morning brief going, whatever she shows. */
const briefGoing: Pick<Expected, 'work' | 'count' | 'jobsLine' | 'running' | 'locked'> = {
  work: [['Morning brief', 'going']],
  count: 1,
  jobsLine: 'Running Morning brief now.',
  running: ['Morning brief'],
  locked: true
};
const brief = { ada: [goingRun(1, 'Morning brief')] };

/** Every state Ada can show, each with the offices that put her there. */
const FIXTURES: Record<Show['is'], Fixture[]> = {
  message: [
    {
      name: 'a message',
      snap: office({ messages: { ada: 1 }, activity: adaAt('wait') }),
      expect: { ...idle, words: 'Has a message for you', info: 'Has a message for you', ring: true }
    },
    {
      name: 'a message while running',
      snap: office({ messages: { ada: 1 }, inProgress: brief, activity: adaAt('wait') }),
      expect: {
        ...briefGoing,
        words: 'Has a message for you',
        info: 'Has a message for you',
        ring: true
      }
    }
  ],
  waitingOnYou: [
    {
      name: 'waiting on you',
      snap: office({ desk: deskOf([{ id: 1, staffId: 'ada' }], []), activity: adaAt('wait') }),
      expect: { ...idle, words: 'Waiting on you', info: 'Waiting on you', ring: true }
    },
    {
      name: 'waiting on you while running',
      snap: office({
        desk: deskOf([{ id: 1, staffId: 'ada' }], []),
        inProgress: brief,
        activity: adaAt('wait')
      }),
      expect: { ...briefGoing, words: 'Waiting on you', info: 'Waiting on you', ring: true }
    }
  ],
  holding: [
    {
      name: 'holding a thread',
      snap: office({ threads: [BOS_THREAD] }),
      expect: { ...idle, words: 'Plan the trip · with Bo', info: 'Plan the trip · with Bo' }
    },
    {
      name: 'holding while its hand-off run goes',
      snap: office({
        threads: [BOS_THREAD],
        inProgress: {
          ada: [goingRun(1, HAND_OFF_LABEL, { kind: 'follow-up', followUp: toAda.id })]
        }
      }),
      expect: {
        words: 'Plan the trip · with Bo',
        info: 'Plan the trip · with Bo',
        work: [['Plan the trip', 'going']],
        count: 1,
        ring: false,
        jobsLine: 'Running Plan the trip now.',
        running: [],
        locked: true
      },
      handOffs: [
        { lead: 'bo', line: toAda, onIt: true, text: 'Ada is on it' },
        {
          lead: 'bo',
          line: toAda,
          office: office({
            threads: [BOS_THREAD],
            toStart: {
              ada: [
                work(1, HAND_OFF_LABEL, { kind: 'follow-up', toStart: true, followUp: toAda.id })
              ]
            }
          }),
          onIt: false,
          text: 'Ada has not started yet'
        }
      ]
    }
  ],
  leading: [
    {
      name: 'leading a thread a colleague holds',
      snap: office({ threads: [{ title: HAND_OFF_LABEL, hubId: 'ada', holderId: 'bo' }] }),
      expect: { ...idle, words: 'Waiting on Bo', info: 'Waiting on Bo' }
    },
    {
      name: 'leading a thread a colleague holds while running',
      snap: office({
        threads: [{ title: HAND_OFF_LABEL, hubId: 'ada', holderId: 'bo' }],
        inProgress: brief
      }),
      expect: {
        ...briefGoing,
        words: 'Plan the trip · with Bo',
        info: 'Plan the trip · with Bo',
        ring: false
      }
    }
  ],
  chatting: [
    {
      name: 'chatting',
      snap: office({ chatting: ['ada'] }),
      expect: { ...idle, words: 'Replying to you', info: 'Replying to you' }
    },
    {
      name: 'chatting while a run goes',
      snap: office({ chatting: ['ada'], inProgress: brief }),
      expect: { ...briefGoing, words: 'Replying to you', info: 'Replying to you', ring: false }
    }
  ],
  running: [
    {
      name: 'running two runs',
      snap: office({
        inProgress: { ada: [goingRun(1, 'Morning brief'), goingRun(2, 'Inbox sweep')] }
      }),
      expect: {
        words: 'Morning brief +1 more',
        info: 'Running Morning brief +1 more',
        work: [
          ['Morning brief', 'going'],
          ['Inbox sweep', 'going']
        ],
        count: 2,
        ring: false,
        jobsLine: 'Running Morning brief +1 more now.',
        running: ['Morning brief', 'Inbox sweep'],
        locked: true
      }
    },
    {
      name: 'saying hello',
      snap: office({ inProgress: { ada: [goingRun(1, HELLO)] } }),
      expect: {
        words: 'Saying hello',
        info: 'Running Saying hello',
        work: [['Saying hello', 'going']],
        count: 1,
        ring: false,
        jobsLine: 'Running Saying hello now.',
        running: [],
        locked: true
      }
    },
    {
      name: 'a catch-up run going',
      snap: office({ inProgress: { ada: [goingRun(1, CATCH_UP)] } }),
      expect: {
        words: 'Catching up 2 periods of Morning brief',
        info: 'Running Catching up 2 periods of Morning brief',
        work: [['Catching up 2 periods of Morning brief', 'going']],
        count: 1,
        ring: false,
        jobsLine: 'Running Catching up 2 periods of Morning brief now.',
        running: [],
        locked: true
      }
    }
  ],
  queued: [
    {
      name: 'queued only',
      snap: office({ inProgress: { ada: [work(1, 'Morning brief')] } }),
      expect: {
        ...idle,
        words: 'Working',
        info: 'Working',
        work: [['Morning brief', 'slot']],
        count: 1
      }
    },
    {
      name: 'a follow-up yet to start',
      snap: office({
        toStart: {
          ada: [work(1, HAND_OFF_LABEL, { kind: 'follow-up', toStart: true, followUp: 7 })]
        },
        activity: adaAt('read')
      }),
      expect: {
        ...idle,
        words: 'Reading in the library',
        info: 'Reading in the library',
        work: [['Plan the trip', 'start']],
        count: 1
      }
    }
  ],
  free: [
    {
      name: 'free at work after a run ended',
      snap: office(),
      expect: { ...idle, words: 'At their desk', info: 'At their desk' }
    },
    {
      name: 'free elsewhere',
      snap: office({ activity: adaAt('play') }),
      expect: { ...idle, words: 'In the break room', info: 'In the break room' }
    },
    {
      name: "free elsewhere with an office task on the Desk, which is no Odd's",
      snap: office({
        desk: deskOf([], [{ id: 1, staffId: null }]),
        activity: adaAt('play')
      }),
      expect: { ...idle, words: 'In the break room', info: 'In the break room' }
    },
    {
      name: "a hand-off to a colleague who has left keeps today's line",
      snap: office(),
      expect: { ...idle, words: 'At their desk', info: 'At their desk' },
      handOffs: [
        {
          lead: 'ada',
          line: handOff({ toId: GONE, to: 'Dee', status: 'failed' }),
          onIt: false,
          text: 'Dee could not finish · Ada is taking it from here'
        }
      ]
    }
  ]
};

/** A render's markup without Svelte's hydration markers, which split what the owner reads. */
const markup = (rendered: { body: string }) => rendered.body.replace(/<!--.*?-->/gs, '');
/** The text of `html` as the owner reads it: tags dropped, entities decoded, spaces collapsed. */
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
/** Each match of `re` in `html`, its groups as plain text. */
const each = (html: string, re: RegExp) =>
  [...html.matchAll(re)].map((m) => m.slice(1).map((g) => (g === undefined ? g : plain(g))));
/** The first group of the first match, as plain text; undefined with no match. */
const first = (html: string, re: RegExp) => {
  const group = re.exec(html)?.[1];
  return group === undefined ? group : plain(group);
};

test("every reader of an Odd's status shows the same state for the same fixture", async (t) => {
  // Static imports are hoisted, so the hook is in place only if the components load after it.
  register('./svelte-load.ts', import.meta.url);
  const { render } = await import('svelte/server');
  const { default: StaffCard } = await import('#lib/ui/StaffCard.svelte');
  const { default: OddInfo } = await import('#lib/ui/OddInfo.svelte');
  const { default: OddsRail } = await import('#lib/ui/OddsRail.svelte');
  const onplan = (_hires: AskRow[]) => {};
  const none = () => {};

  for (const [is, fixtures] of Object.entries(FIXTURES)) {
    for (const f of fixtures) {
      await t.test(f.name, () => {
        const props = readerProps(f.snap, oddNow(f.snap), 'ada', onplan);
        const profile = f.snap.staff[0];
        const activity = f.snap.activity.ada;
        const card = markup(
          render(StaffCard, {
            props: {
              ...props,
              profile,
              activity,
              version: 0,
              onitem: none,
              places: [],
              manual: false,
              sentTo: undefined,
              held: {},
              onsend: none,
              onschedule: none,
              onchatstart: none,
              onchatend: none,
              oncollapse: none,
              onclose: none
            }
          })
        );
        const info = markup(
          render(OddInfo, {
            props: { profile, activity, version: 0, now: props.now, focus: 0, onsend: none }
          })
        );
        const rail = markup(
          render(OddsRail, {
            props: {
              staff: f.snap.staff,
              nowOf: props.nowOf,
              headings: Object.fromEntries(IDS.map((id) => [id, undefined])),
              onselect: none,
              onchat: none
            }
          })
        );
        // Ada's place on the rail, as markup: its title, its ring and its count.
        const onRail = /<li><button[^>]*aria-label="Ada, Writer"(.*?)<\/li>/s.exec(rail)?.[1] ?? '';
        const shown = {
          tag: tagWords(props.now),
          rail: {
            words: first(onRail, /title="Ada, Writer: ([^"]*)"/),
            count: Number(first(onRail, /aria-hidden="true">(\d+)<\/span>/) ?? 0),
            ring: onRail.includes('ring-2 ring-ember')
          },
          card: {
            words: first(card, /Writer · ([^<]*)<\/span>/),
            count: Number(first(card, /aria-label="(\d+) in progress"/) ?? 0)
          },
          info: {
            words: first(info, /<span class="truncate">([^<]*)<\/span>/),
            work: each(
              info,
              /<section class="rounded-xl bg-raise p-3[^"]*" aria-label="[^"]*">.*?<h3[^>]*>(.*?)<\/h3>\s*<p[^>]*>(.*?)<\/p>/gs
            )
          },
          chat: each(
            card,
            /title="Open In progress">([^<]*)<\/button> <span[^>]*>· ([^<]*)<\/span>(?: <span class="min-w-0 truncate[^"]*">· ([^<]*)<\/span>)?/g
          ).map(([label, stands, doing]) => [label, doing ?? stands]),
          jobs: {
            line: first(info, /(Running [^<]* now\.)/),
            // The Jobs tab lists its jobs once it has fetched them, which a server
            // render never does, so its badge and lock are read as it reads them.
            running: JOBS.filter((job) => jobRunning(props.now, job)),
            locked: props.now.runs.length > 0
          }
        };
        const e = f.expect;
        assert.deepEqual(shown, {
          tag: e.words,
          rail: { words: e.words, count: e.count, ring: e.ring },
          card: { words: e.words, count: e.count },
          info: {
            words: e.info,
            work: e.work.map(([label, stands]) => [label, ITEM_WORDS[stands].info])
          },
          chat: e.work.map(([label, stands]) => [label, ITEM_WORDS[stands].chat]),
          jobs: { line: e.jobsLine, running: e.running, locked: e.locked }
        });
        for (const h of f.handOffs ?? []) {
          const snap = h.office ?? f.snap;
          const { nowOf } = readerProps(snap, oddNow(snap), h.lead, onplan);
          assert.equal(!!runFor(nowOf(h.line.toId), h.line.id), h.onIt);
          assert.equal(handOffProgress(h.line, nowOf).text, h.text);
        }
        assert.equal(props.now.show.is, is);
      });
    }
  }
});
