// A chat line as the chat keeps it, a thread's steps in order, how much of a
// hand-off's text shows before it opens, and the words and key of a desk item's card.
import type { HandOffLine, ThreadLine } from '@oddboro/ledger';
import type { Delivered } from './chat-about.svelte.ts';
import type { ChatEntry } from '../staff/chat.ts';

/** A chat line as the page keeps it: one sent or streaming has no time yet. */
export type Line = Omit<ChatEntry, 'at'> & { at?: string; pending?: boolean };

/** A thread's steps in the order they happened: each hand-off given, and each run of the hub's own. */
export function threadSteps(
  t: NonNullable<Line['thread']>
): ({ at: string; h: HandOffLine } | { at: string; run: ThreadLine['runs'][number] })[] {
  return [
    ...t.steps.map((h) => ({ at: String(h.at), h })),
    ...t.line.runs.map((run) => ({ at: String(run.at), run }))
  ].sort((a, b) => a.at.localeCompare(b.at));
}
/** A block that only names what follows: headings, or a bold line on its own. */
const label = (block: string) =>
  block.split('\n').every((l) => /^(#{1,6}\s.*|\*\*[^*]+\*\*:?)$/.test(l.trim()));
/**
 * What the owner sees of a hand-off's text before opening it: its opening
 * paragraph, which the Odds' briefs ask them to write for the owner, with any
 * label above it. A lead still over `LONG` is cut and fades.
 */
export function lead(text: string): { text: string; more: boolean } {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n\s*\n/);
  const i = blocks.findIndex((b) => !label(b));
  if (i < 0 || i === blocks.length - 1) return { text, more: false };
  return { text: blocks.slice(0, i + 1).join('\n\n'), more: true };
}
export const LONG = 600;

export const KIND: Record<Delivered['kind'], string> = {
  ask: 'Ask',
  task: 'Task for you',
  report: 'Report'
};
export const STATUS: Record<string, string> = {
  open: 'Waiting on you',
  approved: 'Approved',
  denied: 'Denied',
  revise: 'Sent back',
  done: 'Done',
  dropped: 'Dropped',
  new: 'New',
  read: 'Read'
};
export const keyOf = (d: Delivered) => `${d.kind}-${d.id}`;
