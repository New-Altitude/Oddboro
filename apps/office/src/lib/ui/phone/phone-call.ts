// The phone's call with one Odd: its timer, what else it is doing, what of it
// waits on the owner, its captions, and reading a reply as it streams. A call
// is that Odd's ordinary chat (`/api/staff/[id]/chat`). Safe to import in the
// browser.
import type { Desk } from '@oddboro/ledger';
import type { ChatEntry, ChatEvent } from '#lib/staff/chat.ts';
import type { Work } from '#lib/staff/work.ts';
import { waitingOnYou, type DeskCard } from './phone-desk.ts';

/** How long a call has run, as "02:14", or "1:02:14" past an hour. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`;
}

/**
 * What else the Odd is doing while it talks: its running work and how long
 * it has run, in whole minutes. A chat is not in `inProgress`, so this is
 * only other work. Empty when there is none.
 */
export function alsoLine(work: Work[] | undefined, now = new Date()): string {
  const running = work?.find((w) => !w.queued && !w.toStart);
  if (!running) return '';
  const min = Math.max(0, Math.floor((now.getTime() - new Date(running.since).getTime()) / 60_000));
  const more = work!.filter((w) => !w.queued && !w.toStart).length - 1;
  return `also ${lower(running.label)}${more ? ` and ${more} more` : ''}, ${min} min`;
}

const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** That Odd's asks on the desk, newest first: what waits on the owner's yes or no, as on Home. */
export const waitingFor = (d: Desk, id: string): DeskCard[] =>
  waitingOnYou(d).filter((c) => c.row.staffId === id);

/** One line of a call's captions. */
export type Caption = {
  from: 'owner' | 'staff';
  text: string;
  /** True while the reply still streams in. */
  live?: boolean;
  failed?: boolean;
};

/** How many of the chat's last lines a call opens with. */
export const CAPTIONS_KEPT = 6;

/** The chat's last spoken lines, as captions: the call picks up where the chat is. */
export function captionsFrom(history: ChatEntry[]): Caption[] {
  return history
    .filter((e) => e.text.trim() && !e.item && !e.lesson && !e.handOff && !e.thread)
    .slice(-CAPTIONS_KEPT)
    .map((e) => ({ from: e.from, text: e.text, ...(e.failed ? { failed: true } : {}) }));
}

/**
 * Reads the chat route's reply, one server-sent event at a time, as the
 * Odd's chat on the computer does. Ends when the reply does.
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  on: (e: ChatEvent) => void
): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      if (chunk.startsWith('data: ')) on(JSON.parse(chunk.slice(6)) as ChatEvent);
    }
  }
}
