// What the viewer offers for an Odd's file besides showing it, read from the
// name it opens by, so the viewer's window and an attachment on the desk
// agree. Plain TypeScript, so a test reads it as the page does.
import { givenPath, shownPath, workPath } from '@oddboro/ledger/work-paths';
import { PAGE } from '#lib/pages.ts';
import { call } from './api.ts';
import type { FileRef } from './windows.svelte.ts';

export type Offers = {
  /** The name the owner reads, which never shows a thread or its folder. */
  shown: string;
  /** Whether the owner may edit it. One attached from a thread's folder, or in a folder the owner gave, opens to read only. */
  edit: boolean;
  /** Whether it gets Open in browser: only a page (`PAGE`). */
  browser: boolean;
};

export const offers = (f: FileRef): Offers => ({
  shown: shownPath(f.path),
  edit: !workPath(f.path) && !givenPath(f.path),
  browser: PAGE.test(f.path)
});

/**
 * Whose file the viewer says it is. One in a goal's or work's folder is the
 * file of the Odd whose part holds it, whoever attached it, and names no
 * thread or folder; one in a folder the owner gave is the owner's; any other
 * is in the folder of the Odd that keeps it.
 */
export function whose(f: FileRef, name: (staffId: string) => string): string {
  const work = workPath(f.path);
  if (work) return `${name(work.inside.slice(0, work.inside.indexOf('/')))}'s file`;
  if (givenPath(f.path)) return `Your folder · ${shownPath(f.path)}`;
  return `${name(f.staff)}'s folder · ${shownPath(f.path)}`;
}

/** Ask the office to open the page `f` in the owner's browser. Throws with why it could not. */
export const openInBrowser = (f: FileRef): Promise<unknown> => call('/api/files/open', f);
