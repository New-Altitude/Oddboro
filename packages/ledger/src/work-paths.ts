// How a file in a goal's or work's folder is named when an Odd attaches it to
// an ask or a task: its path from the office's folder, such as
// "threads/12/paige/index.html", so the name leads to that one file whoever's
// part of the folder holds it. Plain string work with no imports, so the page
// can show such a file by its bare name; `workFile` in threads.ts finds it.

/** The folder in the office's folder that holds every thread's folder. */
export const THREADS_DIR = 'threads';

const NAMED = new RegExp(`^${THREADS_DIR}/(\\d+)/(.+)$`);

// A thread's id is a Postgres integer: a bigger number would fail the query
// that looks it up, so it names no thread.
const LAST_ID = 2 ** 31 - 1;

/**
 * The thread and the path inside its folder that `path` names, or undefined
 * when it names no file in a thread's folder. A `.` or `..` step, or an empty
 * one, names nothing, so the name never leaves that folder.
 */
export function workPath(path: string): { thread: number; inside: string } | undefined {
  const m = NAMED.exec(path);
  if (
    !m ||
    Number(m[1]) > LAST_ID ||
    m[2].split('/').some((step) => step === '' || step === '.' || step === '..')
  )
    return undefined;
  return { thread: Number(m[1]), inside: m[2] };
}

/** How the office names `inside`, a path inside thread `thread`'s folder. */
export const workName = (thread: number, inside: string): string =>
  `${THREADS_DIR}/${thread}/${inside}`;

/**
 * What the owner sees of a file's name: a file in a thread's folder by its
 * bare name, since the owner never sees a thread or its folder, and any other
 * by its path in the Odd's own folder.
 */
export const shownPath = (path: string): string =>
  workPath(path) ? path.slice(path.lastIndexOf('/') + 1) : path;
