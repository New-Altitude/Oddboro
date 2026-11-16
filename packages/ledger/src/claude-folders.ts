// The owner's Claude Code folders: `~/.claude`, always, and each one they name
// in Setup, under Advanced (such as `~/.claude-personal`). Projects lists
// conversations from each, and no Odd reads any of them. The office never looks
// for others: `claude auth status` writes into the folder it reads, so the
// office runs Claude Code only in a folder on this list, or, for a project
// session that has no folder of its own, in the office's own default folder
// (the office's `CLAUDE_CONFIG_DIR`, else `~/.claude`).
import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { readEnv, writeEnv } from './env.ts';
import { folderDelimiter, foldPathCase } from './platform.ts';

/** The `.env` key that holds the named folders. Setup writes it. */
export const CLAUDE_FOLDERS_KEY = 'ODDBORO_CLAUDE_FOLDERS';

/** Claude Code's own folder when nothing names another. */
export const defaultClaudeFolder = (): string => join(homedir(), '.claude');

/**
 * A path as the disk spells it, so two spellings of one folder compare equal:
 * on a Mac the temp home `/var/...` is `/private/var/...`, and a disk that
 * ignores case spells `~/.Claude` as `~/.claude`. A missing folder (on a disk
 * not mounted now) keeps its own name under its nearest folder that exists.
 */
function spelled(p: string): string {
  if (existsSync(p)) return realpathSync.native(p);
  const up = dirname(p);
  return up === p ? p : join(spelled(up), basename(p));
}

/** One folder's identity, for comparing. A Windows disk ignores case. */
function sameAs(p: string): string {
  return foldPathCase(spelled(resolve(p)));
}

/**
 * Every known Claude folder, `~/.claude` first, then each named one in the
 * order it was named. Each is absolute, one per real path; a missing one stays,
 * since a folder may sit on a disk not mounted now. Read from `.env` at each
 * call, so a folder named a moment ago counts at once.
 */
export function claudeFolders(): string[] {
  const named = (readEnv()[CLAUDE_FOLDERS_KEY] ?? '')
    .split(folderDelimiter())
    .map((p) => p.trim())
    .filter((p) => isAbsolute(p));
  const seen = new Set<string>();
  return [defaultClaudeFolder(), ...named].filter((p) => {
    const id = sameAs(p);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Store the named folders, replacing the list. An empty list removes the key. */
export function setClaudeFolders(named: string[]): void {
  writeEnv({ [CLAUDE_FOLDERS_KEY]: named.join(folderDelimiter()) });
}

/**
 * Whether `dir` is a known Claude folder. Every caller asks this before it
 * touches a folder it got from the page or a stored row: a folder taken out of
 * Setup is never run in again.
 */
export function isClaudeFolder(dir: string): boolean {
  if (!isAbsolute(dir)) return false;
  const id = sameAs(dir);
  return claudeFolders().some((f) => sameAs(f) === id);
}

/** Whether a Claude folder is on the disk now. */
export function claudeFolderFound(dir: string): boolean {
  return statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/**
 * The `CLAUDE_CONFIG_DIR` for `dir`: none for `~/.claude`, however it is
 * spelled, else `dir`. Claude Code names its Keychain sign-in after the
 * variable, so setting it to `~/.claude` would read as signed out.
 */
export function claudeConfigDir(dir: string): string | undefined {
  return sameAs(dir) === sameAs(defaultClaudeFolder()) ? undefined : dir;
}

/** A copy of `base` that runs Claude Code in `dir` (`claudeConfigDir`). */
export function claudeFolderEnv(dir: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  const configDir = claudeConfigDir(dir);
  if (configDir === undefined) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = configDir;
  return env;
}
