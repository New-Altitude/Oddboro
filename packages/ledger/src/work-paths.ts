// How a file in a goal's or work's folder is named when an Odd attaches it to
// an ask or a task, when the page reads an Odd's full path to it, and when
// Storage lists it: its path from the office's folder, such as
// "threads/12/paige/index.html", so the name leads to that one file whoever's
// part of the folder holds it. A file in a folder the owner gave an Odd goes
// by that folder's name and its path inside, such as
// "folders/site/index.html" (`givenPath`). Plain string work with no imports,
// so the page can show either by a short name; `workFile` in threads.ts and
// `locate` in the office's files.ts find them.

/** The folder in the office's folder that holds every thread's folder. */
export const THREADS_DIR = 'threads';

const NAMED = new RegExp(`^${THREADS_DIR}/(\\d+)/(.+)$`);

// A thread's id is a Postgres integer: a bigger number would fail the query
// that looks it up, so it names no thread.
const LAST_ID = 2 ** 31 - 1;

/**
 * The thread and the path inside its folder that `path` names, or undefined
 * when it names no file in a thread's folder. A `.` or `..` step, or an empty
 * one, names nothing, so the name never leaves that folder. A backslash divides
 * steps too, since Windows reads it as a folder separator.
 */
export function workPath(path: string): { thread: number; inside: string } | undefined {
  const m = NAMED.exec(path);
  if (!m || Number(m[1]) > LAST_ID || leaves(m[2])) return undefined;
  return { thread: Number(m[1]), inside: m[2] };
}

/** Whether `inside` has a step that names no folder, so a join would leave the folder it is in. */
function leaves(inside: string): boolean {
  return inside.split(/[/\\]/).some((step) => step === '' || step === '.' || step === '..');
}

/** The folder in an office name that holds the folders the owner gave an Odd. */
export const FOLDERS_DIR = 'folders';

const GIVEN = new RegExp(`^${FOLDERS_DIR}/([^/\\\\]+)/(.+)$`);

/**
 * The folder's name and the path inside it that `path` names, as a file in a
 * folder the owner gave an Odd, or undefined when it names none. Its steps
 * pass the same checks as `workPath`'s, so the name never leaves that folder.
 */
export function givenPath(path: string): { folder: string; inside: string } | undefined {
  const m = GIVEN.exec(path);
  if (!m || m[1] === '.' || m[1] === '..' || leaves(m[2])) return undefined;
  return { folder: m[1], inside: m[2] };
}

/** How the office names `inside`, a path inside the given folder called `folder`. */
export const givenName = (folder: string, inside: string): string =>
  `${FOLDERS_DIR}/${folder}/${inside}`;

/** How the office names `inside`, a path inside thread `thread`'s folder. */
export const workName = (thread: number, inside: string): string =>
  `${THREADS_DIR}/${thread}/${inside}`;

/**
 * What the owner sees of a file's name: a file in a thread's folder by its
 * bare name, since the owner never sees a thread or its folder; one in a
 * folder the owner gave by that folder's name and its path inside; and any
 * other by its path in the Odd's own folder.
 */
export function shownPath(path: string): string {
  if (workPath(path)) return path.slice(path.lastIndexOf('/') + 1);
  const given = givenPath(path);
  return given ? `${given.folder}/${given.inside}` : path;
}

/**
 * Claude Code, Grok, Codex and Gemini load these from a run's folder, so an
 * Odd may not rewrite its own instructions, hooks, skills, settings or MCP
 * servers, and none crosses in a hand-off. Every Odd gets the whole list,
 * whichever tool it runs on: it can be moved to another one, and its folder
 * stays its folder.
 */
export const INSTRUCTIONS = [
  'CLAUDE.md',
  'CLAUDE.local.md',
  '.claude',
  '.grok',
  'AGENTS.md',
  '.mcp.json',
  'AGENTS.override.md',
  '.codex',
  '.agents',
  'GEMINI.md',
  '.gemini'
];
