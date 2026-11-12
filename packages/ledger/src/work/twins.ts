// Twin asks: which open asks one answer covers, and which of the asks one
// answer settled start a run. Pure, so a decider can read it without the
// database.
import { levelAtMost } from '../access-words.ts';
import type { AskRow } from '../office.ts';
import type { AskKind } from '../schema.ts';

/** The kinds of ask that have twins (`asksNoMore`): an outside tool, a folder, and switches. */
export const TWINNED: AskKind[] = ['access', 'folder', 'switch'];

/**
 * Whether `later` asks for nothing `first` does not: the same Odd, the same
 * tool or folder, at the same level or lower. Asks for another Google account
 * of one product are the same tool. Two runs of one Odd can each find a tool
 * or a folder missing at once (a hire's first day and its lead's first
 * hand-off), and each raises its own ask. The owner sees the first alone
 * (`desk`), and their answer to it answers the twin too (`decide`), each back
 * where it came from.
 */
export function asksNoMore(first: AskRow, later: AskRow): boolean {
  if (first.id === later.id || first.staffId !== later.staffId) return false;
  if (first.kind === 'access' && later.kind === 'access' && first.access && later.access)
    return (
      first.access.another === later.access.another &&
      (!!first.access.another || first.access.connector === later.access.connector) &&
      levelAtMost(later.access.level, first.access.level)
    );
  if (first.kind === 'folder' && later.kind === 'folder' && first.folder && later.folder)
    return (
      first.folder.path === later.folder.path &&
      (first.folder.level === 'write' || later.folder.level === 'read')
    );
  if (first.kind === 'switch' && later.kind === 'switch')
    return (later.switches ?? []).every((s) => first.switches?.includes(s));
  return false;
}

/** Whether two asks of one kind ask for the same tool or folder, whatever the level. */
export const sameWanted = (a: AskRow, b: AskRow) =>
  a.kind === 'folder'
    ? a.folder?.path === b.folder?.path
    : a.kind === 'switch'
      ? (b.switches ?? []).every((s) => a.switches?.includes(s))
      : a.access?.connector === b.access?.connector;

/**
 * Which of the asks one answer settled start a `carry_out`: one for each place
 * a result must go back to, never one per ask. A hand-off's twin comes first,
 * then a thread's; a twin on neither starts a run only when no other does.
 * Two runs of one Odd once each did the same work after one answer, and the
 * owner got every email reply twice.
 */
export function carriedOutBy(together: AskRow[]): AskRow[] {
  const rank = (a: AskRow) => (a.handOffId ? 0 : a.threadId ? 1 : 2);
  const places = new Set<string>();
  const runs: AskRow[] = [];
  for (const a of [...together].sort((x, y) => rank(x) - rank(y) || x.id - y.id)) {
    const place = a.handOffId
      ? `hand-off ${a.handOffId}`
      : a.threadId
        ? `thread ${a.threadId}`
        : '';
    if (places.has(place) || (place === '' && runs.length)) continue;
    places.add(place);
    runs.push(a);
  }
  return runs;
}
