// Running a staffer: each chat message or job run is Claude Code, or Grok, Codex
// or Gemini for an Odd the owner moved to one (cli.ts), run headless, with the staffer's job
// description from Postgres added to the system prompt. Server only.
//
// A Claude Code run gets five file tools (Read, Glob, Grep, Write, Edit), and
// with the owner's switches as its tool takes them (`OwnTools`), Bash in
// Claude Code's sandbox and WebSearch and WebFetch. It may read only its own
// folder, the owner's data folder, on a thread the thread's folder, and the
// folders the owner gave it (see `readable`), may write only inside the
// staffer's own folder, its own part of that thread's and the folders the
// owner gave it to change, except its tools' own instructions (`INSTRUCTIONS`
// in files.ts), git's usual places in a folder the owner gave it (hooks, the
// config file, submodules' copies: `REPO_RUNS`, which says what they do not
// stop) and, reading the owner's edit, that file (`deniedEdits`),
// loads no project settings, skills or plugins, and is denied anything not
// pre-approved. It always gets the office server (asks,
// tasks, the ledger), plus whatever access the owner granted: servers at read
// level (the tools the server marks as only reading, `readsOnly`) or at write
// level (every tool), each through the office's gateway (gateway.ts), which
// keeps the keys and sign-ins. Hosted servers get a fresh OAuth token per run.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import {
  DATABASE_URL,
  goal as findGoal,
  goalsFor,
  goalWhen,
  atDraft,
  capabilities,
  capped,
  handOffBrief,
  handOffContext,
  handOffsFor,
  resultsToJoin,
  runsGoing,
  servesHandOff,
  servesNoThread,
  thread as threadById,
  threadBrief,
  threadFolder,
  threadPart,
  threadsFor,
  recentThreads,
  recentThreadsBrief,
  threadsOn,
  threadsOnBrief,
  goalsLedBrief,
  ledStories,
  type ThreadLine,
  type ThreadStory,
  HEALTH_WORDS,
  handsOff,
  hasTool,
  jobsFor,
  callResultText,
  levelAtMost,
  writesWait,
  levelLine,
  lessonLine,
  lessonsOf,
  liveLessons,
  outsideLines,
  ownerName,
  ownerNoteOf,
  firstQuestionIn,
  FIRST_QUESTIONS,
  recordUsage,
  setPlanLimits,
  startFirstDay,
  claimPoke,
  deliveries,
  EDIT_CHARS,
  editShown,
  ask as askById,
  replyToReport,
  standsFor,
  stillOnDesk,
  report as reportById,
  staffer,
  task as taskById,
  taskFiles,
  type AskRow,
  type Capabilities,
  type EditShown,
  type FollowUpRow,
  type GoalRow,
  type FollowUpKind,
  type HandOffLine,
  type HandOffStep,
  type JobRow,
  type LessonLine,
  type Level,
  type RunTrigger,
  type ModelUsage,
  type Outcome,
  type ReportRow,
  type TaskRow,
  type PokeRow,
  type Agent,
  type StaffRow,
  type UsageKind,
  clockTime,
  pokeMissed,
  zone,
  zoneName,
  STAFF_SERVER,
  FILES_SERVER,
  filesViaOffice,
  AGENT_NAMES,
  folderLines,
  heldReach,
  holdNetwork,
  modelSection,
  networkHeld,
  officeSection,
  ownTools,
  ownToolsSaid,
  runsOnLine,
  SECRET_STORES,
  FOLDER_SAID,
  shownFolder,
  settingsTab,
  SWITCH_NAMES,
  switchesSaid,
  type OwnTools,
  chatSession,
  home,
  rulePath,
  effortFor,
  MANAGER_ROLE,
  modelFor,
  accountOf,
  accountsHome,
  OFFICE_ACCOUNT,
  toolHome,
  type CallPlace,
  type ConnectorRow
} from '@oddboro/ledger';
import { fixedError } from '@oddboro/ledger/errors';
import { workPath } from '@oddboro/ledger/work-paths';
import { filterWords } from '@oddboro/ledger/filters';
import { bus, emit } from './events.ts';
import { deniedEdits, denyRules, readStaffFile } from './files.ts';
import { floorTool, type Work } from '../staff/work.ts';
import { closeGateway, openGateway } from './gateway.ts';
import { awsReady } from './aws.ts';
import { bearer } from './oauth.ts';
import {
  apiKey,
  claudeAccountOf,
  claudeRunHome,
  claudeSettings,
  cleanEnv,
  modelArgs
} from './claude.ts';
import { notifyMac } from './notify.ts';
import { downtime, installsAt } from './update.ts';
import { catchUp, NOW, parseSession, saveSession, sectionsOf, sessionIdIn } from './resume.ts';
import { changedSince, replay, replayed, replayedAt, replaySince } from './replay.ts';
import { chatPreface } from './chat-preface.ts';
import { officeEnv } from './run-env.ts';
import { firstDayOf } from './first-day.ts';
import { endedEarly, LAUNCHES, stoppedWhy, streamTools, type Launch } from './cli.ts';
import { NOT_SIGNED_IN, shellEnv, SIGN_IN_WHERE, stopGroups } from './launch.ts';
import { tooOldLine } from './versions.ts';
import { claudeSandbox, NETWORK_REFUSED, NETWORK_REFUSED_LINE } from './sandbox.ts';
import { agentCommand } from './agent-sign-in.ts';
import { ACT_WRITE, house, stillOnDeskSection } from './house.ts';

/** The owner's data folder, which every staffer may read, whatever tool it runs on. */
const DATA = home('data');
const HOMES = home('staff');
const CHAT_TIMEOUT_MS = 5 * 60_000;
const JOB_TIMEOUT_MS = 20 * 60_000;

/** Something the staffer put on the owner's desk. */
export type ChatRef = { kind: 'ask' | 'task' | 'report'; id: number; title: string };
/**
 * A `poke` line is one the office delivered later, not a reply. A `told` line
 * is one the office said in the staffer's name that no run of its chat session
 * wrote, like a new manager's hello. An `item` line
 * is something the staffer put on the owner's desk, shown where it landed. An
 * owner's line with `re` replied about one of those. A `handOff` line is work
 * the staffer handed a colleague, or a colleague handed it. A `thread` line is
 * a thread the staffer leads, holding each hand-off it gave on it. A `lesson`
 * line is one the staffer kept, where it kept it.
 */
export type ChatEntry = {
  at: string;
  from: 'owner' | 'staff';
  text: string;
  poke?: true;
  told?: true;
  re?: ChatRef;
  item?: ChatRef & { status: string };
  lesson?: LessonLine;
  /** `back` is which hand-back a reply or pick-up line shows. */
  handOff?: { line: HandOffLine; step: HandOffStep; back?: number };
  thread?: { line: ThreadLine; steps: HandOffLine[] };
  /** On a reply a chat run wrote: milliseconds from the owner's message to the reply. */
  took?: number;
};
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

/**
 * Background runs at once per staffer: jobs, follow-ups and drafts. Each
 * starts a fresh session, so they run side by side; one more waits for a
 * free slot. A chat never waits for them. It resumes the staffer's one chat
 * session, so only a second chat waits.
 */
const AT_ONCE = 3;
const slots = new Map<string, { busy: number; queue: (() => void)[] }>();
const chatting = new Set<string>();
/** Staffer id to what it is running, for the floor: the first thing, and how many more. */
export const working: Record<string, string> = {};
/** Staffer id to its work in progress, waiting for a slot or running. */
export const inProgress: Record<string, Work[]> = {};
let workIds = 0;

/** Run `fn` in one of the staffer's slots, listed as work in progress until it ends. */
async function slot<T>(
  id: string,
  about: Pick<Work, 'kind' | 'label' | 'detail' | 'askId'>,
  fn: (onEvent: (e: ChatEvent) => void) => Promise<T>
): Promise<T> {
  const item: Work = {
    ...about,
    id: ++workIds,
    since: new Date().toISOString(),
    queued: true,
    steps: 0
  };
  (inProgress[id] ??= []).push(item);
  const s = slots.get(id) ?? { busy: 0, queue: [] };
  slots.set(id, s);
  if (s.busy < AT_ONCE) s.busy++;
  else {
    show(id);
    // A finished run hands its slot straight to the next in line.
    await new Promise<void>((go) => s.queue.push(go));
  }
  item.queued = false;
  item.since = new Date().toISOString();
  show(id);
  try {
    return await fn((e) => {
      if (e.type !== 'tool') return;
      item.doing = e.name;
      item.steps++;
      show(id);
    });
  } finally {
    inProgress[id] = (inProgress[id] ?? []).filter((w) => w !== item);
    if (!inProgress[id].length) delete inProgress[id];
    show(id);
    const next = s.queue.shift();
    if (next) next();
    else s.busy--;
  }
}

function show(id: string): void {
  const now = (inProgress[id] ?? []).filter((w) => !w.queued).map((w) => w.label);
  if (now.length) working[id] = now.length > 1 ? `${now[0]} +${now.length - 1} more` : now[0];
  else delete working[id];
  emit({ type: 'working', working: { ...working }, inProgress: structuredClone(inProgress) });
}

export async function isStaff(id: string): Promise<boolean> {
  return /^[a-z0-9-]+$/.test(id) && !!(await staffer(id));
}

export function isBusy(id: string): boolean {
  return chatting.has(id);
}

/** True while any staffer has a chat, job, follow-up or draft going. */
export function runsActive(): boolean {
  return chatting.size > 0 || Object.keys(inProgress).length > 0;
}

function homeOf(id: string): string {
  const dir = join(HOMES, id);
  mkdirSync(join(dir, 'notes'), { recursive: true });
  return dir;
}

const chatFile = (id: string) => join(homeOf(id), 'chat.jsonl');
const addToChat = (id: string, line: ChatEntry) =>
  appendFileSync(chatFile(id), JSON.stringify(line) + '\n');

export function history(id: string): ChatEntry[] {
  const file = chatFile(id);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatEntry);
}

/** The chat as the owner sees it: what was said, and each delivery and lesson where it landed. */
export async function chatLog(id: string): Promise<ChatEntry[]> {
  const items: ChatEntry[] = (await deliveries(id)).map(({ at, ...d }) => ({
    at: at.toISOString(),
    from: 'staff',
    text: '',
    item: d
  }));
  const kept: ChatEntry[] = (await lessonsOf(id))
    .filter((l) => l.heardBy === id)
    .map(({ id: lessonId, text, quote, appliesTo, how, status, staffId, missed, createdAt }) => ({
      at: createdAt.toISOString(),
      from: 'staff',
      text: '',
      lesson: { id: lessonId, text, quote, appliesTo, how, status, staffId, missed }
    }));
  // Each step of a hand-off lands where it happened, so a reply that came back
  // an hour later sits after whatever was said in that hour. The giver's chat
  // keeps the colleague's reply inside the hand-off and shows its own pick-up.
  // A hand-off it gave sits on the card of its thread, where the thread began.
  const lines = await handOffsFor(id);
  const threads: ChatEntry[] = (await threadsFor(id)).map((line) => ({
    at: line.at.toISOString(),
    from: 'staff',
    text: '',
    thread: { line, steps: lines.filter((h) => h.gave && h.threadId === line.id) }
  }));
  const handOffs: ChatEntry[] = lines.flatMap((line) => {
    const at = (d: Date, step: HandOffStep, back?: number): ChatEntry => ({
      at: d.toISOString(),
      from: 'staff',
      text: '',
      handOff: { line, step, back }
    });
    return [
      ...(line.gave ? [] : [at(line.at, 'given')]),
      ...line.backs.flatMap((b, i) =>
        line.gave
          ? b.pickUp.at && b.pickUp.text
            ? [at(b.pickUp.at, 'next', i)]
            : []
          : b.answered
            ? []
            : [at(b.at, 'reply', i)]
      )
    ];
  });
  return [...history(id), ...items, ...threads, ...handOffs, ...kept].sort((a, b) =>
    a.at.localeCompare(b.at)
  );
}

/** What the staffer needs to know about the delivery the owner is replying about. */
async function replyBrief(
  id: string,
  re: Pick<ChatRef, 'kind' | 'id'>
): Promise<{ ref: ChatRef; brief: string }> {
  if (re.kind === 'ask') {
    const a = await askById(re.id);
    if (a?.staffId !== id) throw fixedError('No such ask from this Odd');
    return {
      ref: { kind: 'ask', id: a.id, title: a.title },
      brief: [
        `({owner} is replying about your ask #${a.id}, "${a.title}", which is ${a.status === 'open' ? 'still open' : a.status}.`,
        `- Why: ${a.why}`,
        `- If approved: ${a.ifApproved}`,
        ...(a.reason ? [`- Their reason: ${a.reason}`] : []),
        ')'
      ].join('\n')
    };
  }
  if (re.kind === 'task') {
    const t = await taskById(re.id);
    if (t?.staffId !== id) throw fixedError('No such task from this Odd');
    return {
      ref: { kind: 'task', id: t.id, title: t.title },
      brief: [
        `({owner} is replying about the task you gave them, "${t.title}", which is ${t.status === 'open' ? 'still open' : t.status}.`,
        `- Why: ${t.why}`,
        ...t.steps.map(
          (st, i) =>
            `- Step ${i + 1}: ${st.text}${st.done ? ' (done)' : ''}${st.answer ? `. Their answer: ${st.answer}` : ''}`
        ),
        ...(t.note ? [`- Their note: ${t.note}`] : []),
        ')'
      ].join('\n')
    };
  }
  const r = await reportById(re.id);
  if (r?.staffId !== id) throw fixedError('No such report from this Odd');
  return {
    ref: { kind: 'report', id: r.id, title: r.title },
    brief: [
      `({owner} is replying about your report "${r.title}". If it is feedback, act on it: work inside the office now, raise_ask before changing one of your jobs, or anything outside the office ${ACT_WRITE}, and give_owner_a_task for anything only they can do.`,
      '',
      'The report:',
      '',
      r.body.slice(0, 8000),
      ')'
    ].join('\n')
  };
}

/** Every plugin in the owner's user settings, switched off for staff sessions. */
export function pluginsOff(): Record<string, false> {
  try {
    const user = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8')) as {
      enabledPlugins?: Record<string, boolean>;
    };
    return Object.fromEntries(Object.keys(user.enabledPlugins ?? {}).map((k) => [k, false]));
  } catch {
    return {};
  }
}

/**
 * A clean environment: the owner's Claude login, or the API key they gave the
 * office, and never a key or settings that leaked in from a parent session.
 */
export function staffEnv(claudeDir?: string): NodeJS.ProcessEnv {
  const env = cleanEnv();
  delete env.ANTHROPIC_API_KEY;
  if (claudeSettings().auth === 'key') env.ANTHROPIC_API_KEY = apiKey();
  // The account's own Claude Code folder: its login, settings and sessions.
  if (claudeDir) env.CLAUDE_CONFIG_DIR = claudeDir;
  return env;
}

/**
 * The tool folder an Odd's runs use: its account's (accounts.ts), or '' for
 * the owner's own Claude login, which an Office account not yet signed in
 * keeps (`claudeRunHome`). A saved session counts only in the folder it was
 * made in.
 */
export async function runHomeOf(who: StaffRow): Promise<string> {
  const account = await accountOf(who);
  if (who.agent === 'claude') return (await claudeRunHome(account)) ?? '';
  return toolHome(who.agent, account);
}

type Server = Record<string, unknown>;

/**
 * The office's own settings from .env that the staff tool server reads, set
 * on the server itself. Grok's sandbox holds that server too and will not
 * open .env, so the server never depends on reading it.
 */
const OFFICE_SETTINGS = ['OFFICE_TIME_ZONE', 'OFFICE_AGENT'] as const;
const officeSettings = (): Record<string, string> =>
  Object.fromEntries(
    OFFICE_SETTINGS.flatMap((k) => (process.env[k] ? [[k, process.env[k] as string]] : []))
  );

/**
 * The servers and tool permissions one run gets: the outside tools
 * `capabilities` says it holds. A run from a hand-off works at Draft at most
 * (`ceiling`), so a colleague's words never stand in for the owner's yes. Its
 * caps come down to the ceiling too (`capped`), so its prompt lists what it loads.
 * Every outside tool reaches the run through the office's gateway
 * (gateway.ts), which keeps the keys and passes on only the tools the grant
 * reaches; `gate` is the run's token, closed when the run ends. The tool's own
 * allow list names the same tools, so either one alone holds. A write grant
 * at Draft lists every tool, and the gateway holds each change for the
 * owner's yes (`writesWait`), on the desk where `place` says; a run with no
 * place (a lesson run) changes nothing.
 */
async function access(who: StaffRow, ceiling: Level, ms: number, place?: CallPlace) {
  const servers: Record<string, Server> = {
    office: {
      command: process.execPath,
      args: [STAFF_SERVER],
      env: {
        STAFF_ID: who.id,
        DATABASE_URL,
        ...officeSettings(),
        // In the app on a Mac only the office reaches the Keychain, through
        // the shell; the tool server keeps no secret of its own.
        ...(process.env.ODDBORO_SECRETS === 'shell' ? { ODDBORO_SECRETS: 'office' } : {})
      }
    }
  };
  const allowed = ['mcp__office'];
  const caps = capped(await capabilities(who), ceiling);
  const reach: { connector: ConnectorRow; level: Level; waits: boolean }[] = [];
  for (const a of caps.outside) {
    if (a.heldBack) continue;
    const c = a.connector;
    // A sign-in that ran out shows only now, as the office asks for a fresh token.
    if (c.config.oauth && !(await bearer(c.id).catch(() => undefined))) {
      a.heldBack = 'sign-in ran out';
      continue;
    }
    // So does an AWS sign-in that ended, for AWS itself and any tool whose key is kept there.
    if (!(await awsReady(c))) {
      a.heldBack = 'sign-in ran out';
      continue;
    }
    reach.push({ connector: c, level: a.level, waits: writesWait(a.level, caps.level) });
    if (a.level === 'act') allowed.push(`mcp__${c.id}`);
    else allowed.push(...c.readTools.map((t) => `mcp__${c.id}__${t}`));
  }
  const { token: gate, servers: outside } = openGateway(reach, ms, place);
  Object.assign(servers, outside);
  return { servers, allowed, caps, gate };
}

/**
 * Who the staffer works for, built fresh each run: the owner, the people in
 * their life, its own intake, and the goals it serves, which are the only
 * goals it sees.
 */
async function whoFor(who: StaffRow, dir: string): Promise<string> {
  const people = join(DATA, 'people.json');
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
    '- {owner}. This office is theirs, and runs on their Mac.',
    existsSync(people) && `- The people in their life are listed in ${people}, which you may read.`,
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
 * its lead. `led` are the stories of the threads it leads that the run is
 * told in full (`ledStories`): the lead's run on its thread is told how to
 * move it on, and its chat where each of its goals stands.
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
    shown?: number[];
    own: OwnTools;
    /** Whether this office holds the network (`networkHeld`), read once as the run starts. */
    officeHeld: boolean;
    /** Whether the run is told the threads it leads, by the tool server's own rule (`handsOff`). */
    leads: boolean;
  }
): Promise<string> {
  const { dir, own, leads } = opts;
  // run() fills in the time, so the rest can be compared with what a resumed session saw.
  const now = NOW;
  const updating = installsAt();
  return (
    who.desk +
    '\n' +
    (await whoFor(who, dir)) +
    (await taught(who)) +
    // A chat is told each live goal it leads in full (`goalsLedBrief`), so its list leaves them out.
    (leads
      ? recentThreadsBrief(
          await recentThreads(who.id, { told: opts.led.map((story) => story.thread.id) })
        )
      : '') +
    (opts.chat ? threadsOnBrief(await threadsOn(who.id)) : '') +
    (opts.thread
      ? opts.led.flatMap((story) => threadBrief({ story, shown: opts.shown })).join('\n')
      : goalsLedBrief(opts.led)) +
    stillOnDeskSection(await stillOnDesk(who.id)) +
    house({
      has: (t) => hasTool(who.tools, t),
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

type Run = { ok: boolean; text: string };

type Window = { utilization?: number; resetsAt?: number };

/** Every run reports the owner's plan windows it has news of, often only one. Keep the latest of each. */
export async function notePlan(info: unknown): Promise<void> {
  const w = (info as { unifiedWindows?: Record<string, Window> } | undefined)?.unifiedWindows;
  const five = w?.five_hour;
  const week = w?.seven_day;
  const when = (s?: number) => (s ? new Date(s * 1000) : null);
  const news = {
    ...(typeof five?.utilization === 'number'
      ? { fiveHour: five.utilization, fiveHourResetsAt: when(five.resetsAt) }
      : {}),
    ...(typeof week?.utilization === 'number'
      ? { sevenDay: week.utilization, sevenDayResetsAt: when(week.resetsAt) }
      : {})
  };
  if (Object.keys(news).length) await setPlanLimits(news).catch(() => {});
}

/**
 * What a staffer's file tools may read: its own folder, the owner's data
 * folder, Claude Code's folder for this run's sessions (long tool results
 * land there), the folder of each thread the run reads (`reads`), and the
 * folders the owner gave it (`granted`). Read rules govern Glob and Grep too,
 * and dontAsk turns down every other path. With Run commands, the sandbox
 * reads the same list.
 */
function readable(dir: string, reads: number[], granted: string[], claude: string): string[] {
  return [dir, DATA, sessionsFolder(dir, claude), ...reads.map(threadFolder), ...granted];
}

/**
 * What a run reads beyond its own: `readable` less the run's folder, which
 * each tool reaches already as its working folder, and Claude Code's sessions
 * folder, which is Claude Code's own. Every tool's launch, and Claude Code's
 * `--add-dir` without commands, read this one list, in `readable`'s order.
 */
function readsBeyond(dir: string, reads: number[], granted: string[], claude: string): string[] {
  const own = [dir, sessionsFolder(dir, claude)];
  return readable(dir, reads, granted, claude).filter((p) => !own.includes(p));
}

/**
 * Claude Code's folder for the sessions of a run in `dir`, where long tool
 * results land, in its account's folder (`claude`): ~/.claude for the owner's
 * own login.
 */
function sessionsFolder(dir: string, claude: string): string {
  return join(claude, 'projects', sessionsOf(dir));
}

/** Claude Code names a working folder's sessions folder after its path. */
function sessionsOf(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * What no staffer may read, even when the owner's own Claude Code settings
 * allow it: a deny rule beats every allow. Secret stores, the rest of the
 * office's folder and other staffers' folders, and the rest of Claude Code's
 * folder, sessions included. Each is denied with everything under it (`denyRules`).
 */
function unreadable(
  id: string,
  dir: string,
  threads: number[],
  granted: string[],
  claude: string
): string[] {
  const reads = readable(dir, threads, granted, claude);
  const besides = (parent: string, keep: string[]) => {
    try {
      return readdirSync(parent)
        .filter((n) => !keep.includes(n))
        .map((n) => join(parent, n));
    } catch {
      return [];
    }
  };
  const paths = [
    // ~/.claude among them, which this run's sessions folder, read, keeps open:
    // the two lines at the end shut the rest of it.
    ...SECRET_STORES.map((p) => join(homedir(), p)),
    ...besides(home(), ['staff', 'data', ...(threads.length ? ['threads'] : [])]),
    ...besides(HOMES, [id]),
    // Every other thread's folder. Claude Code takes a read rule on a folder
    // to cover writes too, so none may cover this run's own part.
    ...(threads.length ? besides(dirname(threadFolder(threads[0])), threads.map(String)) : []),
    // An account's Claude folder sits in the office's accounts folder, which
    // its sessions folder keeps open: shut every other tool's and account's.
    ...(claude.startsWith(`${accountsHome()}${sep}`)
      ? [
          ...besides(accountsHome(), ['claude']),
          ...besides(join(accountsHome(), 'claude'), [basename(claude)])
        ]
      : []),
    ...besides(claude, ['projects']),
    ...besides(join(claude, 'projects'), [sessionsOf(dir)])
  ];
  // Never deny a folder a staffer must read, such as an office kept under ~/Library.
  const covers = (p: string) => reads.some((r) => r === p || r.startsWith(`${p}${sep}`));
  return [...new Set(paths)]
    .filter((p) => !covers(p))
    .flatMap((p) => denyRules(['Read'], rulePath(p)));
}

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

/**
 * A run ended, so pick-ups it held may start (follow-ups.ts).
 * The page never hears it: /api/events sends only `event`.
 */
export const RUN_ENDED = 'run-ended';

/**
 * One headless run on the Odd's coding tool. `session` resumes a saved session
 * file, or starts fresh. A tool that will not start fails the run, naming the
 * tool: no run falls back to another.
 */
async function run(
  who: StaffRow,
  message: string,
  opts: {
    kind: UsageKind;
    sessionFile?: string;
    extra?: string;
    /** The owner's own message, when this is a chat. */
    ownerSaid?: string;
    /** The ask the owner approved that this run carries out: the only one its self-edits may cite. */
    approvedAsk?: number;
    /** The owner's note a follow-up carries out, which a lesson may quote. */
    ownerNote?: string;
    /** The file the owner edited, and their version of it, which a lesson read from it quotes. The run may not write that file. */
    ownerEdit?: { path: string; text: string };
    /** Draft at most: a follow-up `atDraft` names. */
    draftOnly?: boolean;
    /** A run that only reads the owner's reason or edit for a lesson (`servesNoThread`): it hands nothing on. */
    lessonRun?: boolean;
    /** The hand-off a colleague's run serves: asks and tasks it raises carry it, and it cannot hand off. */
    handOffId?: number;
    /** The thread the run works on, either side: it reads the thread's folder and writes its own part. */
    threadId?: number;
    /** On a lead's pick-up of a colleague's result, that colleague: what the run puts on the desk names them. */
    via?: string;
    /** The hand-backs this run's brief already holds in full, so its lead's story leaves them out. */
    shown?: number[];
    timeoutMs: number;
    onEvent?: (e: ChatEvent) => void;
  }
): Promise<Run> {
  const dir = homeOf(who.id);
  // The account its tool signs in with, and that account's folder. A session
  // saved in another folder (the Odd moved accounts) cannot resume here.
  const account = await accountOf(who);
  const toolDir = await runHomeOf(who);
  const read =
    opts.sessionFile && existsSync(opts.sessionFile)
      ? parseSession(readFileSync(opts.sessionFile, 'utf8'))
      : undefined;
  const saved = read && (read.home ?? '') === toolDir ? read : undefined;
  /** Claude Code's folder for this run: the account's, or ~/.claude for the owner's own login. */
  const claudeDir = toolDir || join(homedir(), '.claude');
  const ceiling = opts.draftOnly && levelAtMost('draft', who.permission) ? 'draft' : who.permission;
  // Every run gets a key: a thread it hands off on keeps it, and holds the
  // Odd's pick-ups there until it ends (`runsGoing`), even when it is a
  // follow-up on no thread. A call the gateway holds for the owner carries it too.
  const key = randomUUID();
  const { servers, allowed, caps, gate } = await access(
    who,
    ceiling,
    opts.timeoutMs,
    opts.lessonRun
      ? undefined
      : {
          staffId: who.id,
          run: key,
          handOffId: opts.handOffId,
          threadId: opts.threadId,
          via: opts.via
        }
  );
  // Prompts name the owner as {owner}: each install's staff use its own name.
  const owner = await ownerName();
  const say = (s: string) => s.replaceAll('{owner}', owner);
  // Claude Code keeps a session's first system prompt on --resume, so a
  // resumed run's message carries the time and the sections that changed.
  const prior = saved?.sessionId;
  const time = officeNow();
  const inChat = opts.kind === 'chat';
  // What the lead knows of the threads it leads, read now, as the run starts.
  // A lead's chat reads its goals' folders, as its pick-ups there do.
  const led = opts.threadId
    ? await ledStories(who.id, { thread: opts.threadId })
    : inChat
      ? await ledStories(who.id, 'chat')
      : [];
  const reads = opts.threadId ? [opts.threadId] : led.map((s) => s.thread.id);
  // The owner's switches and folders as this run's tool takes them (the
  // ledger's `ownTools`, which `capabilities` worked out once), less a network
  // this office holds back after Claude Code refused the open one. Read once,
  // so the run, its prompt and its tool server agree.
  const officeHeld = networkHeld();
  const own = heldReach(who.agent, caps.own, officeHeld);
  const extraReads = own.granted.map((f) => f.path);
  const extraWrites = own.granted.filter((f) => f.write).map((f) => f.path);
  // From the facts officeEnv hands the tool server, so the prompt lists the
  // threads a run leads only when that run is offered hand_off.
  const { leads } = handsOff(who.tools, {
    thread: !!opts.threadId,
    handOff: !!opts.handOffId,
    lesson: !!opts.lessonRun
  });
  const system = say(
    (await prompt(who, {
      dir,
      caps,
      owner,
      thread: opts.threadId,
      chat: inChat,
      led,
      shown: opts.shown,
      own,
      officeHeld,
      leads
    })) + (opts.extra ?? '')
  );
  const sections = sectionsOf(system, say(who.desk));
  const preface = prior ? catchUp(saved?.seen, sections, time) : '';
  // In a chat, the office tools get the owner's own words, so a change the owner asks for
  // there is recorded as their decision without an ask.
  Object.assign(
    servers.office.env as Record<string, string>,
    officeEnv({
      key,
      ownerSaid: opts.ownerSaid,
      approvedAsk: opts.approvedAsk,
      signedOut: caps.outside
        .filter((a) => a.heldBack === 'sign-in ran out')
        .map((a) => a.connector.id),
      ownerNote: opts.ownerNote,
      ownerEdit: opts.ownerEdit?.text,
      ceiling: ceiling !== who.permission ? ceiling : undefined,
      handOffId: opts.handOffId,
      threadId: opts.threadId,
      via: opts.via,
      lessonRun: !!opts.lessonRun,
      // Every run while held, whatever its own tool or switches: its
      // office_report speaks of other Odds too.
      networkHeld: officeHeld
    })
  );
  // On a thread, the run writes only its own part of the thread's folder.
  const part = opts.threadId ? threadPart(opts.threadId, who.id) : undefined;
  if (part) mkdirSync(part, { recursive: true });
  const writes = [dir, ...(part ? [part] : []), ...extraWrites];
  const denied = deniedEdits({
    dir,
    writes,
    granted: extraWrites,
    edited: opts.ownerEdit?.path
  });
  // Where the office carries the run's files (`FILES_VIA_OFFICE`), its tool's
  // own file tools are off and the office's file server is its one way to
  // files, holding the same folders on every system: it reads what the run
  // reads, writes what it writes, and never writes what `deniedEdits` names.
  const officeFiles = filesViaOffice(who.agent, process.platform);
  if (officeFiles) {
    servers.files = {
      command: process.execPath,
      args: [FILES_SERVER],
      env: {
        ODDBORO_FILES: JSON.stringify({
          cwd: dir,
          reads: readsBeyond(dir, reads, extraReads, claudeDir),
          writes,
          noWrite: denied
        })
      }
    };
    allowed.push('mcp__files');
  }
  // Bash writes in every folder Claude Code works in (the cwd and each
  // --add-dir), whatever the Edit rules say. So with commands, only the
  // folders the run writes are added, and the sandbox's denyWrite, which beats
  // them, holds the data folder and what `deniedEdits` names: never a folder the
  // run only reads, since one may hold a folder it writes (measured on Claude
  // Code 2.1.318). A data folder that is not there is left out: it sits in
  // the office's home, which is neither the cwd nor added, so nothing in the
  // run can make it.
  const data = existsSync(DATA) ? [DATA] : [];
  // Commands get a temp folder of their own: short, since a long one falls
  // back to the folder every run shares, and spelt /private/tmp, since /tmp
  // broke every command (both measured). Commands are on only on a Mac.
  const tmp = own.commands ? `/private/tmp/ob-${key.slice(0, 8)}` : undefined;
  // The temp folder comes last: npm keeps its cache there (`shellEnv`), and
  // without it in --add-dir the sandbox refuses npm's writes (measured).
  const workIn = tmp
    ? [...data, ...(part ? [part] : []), ...extraWrites, tmp]
    : readsBeyond(dir, reads, extraReads, claudeDir);
  // The owner's pick for this Odd, or Medium; never below Medium for the Office Manager.
  const model = modelFor(who.agent, who.model);
  const effort = effortFor(who.agent, who.effort, who.role === MANAGER_ROLE, model);
  function claudeArgs(env: NodeJS.ProcessEnv): string[] {
    return [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      // With the office carrying its files, no file tool of its own; with no
      // other tool either, an empty list, which Claude Code takes as none.
      '--tools',
      [
        ...(officeFiles ? [] : ['Read,Glob,Grep,Write,Edit']),
        ...(own.commands ? ['Bash'] : []),
        ...(own.web ? ['WebSearch,WebFetch'] : [])
      ].join(','),
      '--allowedTools',
      ...readable(dir, reads, extraReads, claudeDir).map((p) => `Read(${rulePath(p)}/**)`),
      // Edit rules cover every file-writing tool; Claude Code ignores Write(path).
      ...writes.map((w) => `Edit(${rulePath(w)}/**)`),
      ...(own.commands ? ['Bash'] : []),
      ...(own.web ? ['WebSearch', 'WebFetch'] : []),
      ...allowed,
      '--disallowedTools',
      ...unreadable(who.id, dir, reads, extraReads, claudeDir),
      ...denied.flatMap((p) => denyRules(['Edit'], rulePath(p))),
      '--permission-mode',
      'dontAsk',
      '--setting-sources',
      'user',
      '--strict-mcp-config',
      '--mcp-config',
      mcpFile,
      '--disable-slash-commands',
      '--settings',
      JSON.stringify({
        enabledPlugins: pluginsOff(),
        ...(tmp
          ? {
              sandbox: claudeSandbox({
                reads: readable(dir, reads, extraReads, claudeDir).filter(
                  (p) => p !== DATA || data.length
                ),
                tmp,
                denyWrite: [...data, ...denied],
                network: own.network,
                env
              })
            }
          : {})
      }),
      ...workIn.flatMap((p) => ['--add-dir', p]),
      // The Odd's own model, or the office's Opus or Sonnet from setup.
      ...(model ? ['--model', model] : modelArgs()),
      ...(effort ? ['--effort', effort] : []),
      '--append-system-prompt',
      system.replaceAll(NOW, time),
      ...(prior ? ['--resume', prior] : ['--session-id', randomUUID()])
    ];
  }
  const input = preface + say(message);
  /**
   * The run's servers, the gateway's token among them, go to Claude Code in a
   * file only the owner can read, in a folder no run reads, removed when the
   * run ends: on the command line any program on this computer could read
   * them with `ps`, an Odd's own commands included.
   */
  const mcpFile = home('mcp', `${key}.json`);
  function writeMcpFile(): () => void {
    mkdirSync(home('mcp'), { recursive: true, mode: 0o700 });
    writeFileSync(mcpFile, JSON.stringify({ mcpServers: servers }), { mode: 0o600 });
    return () => rmSync(mcpFile, { force: true });
  }
  /** A Claude Code run; with commands, their temp folder and the git template in it, made now and removed when the run ends. */
  function claudeLaunch(): Launch {
    const env = staffEnv(toolDir || undefined);
    const dropMcp = writeMcpFile();
    if (!tmp) return { args: claudeArgs(env), env, stdin: input, done: dropMcp };
    mkdirSync(tmp, { recursive: true, mode: 0o700 });
    const shell = shellEnv(tmp);
    mkdirSync(shell.GIT_TEMPLATE_DIR, { mode: 0o700 });
    // The office's git and npm settings (`shellEnv`), and none of the office's
    // own node options, which every node a command starts would take as its own.
    delete env.NODE_OPTIONS;
    Object.assign(env, { CLAUDE_CODE_TMPDIR: tmp, ...shell });
    return {
      args: claudeArgs(env),
      env,
      stdin: input,
      done: () => {
        dropMcp();
        rmSync(tmp, { recursive: true, force: true });
      }
    };
  }
  // An added Claude account nobody signed in to: say where to sign in, rather than Claude Code's own advice.
  if (who.agent === 'claude' && account !== OFFICE_ACCOUNT && !(await claudeAccountOf(account))) {
    const line = `Claude Code ${NOT_SIGNED_IN}`;
    opts.onEvent?.({ type: 'error', message: line });
    return { ok: false, text: line };
  }
  // A tool older than the office runs fails on a switch it does not know, so it never starts.
  const tooOld = await tooOldLine(who.agent, SIGN_IN_WHERE);
  if (tooOld) {
    opts.onEvent?.({ type: 'error', message: tooOld });
    return { ok: false, text: tooOld };
  }
  const launch: Launch | { refused: string } =
    who.agent === 'claude'
      ? claudeLaunch()
      : await LAUNCHES[who.agent]({
          key,
          staffId: who.id,
          dir,
          reads: readsBeyond(dir, reads, extraReads, claudeDir),
          part,
          writes,
          granted: extraWrites,
          edited: opts.ownerEdit?.path,
          system: system.replaceAll(NOW, time),
          input,
          resume: prior,
          servers,
          allowed,
          timeoutMs: opts.timeoutMs,
          web: own.web,
          commands: own.commands,
          network: own.network,
          effort,
          model,
          account
        });
  if ('refused' in launch) {
    opts.onEvent?.({ type: 'error', message: launch.refused });
    return { ok: false, text: launch.refused };
  }
  const tool = AGENT_NAMES[who.agent];

  return new Promise((done) => {
    runsGoing.add(key);
    // The command the page counts as installed, such as a Grok only in xAI's
    // install folder or an npm Claude Code on Windows; by name when there is
    // none, so the run fails naming it.
    const [cmd, before] = agentCommand(who.agent) ?? [who.agent, []];
    const child = spawn(cmd, [...before, ...launch.args], {
      cwd: dir,
      env: launch.env,
      detached: !!launch.ownGroup,
      windowsHide: true
    });
    /** Stop the tool, and with a group of its own, whatever its commands left running. */
    const stop = () => {
      if (!launch.ownGroup) return child.kill();
      if (child.pid) stopGroups(child.pid);
    };
    let buffer = '';
    let stderr = '';
    let reply = '';
    /** The last whole message a Codex or Gemini run sent, which is its reply. */
    let last = '';
    let session: string | undefined;
    let finished = false;
    const finish = (end: Run) => {
      if (finished) return;
      finished = true;
      // A Claude Code that refuses the open network fails this run: the owner
      // is told plainly, and from now on this office's Claude Code runs keep
      // their commands off the internet (`holdNetwork`).
      const refused =
        !end.ok &&
        who.agent === 'claude' &&
        own.network &&
        NETWORK_REFUSED.test(`${end.text}\n${stderr}`);
      if (refused)
        void holdNetwork().catch((e: unknown) =>
          console.error("Could not record that Odds' commands stay off the internet:", e)
        );
      // Keyed on the owner's message, not the kind: a new hire's hello is a
      // chat run the owner sent nothing to.
      const line = NETWORK_REFUSED_LINE[opts.ownerSaid === undefined ? 'unsent' : 'sent'];
      const r = refused ? { ok: false, text: line.replaceAll('{name}', who.name) } : end;
      clearTimeout(timer);
      runsGoing.delete(key);
      launch.done();
      void closeGateway(gate);
      bus.emit(RUN_ENDED);
      if (session && opts.sessionFile)
        saveSession(opts.sessionFile, { sessionId: session, seen: sections, home: toolDir });
      opts.onEvent?.(r.ok ? { type: 'done', text: r.text } : { type: 'error', message: r.text });
      done(r);
    };
    const timer = setTimeout(() => {
      stop();
      finish({ ok: false, text: `No reply after ${opts.timeoutMs / 60_000} minutes.` });
    }, opts.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (launch.read) {
          for (const ev of launch.read(e)) {
            if (ev.type === 'session') session = ev.id;
            else if (ev.type === 'tool') opts.onEvent?.({ type: 'tool', name: floorTool(ev.name) });
            else if (ev.type === 'message') {
              const text = (reply ? '\n\n' : '') + ev.text;
              reply += text;
              last = ev.text;
              opts.onEvent?.({ type: 'delta', text });
            } else if (ev.type === 'usage')
              void recordUsage(who.id, opts.kind, ev.usage).catch(() => {});
            else if (ev.type === 'done') finish({ ok: true, text: last.trim() });
            else if (ev.type === 'failed') finish({ ok: false, text: ev.message });
            // Said again when the tool stops, if the run ends there.
            else stderr += `${ev.message}\n`;
          }
          continue;
        }
        if (typeof e.session_id === 'string') session = e.session_id;
        if (e.type === 'rate_limit_event') void notePlan(e.rate_limit_info);
        if (e.type === 'result' && e.modelUsage)
          void recordUsage(who.id, opts.kind, e.modelUsage as ModelUsage).catch(() => {});
        for (const name of streamTools(who.agent, e))
          opts.onEvent?.({ type: 'tool', name: floorTool(name) });
        if (e.type === 'stream_event') {
          const ev = e.event as { type: string; delta?: { type: string; text?: string } };
          if (
            ev.type === 'content_block_delta' &&
            ev.delta?.type === 'text_delta' &&
            ev.delta.text
          ) {
            reply += ev.delta.text;
            opts.onEvent?.({ type: 'delta', text: ev.delta.text });
          } else if (ev.type === 'message_start' && reply && !reply.endsWith('\n\n')) {
            // A new turn after a tool call: keep its text apart from the last.
            reply += '\n\n';
            opts.onEvent?.({ type: 'delta', text: '\n\n' });
          }
        } else if (e.type === 'result') {
          if (e.subtype === 'success') finish({ ok: true, text: String(e.result ?? reply).trim() });
          else finish({ ok: false, text: endedEarly(who.agent, e) });
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => (stderr += c));
    child.on('error', (err) =>
      finish({ ok: false, text: `Could not start ${tool}: ${err.message}` })
    );
    child.on('close', (code) => {
      if (launch.ownGroup) stop();
      finish({
        ok: false,
        text: stoppedWhy(who.agent, code, stderr)
      });
    });
    child.stdin.end(launch.stdin);
  });
}

/** Send one chat message. Resolves when the reply is complete; events stream through `onEvent`. */
export async function chat(
  id: string,
  message: string,
  onEvent: (e: ChatEvent) => void,
  replyTo?: Pick<ChatRef, 'kind' | 'id'>
): Promise<void> {
  if (chatting.has(id)) throw new Error(`${id} is already replying`);
  const who = await staffer(id);
  if (!who) throw new Error(`No Odd named ${id}`);
  chatting.add(id);
  // Stamped when sent, so what the staffer delivers while replying lands between the two.
  const sent = new Date().toISOString();
  try {
    // An answer to a manager's first or second question (`FIRST_QUESTIONS`):
    // the office asks the next one itself, at once and with no run. The third
    // answer runs the manager, which reads all three in the chat.
    const last = history(id).at(-1);
    const asked = last?.from === 'staff' ? firstQuestionIn(last.text) : -1;
    if (asked >= 0 && asked < FIRST_QUESTIONS.length - 1) {
      const next = FIRST_QUESTIONS[asked + 1].ask;
      addToChat(id, { at: sent, from: 'owner', text: message });
      addToChat(id, { at: new Date().toISOString(), from: 'staff', text: next, told: true });
      onEvent({ type: 'done', text: next });
      return;
    }
    // Lines the office wrote in the chat, and work put on the desk, since the
    // owner last wrote are not in the session: say so, so an answer to the
    // hello, "How did the call go?" or "What about Thursday?" makes sense to
    // the staffer.
    const re = replyTo ? await replyBrief(id, replyTo) : undefined;
    const landed = (await deliveries(id, 20)).filter(
      (d) => !(d.kind === re?.ref.kind && d.id === re.ref.id)
    );
    const past = history(id);
    // A new session (the Odd moved to another tool, or its session is gone)
    // never saw the chat: it gets the latest of it word for word. The preface
    // leaves out the told and poke lines the replay holds, and keeps those the
    // budget cut, so each line since the owner last wrote is said once.
    const kept = sessionIdIn(chatSession(id), await runHomeOf(who)) ? [] : replayed(past);
    const inReplay = new Set(replayedAt(past, kept));
    const since = replaySince(past, kept);
    // The Odd writes only its own folder and the given folders it may change, so only those are walked.
    const writable = ownTools(who, process.platform)
      .granted.filter((f) => f.write)
      .map((f) => f.path);
    const prompt = [
      ...(since
        ? [replay(past, changedSince(homeOf(id), since, [chatFile(id), chatSession(id)], writable))]
        : []),
      ...chatPreface(
        past.filter((e, i) => !(inReplay.has(i) && (e.told || e.poke))),
        landed
      ),
      ...(re ? [re.brief] : []),
      message
    ].join('\n\n');
    const r = await run(who, prompt, {
      kind: 'chat',
      ownerSaid: message,
      sessionFile: chatSession(id),
      timeoutMs: CHAT_TIMEOUT_MS,
      onEvent
    });
    if (r.ok) {
      addToChat(id, { at: sent, from: 'owner', text: message, re: re?.ref });
      // `took`: how long the owner waited for this reply, from when they sent.
      const at = new Date();
      addToChat(id, {
        at: at.toISOString(),
        from: 'staff',
        text: r.text,
        took: at.getTime() - Date.parse(sent)
      });
      if (re?.ref.kind === 'report') await replyToReport(re.ref.id, message);
    }
  } finally {
    chatting.delete(id);
  }
}

/** Run one job in a fresh session. The staffer walks to its room while it runs. */
export async function runJob(job: JobRow, trigger: RunTrigger = 'schedule'): Promise<Run> {
  const who = await staffer(job.staffId);
  if (!who) return { ok: false, text: `No Odd named ${job.staffId}` };
  return slot(who.id, { kind: 'job', label: job.name, detail: 'Running a job' }, (onEvent) =>
    run(who, job.instructions, {
      kind: 'job',
      onEvent,
      timeoutMs: JOB_TIMEOUT_MS,
      extra: `\n## This run\n\nYou are running your job "${job.name}". {owner} is not in a chat with you.${trigger === 'manual' ? ' They started this run by hand just now, so they are at their screen: send anything the job has for them now (poke_owner with in_minutes 0), whatever quiet hours you keep for them.' : ''} Do the job, then reply with what you did in a few plain lines. Your reply goes in the ledger${job.report ? ' and on their desk as a report' : ''}.\n`
    })
  );
}

/** The owner's answers a hub picks its thread up with, one a line (`answerThread`). */
const answers = (note: string | null): string[] =>
  (note ?? '').split('\n').map((line) => `- ${line}`);

/** What the staffer is told, for each kind of follow-up. */
function followUpBrief(
  f: FollowUpRow,
  a?: AskRow,
  r?: ReportRow,
  t?: { row: TaskRow; files: string[] },
  g?: GoalRow,
  /** Twins answered with `a` whose work this carry-out does too (`standsFor`). */
  also: AskRow[] = []
): string[] {
  // The owner answered a plan raised on this thread. Sending one back is a
  // `rework` instead, so only an approval or a denial reaches a resume.
  if (f.kind === 'resume' && a?.kind === 'plan') {
    const plan = g ? `your plan for goal #${g.id}, "${g.title}"` : `"${a.title}"`;
    const hires = a.plan?.items.some((i) => i.kind === 'hire')
      ? ' Odds the plan hires are not here yet: you pick up here again as {owner} hires each one, and hand it its first piece then.'
      : '';
    if (a.status === 'approved')
      return [
        `{owner} approved ${plan}. Start the work now. You lead it, here on the goal.`,
        '',
        ...answers(f.note),
        '',
        `1. Hand each piece of the work to the colleague who should do it, with hand_off, on the goal.${hires}`,
        '2. Each time a piece comes back, check it and hand on the next, until the goal is met or the next step waits on a time.',
        '3. To check a piece of work, prefer a colleague who did not do it.',
        '4. Tell {owner} only what needs them, with raise_ask or give_owner_a_task, and when something is ready to try, with poke_owner. Never ask them to pass work to an Odd: that is yours to do.'
      ];
    if (a.status === 'denied')
      return [
        `{owner} said no to ${plan}. Do not start any of it.`,
        '',
        ...answers(f.note),
        '',
        '1. If their answer says what they want instead, do that. A new plan goes through propose_goal_plan.',
        '2. Otherwise say so, and stop.'
      ];
  }
  // {owner} hired an Odd a plan of yours proposed, from its hire ask on this thread.
  if (f.kind === 'resume' && a?.kind === 'hire' && a.status === 'approved' && g)
    return [
      `{owner} hired an Odd your plan for goal #${g.id}, "${g.title}", proposed. Carry on leading the work, here on the goal.`,
      '',
      ...answers(f.note),
      '',
      `1. Find each new Odd with list_goals: it serves goal #${g.id}, under the name {owner} hired it by.`,
      '2. It starts nothing on its own. Hand it its first piece the plan gives it now, with hand_off, on the goal.',
      "3. If its part waits on another's work, say so, and stop."
    ];
  // Each line says what it is: an answer to something raised on the thread,
  // what {owner} told a colleague about it in chat (`tellLead`), or the usage
  // window resetting on a thread it held (`wakeThread`).
  if (f.kind === 'resume')
    return f.note
      ? [
          'Word came for work you lead, and no run of yours has seen it yet. Pick it back up now.',
          '',
          ...answers(f.note)
        ]
      : ['The time you set to pick your work back up has come. Pick it up now.'];
  if (f.kind === 'first_day')
    return [
      'You joined the office today, and you just said hello to {owner} in chat. Get started now, so they never have to ask.',
      '',
      '1. Read your job description, notes/intake.md if you have one, my_goals and my_jobs.',
      '2. If you cannot do good work without answers from {owner}, write only the questions your intake did not answer to a file in your folder, put it on their desk with give_owner_a_task, attached, then stop.',
      `3. If a tool you need is not in my_access, ask for it with ask_for_access. For ${SWITCH_NAMES.commands} or ${SWITCH_NAMES.web}, ask with ask_for_switch when my_access says {owner} can switch it on.`,
      '4. Otherwise do the first piece of real work your job calls for, now: the first run of your job, or the first thing your job description says to do, so {owner} sees it today. Work for a goal you serve is not yours to start: the Odd who leads it hands you each piece.',
      '5. Your reply goes on their desk. Write it to {owner}: what you did, and what comes next.'
    ];
  if (f.kind === 'goal' && g)
    return [
      `{owner} set a new goal. Plan how the office meets it, and bring them the plan.`,
      '',
      `- Goal #${g.id}: ${g.title}`,
      `- When: ${goalWhen(g)}. Area: ${g.area}.`,
      ...(g.why ? [`- Why it matters: ${g.why}`] : []),
      ...(g.doneWhen ? [`- Done when: ${g.doneWhen}`] : []),
      '',
      '1. Read the office: office_report for each Odd, what it does, its level and the tools it holds or is waiting on, and list_goals for the goals they already serve.',
      `2. Work out who does what, how often, and with which tools (find_connectors). Give the work to Odds already here when one fits, with a new job or a change to one. Give a part to an Odd whose level and tools cover it. For a tool an Odd lacks, put any level raise in owner_steps, as a step on ${modelSection("that Odd's")}. Have the Odd ask for the tool itself with ask_for_access when its officeTools include it, or put connecting it in owner_steps when they do not. For ${SWITCH_NAMES.commands} or ${SWITCH_NAMES.web}, never put switching it on in owner_steps: the Odd asks for it itself with ask_for_switch when its part needs it, and office_report says whether {owner} can switch it on for that Odd. Keep every other step only {owner} can do in owner_steps too. Hire only for work nobody here fits.`,
      '3. If you need answers from {owner} before you can plan it, write the questions to a file in your folder, put it on their desk with give_owner_a_task, attached, then stop. You pick up when they finish it.',
      "4. Otherwise bring the whole plan in one ask with propose_goal_plan. Write each hire's job description to a file first, and pass any intake as its intake_file.",
      '5. Once {owner} approves the plan, you pick up here on the goal and lead the work: you hand each piece to the Odd who does it. So its owner steps hold only what truly needs {owner}, such as signing in to a tool, never passing work or a request to an Odd.',
      '6. If the office already meets this goal as it is, say so and stop.'
    ];
  if (f.kind === 'task_done' && t) {
    const answers = t.row.steps
      .filter((s) => s.answer)
      .map((s) => `- They answered "${s.text}" with: ${s.answer}`);
    return [
      `{owner} finished the task you gave them: "${t.row.title}". Pick up the work that waited on it now.`,
      '',
      `- Why you gave it: ${t.row.why}`,
      ...answers,
      ...(f.note ? [`- Their note: ${f.note}`] : []),
      ...(t.files.length
        ? [
            // A file from a thread's folder is named from the office's folder, so the run gets where it is.
            `- Attached, with anything they filled in: ${t.files.map((f) => (workPath(f) ? home(f) : f)).join(', ')}. Read each one first.`
          ]
        : []),
      '',
      '1. Read what they gave you: the files above, their answers and their note.',
      `2. Do the next step you told them would follow, now. When it needs their yes, such as a hire, a change outside the office ${ACT_WRITE}, or a new job, raise it with the tool for it (propose_goal_plan for a goal, propose_hire, raise_ask and the rest).`,
      '3. If something you need is missing or unclear, put one short question on their desk with give_owner_a_task, then stop.',
      '4. If nothing was waiting on this task, say so and stop.'
    ];
  }
  const askLines = a
    ? [
        `- Ask #${a.id}: ${a.title}`,
        `- Why: ${a.why}`,
        `- What you said would happen: ${a.ifApproved}`,
        ...(a.reply
          ? [
              `- The reply: to ${a.reply.to.join(', ')}${a.reply.cc.length ? `, cc ${a.reply.cc.join(', ')}` : ''}${a.reply.gmailThreadId ? `, in Gmail thread ${a.reply.gmailThreadId}` : ''}${a.reply.inReplyTo ? `, answering message ${a.reply.inReplyTo}` : ''}`,
              `- Its subject: ${a.reply.subject}`,
              '- Its body:',
              '',
              a.reply.body,
              ''
            ]
          : []),
        ...(a.filter
          ? [`- The filter: ${filterWords(a.filter)}`, `- Its summary: ${a.filter.summary}`]
          : []),
        ...(a.folder
          ? [
              `- The folder you asked for: ${shownFolder(a.folder.path)} (${FOLDER_SAID[a.folder.level]})`
            ]
          : []),
        ...(a.switches?.length ? [`- What you asked to turn on: ${switchesSaid(a.switches)}`] : []),
        ...(a.call
          ? [
              `- The call: ${a.call.tool} on ${a.call.connector}, with ${JSON.stringify(a.call.arguments)}`,
              ...(a.call.result ? [`- What it returned: ${callResultText(a.call.result)}`] : [])
            ]
          : [])
      ]
    : [];
  // What the owner gave for a folder ask, which may be narrower than it asked.
  const given = a?.folder?.given;
  if (f.kind === 'carry_out' && given)
    return [
      `{owner} approved your ask #${a?.id} and gave you ${shownFolder(given.path)} (${FOLDER_SAID[given.level]}). This run reaches it.`,
      ...(also.length
        ? [
            `This also answers your ${also.length > 1 ? 'asks' : 'ask'} ${also.map((x) => `#${x.id}`).join(', ')}, which another of your runs raised for the same folder: do that work once, here.`
          ]
        : []),
      '',
      ...askLines,
      `- Their reason: ${a?.reason ?? 'none given'}`,
      '',
      '1. Check you can reach it: list the folder.',
      '2. If work was waiting on it, do it now, within what they gave you. If they gave less than you asked and the work needs more, say so in your reply.',
      '3. If nothing was waiting, stop there.'
    ];
  if (f.kind === 'carry_out' && a?.kind === 'switch')
    return [
      `{owner} approved your ask #${a.id} and turned on ${switchesSaid(a.switches ?? [])} for you. This run has it.`,
      ...(also.length
        ? [
            `This also answers your ${also.length > 1 ? 'asks' : 'ask'} ${also.map((x) => `#${x.id}`).join(', ')}, which another of your runs raised for the same: do that work once, here.`
          ]
        : []),
      '',
      ...askLines,
      `- Their reason: ${a.reason ?? 'none given'}`,
      '',
      '1. If work was waiting on it, do it now.',
      '2. If nothing was waiting, stop there.'
    ];
  if (f.kind === 'carry_out' && a?.access)
    return [
      `{owner} approved your ask #${a.id}, and the access is ready now.`,
      ...(also.length
        ? [
            `This also answers your ${also.length > 1 ? 'asks' : 'ask'} ${also.map((x) => `#${x.id}`).join(', ')}, which another of your runs raised for the same tool: do that work once, here.`
          ]
        : []),
      '',
      ...askLines,
      '',
      '1. Check the tool answers: one small read.',
      '2. If work was waiting on this access, do it now.',
      '3. If nothing was waiting, stop there.'
    ];
  if (f.kind === 'carry_out' && a?.call)
    return [
      `{owner} said yes to your call #${a.id}, and the office made it for you. Do not make it again.`,
      '',
      ...askLines,
      '',
      '1. Carry on with the work that waited on it, using what it returned.',
      '2. If it failed, say so plainly and what you would try instead. Do not call it again without a reason {owner} would want.',
      '3. If nothing more waited on it, stop there.'
    ];
  if (f.kind === 'carry_out')
    return [
      `{owner} approved your ask #${a?.id}. Carry it out now.`,
      '',
      ...askLines,
      `- Their reason: ${f.note ?? 'none given'}`,
      '',
      '1. Do what they approved, and nothing beyond it.',
      '2. If you cannot finish without something from {owner}, put it on their desk with raise_ask or give_owner_a_task, with everything needed to finish, then stop.'
    ];
  if (f.kind === 'denied')
    return [
      `{owner} turned down your ask #${a?.id}, and said why.`,
      '',
      ...askLines,
      `- Their reason: ${f.note}`,
      '',
      '1. If the reason tells you how they want things done from now on, keep_lesson with their words.',
      '2. Do not carry out the ask, and do not raise it again.',
      '3. If the reason asks for something else instead, raise that as a new ask.'
    ];
  if (f.kind === 'rework')
    return [
      `{owner} sent your ask #${a?.id} back. Rework it the way they say, then bring it back.`,
      '',
      ...askLines,
      `- What they want changed: ${f.note}`,
      '',
      '1. Do any work the new version needs first, such as rewriting a file in your folder.',
      `2. Raise the new version with the same tool as before (raise_ask, propose_reply, propose_filter, propose_hire, ask_for_access, ask_for_folder, propose_goal or propose_goal_plan), or the one their note calls for, passing revises: ${a?.id}.`,
      '3. Do not carry out the ask itself. They decide the new version.'
    ];
  return [
    `{owner} read your report "${r?.title}" and gave feedback. Work out what it means, then act on it.`,
    '',
    `- Their feedback: ${f.note}`,
    '',
    'The report:',
    '',
    r?.body ?? '',
    '',
    '1. Work inside the office that they asked for, such as notes or a file in your folder, do now.',
    `2. Anything that changes one of your jobs, or something outside the office ${ACT_WRITE}: raise_ask first, one exact action per ask.`,
    '3. Anything only they can do goes on their desk with give_owner_a_task.',
    '4. If the feedback needs nothing done, say so.'
  ];
}

/** What a staffer is told when it reads the owner's edit to its file, for a lesson. */
function editBrief(path: string, shown: EditShown): string[] {
  const cut = shown.from
    ? ` Both start at character ${shown.from}, a little before the first change; the start is the same in both.`
    : '';
  return [
    `{owner} edited your file ${path} and saved it. Below is the file just before their save (your version, unless they had saved it before), then as it is now, each cut at ${EDIT_CHARS} characters.${cut}`,
    '',
    '1. Work out what they changed.',
    '2. If the changes show how they want this kind of work done from now on, call keep_lesson once, quoting their words from the version now. It waits for their Keep, whatever you pass.',
    '3. If it is a one-off fix (a fact, a name, a typo), keep nothing, and say so.',
    '4. Do not edit the file, or anything else. This run only reads the edit.',
    '',
    '<before>',
    shown.before,
    '</before>',
    '',
    '<now>',
    shown.now,
    '</now>'
  ];
}

/**
 * Do the work the owner's answer calls for, in a fresh session, as soon as the owner
 * answers. The staffer ends its reply with an outcome line. A reply without one
 * counts as failed, so the owner hears about it.
 */
export async function followThrough(
  f: FollowUpRow,
  a?: AskRow,
  r?: ReportRow,
  t?: TaskRow,
  g?: GoalRow
): Promise<{ outcome: Outcome; text: string; saw?: string; joined?: number[] }> {
  const who = await staffer(f.staffId);
  if (!who) return { outcome: 'failed', text: `No Odd named ${f.staffId}` };
  // Work a colleague handed over, or its result coming home.
  const handed =
    (f.kind === 'hand_off' || f.kind === 'handed_back') && f.handOff
      ? { kind: f.kind, ...f.handOff }
      : undefined;
  const colleague = handed && {
    id: handed.from,
    name: (await staffer(handed.from))?.name ?? handed.from
  };
  // The hand-off this run's work serves, if any: its own, or the one whose ask or
  // task the owner just answered. Its result goes back to the giver.
  const serves = await servesHandOff(f);
  const giver = serves?.handOff
    ? {
        id: serves.handOff.from,
        name: (await staffer(serves.handOff.from))?.name ?? serves.handOff.from
      }
    : undefined;
  // The thread it works on. Every hand-off is a step in one, and its files cross
  // in the thread's folder. Hand-backs written before they carried their thread cannot find it.
  const threadId = f.threadId ?? serves?.threadId ?? undefined;
  const thread = threadId ? await threadById(threadId) : undefined;
  if (colleague && !thread)
    return {
      outcome: 'failed',
      text: `This hand-off with ${colleague.name} lost track of the work it was for.`
    };
  // Results that landed while a run of this Odd's on the thread had yet to end:
  // this pick-up takes them too, and they end with it.
  const joined = await Promise.all(
    (await resultsToJoin(f)).flatMap(({ id, handOff: h, note }) =>
      h
        ? [
            staffer(h.from).then((c) => ({
              id,
              h,
              result: note,
              colleague: { id: h.from, name: c?.name ?? h.from }
            }))
          ]
        : []
    )
  );
  const joinedIds = joined.map((j) => j.id);
  // What this pick-up raises comes from a colleague's work: the newest result's colleague.
  const via =
    handed?.kind === 'handed_back'
      ? [
          { id: f.id, from: handed.from },
          ...joined.map((j) => ({ id: j.id, from: j.h.from }))
        ].sort((x, y) => y.id - x.id)[0].from
      : undefined;
  // The owner's edit, read now, so saves while this waited to start are in it.
  let edit: { path: string; saw: string; shown: EditShown } | undefined;
  if (f.kind === 'edited') {
    const e = f.edit;
    if (!e) return { outcome: 'failed', text: 'This edit run lost track of its file.' };
    try {
      const saw = (await readStaffFile(who.id, e.path)).content;
      edit = { path: e.path, saw, shown: editShown(e.before, saw) };
    } catch (err) {
      return {
        outcome: 'failed',
        text: `Could not read ${e.path}: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
  const label = edit
    ? `Reading your edit to ${edit.path}`
    : handed
      ? `${handed.kind === 'hand_off' ? 'For' : 'Back from'} ${colleague?.name}: ${handed.title}`
      : f.kind === 'resume'
        ? (thread?.title ?? 'Picking the work back up')
        : (a?.title ??
          (t
            ? `After: ${t.title}`
            : g
              ? `Plan: ${g.title}`
              : f.kind === 'first_day'
                ? 'First day'
                : `Feedback on ${r?.title ?? 'a report'}`));
  const task = t ? { row: t, files: await taskFiles(t.id) } : undefined;
  // One carry-out may stand for twin asks that start no run of their own.
  const also =
    f.kind === 'carry_out' && (a?.kind === 'access' || a?.kind === 'folder' || a?.kind === 'switch')
      ? await standsFor(a)
      : [];
  const details: Record<FollowUpKind, string> = {
    carry_out: `Carrying out ask #${a?.id}`,
    rework: `Reworking ask #${a?.id}`,
    denied: `Reading why you said no to ask #${a?.id}`,
    task_done: 'Picking up after your task',
    goal: 'Planning your goal',
    first_day: 'Getting started',
    feedback: 'Acting on your feedback',
    hand_off: `Work ${colleague?.name} handed over`,
    handed_back: `Picking up after ${colleague?.name}`,
    resume: 'Picking the work back up',
    edited: 'Learning from your edit'
  };
  const detail = details[f.kind];
  // A colleague handed work on a goal's thread is told the goal in its brief.
  const goalServed =
    handed?.kind === 'hand_off' && thread?.goalId ? await findGoal(thread.goalId) : undefined;
  const work = { kind: 'follow-up' as const, label, detail, askId: a?.id };
  const res = await slot(who.id, work, (onEvent) =>
    run(who, label, {
      kind: 'follow-up',
      onEvent,
      approvedAsk: f.kind === 'carry_out' ? a?.id : undefined,
      ownerNote: ownerNoteOf(f),
      ownerEdit: edit && { path: edit.path, text: edit.shown.now },
      draftOnly: atDraft(f.kind),
      lessonRun: servesNoThread(f.kind),
      handOffId: serves?.id,
      threadId: thread?.id,
      via,
      shown: f.kind === 'handed_back' ? [f.id, ...joinedIds] : undefined,
      timeoutMs: JOB_TIMEOUT_MS,
      extra: [
        '',
        '## This run',
        '',
        '{owner} is not in a chat with you.',
        '',
        ...(handed && colleague && thread
          ? handOffBrief({
              kind: handed.kind,
              h: handed,
              colleague,
              me: who.id,
              result: f.note,
              thread: thread.id,
              goal: goalServed,
              joined
            })
          : edit
            ? editBrief(edit.path, edit.shown)
            : [
                ...followUpBrief(f, a, r, task, g, also),
                ...(serves?.handOff && giver && thread
                  ? handOffContext({
                      h: serves.handOff,
                      giver: giver.name,
                      me: who.id,
                      thread: thread.id
                    })
                  : [])
              ]),
        '',
        'Then reply with what you did in a few plain lines. End with one line that is exactly one of: "Outcome: done", "Outcome: failed", "Outcome: waiting" (waiting means you put what you need on their desk).',
        ''
      ].join('\n')
    })
  );
  // The file an edited run read, so the office can tell a save made while it ran.
  const saw = edit?.saw;
  if (!res.ok) return { outcome: 'failed', text: res.text, saw, joined: joinedIds };
  const m = /[*_\s]*Outcome:[*_\s]*(done|failed|waiting)\W*$/i.exec(res.text);
  if (!m)
    return {
      outcome: 'failed',
      text: `${res.text}\n\n(${who.name} did not say whether it finished.)`,
      saw,
      joined: joinedIds
    };
  return {
    outcome: m[1].toLowerCase() as Outcome,
    text: res.text.slice(0, m.index).trim(),
    saw,
    joined: joinedIds
  };
}

/** A one-off draft from a staffer, outside any session: used to draft a job description. */
export async function draft(id: string, message: string): Promise<Run> {
  const who = await staffer(id);
  if (!who) return { ok: false, text: `No Odd named ${id}` };
  return slot(
    id,
    { kind: 'draft', label: 'Drafting', detail: 'Drafting for the hire window' },
    (onEvent) => run(who, message, { kind: 'draft', timeoutMs: CHAT_TIMEOUT_MS, onEvent })
  );
}

/**
 * A new hire's first minutes. It says hello in its chat, in the session the
 * owner's chats then resume. A hire with a job then starts its first day's
 * work as a follow-up, so nobody has to ping it to get it moving. A hire with
 * no job starts nothing: one that serves a goal gets its first piece from the
 * goal's lead, whom approving the hire already woke on the goal's thread, and
 * any other runs only when it is handed work.
 */
export async function firstDay(id: string): Promise<void> {
  const who = await staffer(id);
  if (!who) return;
  // Read from the ledger, after the hire route has added the first job and
  // linked the goal the hire was proposed for, so the hello and the first day
  // agree with what the hire really has.
  const [jobs, serving] = await Promise.all([jobsFor(id), goalsFor(id)]);
  // Only an active goal: it is the only kind its runs are shown (`whoFor`).
  const day = firstDayOf({ jobs: jobs.length, goal: serving.find((g) => g.status === 'active') });
  if (!chatting.has(id)) {
    chatting.add(id);
    try {
      const r = await slot(
        id,
        { kind: 'draft', label: 'Saying hello', detail: 'Introducing themselves' },
        (onEvent) =>
          run(
            who,
            [
              'You were hired a moment ago, and you just walked into the office. {owner} has your chat open. Say hello.',
              '',
              '- Write as yourself, the way your job description says you work: a few short lines, no headings, no lists.',
              '- Say who you are and what you are here for, in your own words, not your job title.',
              ...day.hello
            ].join('\n'),
            {
              kind: 'chat',
              sessionFile: chatSession(id),
              timeoutMs: CHAT_TIMEOUT_MS,
              onEvent
            }
          )
      );
      // The chat session wrote this hello, so it is not a told line.
      if (r.ok) addToChat(id, { at: new Date().toISOString(), from: 'staff', text: r.text });
    } finally {
      chatting.delete(id);
    }
  }
  if (day.starts) await startFirstDay(id);
}

/**
 * A line from a staffer in their chat that no run wrote, like a new manager's
 * hello. The next chat tells the session it said it (`chatPreface`).
 */
export function sayInChat(id: string, text: string): void {
  addToChat(id, { at: new Date().toISOString(), from: 'staff', text, told: true });
}

/** Deliver a due poke: a chat line from the staffer, and a notification on the Mac. */
export async function deliverPoke(p: PokeRow): Promise<void> {
  // More than 15 minutes late is missed, not counting time the app spent updating.
  const late = pokeMissed(p.at, new Date(), downtime());
  if (!(await claimPoke(p.id, late)) || late) return;
  const who = await staffer(p.staffId);
  addToChat(p.staffId, {
    at: new Date().toISOString(),
    from: 'staff',
    text: p.message,
    poke: true
  });
  void notifyMac(who?.name ?? 'Oddboro', p.message);
}
