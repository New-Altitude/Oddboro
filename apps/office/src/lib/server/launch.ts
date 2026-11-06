// What a Grok, Codex or Gemini run (grok.ts, codex.ts, gemini.ts) does the
// same way as it starts: files replaced in one step, files a run that died
// with the office left behind cleared away, an environment with nothing of the
// office's own keys or node options in it, TOML values, and the MCP grants
// read from access()'s names. What run() in staff.ts takes from a tool's own
// stream, how a run with a shell stops, and where a run refused for its
// sign-in points the owner. Server only.
import { execFileSync } from 'node:child_process';
import { readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runsGoing, type ModelUsage } from '@oddboro/ledger';
import { cleanEnv } from './claude.ts';

/** Where the owner signs a tool in for the office: beside the Odd's "Runs on" picker. */
export const SIGN_IN_WHERE = "on this Odd's Access tab, under Runs on";
/** What a run refused for its tool's sign-in says after the tool's name. */
export const NOT_SIGNED_IN = `is not signed in for this office. Sign in ${SIGN_IN_WHERE}.`;

/** A TOML value: what Codex's `-c` takes after `key=`, and what a config.toml or policy.toml holds. */
export type Toml = string | number | boolean | readonly Toml[] | { readonly [key: string]: Toml };

/**
 * A TOML basic string. JSON's is one, except that TOML also refuses a raw
 * U+007F and an escaped lone surrogate, which JSON leaves raw and escapes, so
 * a lone surrogate becomes U+FFFD first and U+007F is escaped.
 */
const tomlString = (s: string) => JSON.stringify(s.toWellFormed()).replaceAll('\x7f', '\\u007f');

/** One value as TOML. A quoted key is any key. */
export function toml(v: Toml): string {
  if (typeof v === 'string') return tomlString(v);
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return `[${v.map(toml).join(', ')}]`;
  return `{ ${Object.entries(v)
    .map(([k, x]) => `${tomlString(k)} = ${toml(x)}`)
    .join(', ')} }`;
}

/**
 * One MCP grant as access() names it for Claude Code: `mcp__office` is the
 * whole server, `mcp__c__t` one tool of server `c`.
 */
export function mcpGrant(allowed: string): { server: string; tool?: string } {
  const name = allowed.replace(/^mcp__/, '');
  const at = name.indexOf('__');
  return at < 0 ? { server: name } : { server: name.slice(0, at), tool: name.slice(at + 2) };
}

/** What run() takes from one line of a tool's own stream (`read` on a `Launch` in cli.ts). */
export type RunEvent =
  | { type: 'session'; id: string }
  | { type: 'tool'; name: string }
  /** One whole message of the reply. */
  | { type: 'message'; text: string }
  | { type: 'usage'; usage: ModelUsage }
  /** The turn finished; its reply is the last message. */
  | { type: 'done' }
  | { type: 'failed'; message: string }
  /** Something went wrong that the run may still finish past. */
  | { type: 'error'; message: string };

/** A file replaced in one step, so the tool never reads it half written. */
export function replace(path: string, content: string, mode = 0o600): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
}

/**
 * Remove what each run named `<key><suffix>` in `dir` once no run with that
 * key is going (`runsGoing`), files and folders alike: what a run that died
 * with the office left behind goes at the next run. `starting` is the key of
 * the run getting ready now, which is not in `runsGoing` until it spawns.
 */
export function sweep(dir: string, suffix: string, starting: string): void {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(suffix)) continue;
    const key = name.slice(0, name.length - suffix.length);
    if (key !== starting && !runsGoing.has(key))
      rmSync(join(dir, name), { recursive: true, force: true });
  }
}

/**
 * The office's clean environment (`cleanEnv`) for a tool another company
 * makes: no Anthropic key, no variable of that tool's own (`prefixes`) from
 * the office's environment, and no node options, since a preload the office's
 * node was started with sits outside the tool's sandbox and node refuses to
 * start the tool server when it cannot read it.
 */
export function vendorEnv(prefixes: readonly string[]): NodeJS.ProcessEnv {
  const env = cleanEnv();
  delete env.ANTHROPIC_API_KEY;
  delete env.NODE_OPTIONS;
  for (const k of Object.keys(env)) if (prefixes.some((p) => k.startsWith(p))) delete env[k];
  return env;
}

/**
 * Stop a tool started in a process group of its own (`detached`), and the
 * group of every process under it. Codex runs each shell command in a group
 * of its own (measured on codex-cli 0.166.0), so stopping the tool's group
 * alone leaves a command that was still running when the run timed out. A
 * process that already left the tree (its parent ended, so launchd took it)
 * is not found here.
 */
export function stopGroups(pid: number): void {
  const groups = new Set([pid]);
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((l) => l.trim().split(/\s+/).map(Number));
    const under = new Set([pid]);
    // Once pids wrap, a child can come before its parent in the list, so go round until nothing is added.
    for (let added = true; added;) {
      added = false;
      for (const [p, parent, group] of rows)
        if (under.has(parent) && !under.has(p)) {
          under.add(p);
          groups.add(group);
          added = true;
        }
    }
  } catch {
    // Without ps the tool's own group still stops below; only its commands' groups are missed.
  }
  for (const group of groups)
    try {
      process.kill(-group, 'SIGTERM');
    } catch {
      // That group is gone already: nothing is left to stop.
    }
}
