// What a thread's lead knows of it, read from the office's records as each of
// its runs starts. Its pick-ups on the thread and its chat tell it the same
// facts (`threadKnown`), so the two never tell it different things: a chat once
// answered from what it remembered, two steps behind a pick-up running beside it.
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db.ts';
import {
  asks,
  followUps,
  goals,
  staff,
  staffGoals,
  threads,
  type GoalStatus,
  type Outcome
} from './schema.ts';
import {
  HAND_OFF_LIMIT,
  LISTED,
  threadFolder,
  threadPart,
  waitingFor,
  workCalled,
  waitingOn,
  type ThreadRow,
  type ThreadWaiting
} from './threads.ts';
import { THREADS_DIR, workName } from './work-paths.ts';

/** One hand-off in a thread, as the hub's brief tells it. */
type Step = { title: string; to: string; outcome?: Outcome; text?: string };

/** A thread's history, for the hub's next run. */
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
};

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
    serving: serving?.map((s) => `${s.name}: ${s.part}`)
  };
}

/** A step's result as the hub's brief holds it: the opening paragraph, cut short. */
function opening(text: string): string {
  const first = text.trim().split(/\n\s*\n/)[0] ?? '';
  return first.length > 500 ? `${first.slice(0, 500)}...` : first;
}

const ENDED: Record<Outcome, string> = {
  done: 'finished',
  failed: 'could not finish',
  waiting: 'waiting on {owner}'
};

/**
 * What a lead knows of a thread it leads, from its story: what it is for,
 * whether it has ended, the history, bounded to each step's title, outcome and opening paragraph, plus
 * the latest result in full, the hand-offs still out, what still waits on the
 * owner, the plan they approved, who serves its goal, and its folder. `shown`
 * are the hand-backs the run's brief already holds in full.
 */
export function threadKnown(b: { story: ThreadStory; shown?: number[] }): string[] {
  const { thread: t, steps, latest, goal, waiting, plan, serving } = b.story;
  const out = steps.filter((s) => !s.outcome);
  return [
    '',
    `## Work ${t.id}`,
    '',
    `What it is for: ${t.title}`,
    '',
    `You lead this work: you started it, and you pick each next step and who does it.${goal ? ` It serves the goal "${goal}".` : ''}`,
    '',
    ...(b.story.doneWhen ? [`Done when: ${b.story.doneWhen}`, ''] : []),
    // Without it, a chat said a goal's stopped work was under way.
    ...(t.status !== 'open' ? [`Where it stands: ${LISTED[t.status]}.`, ''] : []),
    'Steps so far:',
    '',
    ...steps.map(
      (s, i) =>
        `${i + 1}. ${s.title} (${s.to}): ${s.outcome ? ENDED[s.outcome] : 'not back yet'}.${s.text ? ` ${opening(s.text)}` : ''}`
    ),
    '',
    ...(out.length
      ? [`Still out: ${out.map((s) => `"${s.title}" (${s.to})`).join(', ')}.`, '']
      : []),
    ...(latest && !b.shown?.includes(latest.id)
      ? [`The latest result, from ${latest.from}, in full:`, '', latest.text || '(nothing)', '']
      : []),
    ...(waiting.length
      ? [`Still waiting on {owner}: ${waiting.map((w) => `"${w.title}"`).join(', ')}.`, '']
      : []),
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
    '2. resume_at a time, when the next step should wait for one. End with "Outcome: done" too.',
    '3. raise_ask or give_owner_a_task, when it needs {owner}. Their answer brings you back here. End with "Outcome: waiting", since it now waits on them.',
    '4. If the work is done, say what came of it and end with "Outcome: done".',
    ''
  ];
}

/** The goals whose threads a lead's chat is told of: those still worked on. */
const LIVE: GoalStatus[] = ['active', 'paused'];

/**
 * The stories a lead's run is told, read as the run starts, so a run that
 * waited for a slot still sees what landed meanwhile: on a thread, that one,
 * if it leads it; in a chat, the thread of each live goal it leads. Empty for
 * an Odd that leads none of them.
 */
export async function ledStories(
  hubId: string,
  on: { thread: number } | 'chat'
): Promise<ThreadStory[]> {
  const rows = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.hubId, hubId),
        on === 'chat'
          ? inArray(
              threads.goalId,
              db.select({ id: goals.id }).from(goals).where(inArray(goals.status, LIVE))
            )
          : eq(threads.id, on.thread)
      )
    )
    .orderBy(asc(threads.id));
  return Promise.all(rows.map(threadStory));
}

/**
 * The sections of a lead's chat instructions that say where each of its live
 * goals stands, the same facts its pick-ups get (`threadKnown`). Empty when it
 * leads none.
 */
export function goalsLedBrief(stories: ThreadStory[]): string {
  return stories
    .flatMap((story) => [
      ...threadKnown({ story }),
      `This is where the work stands now, read from the office's records as this chat started, and you may read the folder above. Answer {owner} from it, over anything you said earlier in this chat. A pick-up of yours running beside this chat may still be adding to it.`,
      ''
    ])
    .join('\n');
}
