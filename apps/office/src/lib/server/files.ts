// Files a staffer wrote, opened in the office's viewer. Only files inside a
// staffer's own folder or its parts of thread folders, one it attached from
// the folder of a thread it is on (`workFile`), or one in a folder the owner
// gave it (`givenFile`), only text, and only ones that already exist: the
// owner reads and edits what the staff made, the owner does not browse the
// Mac. A page an Odd built opens in the owner's browser instead
// (`openStaffPage`), found the same way.
import {
  closeSync,
  constants,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  type GrantedFolder,
  type StaffRow,
  currentPlatform,
  learnFromEdit,
  openFile,
  ownTools,
  record,
  staffer,
  home,
  threadFolder,
  threadPart,
  touchesSecretStore,
  workFile
} from '@oddboro/ledger';
import { fixedError, isFixedError } from '@oddboro/ledger/errors';
import { givenName, givenPath, INSTRUCTIONS, workName, workPath } from '@oddboro/ledger/work-paths';
import { PAGE } from '#lib/pages.ts';

const HOMES = home('staff');
/** The folder every thread's folder sits in. */
const THREADS = dirname(threadFolder(0));
const MAX_BYTES = 1_000_000;
export { INSTRUCTIONS };

/**
 * git's usual places for code that runs the next time git runs in a
 * repository: its hooks, its config file, which can name a program, and the
 * copies of both a submodule keeps in `.git/modules`, which `git status` in
 * the repository above runs too. A run never writes them in a folder the
 * owner gave it to change, but reads them, since git cannot run without
 * reading `.git/config`. So they are never shut both ways like
 * `INSTRUCTIONS`. All of `.git/modules` is shut to writes, so an Odd cannot
 * update a submodule there either: its objects sit in the same folder.
 * Claude Code, Grok and Gemini take them as write refusals. Codex gets none:
 * it keeps each write folder's own `.git` read only by itself, and a
 * repository further in is not covered for Codex, since it takes a glob only
 * as `deny`, which would stop git reading (`filesystem` in codex.ts).
 * They do not stop every way code in a project can run later: a `.git`
 * pointer file or `.git/commondir` can name a config elsewhere, and code
 * sits in project files such as package scripts, a Makefile or tests. The
 * owner looks at what an Odd changed before running that project's tools.
 */
export const REPO_RUNS = ['.git/hooks', '.git/config', '.git/modules'];

export type StaffFile = { staff: string; path: string; content: string; mtime: number };
export type FileName = { staff: string; path: string };

/**
 * A refusal the owner may read as written: it names the file by its bare name
 * only, and a folder the owner gave by its name only.
 */
export class FileError extends Error {}

/**
 * What the owner reads when the file they asked for by `name` did not open or
 * save. A refusal, or a message the code fixed (`fixedError`), reads as written. Anything else (a file the office may not
 * read, say) names a path, so the owner gets `fallback` and the log gets the rest.
 */
export function ownerMessage(e: unknown, name: string, fallback: string): string {
  if (e instanceof FileError || isFixedError(e)) return e.message;
  console.error(`${fallback} (${name}):`, e);
  return fallback;
}

/**
 * The file `path` names inside `root` (a real path), as its real path inside
 * it, or undefined when it names none. Odds often name a file without its
 * folder ("saved it as `plan.md`"), so a bare name that is not at the top
 * finds the one file with that name further in. That search skips hidden
 * folders and never follows or matches a link, so it stays inside `root`.
 */
export function fileInFolder(root: string, path: string): string | undefined {
  let exact: string | undefined;
  try {
    // realpath follows links, so a link pointing out of the folder is not inside it.
    const file = realpathSync(resolve(root, path));
    if (file.startsWith(root + sep) && statSync(file).isFile()) exact = relative(root, file);
  } catch {
    // Nothing at that path: a bare name is looked for below.
  }
  if (exact || path.includes('/')) return exact;
  const found = filesNamed(root, path);
  return found.length === 1 ? found[0] : undefined;
}

/**
 * Every file called `name` under `root`, outside hidden folders, never through
 * a link. A folder the office may not read is skipped, so it hides only what
 * is inside it.
 */
function filesNamed(root: string, name: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readable(dir)) {
      const at = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) walk(at);
      else if (entry.isFile() && entry.name === name) found.push(relative(root, at));
    }
  };
  walk(root);
  return found;
}

/** The entries of `dir`, or none when the office may not read it. */
function readable(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * The newest file called `name` (a bare name) in `staff`'s parts of the thread
 * folders (`threadPart`), the only parts of them its runs write.
 * An Odd keeps working in a goal's one folder, so the newest file, not the
 * newest thread, is the one it just wrote; on a tie the newer thread wins. A
 * thread folder or a part that is a link leads somewhere else, so neither is
 * searched, and the search never follows a link, so it stays inside those parts.
 */
function fileInThreads(staff: string, name: string): string | undefined {
  let newest: { file: string; at: number } | undefined;
  for (const id of threadsWithPart(staff)) {
    const part = threadPart(id, staff);
    for (const found of filesNamed(part, name)) {
      const file = join(part, found);
      const at = statSync(file).mtimeMs;
      if (!newest || at > newest.at) newest = { file, at };
    }
  }
  return newest?.file;
}

/**
 * The threads `staff` has a part of on the disk, newest first. A thread's
 * folder or a part that is a link leads somewhere else, so neither counts, and
 * a folder no thread could own (a leading zero, a word, a number past what
 * `workPath` takes) is passed over.
 */
export function threadsWithPart(staff: string): number[] {
  if (!isFolder(THREADS)) return [];
  return readable(THREADS)
    .map((d) => d.name)
    .filter((name) => /^[1-9]\d*$/.test(name))
    .map(Number)
    .filter(
      (id) =>
        workPath(workName(id, staff)) &&
        isFolder(threadFolder(id)) &&
        isFolder(threadPart(id, staff))
    )
    .sort((a, b) => b - a);
}

/** Whether `path` is a folder itself, not a link to one. */
const isFolder = (path: string): boolean =>
  !!lstatSync(path, { throwIfNoEntry: false })?.isDirectory();

/** A file `locate` found: its real path, the path the viewer opens it by, and whether the owner's folder holds it. */
type Found = { file: string; path: string; given?: true };

/** Whether `path` is a full path on this computer, from `~` or from the top. */
const isFull = (path: string): boolean => isAbsolute(path) || path.startsWith('~/');

/**
 * A file in one of `given`, folders on the disk the owner gave an Odd, named
 * by its full path (from `~` or from the top) or by its name in the office
 * (`givenName`), with the name of the folder that holds it. Only a file whose
 * real path stays inside the real path of that folder, so a link never leads
 * out, and only by the one path named: nothing is searched for, since a
 * folder the owner gave can be a whole drive. It goes by the innermost given
 * folder that holds it. A folder with no name of its own (a drive's top) or
 * one that shares its name with another given folder names nothing, since
 * its files' names would not lead back to it.
 */
function givenFile(
  given: GrantedFolder[],
  path: string
): { file: string; path: string; folder: string } | undefined {
  const folders = given
    .map((f) => ({ name: basename(f.path), as: resolve(f.path), real: realpathSync(f.path) }))
    .filter((f, _, all) => f.name && all.filter((g) => g.name === f.name).length === 1);
  const inside = (real: string, rel: string): string | undefined => {
    try {
      const file = realpathSync(join(real, rel));
      return file.startsWith(real + sep) && statSync(file).isFile() ? file : undefined;
    } catch {
      return undefined;
    }
  };
  const named = givenPath(path);
  if (named) {
    const f = folders.find((g) => g.name === named.folder);
    const file = f && inside(f.real, named.inside);
    return file ? { file, path, folder: f.name } : undefined;
  }
  if (!isFull(path)) return undefined;
  const full = path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(path);
  // The innermost folder first, as the Odd wrote it or by its real path.
  for (const f of folders.sort((a, b) => b.real.length - a.real.length)) {
    for (const root of new Set([f.as, f.real])) {
      const rel = relative(root, full);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
      const file = inside(f.real, rel);
      if (file) return { file, path: givenName(f.name, relative(f.real, file)), folder: f.name };
    }
  }
  return undefined;
}

/**
 * A staffer's file: its real path, and the path the viewer opens it by. A
 * bare name its own folder lacks is the newest one it wrote on a thread, and
 * keeps its bare name, since the owner never sees a thread or its folder. A
 * name in a thread's folder (`workPath`), as the Odd attached it, is that one
 * file while the Odd is on that thread, in whoever's part of it. A full path,
 * or a name in a folder the owner gave it, is a file in that folder
 * (`givenFile`).
 */
async function locate(staff: string, path: string): Promise<Found> {
  const who = /^[a-z0-9-]+$/.test(staff) ? await staffer(staff) : undefined;
  if (!who) throw fixedError('No such Odd');
  // A full path names only a file in a folder the owner gave the Odd that its
  // runs still get (`ownTools`), never anywhere else on the Mac. A folder its
  // runs no longer get is no way in either: the owner's hire from a proposal
  // copies the file an Odd names (`giveIntake`), so a refused folder's file
  // would reach the new hire's runs.
  const { granted } = ownTools(who, currentPlatform());
  const given = givenFile(granted, path);
  if (given) return { file: given.file, path: given.path, given: true };
  if (isFull(path)) throw noFile(who, path);
  // The Odd's tools read such a name the same way (`attachable`), so both find one file.
  if (workPath(path)) {
    const file = await workFile(staff, path);
    if (!file) throw new FileError(`No file at ${basename(path)}`);
    return { file, path };
  }
  const root = realpathSync(join(HOMES, staff));
  const own = fileInFolder(root, path);
  // A thread's file opens only when no file in its own folder has that name:
  // one two files there share opens nothing, as before. Only a bare name
  // matches a file's name, so a path with a folder never reaches a thread.
  const onThread = !own && !filesNamed(root, path).length ? fileInThreads(staff, path) : undefined;
  const found = own ? { file: join(root, own), path: own } : onThread && { file: onThread, path };
  if (!found) throw noFile(who, path);
  return found;
}

/**
 * Why `who` has no file at `path`. A file that is there, in a folder the owner
 * gave it that is in or holds a secret store, says so, or the owner would go
 * looking for a file they can see. It picks those folders by the same test as
 * the folder's line on the Settings tab (`touchesSecretStore`), so the words
 * never name a folder its runs miss for any other reason. The refusal names
 * the folder by its name alone, never its real path.
 */
function noFile(who: StaffRow, path: string): FileError {
  // `givenFile` takes each folder's real path, which a folder gone from the
  // disk has none of, and a gone folder holds no file to name.
  const refused = who.folders.filter((f) => existsSync(f.path) && touchesSecretStore(f.path));
  const held = givenFile(refused, path);
  return new FileError(
    held
      ? `${basename(path)} is in ${held.folder}, which holds keys or sign-ins, so ${who.name} no longer gets it.`
      : `No file at ${basename(path)}`
  );
}

/** What the viewer opens: the file `locate` finds, read whole, so only text up to `MAX_BYTES`. */
export async function readStaffFile(staff: string, path: string): Promise<StaffFile> {
  return readFound(staff, path, await locate(staff, path));
}

async function readFound(staff: string, path: string, found: Found): Promise<StaffFile> {
  if (statSync(found.file).size > MAX_BYTES)
    throw new FileError(`${basename(path)} is too big to open here`);
  const content = readFileSync(found.file, 'utf8');
  if (content.includes('\0')) throw new FileError(`${basename(path)} is not a text file`);
  return { staff, path: found.path, content, mtime: statSync(found.file).mtimeMs };
}

/**
 * A page an Odd built (`PAGE`), found the way the viewer finds a file
 * (`locate`), so only inside the Odd's own folder or its parts of thread
 * folders, never through a link. Its size does not matter: the browser opens
 * it, and the office never reads it.
 */
async function findPage(staff: string, path: string): Promise<Found> {
  const found = await locate(staff, path);
  const file = realpathSync(found.file);
  if (!PAGE.test(file)) throw new FileError(`${basename(path)} is not a page`);
  return { file, path: found.path };
}

/**
 * Open a page an Odd built (`findPage`) in the owner's browser, as a file on
 * this computer, outside the office's address. It takes the name the viewer
 * takes. The opener gets the file's real path and nothing else.
 */
export async function openStaffPage(
  staff: string,
  path: string,
  open: (file: string) => Promise<boolean> = openFile
): Promise<void> {
  const { file } = await findPage(staff, path);
  if (!(await open(file))) throw new FileError(`Could not open ${basename(path)} in your browser`);
}

/**
 * For each name an Odd wrote, the path the viewer opens it by, or null when it
 * opens nothing, so the page links only names that lead somewhere. The file is
 * found once (`locate`). A page links whenever the browser opens it, so a page
 * too big or not text for the viewer still gets its button; any other file links
 * only when the viewer's own read takes it.
 */
export async function openableFiles(names: FileName[]): Promise<(string | null)[]> {
  return Promise.all(
    names.map(async ({ staff, path }) => {
      try {
        const found = await locate(staff, path);
        if (!PAGE.test(realpathSync(found.file))) await readFound(staff, path, found);
        return found.path;
      } catch {
        // No such Odd, no such file, or too big or not text and not a page: the name stays text.
        return null;
      }
    })
  );
}

/**
 * Save the owner's edit. `mtime` is when the owner opened it: if the staffer changed the
 * file since, the save stops instead of overwriting the staffer's work. The staffer then
 * reads the edit for a lesson (`learnFromEdit`).
 */
export async function writeStaffFile(
  staff: string,
  path: string,
  content: string,
  mtime: number
): Promise<StaffFile> {
  // The Odd that attached it may not have written it, so its edit would teach the wrong Odd.
  if (workPath(path)) throw new FileError(`${basename(path)} opens here to read only`);
  const { file, given } = await locate(staff, path);
  // The owner's own folder holds the owner's work as much as the Odd's: the owner edits it in their own tools.
  if (given) throw new FileError(`${basename(path)} opens here to read only`);
  if (Math.abs(statSync(file).mtimeMs - mtime) > 1)
    throw fixedError('The Odd changed this file since you opened it. Reopen it to see.');
  // The mtime check makes this the Odd's version, unless the owner saved it before.
  const before = await readStaffFile(staff, path);
  writeFileSync(file, content);
  const who = await staffer(staff);
  const saved = await readStaffFile(staff, path);
  await record({ kind: 'work', actor: 'owner', title: `Edited ${who?.name}'s ${saved.path}` });
  // After the write, so the run never reads the file before it lands. The save
  // stands either way, so a failure here is logged rather than refusing it.
  await learnFromEdit(staff, { path: saved.path, before: before.content }, saved.content).catch(
    (e: unknown) => console.error(`No lesson run for ${staff}'s ${saved.path}:`, e)
  );
  return saved;
}

/** A reply as the file its Odd's edit run reads: the subject, a blank line, the body. */
export const replyFile = (r: { subject: string; body: string }) =>
  `Subject: ${r.subject}\n\n${r.body}\n`;

/**
 * The owner sent or saved a reply an Odd proposed, with their own changes:
 * keep their version as `replies/<ask id>.md` in the Odd's folder and start
 * the same `edited` run a save in the viewer starts (`learnFromEdit`), with
 * the Odd's proposal as the file before. No ledger line: sending it wrote one.
 * Never through a link the Odd made.
 */
export async function learnFromReply(
  staff: string,
  askId: number,
  proposed: { subject: string; body: string },
  sent: { subject: string; body: string }
): Promise<boolean> {
  const before = replyFile(proposed);
  const after = replyFile(sent);
  if (before === after) return false;
  mkdirSync(join(HOMES, staff, 'replies'), { recursive: true });
  const root = realpathSync(join(HOMES, staff));
  const folder = join(root, 'replies');
  if (!isFolder(folder)) throw new FileError('replies is not a folder');
  const path = `replies/${askId}.md`;
  const { O_CREAT, O_NOFOLLOW, O_TRUNC, O_WRONLY } = constants;
  const fd = openSync(join(root, path), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW);
  try {
    writeFileSync(fd, after);
  } finally {
    closeSync(fd);
  }
  return learnFromEdit(staff, { path, before }, after);
}

/**
 * After an `edited` run ends: a save the owner made while it ran started no
 * run of its own, so if the file changed since the run read it (`saw`), one
 * more starts from that version. Like a save, it never fails the run's end.
 */
export async function readEditAgain(staff: string, path: string, saw: string): Promise<void> {
  try {
    const now = await readStaffFile(staff, path);
    await learnFromEdit(staff, { path: now.path, before: saw }, now.content);
  } catch (e) {
    console.error(`No second lesson run for ${staff}'s ${path}:`, e);
  }
}

/** A path and everything under it, as deny rules and sandbox profiles name them. */
export const andBelow = (path: string): string[] => [path, `${path}/**`];

/**
 * Deny rules for each of `tools` on a path and everything under it. A rule on
 * `p/**` alone leaves `p` itself to a tool that takes a folder: Grok's list_dir
 * and grep read a whole folder through it (measured on Grok 1.0.46). Every deny
 * rule a run gets is built here. `path` is in the tool's own form: Claude Code
 * writes an absolute path as `//p`.
 */
export function denyRules(tools: readonly string[], path: string): string[] {
  return tools.flatMap((tool) => andBelow(path).map((p) => `${tool}(${p})`));
}

/**
 * Every instruction file and folder (`INSTRUCTIONS`) in the folders a run
 * writes, as path globs. Each covers what is under it once it goes through
 * `andBelow` or `denyRules`.
 */
export function instructionPaths(writes: string[]): string[] {
  return INSTRUCTIONS.flatMap((name) => writes.flatMap((w) => [`${w}/${name}`, `${w}/**/${name}`]));
}

/**
 * git's usual places (`REPO_RUNS`: hooks, the config file, submodules'
 * copies) in the folders the owner gave a run to change (`granted`), as path
 * globs, at the top and in any repository further in; not every way code
 * there can run later (`REPO_RUNS` says which). Only those folders, as the
 * owner ruled: the Odd's own folder and its part of a thread are the
 * office's, not the owner's projects. A Codex Odd can start a repository in
 * a subfolder of its own folder. A Claude Code Odd cannot start one anywhere:
 * Claude Code's own sandbox refuses every `.git/config` write, and its
 * sandbox setting that allows git config did not change that on 2.1.318
 * (measured in a live run). So in a granted repository a Claude Code Odd's write to
 * `.git/config` is refused by these paths and by Claude Code itself (a live
 * run: exit 1, the file unchanged).
 */
export function repoRunPaths(granted: string[]): string[] {
  return REPO_RUNS.flatMap((p) => granted.flatMap((w) => [`${w}/${p}`, `${w}/**/${p}`]));
}

/**
 * The paths a run may not write: its tools' own instructions in every folder
 * it writes (`writes`), for a run reading the owner's edit to a file in its
 * folder (`dir`) that file, and a repository's hooks, config and submodules
 * in the folders the owner gave it to change (`granted`, some of `writes`).
 * Those shut git's usual places; they do not stop every way code in a
 * project can run later: a `.git` pointer file or `.git/commondir` naming a
 * config elsewhere, a nested repository for Codex, and code in project files
 * such as package scripts, a Makefile or tests. The owner looks at what an
 * Odd changed before running that project's tools.
 * `granted` is required, empty when the owner gave none, so a caller that
 * leaves it out fails the type check rather than protecting nothing; the
 * argument is named because `writes` and `granted` swapped would type-check.
 * Each tool turns the paths into its own rules.
 */
export function deniedEdits({
  dir,
  writes,
  granted,
  edited
}: {
  dir: string;
  writes: string[];
  granted: string[];
  edited?: string;
}): string[] {
  return [
    ...instructionPaths(writes),
    ...repoRunPaths(granted),
    ...(edited ? [join(dir, edited)] : [])
  ];
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
