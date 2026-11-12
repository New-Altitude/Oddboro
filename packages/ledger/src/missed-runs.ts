// What the office clock does with a job whose time passed while the office
// was off, such as a Mac asleep. `dueNow` says, from the job's schedule and its
// kind (`jobs.missed`), and the clock (the office's jobs.ts) does it through
// one of `owe`, `skip` or `askToCatchUp`. Each moves the job on to its next
// time only if nothing else moved it first, so two looks at once settle it
// once. Owed runs wait in `jobs.owed` until the clock starts them, one after
// another, so a restart in between loses none.
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from './db.ts';
import type { AskRow, JobRow } from './office.ts';
import { asks, jobs, staff, type CatchUp } from './schema.ts';
import { periodAt, runsBetween, zone } from './time.ts';
import type { Db, Tx } from './threads.ts';

/** A `record` job fills up to this many missed periods on its own. More waits for the owner's yes. */
export const FILL_WITHOUT_ASKING = 10;
/** A run this late is on time: the clock's timer fires a moment after a job is due. */
export const ON_TIME_MS = 60_000;

/**
 * What the clock does with a due job.
 * - `run`: it is on time, so it runs now, as it always has.
 * - `owe`: it catches up, with each time it is for, after any other catch-up ends.
 * - `skip`: it is too late for a `latest` job to be useful, so it waits for its next time.
 * - `ask`: a `record` job missed more than `FILL_WITHOUT_ASKING` periods.
 */
export type Due =
  | { do: 'run' }
  | { do: 'owe'; times: Date[] }
  | { do: 'skip'; at: Date }
  | { do: 'ask'; times: Date[] };

/**
 * Settle a due job. A `latest` job catches up once, for its newest missed
 * time, if less than half a period passed since; otherwise it skips. A
 * `record` job owes every missed time, or asks first when there are many.
 */
export function dueNow(j: Pick<JobRow, 'schedule' | 'missed'>, nextRunAt: Date, now: Date): Due {
  const times = runsBetween(j.schedule, nextRunAt, now);
  const last = times.at(-1) ?? nextRunAt;
  const late = now.getTime() - last.getTime();
  if (times.length <= 1 && late < ON_TIME_MS) return { do: 'run' };
  if (j.missed === 'record')
    return times.length > FILL_WITHOUT_ASKING ? { do: 'ask', times } : { do: 'owe', times };
  return late < periodAt(j.schedule, last) / 2
    ? { do: 'owe', times: [last] }
    : { do: 'skip', at: last };
}

const iso = (times: Date[]) => times.map((t) => t.toISOString());
/** Both lists in one, oldest first, each time once. ISO times sort as they read. */
const merged = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();

/** Move a job on from the time it missed, `was`, only if nothing moved it first. */
async function moveOn(
  tx: Tx,
  j: Pick<JobRow, 'id'>,
  was: Date,
  set: Partial<Pick<JobRow, 'nextRunAt' | 'skippedAt'>>
): Promise<boolean> {
  const moved = await tx
    .update(jobs)
    .set(set)
    .where(and(eq(jobs.id, j.id), eq(jobs.nextRunAt, was)))
    .returning({ id: jobs.id });
  return moved.length > 0;
}

/** Add times the clock owes a job a run for. */
async function addOwed(q: Db, jobId: number, times: string[]): Promise<void> {
  const [j] = await q
    .select({ owed: jobs.owed })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .for('update');
  if (j)
    await q
      .update(jobs)
      .set({ owed: merged(j.owed ?? [], times) })
      .where(eq(jobs.id, jobId));
}

/** The job owes a run for these times, and its next run is `next`. False when it was settled already. */
export async function owe(j: JobRow, was: Date, times: Date[], next: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await moveOn(tx, j, was, { nextRunAt: next }))) return false;
    await addOwed(tx, j.id, iso(times));
    return true;
  });
}

/**
 * The job skips the run it missed at `at`, which shows on the desk, and runs
 * next at `next`. With no `at`, it skips without a word: a reader whose writer
 * has not written a first file yet.
 */
export async function skip(
  j: JobRow,
  was: Date,
  at: Date | undefined,
  next: Date
): Promise<boolean> {
  return db.transaction((tx) =>
    moveOn(tx, j, was, { nextRunAt: next, ...(at ? { skippedAt: at } : {}) })
  );
}

/**
 * A reader skips the times it owes up to `upTo`, since its writer skipped
 * them. `away` puts it on the desk's While you were away card, at `upTo`.
 */
export async function skipOwed(jobId: number, upTo: Date, away: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const [j] = await tx
      .select({ owed: jobs.owed })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for('update');
    const left = (j?.owed ?? []).filter((t) => new Date(t) > upTo);
    await tx
      .update(jobs)
      .set({ owed: left.length ? left : null, ...(away ? { skippedAt: upTo } : {}) })
      .where(eq(jobs.id, jobId));
  });
}

/** Take the times a job is owed, so only one run fills them. Oldest first. */
export async function takeOwed(jobId: number): Promise<Date[]> {
  return db.transaction(async (tx) => {
    const [j] = await tx
      .select({ owed: jobs.owed })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for('update');
    if (!j?.owed?.length) return [];
    await tx.update(jobs).set({ owed: null }).where(eq(jobs.id, jobId));
    return j.owed.map((t) => new Date(t));
  });
}

/** "Nov 2, 9:00 AM": a time in an ask's title, in the office's zone. */
function shortTime(t: string): string {
  return new Date(t).toLocaleString('en-US', {
    timeZone: zone(),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/** The ask's words for these missed times of one job. */
function catchUpWords(job: string, odd: string, times: string[]) {
  const n = times.length;
  const span = `${shortTime(times[0])} to ${shortTime(times[n - 1])}`;
  return {
    title: `Fill ${n} missed periods of ${job}, ${span}?`,
    why: `${job} adds an entry for each period. ${n} periods passed while the office was off, from ${span}. That is more than ${FILL_WITHOUT_ASKING}, so it waits for your yes.`,
    ifApproved: `${odd} runs ${job} once to fill all ${n}, oldest first, and writes "no data" for any period it cannot fetch now. If you say no, the job skips them and carries on at its next time.`
  };
}

/**
 * Too many missed periods to fill on its own: the job moves on to `next`, and
 * the office asks the owner, from the job's Odd, whether to fill them. One
 * open ask per job: a second absence adds its times to the open one.
 */
export async function askToCatchUp(
  j: JobRow,
  was: Date,
  times: Date[],
  next: Date
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await moveOn(tx, j, was, { nextRunAt: next }))) return false;
    const [open] = await tx
      .select()
      .from(asks)
      .where(
        and(
          eq(asks.kind, 'catch_up'),
          eq(asks.status, 'open'),
          sql`(${asks.catchUp}->>'jobId')::int = ${j.id}`
        )
      )
      .for('update');
    const [who] = await tx.select({ name: staff.name }).from(staff).where(eq(staff.id, j.staffId));
    const catchUp: CatchUp = { jobId: j.id, times: merged(open?.catchUp?.times ?? [], iso(times)) };
    const words = catchUpWords(j.name, who?.name ?? j.staffId, catchUp.times);
    if (open)
      await tx
        .update(asks)
        .set({ ...words, catchUp })
        .where(eq(asks.id, open.id));
    else await tx.insert(asks).values({ staffId: j.staffId, kind: 'catch_up', catchUp, ...words });
    return true;
  });
}

/** The owner said yes to a catch_up ask: the job owes a run for its times, which the clock starts. */
export async function oweCatchUp(a: AskRow): Promise<void> {
  const c = a.catchUp;
  if (c) await db.transaction((tx) => addOwed(tx, c.jobId, c.times));
}

/** A job that skipped a run, as the desk's While you were away card lists it. */
export type AwayJob = { id: number; name: string; staffId: string; skippedAt: Date };

/** Jobs of working Odds that skipped a run and are still on, oldest skip first. */
export async function awayJobs(): Promise<AwayJob[]> {
  const rows = await db
    .select({ id: jobs.id, name: jobs.name, staffId: jobs.staffId, skippedAt: jobs.skippedAt })
    .from(jobs)
    .where(
      and(
        isNotNull(jobs.skippedAt),
        eq(jobs.enabled, true),
        inArray(jobs.staffId, db.select({ id: staff.id }).from(staff).where(isNull(staff.leftAt)))
      )
    )
    .orderBy(asc(jobs.skippedAt));
  return rows.map((r) => ({ ...r, skippedAt: r.skippedAt! }));
}

/** Take one job off the While you were away card, or every job when none is named. */
export async function clearAway(jobId?: number): Promise<void> {
  await db
    .update(jobs)
    .set({ skippedAt: null })
    .where(
      jobId === undefined
        ? isNotNull(jobs.skippedAt)
        : and(eq(jobs.id, jobId), isNotNull(jobs.skippedAt))
    );
}
