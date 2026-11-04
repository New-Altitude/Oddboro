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
export const canDraw = () => claudeSettings().model !== 'sonnet';

/** `--model` for a run: always the owner's pick, never Claude Code's own default. */
export function modelArgs(): string[] {
  return ['--model', claudeSettings().model];
}

/** The environment a `claude` run gets: none of a parent Claude Code session's settings. */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_CONFIG_DIR')
      delete env[k];
  return env;
}

export type ClaudeAccount = { email?: string; org?: string; plan?: string };

/**
 * The account Claude Code is signed in to, which every staff run uses on the
 * owner's plan. Nothing when it is signed out or too old to say.
 */
export function claudeAccount(): Promise<ClaudeAccount | undefined> {
  const [cmd, before] = claudeCommand();
  return new Promise((done) =>
    execFile(
      cmd,
      [...before, 'auth', 'status'],
      { env: cleanEnv(), timeout: 15_000, windowsHide: true },
      (_e, out) => {
        try {
          const s = JSON.parse(String(out)) as {
            loggedIn?: boolean;
            email?: string;
            orgName?: string;
            subscriptionType?: string;
          };
          done(
            s.loggedIn ? { email: s.email, org: s.orgName, plan: s.subscriptionType } : undefined
          );
        } catch {
          done(undefined);
        }
      }
    )
  );
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
