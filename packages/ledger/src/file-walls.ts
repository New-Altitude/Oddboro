// The walls of the office's file tools (files-server.ts): which paths one run
// may read and write. Every path an Odd names goes through `resolveIn` before
// anything opens it. A path is judged by where it really leads: the deepest
// part of it that exists is resolved by the system (`realpathSync.native`,
// which follows every link and junction and gives each name as the disk
// spells it), and the rest, which does not exist yet, may hold no `..`. So a
// link inside an Odd's folder that leads out is refused, and case, `~1` short
// names or a trailing dot change nothing. The same code holds on a Mac, Linux
// and Windows; the decoy probe checks it on each.
//
// A file with a second name (a hard link) is refused both ways, since the
// other name may be outside the folders.
//
// What it does not stop: a link swapped in between the check and the open by
// something else running beside the run. No Odd has a shell while the office
// carries its files, so only the owner's own programs could do that.
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

export type FileWalls = {
  /** The run's own folder: a relative path starts here. */
  cwd: string;
  /** Folders the run reads, with everything in them. Every folder in `writes` is read too. */
  reads: string[];
  /** Folders the run writes, with everything in them. */
  writes: string[];
  /**
   * Paths it may never write, with everything under them: an exact path, or a
   * path with a `**` segment for any depth, as `deniedEdits` gives them
   * (`<folder>/**\/AGENTS.md`, `<folder>/.git/hooks`).
   */
  noWrite: string[];
  /** Exact private paths and everything below them, denied for reads and writes. */
  noAccess?: string[];
};

export type Resolved = { path: string } | { refused: string };

const WIN = process.platform === 'win32';
/** Windows' device names, which open a device whatever folder they sit in, with any extension. */
const DEVICES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;

/** Why `input` can never name a plain file on this system, or nothing. */
function malformed(input: string): string | undefined {
  if (!input) return 'Name a file or folder.';
  if (input.includes('\0')) return 'That path holds a NUL character.';
  if (!WIN) return undefined;
  // \\?\, \\.\ and \\server\share reach devices and other machines.
  if (/^[\\/]{2}/.test(input)) return 'Network and device paths are not allowed.';
  // A colon past the drive letter names an alternate data stream.
  if (input.indexOf(':', /^[a-zA-Z]:/.test(input) ? 2 : 0) !== -1)
    return 'A colon is allowed only after the drive letter.';
  for (const part of input.split(/[\\/]/)) {
    if (part === '' || part === '.' || part === '..') continue;
    if (DEVICES.test(part)) return `"${part}" is a Windows device name.`;
    // Windows drops a trailing dot or space, so "notes.md." opens notes.md.
    if (/[. ]$/.test(part)) return `"${part}" ends in a dot or a space.`;
  }
  return undefined;
}

/** `path` as the system really reaches it, though its last parts may not exist yet. */
function realOf(path: string): { real: string; exists: boolean } {
  const rest: string[] = [];
  let at = path;
  for (;;) {
    try {
      // lstat, so a link that leads nowhere counts as there, and realpath fails on it below.
      lstatSync(at);
      break;
    } catch {
      const up = resolve(at, '..');
      if (up === at) throw new Error('No part of that path exists.');
      rest.unshift(at.slice(up.length).replace(/^[\\/]/, ''));
      at = up;
    }
  }
  const real = realpathSync.native(at);
  return { real: rest.length ? join(real, ...rest) : real, exists: !rest.length };
}

/** A folder's real path, or nothing when it is not there. */
function realRoot(dir: string): string | undefined {
  try {
    return realpathSync.native(dir);
  } catch {
    return undefined;
  }
}

/** Whether `path` is `root` or inside it. */
export const within = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

// Denials are conservative even on case-sensitive filesystems. Normalizing
// Unicode covers common macOS aliases without broadening an allow root.
const privateWithin = (path: string, root: string): boolean =>
  within(path.normalize('NFD').toLowerCase(), root.normalize('NFD').toLowerCase());

const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Whether `path`, or a folder it sits in, matches `pattern`, segment by
 * segment, with `**` for any number of segments. Names compare without case
 * on every system, so `agents.md` is refused on Linux too: refusing more is safe.
 */
export function matchesBelow(path: string, pattern: string): boolean {
  const pat = parts(pattern);
  const seg = parts(path);
  const match = (i: number, j: number): boolean => {
    if (i === pat.length) return true; // the pattern matched a folder `path` is in
    if (pat[i] === '**') return match(i + 1, j) || (j < seg.length && match(i, j + 1));
    return j < seg.length && same(pat[i], seg[j]) && match(i + 1, j + 1);
  };
  return match(0, 0);
}

/**
 * The real path `input` names, if this run may `want` it, or why not. A read
 * must name something that exists; a write may name a file not made yet,
 * in a folder that may not exist yet either.
 */
export function resolveIn(walls: FileWalls, input: string, want: 'read' | 'write'): Resolved {
  const bad = malformed(input);
  if (bad) return { refused: bad };
  const asked = isAbsolute(input) ? resolve(input) : resolve(walls.cwd, input);
  let real: string;
  let exists: boolean;
  try {
    ({ real, exists } = realOf(asked));
  } catch {
    return { refused: `${input} does not exist.` };
  }
  // Resolve private paths even when their leaf does not exist yet. Checking
  // the asked and resolved paths prevents aliases from bypassing the wall.
  if (
    walls.noAccess?.some((privatePath) => {
      let resolved: string;
      try {
        resolved = realOf(privatePath).real;
      } catch {
        return true;
      }
      return (
        privateWithin(asked, privatePath) ||
        privateWithin(real, privatePath) ||
        privateWithin(asked, resolved) ||
        privateWithin(real, resolved)
      );
    })
  )
    return { refused: `${input} is not available.` };
  if (want === 'read' && !exists) return { refused: `${input} does not exist.` };
  // A file with a second name (a hard link) may be one outside the folders,
  // and nothing says where the other name is: refused both ways.
  if (exists) {
    const st = statSync(real);
    // The file tools only serve regular files and directories. Opening a
    // FIFO or device synchronously can hang the shared server indefinitely.
    if (!st.isFile() && !st.isDirectory())
      return { refused: `${input} is not a regular file or folder.` };
    if (st.isFile() && st.nlink > 1)
      return { refused: `${input} has another name elsewhere, so it is not opened.` };
  }
  // A root is judged by its real path too: the office's folder may sit behind a link.
  const roots = (want === 'read' ? [...walls.reads, ...walls.writes] : walls.writes)
    .map(realRoot)
    .filter((r): r is string => !!r);
  if (!roots.some((r) => within(real, r)))
    return {
      refused:
        want === 'read'
          ? `${input} is outside the folders you may read.`
          : `${input} is outside the folders you may change.`
    };
  if (want === 'write') {
    // Each pattern on its real folder, so a link to the Odd's folder cannot dodge it.
    const denied = walls.noWrite.some((p) => {
      const star = p.indexOf('**');
      const base = star === -1 ? p : p.slice(0, star);
      const baseReal = realRoot(base.replace(/[\\/]+$/, '')) ?? base;
      const pattern = star === -1 ? baseReal : join(baseReal, p.slice(star));
      return matchesBelow(real, pattern) || matchesBelow(asked, p);
    });
    if (denied) return { refused: `${input} may not be changed.` };
    if (exists) {
      const st = statSync(real);
      if (st.isDirectory()) return { refused: `${input} is a folder.` };
    }
  }
  return { path: real };
}

/** The walls from the environment the office starts the file server with, or nothing at all. */
export function wallsFromEnv(env: NodeJS.ProcessEnv): FileWalls {
  try {
    const w = JSON.parse(env.ODDBORO_FILES ?? '') as Partial<FileWalls>;
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string' && isAbsolute(p)) : [];
    if (typeof w.cwd !== 'string' || !isAbsolute(w.cwd) || !existsSync(w.cwd)) throw new Error();
    // A supplied private wall must be understood whole; dropping an invalid
    // member could expose the very path it was meant to protect.
    if (
      w.noAccess !== undefined &&
      (!Array.isArray(w.noAccess) ||
        w.noAccess.some((p) => typeof p !== 'string' || !isAbsolute(p) || p.includes('\0')))
    )
      throw new Error();
    return {
      cwd: w.cwd,
      reads: list(w.reads),
      writes: list(w.writes),
      noWrite: list(w.noWrite),
      ...(w.noAccess === undefined ? {} : { noAccess: w.noAccess })
    };
  } catch {
    // No walls: nothing is readable or writable.
    return { cwd: resolve('/'), reads: [], writes: [], noWrite: [] };
  }
}
