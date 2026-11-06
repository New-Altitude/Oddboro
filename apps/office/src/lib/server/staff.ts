// Running a staffer: each chat message or job run is Claude Code run headless
// on the owner's own login, with the staffer's job description from Postgres
// appended to the system prompt. Server only.
//
// Every run gets five file tools (Read, Glob, Grep, Write, Edit), may read
// only its own folder and the owner's data folder (see `readable`), may write
// only inside the staffer's own folder, except Claude Code's own config there
// (CLAUDE.md and .claude/), loads no project settings, skills or plugins, and
// is denied anything not pre-approved. It always gets the office server (asks,
// tasks, the ledger), plus whatever access the owner granted: servers at read
// level (the tools the owner ticked as read-only) or at write level (every
// tool). Hosted servers get a fresh OAuth token per run.
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import {
  DATABASE_URL,
  goalsFor,
  goalWhen,
  capabilities,
  HEALTH_WORDS,
  hasTool,
  levelLine,
  outsideLines,
  ownerName,
  recordUsage,
  setPlanLimits,
  startFirstDay,
  claimPoke,
  deliveries,
  ask as askById,
  replyToReport,
  report as reportById,
  staffer,
  task as taskById,
  taskFiles,
  type AskRow,
  type Capabilities,
  type FollowUpRow,
  type GoalRow,
  type JobRow,
  type RunTrigger,
  type ModelUsage,
  type Outcome,
  type ReportRow,
  type TaskRow,
  type PokeRow,
  type StaffRow,
  type UsageKind,
  clockTime,
  pokeMissed,
  zone,
  zoneName,
  STAFF_SERVER,
  home,
  rulePath,
  toolCommand
} from '@oddboro/ledger';
import { fixedError } from '@oddboro/ledger/errors';
import { emit } from './events.ts';
import type { Work } from '../staff/work.ts';
import { getSecret, headerSecret } from './keychain.ts';
import { bearer } from './oauth.ts';
import { apiKey, claudeSettings, cleanEnv, modelArgs, spawnClaude } from './claude.ts';
import { notifyMac } from './notify.ts';
import { downtime, installsAt } from './update.ts';

/** The owner's data folder, which every staffer may read. */
const DATA = home('data');
const HOMES = home('staff');
/** Hard rule 4's one exception to asking first, said the same way in every brief that tells an Odd to ask. */
const ACT_WRITE = 'unless you hold Act and use a tool {owner} connected for you at read and write';
const CHAT_TIMEOUT_MS = 5 * 60_000;
const JOB_TIMEOUT_MS = 20 * 60_000;

/** Something the staffer put on the owner's desk. */
export type ChatRef = { kind: 'ask' | 'task' | 'report'; id: number; title: string };
/**
 * A `poke` line is one the office delivered later, not a reply. An `item` line
 * is something the staffer put on the owner's desk, shown where it landed. An
 * owner's line with `re` replied about one of those.
 */
export type ChatEntry = {
  at: string;
  from: 'owner' | 'staff';
  text: string;
  poke?: true;
  re?: ChatRef;
  item?: ChatRef & { status: string };
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

export function history(id: string): ChatEntry[] {
  const file = join(homeOf(id), 'chat.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatEntry);
}

/** The chat as the owner sees it: what was said, and each delivery where it landed. */
export async function chatLog(id: string): Promise<ChatEntry[]> {
  const items: ChatEntry[] = (await deliveries(id)).map(({ at, ...d }) => ({
    at: at.toISOString(),
    from: 'staff',
    text: '',
    item: d
  }));
  return [...history(id), ...items].sort((a, b) => a.at.localeCompare(b.at));
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
export function staffEnv(): NodeJS.ProcessEnv {
  const env = cleanEnv();
  delete env.ANTHROPIC_API_KEY;
  if (claudeSettings().auth === 'key') env.ANTHROPIC_API_KEY = apiKey();
  return env;
}

type Server = Record<string, unknown>;

/** The servers and tool permissions one run gets: the outside tools `capabilities` says it holds. */
async function access(who: StaffRow) {
  const servers: Record<string, Server> = {
    office: {
      command: process.execPath,
      args: [STAFF_SERVER],
      env: { STAFF_ID: who.id, DATABASE_URL }
    }
  };
  const allowed = ['mcp__office'];
  const caps = await capabilities(who);
  for (const a of caps.outside) {
    if (a.heldBack) continue;
    const c = a.connector;
    const env = Object.fromEntries(
      (c.config.secrets ?? []).map((n) => [n, getSecret(c.id, n) ?? ''])
    );
    const headers: Record<string, string> = Object.fromEntries(
      (c.config.headers ?? []).map((n) => [n, headerSecret(c.id, n)])
    );
    if (c.config.oauth) {
      const token = await bearer(c.id).catch(() => undefined);
      if (!token) {
        a.heldBack = 'sign-in ran out';
        continue;
      }
      headers.Authorization = `Bearer ${token}`;
    }
    servers[c.id] =
      c.kind === 'http'
        ? { type: 'http', url: c.config.url, headers }
        : { ...toolCommand(c.config.command!, c.config.args ?? []), env };
    if (a.level === 'act') allowed.push(`mcp__${c.id}`);
    else allowed.push(...c.readTools.map((t) => `mcp__${c.id}__${t}`));
  }
  return { servers, allowed, caps };
}

/** How the office works, naming only the office tools this staffer holds. */
function house(who: StaffRow, now: string): string {
  const has = (t: string) => hasTool(who.tools, t);
  const more = !has('ask_for_access')
    ? ''
    : has('find_connectors')
      ? ' For more, call find_connectors, then ask_for_access.'
      : ' For more, call ask_for_access.';
  const updating = installsAt();
  return [
    '',
    '## How the office works',
    '',
    `- The office keeps ${zoneName()}. It is ${now} now.`,
    updating !== undefined &&
      `- Oddboro updates at ${clockTime(updating)}, and the office restarts. Start nothing that runs past it, and write where you are to your notes.`,
    '- You are an Odd. Oddboro calls its AI workers Odds (one Odd, two Odds). When you talk to {owner}, call yourself and the others here Odds, never staff or agents.',
    `- {owner}'s desk is how you reach them. Anything that needs their yes goes through raise_ask${has('give_owner_a_task') ? ', and anything only they can do goes through give_owner_a_task' : ''}. Do not ask for a decision in chat when it should be an ask.`,
    has('search_ledger') &&
      '- Before you raise an ask, search_ledger for how they decided things like it. Follow a decision that fits. If the closest one gave no reason, say so.',
    `- my_access lists your outside tools.${more} When one stops working (its tools fail to load, or it turns down its key), call reconnect_access.`,
    `- Nothing leaves the office without {owner}'s yes on that exact action, ${ACT_WRITE}.`,
    '- Write to {owner} in active voice: the person or thing that acts is the subject ("I moved the call", not "the call was moved"). Plain words, short sentences.',
    ''
  ]
    .filter((l) => l !== false)
    .join('\n');
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
    serving.length &&
      '- After a run that moves one of these goals, or shows it slipping, call log_progress once with one line of evidence.',
    hasTool(who.tools, 'list_goals') &&
      '- list_goals shows every goal, who serves it and how it is going.',
    ''
  ]
    .filter((l) => l !== false)
    .join('\n');
}

/** What this run can do: its level, where it writes, and each outside tool it holds or was granted. */
function canDo(caps: Capabilities, owner: string): string {
  const lines = outsideLines(caps, owner);
  return [
    '',
    '## What you can do',
    '',
    `- ${levelLine(caps.level, owner)}`,
    '- You write files only in your folder. Your own tools work on files only: no shell and no web. The outside tools below are your only reach beyond the office.',
    '- Outside tools:',
    ...(lines.length ? lines.map((l) => `  - ${l}`) : ['  - None yet.']),
    ''
  ].join('\n');
}

async function prompt(
  who: StaffRow,
  opts: { dir: string; caps: Capabilities; owner: string }
): Promise<string> {
  const { dir } = opts;
  const now = new Date().toLocaleString('en-US', {
    timeZone: zone(),
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
  return (
    who.desk +
    '\n' +
    (await whoFor(who, dir)) +
    house(who, now) +
    `\n## Where things are\n\n- Your folder: ${dir}\n- Your notes: ${join(dir, 'notes')}\n- {owner}'s data folder: ${DATA}\n` +
    canDo(opts.caps, opts.owner)
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
 * folder, and Claude Code's folder for this run's sessions (long tool results
 * land there). Read rules govern Glob and Grep too, and dontAsk turns down
 * every other path.
 */
function readable(dir: string): string[] {
  return [dir, DATA, join(homedir(), '.claude', 'projects', sessionsOf(dir))];
}

/** Claude Code names a working folder's sessions folder after its path. */
function sessionsOf(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * What no staffer may read, even when the owner's own Claude Code settings
 * allow it: a deny rule beats every allow. Secret stores, the rest of the
 * office's folder and other staffers' folders, and the rest of Claude Code's
 * folder, sessions included. A rule on a folder covers everything inside it.
 */
function unreadable(id: string, dir: string): string[] {
  const reads = readable(dir);
  const claude = join(homedir(), '.claude');
  const besides = (parent: string, keep: string[]) => {
    try {
      return readdirSync(parent)
        .filter((n) => !keep.includes(n))
        .map((n) => join(parent, n));
    } catch {
      return [];
    }
  };
  // Secret stores in the home folder, including the sign-ins other apps on this
  // computer keep there, like the Google Workspace MCP server's. AppData is
  // where Windows apps keep theirs.
  const paths = [
    ...[
      '.ssh',
      '.aws',
      '.gnupg',
      '.config',
      'Library',
      'AppData',
      '.claude.json',
      '.google_workspace_mcp'
    ].map((p) => join(homedir(), p)),
    ...besides(home(), ['staff', 'data']),
    ...besides(HOMES, [id]),
    ...besides(claude, ['projects']),
    ...besides(join(claude, 'projects'), [sessionsOf(dir)])
  ];
  // Never deny a folder a staffer must read, such as an office kept under ~/Library.
  const covers = (p: string) => reads.some((r) => r === p || r.startsWith(`${p}${sep}`));
  return [...new Set(paths)].filter((p) => !covers(p)).map((p) => `Read(${rulePath(p)})`);
}

/** One headless Claude Code run. `session` resumes a saved session file, or starts fresh. */
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
    timeoutMs: number;
    onEvent?: (e: ChatEvent) => void;
  }
): Promise<Run> {
  const dir = homeOf(who.id);
  const prior =
    opts.sessionFile && existsSync(opts.sessionFile)
      ? (JSON.parse(readFileSync(opts.sessionFile, 'utf8')) as { sessionId: string }).sessionId
      : undefined;
  const { servers, allowed, caps } = await access(who);
  // Prompts name the owner as {owner}: each install's staff use its own name.
  const owner = await ownerName();
  const say = (s: string) => s.replaceAll('{owner}', owner);
  // In a chat, the office tools get the owner's own words, so a change the owner asks for
  // there is recorded as their decision without an ask.
  if (opts.ownerSaid)
    (servers.office.env as Record<string, string>).OWNER_SAID = opts.ownerSaid.slice(0, 4000);
  if (opts.approvedAsk)
    (servers.office.env as Record<string, string>).APPROVED_ASK = String(opts.approvedAsk);
  // Only this run knows which sign-ins ran out, so my_access hears it from here.
  const signedOut = caps.outside.filter((a) => a.heldBack === 'sign-in ran out');
  if (signedOut.length)
    (servers.office.env as Record<string, string>).SIGNED_OUT = signedOut
      .map((a) => a.connector.id)
      .join(',');
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    'Read,Glob,Grep,Write,Edit',
    '--allowedTools',
    ...readable(dir).map((p) => `Read(${rulePath(p)}/**)`),
    // Edit rules cover every file-writing tool; Claude Code ignores Write(path).
    `Edit(${rulePath(dir)}/**)`,
    ...allowed,
    '--disallowedTools',
    ...unreadable(who.id, dir),
    // Claude Code loads these on every run: a staffer may not rewrite its own instructions or hooks.
    ...['CLAUDE.md', 'CLAUDE.local.md', '.claude/**'].flatMap((f) => [
      `Edit(${rulePath(dir)}/${f})`,
      `Edit(${rulePath(dir)}/**/${f})`
    ]),
    '--permission-mode',
    'dontAsk',
    '--setting-sources',
    'user',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify({ mcpServers: servers }),
    '--disable-slash-commands',
    '--settings',
    JSON.stringify({ enabledPlugins: pluginsOff() }),
    '--add-dir',
    DATA,
    ...modelArgs(),
    '--append-system-prompt',
    say((await prompt(who, { dir, caps, owner })) + (opts.extra ?? '')),
    ...(prior ? ['--resume', prior] : ['--session-id', randomUUID()])
  ];

  return new Promise((done) => {
    const child = spawnClaude(args, { cwd: dir, env: staffEnv() });
    let buffer = '';
    let reply = '';
    let session: string | undefined;
    let finished = false;
    const finish = (r: Run) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (session && opts.sessionFile)
        writeFileSync(opts.sessionFile, JSON.stringify({ sessionId: session }));
      opts.onEvent?.(r.ok ? { type: 'done', text: r.text } : { type: 'error', message: r.text });
      done(r);
    };
    const timer = setTimeout(() => {
      child.kill();
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
        if (typeof e.session_id === 'string') session = e.session_id;
        if (e.type === 'rate_limit_event') void notePlan(e.rate_limit_info);
        if (e.type === 'result' && e.modelUsage)
          void recordUsage(who.id, opts.kind, e.modelUsage as ModelUsage).catch(() => {});
        if (e.type === 'stream_event') {
          const ev = e.event as {
            type: string;
            delta?: { type: string; text?: string };
            content_block?: { type: string; name?: string };
          };
          if (
            ev.type === 'content_block_delta' &&
            ev.delta?.type === 'text_delta' &&
            ev.delta.text
          ) {
            reply += ev.delta.text;
            opts.onEvent?.({ type: 'delta', text: ev.delta.text });
          } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
            opts.onEvent?.({ type: 'tool', name: ev.content_block.name ?? 'a tool' });
          } else if (ev.type === 'message_start' && reply && !reply.endsWith('\n\n')) {
            // A new turn after a tool call: keep its text apart from the last.
            reply += '\n\n';
            opts.onEvent?.({ type: 'delta', text: '\n\n' });
          }
        } else if (e.type === 'result') {
          if (e.subtype === 'success') finish({ ok: true, text: String(e.result ?? reply).trim() });
          else finish({ ok: false, text: `The session ended early (${String(e.subtype)}).` });
        }
      }
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => (stderr += c));
    child.on('error', (err) =>
      finish({ ok: false, text: `Could not start Claude Code: ${err.message}` })
    );
    child.on('close', (code) =>
      finish({
        ok: false,
        text: `Claude Code stopped (exit ${code}). ${stderr.trim().split('\n').slice(-2).join(' ')}`
      })
    );
    child.stdin.end(say(message));
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
    // Pokes delivered and work put on the desk since the owner last wrote are
    // not in the session: say so, so "How did the call go?" or "What about
    // Thursday?" makes sense to the staffer.
    const past = history(id);
    const poked = past
      .slice(past.findLastIndex((e) => e.from === 'owner') + 1)
      .filter((e) => e.poke);
    // The session saw what it delivered up to the end of its last reply.
    const last = past.findLast((e) => !e.poke)?.at ?? '';
    const re = replyTo ? await replyBrief(id, replyTo) : undefined;
    const landed = (await deliveries(id, 20)).filter(
      (d) => d.at.toISOString() > last && !(d.kind === re?.ref.kind && d.id === re.ref.id)
    );
    const prompt = [
      ...(poked.length
        ? [
            `(Since {owner} last wrote, the office delivered your pokes to them: ${poked.map((e) => `"${e.text}"`).join(', ')}.)`
          ]
        : []),
      ...(landed.length
        ? [
            `(Since {owner} last wrote, you put these on their desk: ${landed.map((d) => `${d.kind} "${d.title}"`).join(', ')}.)`
          ]
        : []),
      ...(re ? [re.brief] : []),
      message
    ].join('\n\n');
    const r = await run(who, prompt, {
      kind: 'chat',
      ownerSaid: message,
      sessionFile: join(homeOf(id), 'session.json'),
      timeoutMs: CHAT_TIMEOUT_MS,
      onEvent
    });
    if (r.ok) {
      const log = join(homeOf(id), 'chat.jsonl');
      const now = new Date().toISOString();
      const said: ChatEntry = { at: sent, from: 'owner', text: message, re: re?.ref };
      appendFileSync(log, JSON.stringify(said) + '\n');
      appendFileSync(log, JSON.stringify({ at: now, from: 'staff', text: r.text }) + '\n');
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

/** What the staffer is told, for each kind of follow-up. */
function followUpBrief(
  f: FollowUpRow,
  a?: AskRow,
  r?: ReportRow,
  t?: { row: TaskRow; files: string[] },
  g?: GoalRow
): string[] {
  if (f.kind === 'first_day')
    return [
      'You joined the office today, and you just said hello to {owner} in chat. Get started now, so they never have to ask.',
      '',
      '1. Read your job description, notes/intake.md if you have one, my_goals and my_jobs.',
      '2. If you cannot do good work without answers from {owner}, write only the questions your intake did not answer to a file in your folder, put it on their desk with give_owner_a_task, attached, then stop.',
      '3. If a tool you need is not in my_access, ask for it with ask_for_access.',
      '4. Otherwise do the first piece of real work your job calls for, now: the first run of your job, or the first thing your job description says to do, so {owner} sees it today.',
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
      '2. Work out who does what, how often, and with which tools (find_connectors). Give the work to Odds already here when one fits, with a new job or a change to one. Give a part to an Odd whose level and tools cover it. For a tool an Odd lacks, put any level raise in owner_steps, and have the Odd ask for the tool itself with ask_for_access when its officeTools include it, or put connecting it in owner_steps when they do not. Keep every other step only {owner} can do in owner_steps too. Hire only for work nobody here fits.',
      '3. If you need answers from {owner} before you can plan it, write the questions to a file in your folder, put it on their desk with give_owner_a_task, attached, then stop. You pick up when they finish it.',
      "4. Otherwise bring the whole plan in one ask with propose_goal_plan, including the steps only {owner} can do. Write each hire's job description to a file first, and pass any intake as its intake_file.",
      '5. If the office already meets this goal as it is, say so and stop.'
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
        ? [`- Attached, with anything they filled in: ${t.files.join(', ')}. Read each one first.`]
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
        `- What you said would happen: ${a.ifApproved}`
      ]
    : [];
  if (f.kind === 'carry_out' && a?.access)
    return [
      `{owner} approved your ask #${a.id}, and the access is ready now.`,
      '',
      ...askLines,
      '',
      '1. Check the tool answers: one small read.',
      '2. If work was waiting on this access, do it now.',
      '3. If nothing was waiting, stop there.'
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
  if (f.kind === 'rework')
    return [
      `{owner} sent your ask #${a?.id} back. Rework it the way they say, then bring it back.`,
      '',
      ...askLines,
      `- What they want changed: ${f.note}`,
      '',
      '1. Do any work the new version needs first, such as rewriting a file in your folder.',
      `2. Raise the new version with the same tool as before (raise_ask, propose_hire, ask_for_access, propose_goal or propose_goal_plan), or the one their note calls for, passing revises: ${a?.id}.`,
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
): Promise<{ outcome: Outcome; text: string }> {
  const who = await staffer(f.staffId);
  if (!who) return { outcome: 'failed', text: `No Odd named ${f.staffId}` };
  const label =
    a?.title ??
    (t
      ? `After: ${t.title}`
      : g
        ? `Plan: ${g.title}`
        : f.kind === 'first_day'
          ? 'First day'
          : `Feedback on ${r?.title ?? 'a report'}`);
  const task = t ? { row: t, files: await taskFiles(t.id) } : undefined;
  const detail =
    f.kind === 'carry_out'
      ? `Carrying out ask #${a?.id}`
      : f.kind === 'rework'
        ? `Reworking ask #${a?.id}`
        : f.kind === 'task_done'
          ? 'Picking up after your task'
          : f.kind === 'goal'
            ? 'Planning your goal'
            : f.kind === 'first_day'
              ? 'Getting started'
              : 'Acting on your feedback';
  const work = { kind: 'follow-up' as const, label, detail, askId: a?.id };
  const res = await slot(who.id, work, (onEvent) =>
    run(who, label, {
      kind: 'follow-up',
      onEvent,
      approvedAsk: f.kind === 'carry_out' ? a?.id : undefined,
      timeoutMs: JOB_TIMEOUT_MS,
      extra: [
        '',
        '## This run',
        '',
        '{owner} is not in a chat with you.',
        '',
        ...followUpBrief(f, a, r, task, g),
        '',
        'Then reply with what you did in a few plain lines. End with one line that is exactly one of: "Outcome: done", "Outcome: failed", "Outcome: waiting" (waiting means you put what you need on their desk).',
        ''
      ].join('\n')
    })
  );
  if (!res.ok) return { outcome: 'failed', text: res.text };
  const m = /[*_\s]*Outcome:[*_\s]*(done|failed|waiting)\W*$/i.exec(res.text);
  if (!m)
    return {
      outcome: 'failed',
      text: `${res.text}\n\n(${who.name} did not say whether it finished.)`
    };
  return {
    outcome: m[1].toLowerCase() as Outcome,
    text: res.text.slice(0, m.index).trim()
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
 * owner's chats then resume, and then starts its first day's work as a
 * follow-up. Nobody has to ping it to get it moving.
 */
export async function firstDay(id: string): Promise<void> {
  const who = await staffer(id);
  if (!who) return;
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
              '- Say what you will do first, and when your jobs run.',
              '- Tell them you are getting started now. Do not do the work in this reply: the office starts your first day the moment you finish.'
            ].join('\n'),
            {
              kind: 'chat',
              sessionFile: join(homeOf(id), 'session.json'),
              timeoutMs: CHAT_TIMEOUT_MS,
              onEvent
            }
          )
      );
      if (r.ok) sayInChat(id, r.text);
    } finally {
      chatting.delete(id);
    }
  }
  await startFirstDay(id);
}

/** A line from a staffer in their chat that no run wrote, like a new manager's hello. */
export function sayInChat(id: string, text: string): void {
  const line: ChatEntry = { at: new Date().toISOString(), from: 'staff', text };
  appendFileSync(join(homeOf(id), 'chat.jsonl'), JSON.stringify(line) + '\n');
}

/** Deliver a due poke: a chat line from the staffer, and a notification on the Mac. */
export async function deliverPoke(p: PokeRow): Promise<void> {
  // More than 15 minutes late is missed, not counting time the app spent updating.
  const late = pokeMissed(p.at, new Date(), downtime());
  if (!(await claimPoke(p.id, late)) || late) return;
  const who = await staffer(p.staffId);
  const line: ChatEntry = {
    at: new Date().toISOString(),
    from: 'staff',
    text: p.message,
    poke: true
  };
  appendFileSync(join(homeOf(p.staffId), 'chat.jsonl'), JSON.stringify(line) + '\n');
  void notifyMac(who?.name ?? 'Oddboro', p.message);
}
