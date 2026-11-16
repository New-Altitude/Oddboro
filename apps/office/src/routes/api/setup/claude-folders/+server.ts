// The owner's Claude Code folders, from Setup under Advanced: GET lists each
// with the mark Projects shows, and the account folders in the home folder not
// named yet, and PUT names one or takes one out. Both refuse while Advanced
// mode is off. A named folder is shut to every Odd from
// that moment (`touchesSecretStore`), so a folder that holds the home, the
// office or a whole drive is refused: it would shut every Odd's folder under it.
// So is a project's own `.claude` folder, its settings: a folder by that name
// is taken as an account's only when it holds what Claude Code keeps there.
import { error, json } from '@sveltejs/kit';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  accountsHome,
  advancedMode,
  claudeConfigDir,
  claudeFolderFound,
  claudeFolders,
  expandHome,
  folderDelimiter,
  holdsTooMuch,
  home,
  isClaudeAccount,
  isClaudeFolder,
  setClaudeFolders,
  STORE_MARKS,
  within
} from '@oddboro/ledger';
import { claudeFolderMark } from '#lib/server/claude.ts';
import { ADVANCED_OFF } from '#lib/server/project-sessions/controller.ts';
import type { RequestHandler } from './$types';

/** What the owner reads when a folder cannot be named, one line each. */
const REFUSED = {
  typed: 'Type the folder’s full path, or start it with ~.',
  characters: (delimiter: string) =>
    `A Claude folder’s path cannot hold #, ${delimiter} or a line break.`,
  missing: 'There is no folder there.',
  always: '~/.claude is always in the list.',
  broad:
    'That folder is your home, a whole drive, or holds your home or the office. Name the Claude folder itself.',
  office: 'That folder is part of the office.',
  project: 'That’s a project’s settings folder, not a Claude account folder.'
} as const;

const path = z.string().trim().min(1).max(4096);
const change = z.union([z.object({ add: path }).strict(), z.object({ remove: path }).strict()]);

/**
 * Each folder directly in the home folder that is a Claude account folder not
 * known yet, as `~/<name>`, for Setup to offer in one click. It reads folder
 * entries only, never runs `claude` and never writes. A link counts by its own
 * name, as a typed path is kept.
 */
function suggested(): string[] {
  const h = homedir();
  let names: string[];
  try {
    names = readdirSync(h);
  } catch {
    // A home the office cannot read suggests nothing; typing a path still works.
    return [];
  }
  return names
    .filter((name) => name.toLowerCase().startsWith('.claude'))
    .filter((name) => {
      const p = join(h, name);
      try {
        return claudeFolderFound(p) && isClaudeAccount(p) && !isClaudeFolder(p);
      } catch {
        // A link loop or a folder the office may not read is not suggested.
        return false;
      }
    })
    .sort()
    .map((name) => `~/${name}`);
}

/** Every known folder, `~/.claude` first, with its mark read fresh, and the suggestions. */
async function listed() {
  return {
    folders: await Promise.all(
      claudeFolders().map(async (p) => ({
        path: p,
        isDefault: claudeConfigDir(p) === undefined,
        found: claudeFolderFound(p),
        mark: await claudeFolderMark(p, { fresh: true })
      }))
    ),
    suggested: suggested()
  };
}

/**
 * The folder `typed` names, or why it cannot be named. It is kept as the owner
 * typed it, with `~` expanded, not by its real path: on a Mac, Claude Code
 * names its Keychain sign-in after the folder's path as given, so a folder
 * reached through a link must run with the same path the owner's shell uses.
 * Every refusal compares real paths, so a link cannot reach past one.
 */
function folderToName(typed: string): { path: string } | { refused: string } {
  if (/[#\r\n]/.test(typed) || typed.includes(folderDelimiter()))
    return { refused: REFUSED.characters(folderDelimiter()) };
  const expanded = expandHome(typed);
  if (!isAbsolute(expanded)) return { refused: REFUSED.typed };
  const p = resolve(expanded);
  if (!claudeFolderFound(p)) return { refused: REFUSED.missing };
  if (claudeConfigDir(p) === undefined) return { refused: REFUSED.always };
  const real = realpathSync.native(p);
  // `~/.claude` is refused above as always listed. Any other `.claude` is an
  // account folder, such as a second home's, only when it holds what Claude
  // Code keeps in one (`STORE_MARKS`, the same marks that shut it to every
  // Odd); without them it is a project's settings. In any case on every
  // system: a Mac's disk ignores case by default, and a project's `.Claude` is
  // no account folder on a disk that keeps it either. Any one mark is enough
  // here, where it only refuses a project's settings; `suggested` needs every
  // account mark, since it offers a folder the owner did not type.
  if (
    basename(real).toLowerCase() === '.claude' &&
    !STORE_MARKS['.claude'].some((m) => existsSync(join(real, m)))
  )
    return { refused: REFUSED.project };
  const own = [home(), accountsHome()].map((q) => (existsSync(q) ? realpathSync.native(q) : q));
  if (own.some((q) => within(real, q))) return { refused: REFUSED.office };
  const h = realpathSync.native(homedir());
  if (holdsTooMuch(real, [h, ...own])) return { refused: REFUSED.broad };
  return { path: p };
}

export const GET: RequestHandler = async () => {
  if (!(await advancedMode())) error(403, ADVANCED_OFF);
  return json(await listed());
};

export const PUT: RequestHandler = async ({ request }) => {
  if (!(await advancedMode())) error(403, ADVANCED_OFF);
  const body = change.safeParse(await request.json().catch(() => undefined));
  if (!body.success) error(400, 'Say a folder to add or remove.');
  const named = claudeFolders().slice(1);
  if ('add' in body.data) {
    const picked = folderToName(body.data.add);
    if ('refused' in picked) error(400, picked.refused);
    if (!isClaudeFolder(picked.path)) setClaudeFolders([...named, picked.path]);
  } else {
    const gone = body.data.remove;
    if (claudeConfigDir(gone) === undefined) error(400, REFUSED.always);
    // By the path as listed, so a folder on a disk not mounted now can still go.
    setClaudeFolders(named.filter((p) => p !== gone));
  }
  return json(await listed());
};
