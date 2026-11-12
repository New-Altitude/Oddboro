// Jobs and runs: an Odd's schedule, its own changes to its jobs and description,
// and what the office did.
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { db } from './db.ts';
import { fixedError } from './errors.ts';
import { type Db } from './threads.ts';
import {
  asks,
  jobs,
  reports,
  runs,
  staff,
  tasks,
  threads,
  followUps,
  type RunTrigger,
  type Schedule
} from './schema.ts';
import { nextRun, zone } from './time.ts';
import { taskSaid } from './desk-answers.ts';
import type { StaffRow, JobRow, RunRow } from './office.ts';
import { ofWorkingOdd, roster, staffer } from './office-staff.ts';
import { record } from './office-ledger.ts';
import { addReport } from './office-desk.ts';
import { ownerName } from './office-usage.ts';

// Jobs

export async function jobsFor(staffId: string): Promise<(JobRow & { lastRun?: RunRow })[]> {
  const list = await db
    .select()
    .from(jobs)
    .where(eq(jobs.staffId, staffId))
    .orderBy(asc(jobs.createdAt));
  return Promise.all(
    list.map(async (j) => {
      const [lastRun] = await db
        .select()
        .from(runs)
        .where(eq(runs.jobId, j.id))
        .orderBy(desc(runs.startedAt))
        .limit(1);
      return { ...j, lastRun };
    })
  );
}

export async function addJob(
  j: {
    staffId: string;
    name: string;
    instructions: string;
    schedule: Schedule;
    report?: boolean;
  },
  q: Db = db
): Promise<JobRow> {
  const [row] = await q
    .insert(jobs)
    .values({ ...j, nextRunAt: nextRun(j.schedule, new Date()) })
    .returning();
  return row;
}

export async function updateJob(
  id: number,
  patch: Partial<Pick<JobRow, 'name' | 'instructions' | 'schedule' | 'enabled' | 'report'>>
): Promise<void> {
  const [row] = await db.update(jobs).set(patch).where(eq(jobs.id, id)).returning();
  if (row && (patch.schedule || patch.enabled))
    await db
      .update(jobs)
      .set({ nextRunAt: nextRun(row.schedule, new Date()) })
      .where(eq(jobs.id, id));
}

/** A staffer changes one of its own jobs, carrying out a change the owner approved. */
/**
 * The owner's go-ahead for a staffer to change itself: their own words in a chat,
 * which the office hands the staffer's tools, or an ask the owner approved.
 */
export type GoAhead = { said: string } | { askId: number };

/** In a chat, the owner's words go in the ledger as their decision, beside the change. */
async function recordGoAhead(who: StaffRow, go: GoAhead, what: string): Promise<void> {
  if ('said' in go)
    await record({
      kind: 'decision',
      actor: 'owner',
      title: `Asked ${who.name} in chat: ${what}`,
      body: go.said
    });
}

export async function editOwnJob(
  staffId: string,
  name: string,
  patch: Partial<Pick<JobRow, 'instructions' | 'schedule' | 'report'>>,
  go: GoAhead
): Promise<JobRow | undefined> {
  const who = await staffer(staffId);
  const [j] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.staffId, staffId), eq(jobs.name, name)));
  if (!who || !j) return undefined;
  await updateJob(j.id, patch);
  await recordGoAhead(who, go, `change its job "${name}"`);
  await record({
    kind: 'work',
    actor: staffId,
    title: `Changed its job: ${name}`,
    body: [
      patch.instructions && `Steps:\n${patch.instructions}`,
      patch.schedule && `Schedule: ${JSON.stringify(patch.schedule)}`,
      patch.report !== undefined &&
        `Reports to ${await ownerName()}: ${patch.report ? 'yes' : 'no'}`
    ]
      .filter(Boolean)
      .join('\n\n'),
    askId: 'askId' in go ? go.askId : undefined
  });
  return j;
}

/**
 * Rewrite a staffer's job description, the text every run starts from. The owner
 * does it from the card, or the staffer does with their go-ahead. `was` is the
 * text the editor started from: if it changed since, the save stops instead of
 * overwriting someone else's edit. The ledger keeps the old and new versions.
 */
export async function setDescription(
  staffId: string,
  text: string,
  by: { owner: true; was: string } | { go: GoAhead }
): Promise<boolean> {
  const who = await staffer(staffId);
  if (!who) throw fixedError('No such Odd');
  const desk = text.trim();
  if (!desk) throw fixedError('A job description cannot be empty');
  if ('owner' in by && by.was.trim() !== who.desk.trim())
    throw new Error(`${who.name}'s job description changed since you opened it. Reopen it to see.`);
  if (desk === who.desk.trim()) return false;
  await db.update(staff).set({ desk }).where(eq(staff.id, staffId));
  if ('go' in by) await recordGoAhead(who, by.go, 'rewrite its job description');
  await record({
    kind: 'work',
    actor: 'owner' in by ? 'owner' : staffId,
    title: 'owner' in by ? `Edited ${who.name}'s job description` : 'Rewrote its job description',
    body: `Before:\n${who.desk}\n\nAfter:\n${desk}`,
    askId: 'go' in by && 'askId' in by.go ? by.go.askId : undefined
  });
  return true;
}

/** Remove a job that never ran. One that ran stays, paused, so its runs keep their record. */
export async function deleteJob(id: number): Promise<void> {
  const [ran] = await db.select({ id: runs.id }).from(runs).where(eq(runs.jobId, id)).limit(1);
  if (ran) throw fixedError('This job has run before, so it stays paused to keep its record.');
  await db.delete(jobs).where(eq(jobs.id, id));
}

export async function enabledJobs(): Promise<JobRow[]> {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.enabled, true), ofWorkingOdd(jobs.staffId)));
}

export async function job(id: number): Promise<JobRow | undefined> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row;
}

export async function setNextRun(id: number, at: Date): Promise<void> {
  await db.update(jobs).set({ nextRunAt: at }).where(eq(jobs.id, id));
}

export async function startRun(j: JobRow, trigger: RunTrigger): Promise<RunRow> {
  const [row] = await db
    .insert(runs)
    .values({ jobId: j.id, staffId: j.staffId, trigger })
    .returning();
  return row;
}

export async function finishRun(r: RunRow, j: JobRow, ok: boolean, summary: string): Promise<void> {
  await db
    .update(runs)
    .set({ status: ok ? 'done' : 'failed', summary, finishedAt: new Date() })
    .where(eq(runs.id, r.id));
  if (ok && j.report) await addReport(j.staffId, j.name, summary, r.id);
  else
    await record({
      kind: 'work',
      actor: j.staffId,
      title: `${ok ? 'Ran' : 'Failed'}: ${j.name}${r.trigger === 'manual' ? ` (started by ${await ownerName()})` : ''}`,
      body: summary,
      runId: r.id
    });
}

/** Runs that a restart left marked running. */
export async function closeStaleRuns(): Promise<void> {
  await db
    .update(runs)
    .set({
      status: 'failed',
      summary: 'The office stopped while this ran.',
      finishedAt: new Date()
    })
    .where(eq(runs.status, 'running'));
}

/** "Fri, Oct 30, 7:00 AM": the office's own clock, so a schedule reads as written. */
const pt = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleString('en-US', {
        timeZone: zone(),
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    : null;

/** What the whole office did since a time: Marshall's daily report reads this. */
export async function officeActivity(since: Date) {
  const [people, ranJobs, openAsks, decided, openTasks, doneTasks, follow] = await Promise.all([
    roster(),
    db
      .select({
        staff: runs.staffId,
        job: jobs.name,
        status: runs.status,
        trigger: runs.trigger,
        summary: runs.summary,
        at: runs.startedAt
      })
      .from(runs)
      .innerJoin(jobs, eq(runs.jobId, jobs.id))
      .where(gte(runs.startedAt, since))
      .orderBy(asc(runs.startedAt)),
    db.select().from(asks).where(eq(asks.status, 'open')),
    db.select().from(asks).where(gte(asks.decidedAt, since)),
    db.select().from(tasks).where(eq(tasks.status, 'open')),
    db.select().from(tasks).where(gte(tasks.doneAt, since)),
    db
      .select({
        staff: followUps.staffId,
        kind: followUps.kind,
        ask: asks.title,
        report: reports.title,
        task: tasks.title,
        handOff: followUps.handOff,
        thread: threads.title,
        outcome: followUps.outcome,
        at: followUps.createdAt
      })
      .from(followUps)
      .leftJoin(asks, eq(followUps.askId, asks.id))
      .leftJoin(reports, eq(followUps.reportId, reports.id))
      .leftJoin(tasks, eq(followUps.taskId, tasks.id))
      .leftJoin(threads, eq(followUps.threadId, threads.id))
      .where(gte(followUps.createdAt, since))
  ]);
  const allJobs = await db.select().from(jobs).where(eq(jobs.enabled, true));
  return {
    since: pt(since),
    now: pt(new Date()),
    staff: people.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      jobs: allJobs
        .filter((j) => j.staffId === p.id)
        .map((j) => ({ name: j.name, schedule: j.schedule })),
      runs: ranJobs
        .filter((r) => r.staff === p.id)
        .map((r) => ({
          job: r.job,
          status: r.status,
          // 'manual' means the owner pressed Run now; only 'schedule' runs follow the timer.
          trigger: r.trigger,
          at: pt(r.at),
          summary: r.summary?.slice(0, 600)
        }))
    })),
    asks: {
      open: openAsks.map((a) => ({ from: a.staffId, title: a.title, since: pt(a.createdAt) })),
      decided: decided.map((a) => ({
        from: a.staffId,
        title: a.title,
        status: a.status,
        reason: a.reason
      }))
    },
    // Work owed after the owner answered: carrying out an approved ask, reworking one
    // the owner sent back, acting on their feedback on a report, or picking up after a
    // task they finished. A hand_off is work a colleague handed this staffer,
    // handed_back is the colleague's result coming home, and resume is a thread's
    // hub picking it back up. A null outcome is still to do.
    followUps: follow.map((f) => ({
      from: f.staff,
      kind: f.kind,
      about: f.ask ?? f.report ?? f.task ?? f.handOff?.title ?? f.thread,
      ...(f.handOff ? { colleague: f.handOff.from } : {}),
      outcome: f.outcome,
      at: pt(f.at)
    })),
    tasksForOwner: {
      open: openTasks.map((t) => ({ from: t.staffId, title: t.title, since: pt(t.createdAt) })),
      done: doneTasks.map((t) => {
        const said = taskSaid(t);
        return {
          from: t.staffId,
          title: t.title,
          status: t.status,
          ...(said ? { answer: said } : {})
        };
      })
    }
  };
}
