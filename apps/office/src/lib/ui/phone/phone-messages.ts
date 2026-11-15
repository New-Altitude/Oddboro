// What Messages shows under each Odd's name: the last thing said in its chat.
// Safe to import in the browser.
import type { ChatEntry } from '#lib/staff/chat.ts';

/** The last thing said in one Odd's chat, by the owner or by the Odd. */
export type LastLine = { from: 'owner' | 'staff'; text: string; at: string };

/**
 * The last line someone said in a chat. A line the office saved in place of a
 * failed reply is skipped, since the Odd never said it, and so is any line
 * with no words, such as a delivery or a lesson.
 */
export function lastLine(entries: ChatEntry[]): LastLine | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.failed || e.item || e.lesson || e.handOff || e.thread) continue;
    const text = oneLine(e.text);
    if (text) return { from: e.from, text, at: e.at };
  }
  return undefined;
}

/**
 * Text on one line, with the marks Markdown adds taken out: links, code
 * ticks, emphasis around words, and a heading's or a quote's mark at a line's
 * start. The same characters inside a word or a sum stay.
 */
export function oneLine(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/(\*\*|__|~~)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/(^|[\s(])[*_](\S(?:[^*_]*?\S)?)[*_](?=$|[\s.,;:!?)])/gm, '$1$2')
    .replace(/^\s*(?:#{1,6}|>)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The line under an Odd's name: "You: ..." when the owner said it last. */
export const previewLine = (last: LastLine | undefined): string =>
  !last ? 'No messages yet' : last.from === 'owner' ? `You: ${last.text}` : last.text;
