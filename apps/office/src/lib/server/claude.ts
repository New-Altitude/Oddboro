// How staff reach Claude: the owner's Claude plan (their `claude` login) or an
// API key, and which model: Opus unless the owner picks Sonnet. The owner picks in the browser. The choice lives in
// .env (OFFICE_AUTH, OFFICE_MODEL) and the key in the system's secret store,
// never in a file. A change applies to the next run, with no restart.
import {
  execFile,
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio
} from 'node:child_process';
import {
  AGENT_NAMES,
  drawsLooks,
  OFFICE_ACCOUNT,
  officeAgent,
  toolHome,
  type Agent
} from '@oddboro/ledger';
import { writeEnv } from '@oddboro/ledger/env';
import { claudeCommand } from '@oddboro/ledger/platform';
import { getSecret, setSecret } from './keychain.ts';

/** Start Claude Code with these arguments, wherever this system keeps it. */
export function spawnClaude(
  args: string[],
  opts: SpawnOptionsWithoutStdio
): ChildProcessWithoutNullStreams;
export function spawnClaude(args: string[], opts: SpawnOptions): ChildProcess;
export function spawnClaude(args: string[], opts: SpawnOptions): ChildProcess {
  const [cmd, before] = claudeCommand();
  return spawn(cmd, [...before, ...args], { windowsHide: true, ...opts });
}

export const MODELS = ['opus', 'sonnet'] as const;
export type Model = (typeof MODELS)[number];

export type ClaudeSettings = { auth: 'plan' | 'key'; model: Model };

export function claudeSettings(): ClaudeSettings {
  return {
    auth: process.env.OFFICE_AUTH === 'key' ? 'key' : 'plan',
    model: process.env.OFFICE_MODEL === 'sonnet' ? 'sonnet' : 'opus'
  };
}

/** Drawing looks and designing offices need more than Sonnet. */
export const SONNET_CANNOT_DRAW =
  'On Sonnet, the office cannot draw looks or design offices. Pick Opus in Setup.';
/** Whether the office designs offices: on Grok or Codex always, on Claude Code unless it runs on Sonnet. */
export const canDraw = () => officeAgent() !== 'claude' || claudeSettings().model !== 'sonnet';

/** The model the office's own runs use, when the office names one. */
const officeModel = (agent: Agent) =>
  agent === 'claude'
    ? claudeSettings().model
    : agent === 'codex'
      ? process.env.OFFICE_CODEX_MODEL
      : undefined;

/** Whether the office draws an Odd's look from words or a headshot (`drawsLooks`). */
export const officeDrawsLooks = () => drawsLooks(officeAgent(), officeModel(officeAgent()));

/** Why the office does not draw a look, and what to do instead. */
export function cannotDrawLook(): string {
  const agent = officeAgent();
  if (agent === 'claude')
    return 'On Sonnet, the office does not draw looks. Build this one from parts, or pick Opus in Setup.';
  const on = officeModel(agent);
  return `${AGENT_NAMES[agent]}${on ? ` on ${on}` : ''} does not draw looks here. Build this one from parts, or run the office on Claude Code or Codex in Setup.`;
}

/** `--model` for a run: always the owner's pick, never Claude Code's own default. */
export function modelArgs(): string[] {
  return ['--model', claudeSettings().model];
}

/**
 * The environment a `claude` run gets: none of a parent Claude Code session's
 * settings, none of the owner's own CLAUDE.md files, and no auto-memory. Under
 * `--setting-sources user`, a run still loaded the owner's ~/.claude/CLAUDE.md,
 * their instructions to their own Claude, which no Odd should read. Auto-memory
 * wrote each Odd's own notes into the owner's ~/.claude/projects, a second
 * memory beside the office's lessons that the owner never sees. None of the
 * office process's own git variables either (every `GIT_` name, such as
 * `GIT_DIR` or `GIT_CONFIG_PARAMETERS`), since the owner's git settings never
 * shape an Odd's git: a run with a shell gets the office's own (`gitEnv`)
 * after this. Nor `ODDBORO_SECRETS`: only the office itself holds the pipes
 * to the app's Keychain. Every coding tool's run, install and sign-in starts here. A run's own
 * instructions come in its arguments and its message, which this leaves alone.
 */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (
      k === 'CLAUDECODE' ||
      k.startsWith('CLAUDE_CODE_') ||
      k === 'CLAUDE_CONFIG_DIR' ||
      k.startsWith('GIT_') ||
      k === 'ODDBORO_SECRETS' ||
      // The owner's own AWS settings, like AWS_PROFILE: a tool server runs
      // outside a run's sandbox and could sign in as the owner. The Odds' AWS
      // tool gets its own role's credentials (`toolKeys` in aws.ts).
      k.startsWith('AWS_')
    )
      delete env[k];
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1';
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  return env;
}

export type ClaudeAccount = { email?: string; org?: string; plan?: string };

/** One account's Claude Code folder (`CLAUDE_CONFIG_DIR`): its login, its settings and its sessions. */
export const claudeHome = (account: string = OFFICE_ACCOUNT): string => toolHome('claude', account);

/**
 * The account Claude Code is signed in to in `dir`, a folder `claudeHome`
 * names, or the owner's own login on this computer without one. Nothing when
 * it is signed out or too old to say.
 */
export function claudeAccount(dir?: string): Promise<ClaudeAccount | undefined> {
  const [cmd, before] = claudeCommand();
  return new Promise((done) => {
    try {
      readStatus(cmd, before, dir, done);
    } catch {
      // A file this system cannot run (ENOEXEC) throws here, not in the callback: not signed in.
      done(undefined);
    }
  });
}

function readStatus(
  cmd: string,
  before: readonly string[],
  dir: string | undefined,
  done: (a: ClaudeAccount | undefined) => void
): void {
  execFile(
    cmd,
    [...before, 'auth', 'status'],
    {
      env: dir ? { ...cleanEnv(), CLAUDE_CONFIG_DIR: dir } : cleanEnv(),
      timeout: 15_000,
      windowsHide: true
    },
    (_e, out) => {
      try {
        const s = JSON.parse(String(out)) as {
          loggedIn?: boolean;
          email?: string;
          orgName?: string;
          subscriptionType?: string;
        };
        done(s.loggedIn ? { email: s.email, org: s.orgName, plan: s.subscriptionType } : undefined);
      } catch {
        done(undefined);
      }
    }
  );
}

/** Each account's sign-in, as last read, for a minute: every run asks before it starts. */
const status = new Map<string, { at: number; account?: ClaudeAccount }>();

/** Who `account`'s Claude Code is signed in as, read at most once a minute unless `fresh`. */
export async function claudeAccountOf(
  account: string = OFFICE_ACCOUNT,
  fresh = false
): Promise<ClaudeAccount | undefined> {
  const dir = claudeHome(account);
  const was = status.get(dir);
  if (!fresh && was && Date.now() - was.at < 60_000) return was.account;
  const now = await claudeAccount(dir);
  status.set(dir, { at: Date.now(), account: now });
  return now;
}

/** Forget an account's sign-in as read, after a sign-in or sign-out changed it. */
export const forgetClaudeAccount = (account: string = OFFICE_ACCOUNT): void =>
  void status.delete(claudeHome(account));

/**
 * The folder a Claude Code run uses for `account`, or nothing for the owner's
 * own login on this computer. Only the Office account, on the Claude plan,
 * before the owner signed it in: an office made before accounts keeps running
 * on the login it had until then, so nothing stops working.
 */
export async function claudeRunHome(account: string = OFFICE_ACCOUNT): Promise<string | undefined> {
  if (account !== OFFICE_ACCOUNT || claudeSettings().auth === 'key') return claudeHome(account);
  return (await claudeAccountOf(account)) ? claudeHome(account) : undefined;
}

let key: string | undefined;
/** The owner's API key, read from the keychain once. */
export function apiKey(): string | undefined {
  return (key ??= getSecret('anthropic', 'API_KEY'));
}

/** Save the owner's choice. A key is tried with one short run before it is kept. */
export async function setClaude(change: {
  model?: Model;
  key?: string;
  auth?: 'plan';
}): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (change.key !== undefined) {
    const value = change.key.trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(value))
      return { ok: false, problem: 'That does not look like an Anthropic API key.' };
    if (!(await keyWorks(value)))
      return { ok: false, problem: 'That key did not work. Check it in the Anthropic Console.' };
    setSecret('anthropic', 'API_KEY', value);
    key = value;
    set('OFFICE_AUTH', 'key');
  }
  if (change.auth === 'plan') set('OFFICE_AUTH', '');
  if (change.model) set('OFFICE_MODEL', change.model);
  return { ok: true };
}

function set(name: string, value: string): void {
  writeEnv({ [name]: value });
  if (value) process.env[name] = value;
  else delete process.env[name];
}

function keyWorks(value: string): Promise<boolean> {
  return new Promise((done) => {
    const env: NodeJS.ProcessEnv = { ...cleanEnv(), ANTHROPIC_API_KEY: value };
    const child = spawnClaude(['-p', '--tools', '', 'Say ok.'], { env, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
  });
}

/** A message on stdin for Claude Code; pictures go in its stream-json user turn. */
export function claudeInput(message: string, images?: { mediaType: string; data: string }[]) {
  if (!images?.length) return message;
  return (
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          ...images.map((i) => ({
            type: 'image',
            source: { type: 'base64', media_type: i.mediaType, data: i.data }
          })),
          { type: 'text', text: message }
        ]
      }
    }) + '\n'
  );
}
