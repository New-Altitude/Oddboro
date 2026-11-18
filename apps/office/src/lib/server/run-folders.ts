// Where each Odd's runs live: its home, the folders a run may read, and its sessions.
import {
  accountOf,
  accountsHome,
  claudeFolders,
  home,
  rulePath,
  SECRET_STORES,
  threadFolder,
  toolHome,
  type StaffRow
} from '@oddboro/ledger';
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { claudeRunHome } from './claude.ts';
import { denyRules } from './files.ts';

/** The owner's data folder, which every staffer may read, whatever tool it runs on. */
const DATA = home('data');
const HOMES = home('staff');

function homeOf(id: string): string {
  const dir = join(HOMES, id);
  mkdirSync(join(dir, 'notes'), { recursive: true });
  return dir;
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
 * office's folder and other staffers' folders, the rest of Claude Code's
 * folder, sessions included, and every Claude folder the owner named in Setup.
 * Each is denied with everything under it (`denyRules`).
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
    // Every Claude folder the owner named in Setup holds their own sessions and login.
    ...claudeFolders(),
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

export { DATA, homeOf, readable, readsBeyond, unreadable };
