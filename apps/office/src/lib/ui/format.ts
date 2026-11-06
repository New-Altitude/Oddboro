// Times as the owner reads them: in the office's time zone, short, and relative
// when recent.
import type { ThreadStage } from '@oddboro/ledger';
import { zone } from '@oddboro/ledger/time';

export function ago(at: string | Date): string {
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function when(at: string | Date): string {
  const PT = zone();
  const d = new Date(at);
  const today = new Date().toLocaleDateString('en-US', { timeZone: PT });
  const day = d.toLocaleDateString('en-US', { timeZone: PT });
  const time = d.toLocaleTimeString('en-US', { timeZone: PT, hour: 'numeric', minute: '2-digit' });
  if (day === today) return time;
  return `${d.toLocaleDateString('en-US', { timeZone: PT, month: 'short', day: 'numeric' })}, ${time}`;
}

/** Big counts as the owner reads them: 1.2K, 3.4M. */
export const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1
});

/** A piece of work an Odd leads, as the owner sees it: by name, with no plumbing. */
export type Work = {
  stage: ThreadStage;
  lead: string;
  holder: string;
  resumeAt?: string | Date;
  /** Paused for the plan's usage window, not by the lead's own choice. */
  held: boolean;
};

const WORK: Record<ThreadStage, (w: Work) => { text: string; yours: boolean }> = {
  under_way: (w) => ({
    text: !w.resumeAt
      ? `With ${w.holder}`
      : w.held
        ? `Paused until your Claude plan's window resets at ${when(w.resumeAt)}`
        : `${w.lead} picks it up at ${when(w.resumeAt)}`,
    yours: false
  }),
  waiting_on_you: () => ({ text: 'Waiting on you', yours: true }),
  done: () => ({ text: 'Done', yours: false }),
  failed: (w) => ({ text: `${w.lead} could not finish it`, yours: false }),
  // The owner said no to going on with it.
  stopped: () => ({ text: 'You stopped it', yours: false })
};

/**
 * Where a piece of work stands, in the owner's words, and whether they have to
 * act. The card in a chat and the Goals window both show it. Never a thread,
 * a number or a count: those are the office's own.
 */
export const workLine = (w: Work): { text: string; yours: boolean } => WORK[w.stage](w);
