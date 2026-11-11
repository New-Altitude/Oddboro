// What an Odd has kept, for the Storage tab: every file and folder in its own
// folder and in its part of each thread it is on, with sizes and when each
// changed. Never the office's own files there (`OFFICE_FILES` in the
// ledger's home.ts), never an instruction file or a hidden one (`.claude`, `.grok`,
// `.git` and the rest), and never through a link, so the list stays inside
// those folders. It stops at `STORAGE_CAP` entries in all and says so, shared
// work counted first, so a full folder of its own never hides what it built
// with others. Read when the tab opens; nothing watches the folders.
import { type Dirent, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { home, OFFICE_FILE_NAMES, threadPart, workTitles } from '@oddboro/ledger';
import { workName } from '@oddboro/ledger/work-paths';
import { INSTRUCTIONS, threadsWithPart } from './files.ts';

/** The most entries the tab lists. */
export const STORAGE_CAP = 5000;

export type StoredEntry = {
  /** From the Odd's folder, or for a thread's file its name in the office (`workName`), with `/` between folders. */
  path: string;
  dir: boolean;
  /** Bytes; 0 for a folder. */
  size: number;
  /** When it last changed, in milliseconds. */
  mtime: number;
};

/** An Odd's part of one thread: the owner reads it by `title`, and `root` is the `workName` its entries start with. */
export type StoredWork = { title: string; root: string; entries: StoredEntry[] };

/** Whether the tab shows `name`, at `depth` (0 is the top of the folder). */
const shown = (name: string, depth: number): boolean =>
  !name.startsWith('.') &&
  !INSTRUCTIONS.includes(name) &&
  // The office's own files are hidden at the top of an Odd's folder, and at the top of a thread part.
  !(depth === 0 && OFFICE_FILE_NAMES.includes(name));

/** Every entry under `root`, folders before files, by name; `capped` when it stopped at `cap`. */
export function listStorage(
  root: string,
  cap = STORAGE_CAP
): { entries: StoredEntry[]; capped: boolean } {
  const entries: StoredEntry[] = [];
  let capped = false;
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    return { entries, capped };
  }
  const walk = (dir: string, depth: number): void => {
    let list: Dirent[];
    try {
      list = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A folder the office may not read hides only what is in it.
      return;
    }
    list.sort((a, b) =>
      a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1
    );
    for (const e of list) {
      if (capped) return;
      // A link may lead anywhere on the computer, so it is not listed or followed.
      if (e.isSymbolicLink() || !shown(e.name, depth)) continue;
      if (!e.isDirectory() && !e.isFile()) continue;
      if (entries.length >= cap) {
        capped = true;
        return;
      }
      const at = join(dir, e.name);
      const st = lstatSync(at, { throwIfNoEntry: false });
      if (!st) continue;
      entries.push({
        path: relative(real, at).split('\\').join('/'),
        dir: e.isDirectory(),
        size: e.isDirectory() ? 0 : st.size,
        mtime: st.mtimeMs
      });
      if (e.isDirectory()) walk(at, depth + 1);
    }
  };
  walk(real, 0);
  return { entries, capped };
}

/**
 * `staff`'s part of each thread it is on now, newest first, by the names the
 * viewer opens them by, up to `cap` entries. The titles come first, so a part
 * of a thread it has left uses none of the cap. A part with nothing shown in
 * it is left out.
 */
async function listWork(
  staff: string,
  cap: number
): Promise<{ work: StoredWork[]; capped: boolean }> {
  const ids = threadsWithPart(staff);
  const titles = await workTitles(staff, ids);
  const work: StoredWork[] = [];
  let room = cap;
  for (const id of ids) {
    const title = titles.get(id);
    if (title === undefined) continue;
    const root = workName(id, staff);
    const part = listStorage(threadPart(id, staff), room);
    if (part.entries.length)
      work.push({
        title,
        root,
        entries: part.entries.map((e) => ({ ...e, path: `${root}/${e.path}` }))
      });
    room -= part.entries.length;
    if (part.capped) return { work, capped: true };
  }
  return { work, capped: false };
}

/**
 * Everything an Odd has kept, under one cap: its parts of threads first, then
 * its own folder with what is left, since the page's reason for shared work is
 * finding what was built.
 */
export async function oddStorage(
  staff: string,
  cap = STORAGE_CAP
): Promise<{ entries: StoredEntry[]; work: StoredWork[]; capped: boolean }> {
  const { work, capped } = await listWork(staff, cap);
  const used = work.reduce((sum, w) => sum + w.entries.length, 0);
  const own = listStorage(home('staff', staff), cap - used);
  return { entries: own.entries, work, capped: own.capped || capped };
}
