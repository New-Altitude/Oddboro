// What each Odd on a piece of work knows of it, read from the office's records
// as each of its runs starts. One story serves its lead and its colleagues, in
// a chat and on a run: a chat once answered from what it remembered, two steps
// behind a pick-up running beside it. A chat reads the same record cut to
// openings of the latest steps, since it pays for every story on every turn.
import { and, asc, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { db } from './db.ts';
import { conversationSaid } from './work-conversations.ts';
import {
  asks,
  followUps,
  goals,
  staff,
  staffGoals,
  tasks,
  threads,
  GOAL_STATUSES,
  type Outcome
} from './schema.ts';
import { askReplaced, flat, SAID_AS, taskSaid } from './desk-answers.ts';
import {
  HAND_OFF_LIMIT,
  LATEST_WORK,
  LISTED,
  taskThread,
  thread,
  threadFolder,
  threadPart,
  parkedTitles,
  waitingFor,
  workCalled,
  waitingOn,
  worksOn,
  type ThreadRow,
  type ThreadWaiting
} from './threads.ts';
import { THREADS_DIR, workName } from './work-paths.ts';
import { clockTime, zoneName } from './time.ts';
import { GOAL_IS_LIVE } from './goal-words.ts';

/** One hand-off in a thread, as the hub's brief tells it. */
type Step = { title: string; to: string; outcome?: Outcome; text?: string };

/** A chat's story holds this many of the latest steps. */
const STEPS_IN_CHAT = 5;
/** A story holds this many of the owner's newest decisions on the work. */
const SAID_SHOWN = 10;
/** The longest a step's opening or the owner's words run in a story. */
const WORDS_MAX = 500;
/** All of a chat's stories together, led and on, since a chat pays for them on every turn. */
export const CHAT_STORIES_MAX = 24_000;

/** One thing the owner decided on this work: what it was, how it ended, and their words. */
export type OwnerSaid = { what: string; how: string; words?: string };

/** A thread's history, for the next run of anyone on it. */
export type ThreadStory = {
  thread: ThreadRow;
  goal?: string;
  doneWhen?: string;
  steps: Step[];
  /** The newest result that came back, by hand-back id. */
  latest?: { id: number; from: string; text: string };
  /** What it raised that is still open on the owner's desk, in any round, oldest first. */
  waiting: ThreadWaiting[];
  /** The newest plan the owner approved on it: who does each part, and their answer. */
  plan?: { parts: string[]; answer: string | null };
  /** On a goal's thread, each Odd that serves the goal now, with its part, from `staff_goals`. */
  serving?: string[];
  /** What the owner decided on it, oldest first, the newest `SAID_SHOWN`. */
  said: OwnerSaid[];
  /** The name of the Odd that leads it. */
  lead: string;
  /** The title of the task whose end wakes it. */
  parkedOn?: string;
};

/** The one place a decision becomes what an Odd reads: a colleague reads nothing of an ask beyond this. */
function saidOf(r: {
  title: string;
  status: keyof typeof SAID_AS;
  words: string | null;
}): OwnerSaid {
  const words = flat(r.words ?? '').slice(0, WORDS_MAX);
  return { what: flat(r.title), how: SAID_AS[r.status], ...(words ? { words } : {}) };
}

/** What the owner decided on a thread: its asks, and the tasks on it or on one of its asks. */
async function saidOn(id: number): Promise<OwnerSaid[]> {
  const threadAsks = await db
    .select({
      id: asks.id,
      threadId: asks.threadId,
      title: asks.title,
      status: asks.status,
      reason: asks.reason,
      decidedAt: asks.decidedAt,
      createdAt: asks.createdAt
    })
    .from(asks)
    .where(eq(asks.threadId, id));
  const askIds = threadAsks.map((a) => a.id);
  const onThread = await db
    .select()
    .from(tasks)
    .where(or(eq(tasks.threadId, id), askIds.length ? inArray(tasks.askId, askIds) : undefined));
  const conversation = await conversationSaid(id);
  return [
    ...conversation.map((c) => ({
      at: c.createdAt,
      said: { what: 'Work conversation', how: 'said', words: flat(c.message).slice(0, WORDS_MAX) }
    })),
    // In JavaScript, not SQL: a null reason compares as unknown there, which
    // would drop every ask answered with no reason.
    ...threadAsks.flatMap((a) =>
      a.status === 'open' || askReplaced(a)
        ? []
        : [
            {
              at: a.decidedAt ?? a.createdAt,
              said: saidOf({ title: a.title, status: a.status, words: a.reason })
            }
          ]
    ),
    ...onThread.flatMap((k) =>
      k.status === 'open' || taskThread(k, threadAsks) !== id
        ? []
        : [
            {
              at: k.doneAt ?? k.createdAt,
              said: saidOf({ title: k.title, status: k.status, words: taskSaid(k) })
            }
          ]
    )
  ]
    .sort((x, y) => x.at.getTime() - y.at.getTime())
    .slice(-SAID_SHOWN)
    .map((s) => s.said);
}

export async function threadStory(t: ThreadRow): Promise<ThreadStory> {
  const rows = await db
    .select({
      id: followUps.id,
      kind: followUps.kind,
      handOff: followUps.handOff,
      note: followUps.note,
      name: staff.name
    })
    .from(followUps)
    .innerJoin(staff, eq(followUps.staffId, staff.id))
    .where(and(eq(followUps.threadId, t.id), inArray(followUps.kind, ['hand_off', 'handed_back'])))
    .orderBy(asc(followUps.id));
  const backs = rows.filter((r) => r.kind === 'handed_back');
  const steps = rows
    .filter((r) => r.kind === 'hand_off')
    .map((r) => {
      const back = backs.findLast((b) => b.handOff?.id === r.id);
      return {
        title: r.handOff?.title ?? '',
        to: r.name,
        outcome: back?.handOff?.outcome,
        text: back?.note ?? undefined
      };
    });
  const last = backs.at(-1);
  const from = last && rows.find((r) => r.id === last.handOff?.id)?.name;
  const [goal] = t.goalId
    ? await db
        .select({ title: goals.title, doneWhen: goals.doneWhen })
        .from(goals)
        .where(eq(goals.id, t.goalId))
    : [];
  const [plan] = await db
    .select({ plan: asks.plan, reason: asks.reason })
    .from(asks)
    .where(and(eq(asks.threadId, t.id), eq(asks.kind, 'plan'), eq(asks.status, 'approved')))
    .orderBy(desc(asks.id))
    .limit(1);
  const people = await db.select({ id: staff.id, name: staff.name }).from(staff);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  const serving = t.goalId
    ? await db
        .select({ name: staff.name, part: staffGoals.part })
        .from(staffGoals)
        .innerJoin(staff, eq(staffGoals.staffId, staff.id))
        .where(and(eq(staffGoals.goalId, t.goalId), isNull(staff.leftAt)))
        .orderBy(asc(staff.hiredAt))
    : undefined;
  return {
    thread: t,
    goal: goal?.title,
    doneWhen: goal?.doneWhen ?? undefined,
    steps,
    latest: last && from ? { id: last.id, from, text: last.note ?? '' } : undefined,
    waiting: waitingFor(await waitingOn(db, [t.id]), t.id),
    plan: plan?.plan
      ? {
          parts: plan.plan.items.map(
            (i) => `${i.kind === 'hire' ? `${i.hire.name} (a hire)` : name(i.staff)}: ${i.part}`
          ),
          answer: plan.reason
        }
      : undefined,
    serving: serving?.map((s) => `${s.name}: ${s.part}`),
    said: await saidOn(t.id),
    lead: name(t.hubId),
    parkedOn: (await parkedTitles([t])).get(t.id)
  };
}

/** A step's result as the hub's brief holds it: the opening paragraph, cut short. */
function opening(text: string): string {
  const first = flat(text.trim().split(/\n\s*\n/)[0] ?? '');
  return first.length > WORDS_MAX ? `${first.slice(0, WORDS_MAX)}...` : first;
}

const ENDED: Record<Outcome, string> = {
  done: 'finished',
  failed: 'could not finish',
  waiting: 'waiting on {owner}'
};

/** The steps a story tells, numbered as they ran, with how many it leaves out of the latest `last`. */
function stepLines(steps: Step[], last: number | undefined): string[] {
  const from = last === undefined ? 0 : Math.max(steps.length - last, 0);
  return [
    ...(from ? [`${from} earlier step${from === 1 ? ' is' : 's are'} left out here.`] : []),
    ...steps
      .slice(from)
      .map(
        (s, i) =>
          `${from + i + 1}. ${s.title} (${s.to}): ${s.outcome ? ENDED[s.outcome] : 'not back yet'}.${s.text ? ` ${opening(s.text)}` : ''}`
      )
  ];
}

/** The hand-offs still out, worked from every step, even those a chat leaves out. */
function outLines(steps: Step[]): string[] {
  const out = steps.filter((s) => !s.outcome);
  return out.length
    ? [`Still out: ${out.map((s) => `"${s.title}" (${s.to})`).join(', ')}.`, '']
    : [];
}

function waitingLines(waiting: ThreadWaiting[]): string[] {
  return waiting.length
    ? [`Still waiting on {owner}: ${waiting.map((w) => `"${w.title}"`).join(', ')}.`, '']
    : [];
}

/** What the owner decided on the work, the same words for its lead and its colleagues. */
function saidLines(said: OwnerSaid[]): string[] {
  return said.length
    ? [
        `What {owner} said on this work, from the office's records. Trust this over your notes or anything you remember:`,
        '',
        ...said.map((s) => `- "${s.what}": ${s.how}.${s.words ? ` Their words: ${s.words}` : ''}`),
        ''
      ]
    : [];
}

/** Where the work stands, once it has ended. Without it, a chat said a goal's stopped work was under way. */
function standsLines(t: ThreadRow): string[] {
  return t.status !== 'open' ? [`Where it stands: ${LISTED[t.status]}.`, ''] : [];
}

/** What the work waits for. Without it, a pick-up cannot tell parked work from stalled work. */
function parkedLines(t: ThreadRow, parkedOn: string | undefined): string[] {
  if (parkedOn)
    return [
      `It is parked until {owner} finishes or drops "${flat(parkedOn)}". You pick it up then.`,
      ''
    ];
  return t.resumeAt ? [`It picks back up at ${clockTime(t.resumeAt)} ${zoneName()}.`, ''] : [];
}

/**
 * What a lead knows of a thread it leads, from its story: what it is for,
 * whether it has ended, the history, bounded to each step's title, outcome and
 * opening paragraph, plus the latest result in full, the hand-offs still out,
 * what still waits on the owner, what they said on it, the plan they approved,
 * who serves its goal, and its folder. `shown` are the hand-backs the run's
 * brief already holds in full; `lastSteps` cuts the history to the latest few.
 */
export function threadKnown(b: {
  story: ThreadStory;
  shown?: number[];
  lastSteps?: number;
}): string[] {
  const { thread: t, steps, latest, goal, waiting, plan, serving, said, parkedOn } = b.story;
  return [
    '',
    `## Work ${t.id}`,
    '',
    `What it is for: ${t.title}`,
    '',
    `You lead this work: you started it, and you pick each next step and who does it.${goal ? ` It serves the goal "${goal}".` : ''}`,
    '',
    ...(b.story.doneWhen ? [`Done when: ${b.story.doneWhen}`, ''] : []),
    ...standsLines(t),
    ...parkedLines(t, parkedOn),
    'Steps so far:',
    '',
    ...stepLines(steps, b.lastSteps),
    '',
    ...outLines(steps),
    ...(latest && !b.shown?.includes(latest.id)
      ? [`The latest result, from ${latest.from}, in full:`, '', latest.text || '(nothing)', '']
      : []),
    ...waitingLines(waiting),
    ...saidLines(said),
    ...(plan
      ? [
          'The plan {owner} approved, part by part:',
          '',
          ...plan.parts.map((p) => `- ${p}`),
          ...(plan.answer ? ['', `Their answer: ${plan.answer}`] : []),
          ''
        ]
      : []),
    // A lead once said two hires were still to come a minute after they were
    // hired, from its own notes. This list is read from the office's records.
    ...(serving
      ? [
          serving.length
            ? `Who serves the goal now, from the office's records. Trust this over your notes or any plan file: a hire in the plan who is listed here is hired.`
            : `Nobody serves the goal yet, from the office's records: any hire in the plan is still to be hired.`,
          '',
          ...serving.map((s) => `- ${s}`),
          ...(serving.length ? [''] : [])
        ]
      : []),
    `Everyone on ${workCalled(t)} reads all of its folder, ${threadFolder(t.id)}.`,
    `When you hand {owner} a result built there, such as a page, attach that file itself, never a copy: name it from ${THREADS_DIR}/, e.g. ${workName(t.id, `${t.hubId}/plan.md`)}.`,
    ''
  ];
}

/**
 * What the hub is told in every run on its thread: what it knows of the
 * thread (`threadKnown`), the round's hand-offs, and the ways to move it on.
 */
export function threadBrief(b: { story: ThreadStory; shown?: number[] }): string[] {
  const { thread: t, steps, plan } = b.story;
  const called = workCalled(t);
  return [
    ...threadKnown(b),
    ...(steps.some((s) => !s.outcome)
      ? [
          'Each step still out brings you back here when it ends, and what lands while you run comes back together in one run. Go on with what is back, or finish this run with "Outcome: done" and wait for them.',
          ''
        ]
      : []),
    ...(plan
      ? [
          'Hand on the next piece this plan gives when what it waits on is back. Leave out any part their answer left out.',
          ''
        ]
      : []),
    `- Hand-offs: ${t.handOffsUsed} of the ${HAND_OFF_LIMIT} a round takes. The next one past that waits while {owner} decides whether the work keeps going: a yes starts it as you wrote it.`,
    `- In ${called}'s folder, each Odd writes only its own part, and yours is ${threadPart(t.id, t.hubId)}. If a plan for the work helps, keep it there as plan.md and revise it as you go.`,
    `- Never copy anything from a tool a colleague lacks into a brief or this folder without {owner}'s yes: if the work needs it, raise_ask first, naming the tool and what goes to whom, and hand off once they say yes. hand_off lists what each colleague lacks of yours. The same goes for a tool of another colleague's on ${called}, when its part of the folder carries that tool's contents.`,
    '',
    'Move it on one of these ways, then finish this run:',
    '',
    `1. hand_off the next piece to a colleague; it goes on ${called}, and you pick up when they finish. To check work, prefer a reviewer who did not do it. End with "Outcome: done": this run's part is done, and ${called} stays open.`,
    '2. resume_at a time, when the next step should wait for one, or resume_at after_task, when it waits on a task {owner} has on other work. End with "Outcome: done" too.',
    '3. raise_ask or give_owner_a_task, when it needs {owner}. Their answer brings you back here. End with "Outcome: waiting", since it now waits on them.',
    '4. If the work is done, say what came of it and end with "Outcome: done".',
    ''
  ];
}

/**
 * What a colleague knows of work another Odd leads: its steps, what is out,
 * what the owner said on it and its folder, each on its own line. Never the
 * plan's parts, who serves the goal or an ask's text: a colleague is told how
 * each ask ended, not what it asked.
 */
export function threadOnKnown(b: { story: ThreadStory }): string[] {
  const { thread: t, steps, waiting, said, lead } = b.story;
  return [
    '',
    `## Work ${t.id}`,
    '',
    `What it is for: ${t.title}`,
    '',
    `${lead} leads this work. You are on it.`,
    '',
    ...standsLines(t),
    'Steps so far:',
    '',
    ...stepLines(steps, STEPS_IN_CHAT),
    '',
    ...outLines(steps),
    ...waitingLines(waiting),
    ...saidLines(said),
    `Everyone on the work reads all of its folder, ${threadFolder(t.id)}.`,
    ''
  ].map(flat);
}

/** The goals whose threads a chat is told of: those still worked on. */
const LIVE = GOAL_STATUSES.filter((s) => GOAL_IS_LIVE[s]);

/**
 * The threads a chat is told the story of, of those `mine` selects: each live
 * goal's, and the latest others. A met or dropped goal's thread stays out.
 * `mine` may be undefined because `worksOn` is an `and(...)`.
 */
async function chatThreads(mine: SQL | undefined): Promise<ThreadRow[]> {
  const [forGoals, others] = await Promise.all([
    db
      .select()
      .from(threads)
      .where(
        and(
          mine,
          inArray(
            threads.goalId,
            db.select({ id: goals.id }).from(goals).where(inArray(goals.status, LIVE))
          )
        )
      )
      .orderBy(asc(threads.id)),
    db
      .select()
      .from(threads)
      .where(and(mine, isNull(threads.goalId)))
      .orderBy(desc(threads.id))
      .limit(LATEST_WORK)
  ]);
  return [...forGoals, ...others];
}

/**
 * The stories a lead's run is told, read as the run starts, so a run that
 * waited for a slot still sees what landed meanwhile: on a thread, that one,
 * if it leads it; in a chat, each live goal's it leads and its latest other
 * work. Empty for an Odd that leads none of them.
 */
export async function ledStories(
  hubId: string,
  on: { thread: number } | 'chat'
): Promise<ThreadStory[]> {
  const rows =
    on === 'chat'
      ? await chatThreads(eq(threads.hubId, hubId))
      : await db
          .select()
          .from(threads)
          .where(and(eq(threads.hubId, hubId), eq(threads.id, on.thread)));
  return Promise.all(rows.map(threadStory));
}

/** The stories of the work a colleague's chat is told: what it is on and does not lead. */
export async function onStories(staffId: string): Promise<ThreadStory[]> {
  return Promise.all((await chatThreads(worksOn(staffId))).map(threadStory));
}

/** One thread's story, for a colleague's run on it. Empty when there is no such thread. */
export async function storyOf(id: number): Promise<ThreadStory[]> {
  const t = await thread(id);
  return t ? [await threadStory(t)] : [];
}

/**
 * The sections of a lead's chat instructions that say where its work stands,
 * cut to openings of the latest steps: the latest result stays for a run on
 * the thread. Each section ends in a newline and sections join with nothing,
 * so `fitStories` can add their lengths. Every line is flattened because a
 * resumed chat splits this text on its headings (`sectionsOf`). Empty when it
 * leads none.
 */
export function workLedBrief(stories: ThreadStory[]): string {
  return stories
    .map((story) =>
      [
        ...threadKnown({
          story,
          lastSteps: STEPS_IN_CHAT,
          shown: story.latest ? [story.latest.id] : []
        }),
        `This is where the work stands now, read from the office's records as this chat started, and you may read the folder above. Answer {owner} from it, over anything you said earlier in this chat. A pick-up of yours running beside this chat may still be adding to it.`,
        ''
      ]
        .map(flat)
        .join('\n')
    )
    .join('');
}

/** The sections of a colleague's chat instructions, one per piece of work it is on, joined as `workLedBrief`'s are. */
export function workOnBrief(stories: ThreadStory[]): string {
  return stories
    .map((story) =>
      [
        ...threadOnKnown({ story }),
        'You may read the folder above. Answer {owner} from it, over anything you said earlier in this chat.',
        ''
      ].join('\n')
    )
    .join('');
}

/**
 * The stories that fit in `room` characters: live goals' first, then the rest,
 * newest first within each. Whole stories only, stopping at the first that
 * does not fit, so what is left out is always the oldest of its kind.
 */
export function fitStories(
  stories: ThreadStory[],
  briefOf: (s: ThreadStory) => string,
  room: number
): { kept: ThreadStory[]; used: number } {
  const order = [...stories].sort(
    (a, b) =>
      Number(b.thread.goalId !== null) - Number(a.thread.goalId !== null) ||
      b.thread.id - a.thread.id
  );
  const kept: ThreadStory[] = [];
  let used = 0;
  for (const story of order) {
    const size = briefOf(story).length;
    if (used + size > room) break;
    kept.push(story);
    used += size;
  }
  return { kept, used };
}
