// What a chat message tells the staffer's chat session before the owner's
// words: the lines in its chat that no run of the session wrote, the work it
// put on the desk, and the asks the owner decided, since the session last
// heard. Without it, an answer to a
// new manager's hello, or "How did the call go?" after a poke, means nothing
// to the session.
import type { ChatEntry } from './staff.ts';

/** A line the session never saw: a poke the office delivered, or a line it said in the staffer's name. */
const unseen = (e: ChatEntry) => e.poke || e.told;

/** Something the staffer put on the desk, as the chat lists it, and when the owner decided an ask. */
type Landed = { kind: string; title: string; at: Date; status?: string; decidedAt?: Date | null };

/** How the session hears each decision on an ask (`AskStatus`). */
const DECIDED: Record<string, string> = {
  approved: 'approved',
  denied: 'turned down',
  revise: 'sent back'
};

export function chatPreface(past: ChatEntry[], landed: Landed[]): string[] {
  const since = past.slice(past.findLastIndex((e) => e.from === 'owner') + 1);
  const told = since.filter((e) => e.told);
  const poked = since.filter((e) => e.poke);
  // The session saw what it delivered up to the end of its last reply.
  const last = past.findLast((e) => !unseen(e))?.at ?? '';
  const put = landed.filter((d) => d.at.toISOString() > last);
  // Without this, a resumed session says an ask still waits after the owner decided it.
  const decided = landed.filter((d) => d.decidedAt && d.decidedAt.toISOString() > last);
  return [
    ...(told.length
      ? [
          `(Before this, you said to {owner} in chat: ${told.map((e) => `"${e.text}"`).join(', ')}.)`
        ]
      : []),
    ...(poked.length
      ? [
          `(Since {owner} last wrote, the office delivered your pokes to them: ${poked.map((e) => `"${e.text}"`).join(', ')}.)`
        ]
      : []),
    ...(put.length
      ? [
          `(Since {owner} last wrote, you put these on their desk: ${put.map((d) => `${d.kind} "${d.title}"`).join(', ')}.)`
        ]
      : []),
    ...(decided.length
      ? [
          `(Since your last reply, {owner} decided your asks: ${decided.map((d) => `"${d.title}" ${DECIDED[d.status ?? ''] ?? d.status}`).join(', ')}. my_asks has their reasons.)`
        ]
      : [])
  ];
}
