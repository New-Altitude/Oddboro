// Tasks an Odd gives the owner, from giving one to finishing it.
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from './db.ts';
import { parkedWork, wakeOnTask, type TaskEnded } from './task-parking.ts';
import { keepRun, raisedOn } from './threads.ts';
import { attachments, tasks, threads, type Step } from './schema.ts';
import {
  OWN_RUN,
  ownerAnswers,
  OWNER_ANSWERS,
  pickedUpLine,
  type TaskEffect
} from './desk-answers.ts';
import type { TaskRow } from './office.ts';
import { staffer } from './office-staff.ts';
import { record } from './office-ledger.ts';
import { lockDesk, refuseRepeat, ask, answeredWith, carryOutTogether } from './office-asks.ts';
import { answerLater } from './office-decide.ts';
import { followUp } from './office-follow-ups.ts';
import { ownerName } from './office-usage.ts';

// Tasks for the owner

export async function giveTask(
  staffId: string | null,
  t: {
    title: string;
    why: string;
    steps: (string | Step)[];
    attach?: string[];
    /** Given while working on this hand-off: the owner's answer goes back to it. */
    handOffId?: number;
    /** Given on this thread: the owner's answer moves it on. */
    threadId?: number;
    /** The key of the run giving it, which its thread keeps, as `raiseAsk` says. */
    run?: string;
    /** The colleague whose handed-back work the lead gave this from (`VIA`). */
    via?: string;
    /** The office gives it in the Odd's name (a plan's steps, a reconnect), so it may repeat a title. */
    byOffice?: true;
  }
): Promise<TaskRow> {
  const steps = t.steps.map((s) => (typeof s === 'string' ? { text: s, done: false } : s));
  return db.transaction(async (tx) => {
    // An Odd's own task may not repeat an item it already has on the desk.
    if (staffId && !t.byOffice) {
      await lockDesk(tx, staffId);
      await refuseRepeat(tx, staffId, t.title);
    }
    const [row] = await tx
      .insert(tasks)
      .values({
        staffId,
        title: t.title,
        why: t.why,
        steps,
        handOffId: t.handOffId,
        threadId: t.threadId,
        via: t.via
      })
      .returning();
    if (row.threadId) {
      // A task the office gives itself has no Odd, so no run of one to keep.
      if (staffId) await keepRun(tx, row.threadId, { key: t.run, by: staffId });
      await raisedOn(tx, row.threadId);
    }
    if (staffId && t.attach?.length)
      await tx
        .insert(attachments)
        .values(
          t.attach.map((path) => ({ staffId, path, mediaType: mediaTypeOf(path), taskId: row.id }))
        );
    return row;
  });
}

/** The files a task carries, as paths inside its staffer's folder or names in a thread's folder (`workPath`). */
export async function taskFiles(taskId: number): Promise<string[]> {
  const rows = await db
    .select({ path: attachments.path })
    .from(attachments)
    .where(eq(attachments.taskId, taskId))
    .orderBy(asc(attachments.id));
  return rows.map((r) => r.path);
}

const MEDIA: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml'
};

/** The media type of an attachment, from its extension. */
export function mediaTypeOf(path: string): string {
  return MEDIA[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export async function task(id: number): Promise<TaskRow | undefined> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return row;
}

/** Tick a step, or every step sharing its key, and record an answer if the step asked for one. */
export async function tickStep(id: number, index: number, answer?: string): Promise<void> {
  const t = await task(id);
  const step = t?.steps[index];
  if (!t || !step) return;
  const steps = t.steps.map((s, i) =>
    i === index || (step.key && s.key === step.key)
      ? { ...s, done: true, ...(i === index && answer !== undefined ? { answer } : {}) }
      : s
  );
  await db.update(tasks).set({ steps }).where(eq(tasks.id, id));
}

/** Undo a step, and any step sharing its key, so the owner can do it again. Its answer goes too. */
export async function untickStep(id: number, index: number): Promise<void> {
  const t = await task(id);
  const step = t?.steps[index];
  if (!t || !step) return;
  const steps = t.steps.map((s, i) => {
    if (i !== index && !(step.key && s.key === step.key)) return s;
    const { answer: _, ...rest } = s;
    return { ...rest, done: false };
  });
  await db.update(tasks).set({ steps }).where(eq(tasks.id, id));
}

/** Tick every step whose key matches, across open tasks. Used when a sign-in lands. */
export async function tickKey(key: string): Promise<void> {
  const open = await db.select().from(tasks).where(eq(tasks.status, 'open'));
  for (const t of open)
    if (t.steps.some((s) => s.key === key && !s.done))
      await db
        .update(tasks)
        .set({ steps: t.steps.map((s) => (s.key === key ? { ...s, done: true } : s)) })
        .where(eq(tasks.id, t.id));
}

/**
 * What an ended task starts (`OWNER_ANSWERS`), and whether a run on the task's
 * own work picks up among it (`OWN_RUN`). `finishTask` and a failed run giving
 * a wait back (`finishFollowUp`) both read it, so parked work hears of the same run.
 */
async function taskEnd(t: TaskRow) {
  // A tool's connect task belongs to the access ask it came from.
  const from = t.askId ? await ask(t.askId) : undefined;
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
  return { from, effects, ownThread, ownRuns };
}

/** The run on an ended task's own work that `wakeOnTask` tells parked work of, if one picks up. */
async function ownRunOf(end: {
  ownThread: number | null;
  ownRuns: boolean;
}): Promise<{ work: string | null } | undefined> {
  if (!end.ownRuns) return undefined;
  const [own] = end.ownThread
    ? await db
        .select({ title: threads.title, hubId: threads.hubId })
        .from(threads)
        .where(eq(threads.id, end.ownThread))
    : [];
  // A lead that left the office runs nothing, so parked work must not leave its part to it.
  if (own && !(await staffer(own.hubId))) return undefined;
  return { work: own?.title ?? null };
}

export async function finishTask(id: number, done: boolean, note: string | null): Promise<void> {
  const [t] = await db
    .update(tasks)
    .set({ status: done ? 'done' : 'dropped', note: note || null, doneAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.status, 'open')))
    .returning();
  if (!t) return;
  const owner = await ownerName();
  const answers = ownerAnswers(t.steps).map((a) => `${a.step} ${a.answer}`);
  await record({
    kind: 'work',
    actor: 'owner',
    title: `${done ? 'Done' : 'Dropped'} by ${owner}: ${t.title}`,
    // Answers first: search_ledger shows the first 400 characters, and a long why would cut them off.
    body: [...answers, t.why].join('\n'),
    reason: t.note,
    taskId: t.id
  });
  await taskEnded(t, {
    ended: done ? 'done' : 'dropped',
    owner,
    said: `${owner} ${done ? 'finished' : 'dropped'} "${t.title}"${t.note ? `: ${t.note}` : '.'}`
  });
}

/**
 * What a task's end starts, from its row in `OWNER_ANSWERS`, whoever ended it:
 * the owner (`finishTask`), or the office or its Odd taking it off the desk
 * (`withdrawTask`), which ends it as a drop. `said` is the line that goes back
 * where the task came from when no run follows.
 */
async function taskEnded(
  t: TaskRow,
  how: { ended: TaskEnded; owner: string; said: string }
): Promise<void> {
  const done = how.ended === 'done';
  const end = await taskEnd(t);
  const { from, effects } = end;
  // Read before the effects: waking the parked work clears what parks it. Its
  // lead's run on the task's own work picks up in the same moment, so each run
  // is told the other has its part, or both do the parked work.
  const parked = await parkedWork(t.id);
  const ownRun = parked.length ? await ownRunOf(end) : undefined;
  const pickedUp = parked.length ? parked.map((p) => p.title) : undefined;
  for (const effect of effects) {
    if (typeof effect === 'object') continue;
    switch (effect) {
      // No run follows a dropped task: the answer itself goes back.
      case 'answer_back':
        await answerLater(
          {
            handOffId: t.handOffId ?? from?.handOffId ?? null,
            threadId: t.threadId ?? from?.threadId ?? null
          },
          done ? 'done' : 'failed',
          [how.said, ...parked.map((p) => pickedUpLine(p.title))].join(' ')
        );
        break;
      // The owner finished connecting a tool an Odd asked for: it can start the
      // work that was waiting on it, once however many asks that one answer settled.
      case 'carry_out':
        if (t.staffId && from)
          await carryOutTogether([from, ...(await answeredWith(from))], pickedUp);
        break;
      // Any other task an Odd gave them: the Odd picks up whatever waited on
      // it, such as hiring from an intake the owner just filled in.
      case 'task_done':
        if (t.staffId)
          await followUp(t.staffId, 'task_done', { taskId: t.id, note: t.note, pickedUp });
        break;
      // Work on another thread that waited on this task, whoever gave it.
      case 'wake_parked':
        await wakeOnTask(t, { ended: how.ended, owner: how.owner, ownRun });
        break;
      default:
        effect satisfies never;
    }
  }
}

export async function tasksFrom(staffId: string): Promise<TaskRow[]> {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.staffId, staffId))
    .orderBy(desc(tasks.createdAt))
    .limit(30);
}

export { taskEnd, ownRunOf, taskEnded };
