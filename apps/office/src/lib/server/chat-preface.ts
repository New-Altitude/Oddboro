// What a chat message tells the staffer's chat session before the owner's
// words: the lines in its chat that no run of the session wrote, the owner's
// messages whose run failed or the owner stopped, the work it put on the desk, and the asks the
// owner decided and tasks they ended, since the session last heard. Without
// it, an answer to a new manager's hello, or "How did the call go?" after a
// poke, means nothing to the session.
import { flat, SAID_AS } from '@oddboro/ledger/desk-answers';
import type { ChatEntry } from '../staff/chat.ts';
import type { ChatFile } from '#lib/attachments.ts';
import { cut } from './run-env.ts';

/** An attached file as a run hears it: kept, with its full path, or gone from the attachments folder since. */
export type KeptFile = (ChatFile & { path: string }) | { tag: string; gone: true };

/** A chat line as the office retells it: an owner line carries its files as they are now (`filesNow`). */
export type RetoldEntry = ChatEntry & { now?: KeptFile[] };

/** How a run hears one attached file, on the owner's new message and on a line the office retells alike. */
export const fileLine = (f: KeptFile): string =>
  'gone' in f
    ? `- [${f.tag}]: gone, deleted from your folder since`
    : `- [${f.tag}]: ${f.path} (${f.mediaType})`;

/** The files under an owner line the office retells, as they are now, or nothing when it has none. */
export const retoldFiles = (e: RetoldEntry): string =>
  e.now?.length
    ? [
        '\n(Files attached, each kept in your folder and named by its tag in brackets. Read each one the answer needs.',
        ...e.now.map(fileLine),
        ')'
      ].join('\n')
    : '';

/** A chat line the office retells (`replay`, `chatPreface`), with its files under it, so each file sits under its own line. */
export const retoldLine = (e: RetoldEntry): string =>
  `${e.from === 'owner' ? '{owner}' : 'You'}: ${e.text}${retoldFiles(e)}`;

/** A line the session never saw: a poke the office delivered, a line it said in the staffer's name, or a failed run's error. */
const unseen = (e: ChatEntry) => e.poke || e.told || e.failed;

/** Something the staffer put on the desk, as the chat lists it, and when the owner decided an ask or ended a task. */
type Landed = { kind: string; title: string; at: Date; status?: string; decidedAt?: Date | null };

// Any desk item's status reaches here as text, and one with no word keeps its own.
const said: Partial<Record<string, string>> = SAID_AS;
const howItEnded = (d: Landed) => `"${d.title}" ${said[d.status ?? ''] ?? d.status}`;

/**
 * The chat resumes the session saved last, or starts a new one that hears the
 * lines of `past` at `replayed` word for word (`replay` in replay.ts).
 */
export type Session = 'resumed' | { replayed: Set<number> };

/** The most of one chat line `lastExchange` carries, in UTF-16 units. */
const EXCHANGE_LINE_MAX = 300;

/**
 * The last Odd line before the owner's message and the owner line before it,
 * each on a line of its own and cut to `EXCHANGE_LINE_MAX`, for tell_lead. A
 * told or poke line counts as the Odd's: the owner read it just before
 * replying, whichever way it was written. Without an owner line before it (a
 * hello, a first question) it is the Odd's half alone. The Odd's half is last,
 * so tell_lead can leave it out for a lead that lacks the Odd's tools
 * (`exchangeForLead` in the ledger's `threads.ts`).
 */
export function lastExchange(
  past: ChatEntry[],
  who: { owner: string; odd: string }
): string | undefined {
  const spoken = past.filter((e) => !e.failed && flat(e.text));
  const odd = spoken.findLastIndex((e) => e.from === 'staff');
  if (odd < 0) return undefined;
  const quoted = (e: ChatEntry) => `"${cut(flat(e.text), EXCHANGE_LINE_MAX)}"`;
  const owner = spoken.slice(0, odd).findLast((e) => e.from === 'owner');
  return owner
    ? `Just before, ${who.owner} said: ${quoted(owner)}.\n${who.odd} replied: ${quoted(spoken[odd])}.`
    : `Just before, ${who.odd} said: ${quoted(spoken[odd])}.`;
}

/**
 * The line that ends the run on the owner's line at `i`: the next one after
 * it, past what the owner added to the same turn with Send now.
 */
function outcomeOf(past: ChatEntry[], i: number): ChatEntry | undefined {
  const turn = past[i].turnId;
  return past.slice(i + 1).find((e) => !(turn && e.from === 'owner' && e.turnId === turn));
}

/** Where `past` stands for `session`: which lines it holds, and the failed runs since the owner last wrote. */
function heardOf(past: ChatEntry[], session: Session) {
  // The office saves a failed run's error right after the owner's lines (`replyToOwnerTurn`).
  const failedOn = (i: number) => past[i].from === 'owner' && outcomeOf(past, i)?.failed === true;
  // The owner stopped that run: it did not fail.
  const stoppedOn = (i: number) => failedOn(i) && outcomeOf(past, i)?.interrupted === true;
  // The last failed run whose tool named a session (`inSession`): the session
  // a resumed chat takes up is the one it saved.
  const saved = past.findLastIndex((_, i) => failedOn(i) && outcomeOf(past, i)?.inSession === true);
  // A new session holds what its replay keeps. A resumed one holds every
  // failed run's owner line up to that run's: the run took its own line, and
  // its preface carried each earlier one the session did not hold. It never
  // holds a told or poke line, which no run of it wrote.
  const holds = (i: number) =>
    session === 'resumed' ? failedOn(i) && i <= saved : session.replayed.has(i);
  const heard = past.findLastIndex((e, i) => e.from === 'owner' && !failedOn(i)) + 1;
  const failed = past.flatMap((_, i) => (i >= heard && failedOn(i) ? [i] : []));
  return { failedOn, stoppedOn, holds, heard, failed };
}

/** Where in `past` sit the failed runs' owner lines the session never saw, which `chatPreface` retells. */
export function missedAt(past: ChatEntry[], session: Session): number[] {
  const { failed, holds } = heardOf(past, session);
  return failed.filter((i) => !holds(i));
}

/**
 * Each told, poke and failed run's owner line since the owner last wrote is
 * said once: here only when the session does not hold it already. A failed
 * run's owner line comes as the replay retells it, with its files as they are now under it.
 */
export function chatPreface(past: RetoldEntry[], landed: Landed[], session: Session): string[] {
  const { failedOn, stoppedOn, holds, heard, failed } = heardOf(past, session);
  const since = past.flatMap((e, i) => (i >= heard && !holds(i) ? [e] : []));
  const told = since.filter((e) => e.told);
  const poked = since.filter((e) => e.poke);
  const missedAll = missedAt(past, session);
  const missed = missedAll.filter((i) => !stoppedOn(i)).map((i) => past[i]);
  const missedStopped = missedAll.filter(stoppedOn).map((i) => past[i]);
  const ran = failed.filter((i) => holds(i) && !stoppedOn(i)).length;
  const heldStopped = failed.filter((i) => holds(i) && stoppedOn(i));
  // Words added with Send now share their turn's one reply.
  const stops = new Set(heldStopped.map((i) => outcomeOf(past, i))).size;
  const ranStopped = heldStopped.length;
  // The session saw what it delivered up to the end of its last reply.
  const last = past.findLast((e, i) => !unseen(e) && !failedOn(i))?.at ?? '';
  const put = landed.filter((d) => d.at.toISOString() > last);
  // Without these, a resumed session says an ask or a task still waits after the owner ended it.
  const ended = landed.filter((d) => d.decidedAt && d.decidedAt.toISOString() > last);
  const decided = ended.filter((d) => d.kind !== 'task');
  const endedTasks = ended.filter((d) => d.kind === 'task');
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
    // The session holds these messages, but not that its run on them failed.
    ...(ran
      ? [
          ran === 1
            ? "(Your run on {owner}'s last message you saw before this one failed, so they have no reply from you to it.)"
            : `(Your runs on {owner}'s last ${ran} messages you saw before this one failed, so they have no reply from you to them.)`
        ]
      : []),
    // A stopped reply is the owner's choice, not a failure to make up for.
    ...(ranStopped
      ? [
          `({owner} stopped your ${stops === 1 ? 'reply' : 'replies'} to their last ${ranStopped === 1 ? 'message' : `${ranStopped} messages`} you saw before this one. Do not pick that work back up unless they ask.)`
        ]
      : []),
    ...(missedStopped.length
      ? [
          [
            '({owner} wrote to you before this, then stopped your reply before you saw it. Do not act on it unless they ask:)',
            ...missedStopped.map(retoldLine)
          ].join('\n')
        ]
      : []),
    // Each line with its own files, since pasted pictures are numbered from #1 in every message.
    ...(missed.length
      ? [
          [
            '({owner} wrote to you before this, but your run failed each time, so you never saw it:)',
            ...missed.map(retoldLine)
          ].join('\n')
        ]
      : []),
    ...(put.length
      ? [
          `(Since {owner} last wrote, you put these on their desk: ${put.map((d) => `${d.kind} "${d.title}"`).join(', ')}.)`
        ]
      : []),
    ...(decided.length
      ? [
          `(Since your last reply, {owner} decided your asks: ${decided.map(howItEnded).join(', ')}. my_asks has their reasons.)`
        ]
      : []),
    ...(endedTasks.length
      ? [
          `(Since your last reply, {owner} ended your tasks: ${endedTasks.map(howItEnded).join(', ')}. my_tasks has what they said.)`
        ]
      : [])
  ];
}
