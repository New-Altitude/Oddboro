// What the Storage tab lists and what each row says, so a test reads it as the
// page does. A row is shared because it came from a piece of work, never because
// its path looks like one: an Odd's own folder can hold a path that reads the same.

export type Entry = { path: string; dir: boolean; size: number; mtime: number };
export type Work = { title: string; root: string; entries: Entry[] };
/** An entry and the words the owner reads for it. `below` is its path under its work's root. */
export type Row = Entry & { work?: string; below: string };
/** Each folder's own rows, by the folder's path ('' is the top). */
export type Tree = Record<string, Row[]>;

export const ownRows = (entries: Entry[]): Row[] => entries.map((e) => ({ ...e, below: e.path }));

export const sharedRows = (work: Work[]): Row[] =>
  work.flatMap((w) =>
    w.entries.map((e) => ({ ...e, work: w.title, below: e.path.slice(w.root.length + 1) }))
  );

/** What the owner reads for a row. A shared one says its work's title, never its thread's folder. */
export const shownAs = (r: Row): string =>
  r.work === undefined ? r.below : `${r.work}/${r.below}`;

export const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

export const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** What a search row shows between a shared row's title and the file's bare name. */
export const beforeName = (r: Row): string => {
  const folders = parentOf(r.below);
  return `${r.work === undefined ? '' : '/'}${folders && `${folders}/`}`;
};

export function treeOf(rows: Row[]): Tree {
  const by: Tree = {};
  for (const r of rows) (by[parentOf(r.path)] ??= []).push(r);
  return by;
}

export const countFiles = (rows: Row[]): number => rows.filter((r) => !r.dir).length;

/** The line that says how many files `rows` holds and where they are. */
export const countLine = (rows: Row[], where: string): string => {
  const n = countFiles(rows);
  return `${n} ${n === 1 ? 'file' : 'files'} in ${where}.`;
};

/** Whether the Odd has nothing to list: no entry of its own and no piece of work. */
export const nothingKept = (entries: Entry[], work: Work[]): boolean =>
  !entries.length && !work.length;

/** The files whose words for the owner hold `find`, the Odd's own first. */
export function matching(own: Row[], shared: Row[], find: string): Row[] {
  const f = find.trim().toLowerCase();
  return f ? [...own, ...shared].filter((r) => !r.dir && shownAs(r).toLowerCase().includes(f)) : [];
}
