// What the office does with an Odd's chat and its runs, and the one place the
// rest of the office imports running an Odd from. A chat's log, a draft, a
// first day, a line the office says in a chat (`sayInChat`, `answerInChat`) and
// a poke's delivery are here. The runs themselves are re-exported: chats
// (chat-run.ts), jobs (job-run.ts), the run on its tool (run-tool.ts), its
// follow-through (follow-through.ts), its folders (run-folders.ts) and its
// state (run-state.ts). Server only.
import {
  chatSession,
  type ChatCard,
  claimPoke,
  deliveries,
  goalsFor,
  handOffsFor,
  jobsFor,
  lessonsOf,
  pokeMissed,
  staffer,
  startFirstDay,
  threadsFor,
  type HandOffStep,
  type Outcome,
  type PokeRow
} from '@oddboro/ledger';
import { flat } from '@oddboro/ledger/desk-answers';
import type { ChatEntry } from '../staff/chat.ts';
import { addToChat, history } from './chat-turns.ts';
import { emit } from './events.ts';
import { firstDayOf } from './first-day.ts';
import { notifyMac } from './notify.ts';
import { cut } from './run-env.ts';
import { downtime } from './update.ts';
import { isBusy, slot } from './run-state.ts';
import { run } from './run-tool.ts';
import type { Run } from './run-opts.ts';

export { activeReply, addToReply, chat, replyToOwnerTurn, stopReply } from './chat-run.ts';
export { history, keepOwnerTurn } from './chat-turns.ts';
export { runJob } from './job-run.ts';
export { chatting, inProgress, isBusy, runsActive, stopRuns } from './run-state.ts';

const CHAT_TIMEOUT_MS = 5 * 60_000;

export async function isStaff(id: string): Promise<boolean> {
  return /^[a-z0-9-]+$/.test(id) && !!(await staffer(id));
}

/** The chat as the owner sees it: what was said, and each delivery and lesson where it landed. */
export async function chatLog(id: string): Promise<ChatEntry[]> {
  const items: ChatEntry[] = (await deliveries(id)).map(({ at, ...d }) => ({
    at: at.toISOString(),
    from: 'staff',
    text: '',
    item: d
  }));
  const kept: ChatEntry[] = (await lessonsOf(id))
    .filter((l) => l.heardBy === id)
    .map(({ id: lessonId, text, quote, appliesTo, how, status, staffId, missed, createdAt }) => ({
      at: createdAt.toISOString(),
      from: 'staff',
      text: '',
      lesson: { id: lessonId, text, quote, appliesTo, how, status, staffId, missed }
    }));
  // Each step of a hand-off lands where it happened, so a reply that came back
  // an hour later sits after whatever was said in that hour. The giver's chat
  // keeps the colleague's reply inside the hand-off and shows its own pick-up.
  // A hand-off it gave sits on the card of its thread, where the thread began.
  const lines = await handOffsFor(id);
  const threads: ChatEntry[] = (await threadsFor(id)).map((line) => ({
    at: line.at.toISOString(),
    from: 'staff',
    text: '',
    thread: { line, steps: lines.filter((h) => h.gave && h.threadId === line.id) }
  }));
  const handOffs: ChatEntry[] = lines.flatMap((line) => {
    const at = (d: Date, step: HandOffStep, back?: number): ChatEntry => ({
      at: d.toISOString(),
      from: 'staff',
      text: '',
      handOff: { line, step, back }
    });
    return [
      ...(line.gave ? [] : [at(line.at, 'given')]),
      ...line.backs.flatMap((b, i) =>
        line.gave
          ? b.pickUp.at && b.pickUp.text
            ? [at(b.pickUp.at, 'next', i)]
            : []
          : b.answered
            ? []
            : [at(b.at, 'reply', i)]
      )
    ];
  });
  const messages = history(id).map(({ item: _item, ...message }) => message);
  return [...messages, ...items, ...threads, ...handOffs, ...kept].sort((a, b) =>
    a.at.localeCompare(b.at)
  );
}

/** A one-off draft from a staffer, outside any session: used to draft a job description. */
export async function draft(id: string, message: string): Promise<Run> {
  const who = await staffer(id);
  if (!who) return { ok: false, text: `No Odd named ${id}` };
  return slot(
    id,
    { kind: 'draft', label: 'Drafting', detail: 'Drafting for the hire window' },
    (onEvent, runId) =>
      run(who, message, { kind: 'draft', runId, timeoutMs: CHAT_TIMEOUT_MS, onEvent })
  );
}

/**
 * A new hire's first minutes. It says hello in its chat, in the session the
 * owner's chats then resume. A hire with a job then starts its first day's
 * work as a follow-up, so nobody has to ping it to get it moving. A hire with
 * no job starts nothing: one that serves a goal gets its first piece from the
 * goal's lead, whom approving the hire already woke on the goal's thread, and
 * any other runs only when it is handed work.
 */
export async function firstDay(id: string): Promise<void> {
  const who = await staffer(id);
  if (!who) return;
  // Read from the ledger, after the hire route has added the first job and
  // linked the goal the hire was proposed for, so the hello and the first day
  // agree with what the hire really has.
  const [jobs, serving] = await Promise.all([jobsFor(id), goalsFor(id)]);
  // Only an active goal: it is the only kind its runs are shown (`whoFor`).
  const day = firstDayOf({ jobs: jobs.length, goal: serving.find((g) => g.status === 'active') });
  if (!isBusy(id)) {
    const r = await slot(
      id,
      { kind: 'draft', label: 'Saying hello', detail: 'Introducing themselves' },
      (onEvent, runId) =>
        run(
          who,
          [
            'You were hired a moment ago, and you just walked into the office. {owner} has your chat open. Say hello.',
            '',
            '- Write as yourself, the way your job description says you work: a few short lines, no headings, no lists.',
            '- Say who you are and what you are here for, in your own words, not your job title.',
            ...day.hello
          ].join('\n'),
          {
            kind: 'chat',
            runId,
            sessionFile: chatSession(id),
            timeoutMs: CHAT_TIMEOUT_MS,
            onEvent
          }
        ),
      { greeting: true }
    );
    // The chat session wrote this hello, so it is not a told line.
    if (r.ok) addToChat(id, { at: new Date().toISOString(), from: 'staff', text: r.text });
  }
  if (day.starts) await startFirstDay(id);
}

/**
 * A line from a staffer in their chat that no run wrote, like a new manager's
 * hello. The next chat tells the session it said it (`chatPreface`).
 */
export function sayInChat(id: string, text: string): void {
  addToChat(id, { at: new Date().toISOString(), from: 'staff', text, told: true });
}

/** The most of a failed follow-up's reason its one chat line carries. */
const FAILED_LINE_MAX = 300;

/**
 * The Odd's reply to an answer the owner gave on a card in its chat: what
 * the run their answer started did, in the chat under that card (`re`), so
 * the talk goes on where they answered. One line per run. A failed run says
 * so in one line, shown as a failed reply is. A told line, since no run of
 * the chat session wrote it: the next chat hears it (`chatPreface`).
 */
export function answerInChat(id: string, card: ChatCard, outcome: Outcome, result: string): void {
  const failed = outcome === 'failed';
  const why = cut(flat(result), FAILED_LINE_MAX);
  addToChat(id, {
    at: new Date().toISOString(),
    from: 'staff',
    text: failed
      ? `Could not finish this${why ? `: ${why}` : '.'}`
      : result.trim() || (outcome === 'waiting' ? 'It waits on you, on your desk.' : 'Done.'),
    told: true,
    re: card,
    ...(failed ? { runFailed: true as const } : {})
  });
  emit({ type: 'change', table: 'chat' });
}

/** Deliver a due poke: a chat line from the staffer, and a notification on the Mac. */
export async function deliverPoke(p: PokeRow): Promise<void> {
  // More than 15 minutes late is missed, not counting time the app spent updating.
  const late = pokeMissed(p.at, new Date(), downtime());
  // An Odd that left says nothing: leaving cancelled its pokes, and this is the second wall.
  const who = await staffer(p.staffId);
  if (!who) return;
  if (!(await claimPoke(p.id, late)) || late) return;
  addToChat(p.staffId, {
    at: new Date().toISOString(),
    from: 'staff',
    text: p.message,
    poke: true
  });
  void notifyMac(who?.name ?? 'Oddboro', p.message);
}

export { runHomeOf } from './run-folders.ts';
export { notePlan, run } from './run-tool.ts';
export { type Run, RUN_ENDED, type RunOpts } from './run-opts.ts';
export { followThrough } from './follow-through.ts';
