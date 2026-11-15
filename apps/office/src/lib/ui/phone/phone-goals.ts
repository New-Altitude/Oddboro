// What the phone's Goals tab and a goal's page say, and a goal's work with
// what it left on the owner's desk woven in. Safe to import in the browser.
import type { Desk, ThreadWaiting } from '@oddboro/ledger';
import { HEALTH_WORDS } from '@oddboro/ledger/goals';
import type { ChatEvent } from '#lib/staff/chat.ts';
import type { ApiUrl } from '#lib/ui/api.ts';
import type { GoalEntry, GoalProgress, PhoneGoalCard } from '#lib/server/phone-goals.ts';
import type { DeskCard } from './phone-desk.ts';

/** "3 of 5 parts done · On track", or "No work started yet". */
export function progressLine(p: GoalProgress): string {
  const parts = p.total
    ? `${p.done} of ${p.total} ${p.total === 1 ? 'part' : 'parts'} done`
    : 'No work started yet';
  return p.health ? `${parts} · ${HEALTH_WORDS[p.health]}` : parts;
}

/** "By Jan 15 · Cindy leads". */
export function metaLine(g: Pick<PhoneGoalCard, 'when'>, lead: string | undefined): string {
  return lead ? `${g.when} · ${lead} leads` : g.when;
}

/** "1 waiting on you". */
export const waitingBadge = (n: number): string => `${n} waiting on you`;

/** "3 under way", or the one plain line for none. */
export const underWay = (n: number): string => (n ? `${n} under way` : 'No goals under way');

/** The card under a step: who the work went to, or how it came back. */
export function workLine(e: GoalEntry): string | undefined {
  if (!e.work) return undefined;
  if (e.kind === 'handed') return `Handed off to ${e.work.to}`;
  const back = {
    done: `Back to ${e.work.to}`,
    failed: `Could not finish it. Back to ${e.work.to}`,
    waiting: `Waiting on you for part of it`
  } as const;
  return back[e.work.outcome ?? 'done'];
}

/** One line of a goal's page: a step of its work, or an item of it on the owner's desk. */
export type GoalLine =
  { kind: 'entry'; at: string; entry: GoalEntry } | { kind: 'desk'; at: string; card: DeskCard };

/**
 * A goal's work with each item of it still open on the desk woven in by when
 * it landed, oldest first. An item the desk no longer holds is left out: the
 * owner already answered it.
 */
export function goalLines(entries: GoalEntry[], open: ThreadWaiting[], desk: Desk): GoalLine[] {
  const desked: GoalLine[] = open.flatMap((w): GoalLine[] => {
    if (w.kind === 'ask') {
      const row = desk.asks.find((a) => a.id === w.id);
      return row
        ? [
            {
              kind: 'desk',
              at: new Date(row.createdAt).toISOString(),
              card: { kind: 'ask', key: `ask-${row.id}`, row }
            }
          ]
        : [];
    }
    const row = desk.tasks.find((t) => t.id === w.id);
    return row
      ? [
          {
            kind: 'desk',
            at: new Date(row.createdAt).toISOString(),
            card: { kind: 'task', key: `task-${row.id}`, row }
          }
        ]
      : [];
  });
  return [
    ...entries.map((entry): GoalLine => ({ kind: 'entry', at: entry.at, entry })),
    ...desked
  ].sort((a, b) => a.at.localeCompare(b.at));
}

/** The chat route's server-sent events in what has arrived so far, and the part still to come. */
export function chatEvents(buf: string): { events: ChatEvent[]; rest: string } {
  const blocks = buf.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events = blocks.flatMap((b) => {
    const data = b
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    return data ? [JSON.parse(data) as ChatEvent] : [];
  });
  return { events, rest };
}

/**
 * Message the team: the owner's words go to the lead's own chat, through the
 * same route the chat posts to, and its reply comes back when it ends. A
 * refusal (the lead still replying, say) throws with the route's own words.
 */
export async function messageLead(
  leadId: string,
  message: string,
  /** Called once the route took the message, before the reply. */
  accepted?: () => void
): Promise<string> {
  const res = await fetch(`/api/staff/${leadId}/chat` satisfies ApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message })
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    let said = text;
    try {
      said = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      // Plain text error.
    }
    throw new Error(said || `HTTP ${res.status}`);
  }
  accepted?.();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let reply = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const got = chatEvents(buf + value);
    buf = got.rest;
    for (const e of got.events) {
      if (e.type === 'done') reply = e.text;
      if (e.type === 'error') throw new Error(e.message);
    }
  }
  return reply;
}
