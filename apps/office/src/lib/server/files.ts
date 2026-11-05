// Files a staffer wrote, opened in the office's viewer. Only files inside a
// staffer's own folder, only text, and only ones that already exist: the owner
// reads and edits what the staff made, the owner does not browse the Mac.
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { record, staffer, home } from '@oddboro/ledger';
import { fixedError } from '@oddboro/ledger/errors';

const HOMES = home('staff');
const MAX_BYTES = 1_000_000;

export type StaffFile = { staff: string; path: string; content: string; mtime: number };

/** The real path of a staffer's file, or an error saying why not. */
async function locate(staff: string, path: string): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(staff) || !(await staffer(staff))) throw fixedError('No such Odd');
  const root = realpathSync(join(HOMES, staff));
  let file: string;
  try {
    // realpath follows links, so a link pointing out of the folder fails below.
    file = realpathSync(resolve(root, path));
  } catch {
    throw new Error(`No file at ${path}`);
  }
  if (!file.startsWith(root + sep)) throw new Error("That file is outside the Odd's folder");
  const s = statSync(file);
  if (!s.isFile()) throw new Error(`${path} is not a file`);
  if (s.size > MAX_BYTES) throw new Error(`${path} is too big to open here`);
  return file;
}

export async function readStaffFile(staff: string, path: string): Promise<StaffFile> {
  const file = await locate(staff, path);
  const content = readFileSync(file, 'utf8');
  if (content.includes('\0')) throw new Error(`${path} is not a text file`);
  const root = realpathSync(join(HOMES, staff));
  return { staff, path: relative(root, file), content, mtime: statSync(file).mtimeMs };
}

/**
 * Save the owner's edit. `mtime` is when the owner opened it: if the staffer changed the
 * file since, the save stops instead of overwriting the staffer's work.
 */
export async function writeStaffFile(
  staff: string,
  path: string,
  content: string,
  mtime: number
): Promise<StaffFile> {
  const file = await locate(staff, path);
  if (Math.abs(statSync(file).mtimeMs - mtime) > 1)
    throw fixedError('The Odd changed this file since you opened it. Reopen it to see.');
  writeFileSync(file, content);
  const who = await staffer(staff);
  const saved = await readStaffFile(staff, path);
  await record({ kind: 'work', actor: 'owner', title: `Edited ${who?.name}'s ${saved.path}` });
  return saved;
}

/**
 * A new hire's copy of the intake the owner filled in for it, from the staffer
 * who proposed it, as `notes/intake.md` in its own folder.
 */
export async function giveIntake(from: string, path: string, to: string): Promise<void> {
  const { content } = await readStaffFile(from, path);
  mkdirSync(join(HOMES, to, 'notes'), { recursive: true });
  writeFileSync(join(HOMES, to, 'notes', 'intake.md'), content);
}
