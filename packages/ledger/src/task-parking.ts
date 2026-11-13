// Work a lead parked until a task on the owner's desk ends. The task's end is
// the only wake: nothing looks at the clock or goes round a loop for it.
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db.ts';
import { flat } from './desk-answers.ts';
import { fixedError } from './errors.ts';
import { threads } from './schema.ts';
import { answerThread, workedOn, type Db } from './threads.ts';
import { transitionWork } from './work/apply.ts';

/**
 * Parks work on a task through the work core (`parked`), or says why it
 * cannot. The task is locked with the park, so it cannot end between the
 * look and the park and leave the work waiting on a task already over.
 */
export async function parkOnTask(
  hubId: string,
  id: number,
  taskId: number
): Promise<{ title: string } | { problem: string }> {
  const parked = await transitionWork({
    kind: 'parked',
    staffId: hubId,
    threadId: id,
    on: { task: taskId },
    worksOn: await workedOn(db, hubId)
  });
  if ('refused' in parked) return { problem: parked.refused };
  const r = parked.change.result;
  if (!('title' in r)) throw fixedError('A park on a task came back as a park on a time.');
  return r;
}

/** The live threads parked on a task: what its end picks up. */
const parkedOn = (taskId: number) => and(eq(threads.resumeOnTask, taskId), isNull(threads.endedAt));

/**
 * The work parked on a task, read before the task's end wakes it, so the run
 * that hears the task ended can be told that work picks up on its own.
 */
export async function parkedWork(
  taskId: number,
  q: Db = db
): Promise<{ id: number; title: string }[]> {
  return q.select({ id: threads.id, title: threads.title }).from(threads).where(parkedOn(taskId));
}

/**
 * How a task ended, as the work parked on it hears it: `withdrawn` is the
 * office or its Odd taking it off the desk (`withdrawTask`), never the owner's drop.
 */
export type TaskEnded = 'done' | 'dropped' | 'withdrawn';

/**
 * The task ended: every live thread parked on it picks up, with what happened.
 * A stopped thread lost its park and wakes for nothing, so neither does the
 * lead of one, such as an Odd that left the office (`removeOdd`).
 * `ownRun` is there when a run on the task's own work picks up too, with the
 * title of the work it is on, or null for a task on no work: each parked
 * thread is told that run carries its own part. `earlier` when that run
 * was set going before this wake, as the task ended, and was not told of this work:
 * a failed run gave the park back after the task ended (`finishFollowUp`).
 */
export async function wakeOnTask(
  t: { id: number; title: string; note: string | null },
  how: { ended: TaskEnded; owner: string; ownRun?: { work: string | null; earlier?: true } },
  q: Db = db
): Promise<void> {
  const parked = await q
    .update(threads)
    .set({ resumeOnTask: null })
    .where(parkedOn(t.id))
    .returning({ id: threads.id });
  const title = flat(t.title);
  const note = flat(t.note ?? '');
  const ended = {
    done: `${how.owner} finished "${title}", the task you parked this work on.`,
    dropped: `${how.owner} dropped "${title}", the task you parked this work on, so it will not be finished.`,
    withdrawn: `"${title}", the task you parked this work on, was taken off ${how.owner}'s desk, so it will not be finished.`
  }[how.ended];
  // A task on no work can be parked on only by the Odd that gave it
  // (`parkOnTask`), so its own run is this Odd's.
  const run = how.ownRun;
  const own = !run
    ? ''
    : run.work === null
      ? run.earlier
        ? " Another run of yours was set going when the task ended and carries its own part: do only this work's part here."
        : " Another run of yours picks up from that task too and carries its own part: do only this work's here."
      : run.earlier
        ? ` A run on "${flat(run.work)}", the work that task was given on, was set going when the task ended, and its lead carries that work's own part: do only this work's part here.`
        : ` "${flat(run.work)}", the work that task was given on, picks up too, and its lead carries that work's own part: do only this work's here.`;
  const next = how.ended === 'done' ? 'Pick it up now' : 'Decide what comes of the work now';
  const said = `${ended}${own} ${next}`;
  for (const { id } of parked)
    await answerThread(id, note ? `${said}: ${note}` : `${said}.`, undefined, q);
}
