// Work a staffer owes once the owner answers it: carry out an approved ask, rework
// one the owner sent back, take in the reason for a no, act on their feedback on a report, pick up the work
// that waited on a task the owner just finished, plan a goal they set, get a
// new hire with a job started on its first day, or read the owner's
// edit to an Odd's file for a lesson. Work one Odd hands another runs the
// same way, and so does its result going back (hand-offs.ts in the ledger), and
// so does a thread's hub picking it back up (threads.ts).
// This listens for changes to follow-ups and starts any nobody has started yet. Nothing polls:
// a change to the table, or any run ending, is the only thing that looks.
import {
  closeStaleFollowUps,
  finishFollowUp,
  followUpsToDo,
  startFollowUp,
  workTitle
} from '@oddboro/ledger';
import { bus, listen, type OfficeEvent } from './events.ts';
import { readEditAgain } from './files.ts';
import { followThrough, RUN_ENDED } from './staff.ts';
import { held } from './update.ts';

const g = globalThis as unknown as { followUps?: boolean };

async function look(): Promise<void> {
  // An update is about to install. Nothing new starts; the next start looks again.
  if (held()) return;
  for (const { id, ask, report, task, goal } of await followUpsToDo()) {
    // The claim is in the database, so two looks never start the same one. It
    // returns the row as claimed, with any answer that joined it since the list.
    const f = await startFollowUp(id);
    if (!f) continue;
    // The same name a restart gives it, so one piece of work has one name.
    const about = await workTitle(f);
    void followThrough(f, ask, report, task, goal)
      .then(async (r) => {
        await finishFollowUp(f, about, r.outcome, r.text, { joined: r.joined });
        // A save while an edited run ran joined it, so once it ends, any change
        // since it read the file is one more edit to read.
        if (f.edit && r.saw !== undefined) await readEditAgain(f.staffId, f.edit.path, r.saw);
      })
      .catch((e: unknown) => {
        // When finishing itself failed, the second call finds the outcome
        // already written and does nothing, so the log is all that tells.
        console.error(`Follow-up ${f.id} (${about}) failed:`, e);
        return finishFollowUp(f, about, 'failed', e instanceof Error ? e.message : String(e));
      });
  }
}

/** Start once per process. */
export function startFollowUps(): void {
  if (g.followUps) return;
  g.followUps = true;
  listen();
  bus.on('event', (e: OfficeEvent) => {
    if (e.type === 'change' && e.table === 'follow_ups') void look();
  });
  bus.on(RUN_ENDED, () => void look());
  void closeStaleFollowUps().then(look);
}
