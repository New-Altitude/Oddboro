// Follow-up runs: adding, claiming, finishing and naming them, and holding one
// while its Odd still runs on the thread.
import { runsGoing } from './run-registry.ts';
import {
  and,
  arrayOverlaps,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  or,
  sql,
  type SQL
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from './db.ts';
import { answeredAll, handBack, leadLeft, servesHandOff, servesNoThread } from './hand-offs.ts';
import { wakeOnTask, type TaskEnded } from './task-parking.ts';
import { addFollowUp, settleThread, type Db, type Tx } from './threads.ts';
import {
  asks,
  pokes,
  reports,
  tasks,
  threads,
  followUps,
  goals,
  type FollowUpKind,
  type Outcome
} from './schema.ts';
import { flat } from './desk-answers.ts';
import type { AskRow, TaskRow, ReportRow } from './office.ts';
import { ofWorkingOdd, anyStaffer } from './office-staff.ts';
import { record } from './office-ledger.ts';
import { ask } from './office-asks.ts';
import { task, taskEnd, ownRunOf } from './office-tasks.ts';
import { ownerName } from './office-usage.ts';

// Follow-ups: work a staffer owes once the owner answers it or finishes a task it
// gave them. The office starts each one as soon as it is written.

export type FollowUpRow = typeof followUps.$inferSelect;

async function followUp(
  staffId: string,
  kind: FollowUpKind,
  f: {
    askId?: number;
    reportId?: number;
    taskId?: number;
    note: string | null;
    pickedUp?: string[];
    reportWhenDone?: boolean;
  }
): Promise<void> {
  // The answer to something raised on a thread works on that thread.
  const [on] = servesNoThread(kind)
    ? []
    : f.askId
      ? await db.select({ threadId: asks.threadId }).from(asks).where(eq(asks.id, f.askId))
      : f.taskId
        ? await db.select({ threadId: tasks.threadId }).from(tasks).where(eq(tasks.id, f.taskId))
        : [];
  await addFollowUp(db, { staffId, kind, ...f, threadId: on?.threadId });
}

/**
 * A new hire's first day: right after it says hello, a hire with a job starts
 * its work. Its result goes on the owner's desk, so they see the first piece
 * of work. A hire with no job gets none (`firstDay` in the office decides): one
 * that serves a goal gets its first piece from the goal's lead, on the goal's
 * thread, and any other runs only when handed work.
 */
export async function startFirstDay(staffId: string): Promise<void> {
  await addFollowUp(db, { staffId, kind: 'first_day', note: null, reportWhenDone: true });
}

/**
 * Follow-ups ready to start, by id, with the ask, report, task, goal or thread
 * each is about. Not the rows: a run takes its row from the claim
 * (`startFollowUp`), with any answer that joined it since this list.
 */
export async function followUpsToDo(): Promise<
  {
    id: number;
    ask?: AskRow;
    report?: ReportRow;
    task?: TaskRow;
    goal?: typeof goals.$inferSelect;
  }[]
> {
  const rows = await db
    .select()
    .from(followUps)
    .where(and(isNull(followUps.startedAt), not(waitsOnOwnRun()), ofWorkingOdd(followUps.staffId)))
    .orderBy(asc(followUps.createdAt));
  return Promise.all(
    rows.map(async (f) => {
      const a = f.askId ? await ask(f.askId) : undefined;
      // The owner's answer to a plan, or to a hire it proposed, is about the plan's goal.
      const goalId = f.goalId ?? a?.plan?.goalId ?? a?.hire?.goal?.id;
      return {
        id: f.id,
        ask: a,
        report: f.reportId
          ? (await db.select().from(reports).where(eq(reports.id, f.reportId)))[0]
          : undefined,
        task: f.taskId
          ? (await db.select().from(tasks).where(eq(tasks.id, f.taskId)))[0]
          : undefined,
        goal: goalId ? (await db.select().from(goals).where(eq(goals.id, goalId)))[0] : undefined
      };
    })
  );
}

/**
 * Follow-ups of Odds still in the office that have yet to start, oldest
 * first. One waits while a run of its Odd on the same work goes
 * (`waitsOnOwnRun`), such as the chat that gave the owner the task it picks
 * up after; any other starts at the office's next look. The office lists them
 * under In progress, so work the owner's answer started shows while it waits.
 */
export async function followUpsToStart(): Promise<FollowUpRow[]> {
  return db
    .select()
    .from(followUps)
    .where(
      and(isNull(followUps.startedAt), isNull(followUps.outcome), ofWorkingOdd(followUps.staffId))
    )
    .orderBy(asc(followUps.createdAt), asc(followUps.id));
}

/**
 * An Odd runs once at a time on a thread: a follow-up on one waits while a run
 * of the same Odd there has yet to end. So a hub never picks its thread up
 * twice at once, and a colleague's run on the owner's answer starts only once
 * the run that raised it ended. Answers that come meanwhile join the waiting
 * `resume` (`answerThread`), and results the waiting `handed_back`
 * (`resultsToJoin`); the run ending starts it. A hand-off is new work, not a
 * pick-up, so several may run side by side, even for one colleague. A run on
 * no thread, such as a chat, a job or a follow-up like a carry-out, counts on
 * each thread it put work on, a hand-off held or not or a goal's plan
 * (`threads.runs`, `keepRun`), while its key is in `runsGoing`.
 */
function waitsOnOwnRun(): SQL {
  const busy = alias(followUps, 'busy');
  const ownRun = db
    .select({ id: busy.id })
    .from(busy)
    .where(
      and(
        eq(busy.staffId, followUps.staffId),
        eq(busy.threadId, followUps.threadId),
        isNotNull(busy.startedAt),
        isNull(busy.outcome)
      )
    );
  // With no run going there is no key to look for, and drizzle refuses an empty list.
  const held = runsGoing.size
    ? or(
        exists(ownRun),
        exists(
          db
            .select({ id: threads.id })
            .from(threads)
            .where(
              and(
                eq(threads.id, followUps.threadId),
                eq(threads.hubId, followUps.staffId),
                arrayOverlaps(threads.runs, [...runsGoing.keys()])
              )
            )
        )
      )
    : exists(ownRun);
  // Bracketed, since callers negate it.
  return sql`(${ne(followUps.kind, 'hand_off')} and (${held}))`;
}

/** The wait a lead's run ended as it started: the task's title, or the time it was parked until. */
export type Unparked = { task: string } | { at: Date };

/**
 * Claim a follow-up, and return it as claimed: an answer that joined it after
 * it was listed is in its note (`answerThread`). Undefined when something else
 * already started it, or it waits (`waitsOnOwnRun`).
 *
 * A thread stays parked only while no run of its lead's on it has started
 * since it parked, so the claim of one ends the park, and returns the wait it
 * ended for the run's brief (`unparked`). Without it, work a hand-back or the
 * owner's words picked up stayed parked on a task that might never end, and
 * that task's end woke the finished work again. A colleague's run leaves the
 * lead's park alone, and so does a usage-window hold, which is the office's.
 * The claimed row keeps the task or time it lifted (`unparkedTask`,
 * `unparkedAt`), so a run that then fails gives that wait back (`finishFollowUp`).
 */
export async function startFollowUp(
  id: number
): Promise<(FollowUpRow & { unparked?: Unparked }) | undefined> {
  return db.transaction(async (tx) => {
    // The thread is locked, so two claims on it at once cannot each miss the
    // other's run starting, and both go.
    const [on] = await tx
      .select({ threadId: followUps.threadId, staffId: followUps.staffId })
      .from(followUps)
      .where(eq(followUps.id, id));
    const [t] = on?.threadId
      ? await tx
          .select({
            hubId: threads.hubId,
            resumeOnTask: threads.resumeOnTask,
            resumeAt: threads.resumeAt,
            heldBy: threads.heldBy
          })
          .from(threads)
          .where(eq(threads.id, on.threadId))
          .for('update')
      : [];
    // Only the lead's own run ends its park, so only it records the wait it lifted.
    const leads = t !== undefined && on?.staffId === t.hubId;
    const timed = leads && t.heldBy === null ? t.resumeAt : null;
    const [claimed] = await tx
      .update(followUps)
      .set({
        startedAt: new Date(),
        unparkedTask: leads ? t.resumeOnTask : null,
        unparkedAt: timed
      })
      .where(and(eq(followUps.id, id), isNull(followUps.startedAt), not(waitsOnOwnRun())))
      .returning();
    if (!claimed?.threadId || !leads) return claimed;
    if (t.resumeOnTask === null && timed === null) return claimed;
    const [task] = t.resumeOnTask
      ? await tx.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, t.resumeOnTask))
      : [];
    await tx
      .update(threads)
      .set({ resumeOnTask: null, ...(timed ? { resumeAt: null } : {}) })
      .where(eq(threads.id, claimed.threadId));
    return {
      ...claimed,
      unparked: task ? { task: task.title } : timed ? { at: timed } : undefined
    };
  });
}

/**
 * The ledger title of each follow-up as it ends, before what it was about. The
 * owner reads these in the Ledger window, so none names a thread or a hand-off.
 */
export const OUTCOME_TITLE: Record<FollowUpKind, Record<Outcome, string>> = {
  carry_out: { done: 'Did', failed: 'Failed', waiting: 'Waiting on {owner} for' },
  rework: { done: 'Reworked', failed: 'Could not rework', waiting: 'Reworked' },
  denied: {
    done: 'Took in the no on',
    failed: 'Could not take in the no on',
    waiting: 'Waiting on {owner} after the no on'
  },
  feedback: {
    done: 'Acted on feedback on',
    failed: 'Could not act on feedback on',
    waiting: 'Waiting on {owner} after feedback on'
  },
  task_done: {
    done: 'Picked up after',
    failed: 'Could not pick up after',
    waiting: 'Waiting on {owner} after'
  },
  first_day: {
    done: 'First day',
    failed: 'First day stalled',
    waiting: 'First day, waiting on {owner}'
  },
  goal: {
    done: 'Planned the goal',
    failed: 'Could not plan the goal',
    waiting: 'Brought {owner} the plan for the goal'
  },
  hand_off: {
    done: 'Did work a colleague handed over',
    failed: 'Could not do work a colleague handed over',
    waiting: 'Waiting on {owner} for work a colleague handed over'
  },
  handed_back: {
    done: 'Picked up what a colleague finished',
    failed: 'Could not pick up what a colleague finished',
    waiting: 'Waiting on {owner} after a colleague finished'
  },
  resume: {
    done: 'Picked back up',
    failed: 'Could not pick back up',
    waiting: 'Waiting on {owner} after picking back up'
  },
  edited: {
    done: "Read {owner}'s edit to",
    failed: "Could not read {owner}'s edit to",
    waiting: 'Waiting on {owner} after their edit to'
  }
};

/**
 * A colleague's result that no lead takes, since the lead that handed it the
 * work left the office (`leadLeft`): nothing picks the work up. The owner
 * ruled that nothing goes on the desk for it. The colleague, the last Odd on
 * the work, pokes the owner now, and the Ledger keeps a line. What the
 * colleague did stays in the work's folder.
 */
export type Unreturned = {
  colleague: { id: string; name: string };
  lead: string;
  title: string;
  outcome: Exclude<Outcome, 'waiting'>;
};

/** The poke that tells the owner, sent now, as `poke_owner` would send one. */
export async function pokeUnreturned(q: Db, u: Unreturned): Promise<void> {
  const did = u.outcome === 'done' ? 'finished' : 'could not finish';
  const yet = u.outcome === 'done' ? 'but' : 'and';
  await q.insert(pokes).values({
    staffId: u.colleague.id,
    at: new Date(),
    message: `${u.colleague.name} ${did} "${u.title}", ${yet} could not hand it back to ${u.lead} because ${u.lead} is no longer here.`
  });
}

/** The Ledger's line for it. Outside a transaction: `record` embeds its text first. */
export async function recordUnreturned(u: Unreturned): Promise<void> {
  const did = u.outcome === 'done' ? 'finished' : 'could not finish';
  await record({
    kind: 'work',
    actor: u.colleague.id,
    title: `${u.outcome === 'done' ? 'Finished' : 'Could not finish'}, but ${u.lead} has left: ${u.title}`,
    body: `${u.colleague.name} ${did} "${u.title}", but ${u.lead} has left the office, so nothing picks the work up. What ${u.colleague.name} did stays in the work's folder.`
  });
}

/**
 * Record how a follow-up ended. Every outcome goes in the ledger. The owner's desk
 * gets a failure no lead is woken for, and a success only when the owner asked
 * for one. When the staffer is waiting, what it needs is already on their desk
 * as an ask or task. `joined` are the results this run picked up with its own
 * (`resultsToJoin`): they end with it. `stopped` is work its lead's leaving
 * stopped (`removeOdd`): the owner let the lead go, so no report says it failed.
 */
export async function finishFollowUp(
  f: FollowUpRow,
  about: string,
  outcome: Outcome,
  result: string,
  o: { joined?: number[]; stopped?: boolean } = {}
): Promise<void> {
  const joined = o.joined ?? [];
  const title = `${OUTCOME_TITLE[f.kind][outcome].replace('{owner}', await ownerName())}: ${about}`;
  const origin = await servesHandOff(f);
  // Once only. The outcome, the owner's report and a hand-off's result going
  // back are written together or not at all, so a restart or a second call
  // never leaves the desk short or the staffer that handed it waiting.
  const finished = await db.transaction(async (tx) => {
    const now = new Date();
    // A lead that left runs nothing, so nothing goes back to wait on it.
    // Looked at first, so this locks the lead's row before its threads, in the
    // order `removeOdd` does.
    const left = origin?.handOff ? await leadLeft(tx, origin.handOff.from) : undefined;
    const [row] = await tx
      .update(followUps)
      .set({ outcome, result, doneAt: now })
      .where(and(eq(followUps.id, f.id), isNull(followUps.outcome)))
      .returning({
        id: followUps.id,
        unparkedTask: followUps.unparkedTask,
        unparkedAt: followUps.unparkedAt
      });
    if (!row) return false;
    // Read from the row, not `f`: the claim wrote it after `f` may have been read.
    const ended =
      outcome === 'failed' && (row.unparkedTask !== null || row.unparkedAt !== null) && f.threadId
        ? await giveWaitBack(tx, f.threadId, row)
        : undefined;
    if (joined.length)
      await tx
        .update(followUps)
        .set({ startedAt: now, outcome, result, doneAt: now })
        .where(
          and(
            inArray(followUps.id, joined),
            eq(followUps.staffId, f.staffId),
            eq(followUps.kind, 'handed_back'),
            isNull(followUps.startedAt)
          )
        );
    // Work that serves a hand-off reports back to the Odd that handed it: the
    // hand-off's own run however it ended, a later run once it ended, since a
    // run left waiting has put what it needs on the desk, and the owner's
    // answer brings the next run. The hand-off's own run left waiting goes
    // back only while something it raised is still open: once the owner
    // answered all of it, that answer went back already (`handBackLater`) or
    // started a run whose result will, so "waiting" would be stale.
    const back =
      origin && (outcome !== 'waiting' || (f.kind === 'hand_off' && !(await answeredAll(tx, f.id))))
        ? handBack(origin, outcome, result)
        : undefined;
    // With the lead gone, the colleague tells the owner instead (`Unreturned`).
    // One left waiting has its ask or task on the desk already, and the run
    // the owner's answer brings ends here again.
    const unreturned: Unreturned | undefined =
      back && left && origin?.handOff && outcome !== 'waiting'
        ? {
            colleague: {
              id: f.staffId,
              name: (await anyStaffer(f.staffId, tx))?.name ?? f.staffId
            },
            lead: left,
            title: flat(origin.handOff.title),
            outcome
          }
        : undefined;
    // A failure that goes back to a lead goes to the lead only: the lead
    // picks it up at once and decides what comes next, so a desk item would
    // wait on the owner for work already moving. With no one to wake, the
    // owner hears, unless the lead left: then the colleague's poke tells them.
    const reported =
      !o.stopped && (outcome === 'failed' ? !back : outcome === 'done' && f.reportWhenDone);
    if (reported) await tx.insert(reports).values({ staffId: f.staffId, title, body: result });
    if (unreturned) await pokeUnreturned(tx, unreturned);
    // The hand-back moves the thread on; with none, the outcome may end it.
    if (back && !left) await addFollowUp(tx, back);
    else if (f.threadId) await settleThread(tx, f.threadId);
    return { ended, unreturned };
  });
  if (finished && finished.ended) {
    const t = finished.ended;
    // The task's own run was set going when the task ended, while the park was
    // lifted, so it was not told of this work and does not pick up now.
    const own = await ownRunOf(await taskEnd(t));
    await wakeOnTask(t, {
      ended: endedAs(t),
      owner: await ownerName(),
      ownRun: own && { ...own, earlier: true }
    });
  }
  // The ledger row embeds its text first, which can take a while: outside the transaction.
  if (finished)
    await record({
      kind: 'work',
      actor: f.staffId,
      title,
      body: result,
      askId: f.askId ?? undefined
    });
  if (finished && finished.unreturned) await recordUnreturned(finished.unreturned);
}

/**
 * A lead's run that ended a park failed, so the wait comes back, on its task or
 * its time: only a run that ends without failing, or the wait's own end, ends
 * one. Not when the run parked the work again, on a task or a time, or the
 * work ended. The task is locked, as `parkOnTask` locks it, so it cannot end
 * between this look and the park and wake nothing. Returns the task when it
 * ended during the run: the park is back so the work stays open, and
 * `wakeOnTask` then wakes it as the task's end would have, but told the task's
 * own run was set going back when the task ended. A time that passed
 * during the run comes back as it was, so the clock's next look wakes the work,
 * once, since `wakeThread` claims the time as it wakes.
 */
async function giveWaitBack(
  tx: Tx,
  threadId: number,
  lifted: Pick<FollowUpRow, 'unparkedTask' | 'unparkedAt'>
): Promise<TaskRow | undefined> {
  const [task] =
    lifted.unparkedTask === null
      ? []
      : await tx.select().from(tasks).where(eq(tasks.id, lifted.unparkedTask)).for('update');
  // A claim lifts a task or a time, never both, so one of these is null.
  const [back] = await tx
    .update(threads)
    .set({ resumeOnTask: lifted.unparkedTask, resumeAt: lifted.unparkedAt })
    .where(
      and(
        eq(threads.id, threadId),
        isNull(threads.resumeOnTask),
        isNull(threads.resumeAt),
        isNull(threads.endedAt)
      )
    )
    .returning({ id: threads.id });
  return back && task && task.status !== 'open' ? task : undefined;
}

/**
 * How a task that ended during a run reads to the work that run gives the park
 * back to. A task the office or its Odd took off the desk (`withdrawTask`), as
 * its Odd left or through its `withdraw` tool, says so; one the owner dropped
 * reads as dropped. Read from the row, not from whether the Odd is gone: one
 * brought back since has no mark of leaving.
 */
function endedAs(t: TaskRow): TaskEnded {
  return t.status === 'done' ? 'done' : t.withdrawn ? 'withdrawn' : 'dropped';
}

/** The result of a run a restart cut off. */
export const CUT_OFF_RESULT =
  'The office restarted while this was running, so it may be half done. Check it, then ask the Odd to finish it.';

/** Follow-ups a restart cut off mid-run. They fail rather than run twice. */
export async function closeStaleFollowUps(): Promise<void> {
  const stale = await db
    .select()
    .from(followUps)
    .where(and(isNotNull(followUps.startedAt), isNull(followUps.outcome)));
  for (const f of stale) await finishFollowUp(f, await workTitle(f), 'failed', CUT_OFF_RESULT);
}

/**
 * What the Ledger names work when no title is left for it, such as an ask
 * since removed, or a first day. The owner reads it after each kind's
 * `OUTCOME_TITLE`, so it names no thread and no number (test/owner-tables.test.ts).
 */
export const CUT_OFF_WORK: Record<FollowUpKind, string> = {
  carry_out: 'an ask',
  rework: 'an ask',
  denied: 'an ask',
  feedback: 'a report',
  task_done: 'a task',
  first_day: 'getting started',
  goal: 'a goal',
  hand_off: 'the work',
  handed_back: 'the work',
  resume: 'the work',
  edited: 'a file'
};

/**
 * What the Ledger names the work a follow-up was about, whether it finished or
 * a restart cut it off: its ask's, hand-off's, file's, task's, goal's or
 * report's title. A lead picking a thread back up names its goal, or the
 * thread's own title when it serves none, never the thread itself. With no
 * title left, its kind's plain words (`CUT_OFF_WORK`).
 */
export async function workTitle(f: FollowUpRow): Promise<string> {
  return (await titleOf(f)) ?? CUT_OFF_WORK[f.kind];
}

async function titleOf(f: FollowUpRow): Promise<string | undefined> {
  if (f.askId) return (await ask(f.askId))?.title;
  if (f.handOff) return f.handOff.title;
  if (f.edit) return f.edit.path;
  if (f.taskId) return (await task(f.taskId))?.title;
  if (f.goalId)
    return (await db.select({ title: goals.title }).from(goals).where(eq(goals.id, f.goalId)))[0]
      ?.title;
  if (f.kind === 'resume' && f.threadId) {
    const [t] = await db
      .select({ goal: goals.title, title: threads.title })
      .from(threads)
      .leftJoin(goals, eq(goals.id, threads.goalId))
      .where(eq(threads.id, f.threadId));
    return t?.goal ?? t?.title;
  }
  if (f.reportId)
    return (
      await db.select({ title: reports.title }).from(reports).where(eq(reports.id, f.reportId))
    )[0]?.title;
  return undefined;
}

export { followUp };
