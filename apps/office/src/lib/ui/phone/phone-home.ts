// What Home says about each Odd under Who's around: a dot and one line.
// Safe to import in the browser.
import type { Desk } from '@oddboro/ledger';
import type { Work } from '#lib/staff/work.ts';
import { nextWhen } from '#lib/ui/format.ts';

/** The phone's four tabs. */
export type Tab = 'home' | 'goals' | 'messages' | 'desk';

/** Working on something, waiting on the owner, or free. */
export type Presence = 'working' | 'waiting' | 'free';

/** The Odds with an open ask or task on the desk. */
export const waitingOdds = (d: Desk): Set<string> =>
  new Set([...d.asks, ...d.tasks].flatMap((i) => (i.staffId ? [i.staffId] : [])));

/**
 * One Odd's dot and line. Work it is running comes first, with how long it
 * has run in whole minutes. Then something of its waiting on the owner. Then
 * free, with its next job's time when one is set.
 */
export function aroundLine(
  o: {
    /** What the floor says it runs (`working` on the live line), if anything. */
    working?: string;
    work?: Work[];
    waiting: boolean;
    /** Its soonest job run, if any. */
    next?: string;
  },
  now = new Date()
): { presence: Presence; line: string } {
  const running = o.work?.find((w) => !w.queued && !w.toStart);
  if (running) {
    const min = Math.max(
      0,
      Math.floor((now.getTime() - new Date(running.since).getTime()) / 60_000)
    );
    return { presence: 'working', line: `${running.label} · ${min} min` };
  }
  if (o.working) return { presence: 'working', line: o.working };
  if (o.waiting) return { presence: 'waiting', line: 'Waiting on you' };
  return { presence: 'free', line: o.next ? `Free · next job ${nextWhen(o.next, now)}` : 'Free' };
}
