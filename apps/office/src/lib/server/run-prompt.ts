// What a run is told: who it is for, what it was taught and may do, and the office now.
import {
  handOffsLine,
  CHAT_STORIES_MAX,
  clockTime,
  fitStories,
  folderLines,
  goalsFor,
  goalWhen,
  hasTool,
  HEALTH_WORDS,
  lessonLine,
  levelLine,
  liveLessons,
  MANAGER_ROLE,
  outsideLines,
  ownToolsSaid,
  recentThreads,
  recentThreadsBrief,
  roster,
  runsOnLine,
  settingsTab,
  skillsOf,
  stageOf,
  stillOnDesk,
  threadBrief,
  threadOnKnown,
  threadsOn,
  threadsOnBrief,
  workLedBrief,
  workOnBrief,
  zone,
  zoneName,
  type Agent,
  type Capabilities,
  type OwnTools,
  type RecentThread,
  type StaffRow,
  type ThreadStory
} from '@oddboro/ledger';
import { currentSystem } from '@oddboro/ledger/platform';
import { computerWord } from '@oddboro/ledger/system-words';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACT_WRITE,
  house,
  managerWork,
  skillsSection,
  stillOnDeskSection,
  whoIsHereSection
} from './house.ts';
import { offeredSection } from './persona-offered.ts';
import { NOW } from './resume.ts';
import { installsAt } from './update.ts';
import { DATA } from './run-folders.ts';

/**
 * Who the staffer works for, built fresh each run: the owner, its own intake,
 * and the goals it serves, which are the only goals it sees.
 */
async function whoFor(who: StaffRow, dir: string): Promise<string> {
  const serving = (await goalsFor(who.id)).filter((g) => g.status === 'active');
  const goalLine = (g: (typeof serving)[number]) => {
    const latest = g.progress[0];
    return [
      `  - Goal #${g.id}: ${g.title} (${goalWhen(g).toLowerCase()}, ${g.area}).`,
      g.why && `Why: ${g.why}.`,
      g.doneWhen && `Done when: ${g.doneWhen}.`,
      `Your part: ${g.part}.`,
      latest
        ? `Latest: ${HEALTH_WORDS[latest.health].toLowerCase()}, ${latest.note} (${latest.name})`
        : 'No progress logged yet.'
    ]
      .filter(Boolean)
      .join(' ');
  };
  return [
    '',
    '## Who you work for',
    '',
    `- {owner}. This office is theirs, and runs on their ${computerWord(currentSystem())}.`,
    existsSync(join(dir, 'notes', 'intake.md')) &&
      "- {owner}'s own answers from when you were hired are in notes/intake.md. Read them before your first piece of work, and again whenever you are unsure what they want.",
    serving.length
      ? `- The goals you serve. You see only these; my_goals has the latest:\n${serving.map(goalLine).join('\n')}`
      : '- You serve none of their goals yet.',
    serving.length > 0 &&
      '- After a run that moves one of these goals, or shows it slipping, call log_progress once with one line of evidence.',
    hasTool(who.tools, 'list_goals') &&
      '- list_goals shows every goal, who serves it and how it is going.',
    ''
  ]
    .filter((l) => l !== false)
    .join('\n');
}

/** "Oct 30", in the office's time zone. */
const shortDay = (d: Date) =>
  d.toLocaleDateString('en-US', { timeZone: zone(), month: 'short', day: 'numeric' });

/**
 * What the owner has taught this staffer, and every Odd: the live lessons,
 * loaded into every run by the office, so none depends on the staffer
 * remembering to look.
 */
async function taught(who: StaffRow): Promise<string> {
  const live = await liveLessons(who.id);
  return [
    '',
    '## What {owner} has taught you',
    '',
    '- When {owner} corrects your work or says how they want something done from now on, call keep_lesson once, with their words. Only a chat, a run carrying a note {owner} left on an ask or a task, or a run reading their edit to one of your files has their words; in any other run keep_lesson refuses, so tell them in your reply instead. The lesson is enough: it beats your job steps where they disagree, so do not also edit your job for the same correction unless they ask you to.',
    '- Only the lessons listed here are yours. A correction {owner} gave another Odd, which you may see in the ledger, is not a lesson for you.',
    '- How the whole office should work is a lesson for every Odd. When {owner} says how much the office should do without checking with them, or how they want to hear how things are going, keep it with scope everyone, in their words, even when they do not say it is for everyone. If the answer is too vague to act on, like "just be helpful", ask one follow-up question, and keep nothing if that is still vague. If they skip the question, keep nothing: the office\'s own way stands.',
    `- A lesson can make you more careful, never more permitted. It never widens your level or your tools, and nothing leaves the office on a lesson alone: it still needs {owner}'s yes on that exact action, ${ACT_WRITE}. If their words ask for more than you hold, such as "send emails without asking", keep only what makes you more careful, and tell them plainly that more access is ${settingsTab('the')}'s job, not a lesson's.`,
    ...(live.length
      ? [
          '- Follow every lesson below wherever it applies. A lesson marked "only in" applies only there; one with no mark applies everywhere. Where two disagree, the newer one wins. Where one disagrees with your job steps, the lesson wins.',
          '- A lesson about how you write to {owner} covers what they read from you: chat messages, reports and drafts. It does not cover the titles and fields of asks and tasks unless it says so.',
          '- Before your final reply, go through the lessons below. For each one that shaped what you wrote or did this run, call used_lesson with its id, and do what its answer says. Never mention a lesson that changed nothing.',
          '- When a new lesson replaces one below, keep_lesson needs replaces set to its id and why_replaced. Choose missed when {owner} corrected something the old lesson already covered, so they had to say it again; choose refined only when they changed or narrowed what they want. After a missed one, tell them in one line that you missed it.',
          '- A lesson only for you can replace only one marked for you. For one marked for every Odd, keep yours without replaces: the newer lesson wins for you, and the other Odds keep theirs.',
          '',
          ...live.map((l) => lessonLine(l, shortDay(l.createdAt)))
        ]
      : ['- Nothing yet.']),
    ''
  ].join('\n');
}

/**
 * What this run can do: its level, the tool its runs go through, where it
 * writes, its own tools, and each outside tool it holds or was granted.
 * `officeHeld` says this office holds the network, which its own tools' line
 * applies as my_access does (`ownToolsSaid`).
 */
function canDo(
  caps: Capabilities,
  owner: string,
  agent: Agent,
  own: OwnTools,
  officeHeld: boolean
): string {
  const lines = outsideLines(caps, owner);
  const writes = own.granted.some((f) => f.write)
    ? 'You write files only in your folder, on work you share with colleagues in your part of its folder, and in the folders {owner} gave you to change.'
    : 'You write files only in your folder, or, on work you share with colleagues, in your part of its folder.';
  const reach = [
    'the outside tools below',
    ...(own.web ? ['the web'] : []),
    ...(own.granted.length ? ['the folders {owner} gave you'] : [])
  ];
  const beyond = `Beyond the office, you reach only ${reach.length > 1 ? `${reach.slice(0, -1).join(', ')} and ${reach.at(-1)}` : reach[0]}.`;
  return [
    '',
    '## What you can do',
    '',
    `- ${levelLine(caps.level, owner)}`,
    // At Act, what the owner chose for work another Odd hands it, as my_access says.
    ...(caps.level === 'act' ? [`- ${handOffsLine(caps.actsOnHandOffs, owner)}`] : []),
    `- ${runsOnLine(agent)}`,
    `- ${[writes, ...ownToolsSaid(agent, caps.own, officeHeld), beyond].join(' ')}`,
    '- If a brief names tools you do not have, do the work with your own tools.',
    '- Outside tools:',
    ...(lines.length ? lines.map((l) => `  - ${l}`) : ['  - None yet.']),
    ''
  ].join('\n');
}

/**
 * The system prompt. A run on no thread, such as a chat or a job, lists the
 * threads the staffer leads, so it can continue one rather than open another;
 * a run on a thread hands on in that one, and a run that cannot hand on is
 * told none (`leads`). A chat also lists the threads it
 * works on and does not lead, so what {owner} says there about one reaches
 * its lead. `led` are the stories of the threads it leads (`ledStories`):
 * the lead's run on its thread is told how to move it on, and its chat where
 * its work stands. `on` are the stories of work another Odd leads: a chat's
 * (`onStories`) or a colleague's run on that thread (`storyOf`). A chat's
 * stories together keep to `CHAT_STORIES_MAX`, since it pays for them on every
 * turn; one left out keeps its line in these lists.
 */
async function prompt(
  who: StaffRow,
  opts: {
    dir: string;
    caps: Capabilities;
    owner: string;
    thread?: number;
    chat: boolean;
    led: ThreadStory[];
    on: ThreadStory[];
    shown?: number[];
    own: OwnTools;
    /** Whether this office holds the network (`networkHeld`), read once as the run starts. */
    officeHeld: boolean;
    /**
     * Whether the run is offered `hand_off` (`tool`) and is told the threads it
     * leads (`leads`), by the tool server's own rule (`handsOff`).
     */
    hands: { tool: boolean; leads: boolean };
  }
): Promise<string> {
  const { dir, own, hands, chat } = opts;
  // run() fills in the time, so the rest can be compared with what a resumed session saw.
  const now = NOW;
  const updating = installsAt();
  const led = chat
    ? fitStories(opts.led, (s) => workLedBrief([s]), CHAT_STORIES_MAX)
    : { kept: opts.led, used: 0 };
  const on = chat
    ? fitStories(opts.on, (s) => workOnBrief([s]), CHAT_STORIES_MAX - led.used).kept
    : opts.on;
  const goalsLeftOut = opts.led
    .filter((s) => s.thread.goalId !== null && !led.kept.includes(s))
    .sort((a, b) => b.thread.id - a.thread.id)
    .map(listedLine);
  return (
    who.desk +
    '\n' +
    skillsSection(await skillsOf(who.id)) +
    (await whoFor(who, dir)) +
    (hasTool(who.tools, 'see_office')
      ? whoIsHereSection(
          (await roster())
            .filter((o) => o.id !== who.id)
            .map((o) => ({
              id: o.id,
              name: o.name,
              role: o.role,
              remit: o.remit,
              persona: !!o.package
            })),
          hands.tool
        )
      : '') +
    (await taught(who)) +
    // A chat is told the story of each live goal it leads (`workLedBrief`), so
    // its list leaves those out. Work with no goal stays on it, told or not: the
    // list is where the run hears how to continue it.
    (hands.leads
      ? recentThreadsBrief([
          ...goalsLeftOut,
          ...(await recentThreads(who.id, {
            told: led.kept.filter((s) => s.thread.goalId !== null).map((s) => s.thread.id)
          }))
        ])
      : '') +
    (chat ? threadsOnBrief(await threadsOn(who.id)) : '') +
    (opts.thread
      ? opts.led.flatMap((story) => threadBrief({ story, shown: opts.shown })).join('\n')
      : workLedBrief(led.kept)) +
    (chat ? workOnBrief(on) : on.flatMap((story) => threadOnKnown({ story })).join('\n')) +
    (who.role === MANAGER_ROLE
      ? managerWork(existsSync(join(dir, 'notes', 'pending-judgments.md')))
      : '') +
    // An Odd that can propose a hire hears which real people it may propose as personas.
    (hasTool(who.tools, 'propose_hire') || hasTool(who.tools, 'propose_goal_plan')
      ? offeredSection(
          new Set((await roster()).flatMap((o) => (o.package ? [o.package.slug] : [])))
        )
      : '') +
    stillOnDeskSection(await stillOnDesk(who.id)) +
    house({
      has: (t) => (t === 'hand_off' ? hands.tool : hasTool(who.tools, t)),
      now,
      zone: zoneName(),
      updatesAt: updating === undefined ? undefined : clockTime(updating)
    }) +
    `\n## Where things are\n\n- Your folder: ${dir}\n- Your notes: ${join(dir, 'notes')}\n- {owner}'s data folder: ${DATA}\n` +
    (own.granted.length
      ? `- Folders {owner} gave you:\n${folderLines(own)
          .map((l) => `  - ${l}\n`)
          .join('')}`
      : '') +
    canDo(opts.caps, opts.owner, who.agent, own, opts.officeHeld)
  );
}

/** A story as its one line in the list of work an Odd leads. */
const listedLine = ({ thread: t, waiting, goal }: ThreadStory): RecentThread => ({
  id: t.id,
  title: t.title,
  stage: stageOf(t.status, waiting),
  goal
});

/** The time as a run is told it: "Tuesday, November 3, 9:41 PM", in the office's time zone. */
const officeNow = () =>
  new Date().toLocaleString('en-US', {
    timeZone: zone(),
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

export { prompt, officeNow };
