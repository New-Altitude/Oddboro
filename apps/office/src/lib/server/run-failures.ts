// Where the owner finds the error of a failed run, for each kind of run
// (`UsageKind` in the ledger), so a new kind cannot ship without saying where
// its failure goes. failed-run.test.ts makes a run of each kind fail and
// checks every place, both ways. Each place shows the error as the tool gave
// it, such as "Could not start Claude Code: spawn claude ENOENT"; saying it in
// plain words is NEW-1686.
import type { UsageKind } from '@oddboro/ledger';

/** A place the owner can find a failed run's error. */
export type Landing =
  /** The Odd's chat, after the owner's message, and still there after a reload. */
  | 'chat'
  /** A report on the owner's desk. */
  | 'desk'
  /** A line in the Ledger. */
  | 'ledger'
  /** The job's "Last run failed" and its error on the Odd's Jobs tab (`JobsSection.svelte`). */
  | 'jobs'
  /** The answer to the page's request, shown where the owner asked. Nothing is saved. */
  | 'reply'
  /** The office drawing's progress, which a page following it shows until the office restarts. */
  | 'drawing';

export const RUN_FAILURE: Record<UsageKind, readonly Landing[]> = {
  // A new hire's hello is a chat run too, and when it fails it lands nowhere
  // (NEW-1660).
  chat: ['chat'],
  // The job's run is marked failed with the error, which its Jobs tab shows,
  // but a failed job, run by the clock or by hand, never reaches the desk
  // (NEW-1706).
  job: ['ledger', 'jobs'],
  // `desk` holds only for work that serves no hand-off: a failure of work
  // that serves one goes back to the Odd that handed it instead
  // (`finishFollowUp` in the ledger), since that Odd picks it up at once. The
  // row cannot say so, and the test's follow-up serves none.
  'follow-up': ['desk', 'ledger'],
  // Drafting a job description in the hire window.
  draft: ['reply'],
  look: ['reply'],
  office: ['drawing']
};
