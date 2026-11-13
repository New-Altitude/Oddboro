// How an answer reaches a lead's work, as steps a decider takes on its
// `Draft`: the owner's answer or a task's end joins the lead's waiting pick-up
// or starts one, and parked work wakes as its task ends.
//
// Pure: every import that reaches the database is a type.
import { flat, OWN_RUN, OWNER_ANSWERS, type TaskEffect } from '../desk-answers.ts';
import { chatCardOf, type InChat } from '../schema.ts';
import type { TaskEnded } from '../task-parking.ts';
import { putAll, type Draft, type WorkRows } from './snapshot.ts';
import type { Task, Thread } from './state.ts';
import { addRun, newRun } from './threads.ts';

/**
 * The owner's answer, or a task's end, reaches the lead of a thread, as
 * `answerThread` does: it joins the lead's oldest `resume` there still
 * queued, a line each, so several answers landing together wake it once, or
 * it starts one. Only a queued row is joined: one an Odd's leaving ended
 * never starts, so a line joined to it would never be read. Nothing when the
 * lead left the office, since it runs nothing.
 */
export function answerLead(
  d: Draft,
  threadId: number,
  line: string,
  o: { askId?: number; chat?: InChat },
  now: Date
): void {
  const t = d.rows.threads.get(threadId);
  const lead = t && d.rows.staff.get(t.hubId);
  if (!lead || lead.leftAt) return;
  // Answered in the lead's own chat: the pick-up replies there, under the newest card answered.
  const chatCard = chatCardOf(lead.id, o.chat);
  const waiting = [...d.rows.followUps.values()]
    .filter(
      (f) =>
        f.staffId === lead.id &&
        f.threadId === threadId &&
        f.kind === 'resume' &&
        f.run.is === 'queued'
    )
    .sort((a, b) => a.id - b.id)[0];
  if (waiting) {
    const note = waiting.note ? `${waiting.note}\n${line}` : line;
    putAll(d, [{ table: 'followUps', row: { ...waiting, note, ...(chatCard && { chatCard }) } }]);
    return;
  }
  addRun(
    d,
    newRun(
      {
        staffId: lead.id,
        kind: 'resume',
        threadId,
        note: line,
        askId: o.askId ?? null,
        chatCard: chatCard ?? null
      },
      now
    ),
    now
  );
}

type OpenThread = Extract<Thread, { status: 'open' }>;

/** A run on an ended task's own work that parked work hears of: the title of that work, or null for a task on no work. */
export type OwnRun = { work: string | null; earlier?: true };

/**
 * The task ended: every open thread parked on it picks up, with what
 * happened, as `wakeOnTask` does. `ownRun` is there when a run on the task's
 * own work picks up too, so each parked thread is told that run carries its
 * own part; `earlier` when that run was set going as the task ended, before
 * this wake. A stopped thread lost its park, so it wakes for nothing.
 */
export function wakeParked(
  d: Draft,
  task: Task,
  how: { ended: TaskEnded; ownRun?: OwnRun },
  now: Date
): void {
  const parked = [...d.rows.threads.values()]
    .filter(
      (t): t is OpenThread => t.status === 'open' && t.park.on === 'task' && t.park.task === task.id
    )
    .sort((a, b) => a.id - b.id);
  putAll(
    d,
    parked.map((t) => ({ table: 'threads', row: { ...t, park: { on: 'none' } } }) as const)
  );
  const owner = d.rows.owner;
  const title = flat(task.title);
  const note = flat(task.note ?? '');
  const ended = {
    done: `${owner} finished "${title}", the task you parked this work on.`,
    dropped: `${owner} dropped "${title}", the task you parked this work on, so it will not be finished.`,
    withdrawn: `"${title}", the task you parked this work on, was taken off ${owner}'s desk, so it will not be finished.`
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
  for (const t of parked) answerLead(d, t.id, note ? `${said}: ${note}` : `${said}.`, {}, now);
}

/**
 * The run on an ended task's own work that `wakeParked` tells parked work
 * of, if one picks up, as `taskEnd` and `ownRunOf` in office-tasks.ts work it
 * out: whether the task's end starts a run there (`OWN_RUN`), and never on
 * stopped work or work whose lead left the office, which runs nothing.
 */
export function ownRunOf(rows: WorkRows, t: Task): OwnRun | undefined {
  // A tool's connect task belongs to the access ask it came from.
  const from = t.askId === null ? undefined : rows.asks.get(t.askId);
  const effects: readonly TaskEffect[] =
    t.status !== 'done'
      ? OWNER_ANSWERS.task.dropped
      : !t.staffId
        ? OWNER_ANSWERS.task.done.noOdd
        : from?.kind === 'access'
          ? OWNER_ANSWERS.task.done.fromAccess
          : OWNER_ANSWERS.task.done.other;
  const ownThread = t.threadId ?? from?.threadId ?? null;
  const ownRuns = effects.some(
    (e) =>
      typeof e === 'string' &&
      (OWN_RUN[e] === 'always' || (OWN_RUN[e] === 'on its work' && ownThread !== null))
  );
  if (!ownRuns) return undefined;
  const own = ownThread === null ? undefined : rows.threads.get(ownThread);
  // Its lead leaving stopped the work, so a lead brought back since still reads as gone.
  if (own && (own.status === 'stopped' || rows.staff.get(own.hubId)?.leftAt !== null))
    return undefined;
  return { work: own?.title ?? null };
}
