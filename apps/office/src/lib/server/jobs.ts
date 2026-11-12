// The office clock. It keeps one timer, set for the soonest due job, poke or
// parked thread, and resets it whenever the jobs, pokes or threads table
// changes. A thread's hub parks it until a time (resume_at); the clock starts
// the hub's pick-up then. Every job run is told the scheduled time it is for
// (job-brief.ts). A job on time runs at once. One whose time passed while the
// Mac slept is settled by its kind (`dueNow` in the ledger's missed-runs.ts):
// a `latest` job catches up once if less than half a period passed since its
// newest missed time, else skips to its next time and waits on the desk's
// While you were away card; a `record` job owes a run for every missed
// period, or, past FILL_WITHOUT_ASKING of them, asks the owner first. Owed
// runs (`jobs.owed`) start one after another, never together, so waking
// after a week away is no burst. A poke that late is marked missed (see
// deliverPoke); a thread that late wakes then. While an update is about to
// install (`held()` in update.ts) it starts no scheduled job: a due one waits
// and runs once the app is back.
import {
  askToCatchUp,
  claimScheduledRun,
  clearAway,
  closeStaleRuns,
  dueNow,
  enabledJobs,
  finishRun,
  job as jobById,
  nextRun,
  owe,
  parkedThreads,
  setNextRun,
  skip,
  startRun,
  takeOwed,
  waitingPokes,
  wakeThread,
  type JobRow,
  type RunTrigger
} from '@oddboro/ledger';
import { bus, listen, type OfficeEvent } from './events.ts';
import { deliverPoke, runJob } from './staff.ts';
import { held } from './update.ts';

// macOS stops timers while it sleeps, so the clock never waits longer than
// this before checking the time again. Each check is one comparison per job.
const LONGEST_WAIT_MS = 10 * 60_000;

const g = globalThis as unknown as {
  jobClock?: {
    started?: true;
    timer?: ReturnType<typeof setTimeout>;
    line?: Promise<void>;
    revision?: number;
    stop?: () => void;
  };
};
const running = new Set<number>();
/** Jobs whose owed run waits in the line, so a second look adds none. */
const inLine = new Set<number>();

async function plan(): Promise<void> {
  const clock = g.jobClock;
  if (!clock?.started) return;
  const revision = (clock.revision = (clock.revision ?? 0) + 1);
  const now = new Date();
  let soonest = now.getTime() + LONGEST_WAIT_MS;
  for (const next of await lookAtJobs(now)) soonest = Math.min(soonest, next);
  for (const p of await waitingPokes()) {
    if (p.at <= now) void deliverPoke(p);
    else soonest = Math.min(soonest, p.at.getTime());
  }
  for (const t of await parkedThreads()) {
    // A failed wake leaves the time set, so the clock's next look tries again.
    if (t.resumeAt <= now)
      void wakeThread(t.id).catch((e: unknown) => console.error(`Thread ${t.id} did not wake:`, e));
    else soonest = Math.min(soonest, t.resumeAt.getTime());
  }
  if (g.jobClock !== clock || clock.revision !== revision) return;
  clearTimeout(clock.timer);
  clock.timer = setTimeout(() => void plan(), Math.max(1000, soonest - Date.now()));
}

/**
 * The clock's look at the jobs at `now`: each one due starts or is settled,
 * and each owed run gets in line. Returns when each other job runs next, for
 * the timer.
 */
export async function lookAtJobs(now: Date): Promise<number[]> {
  const later: number[] = [];
  for (const j of await enabledJobs()) {
    if (j.owed?.length) getInLine(j.id);
    if (!j.nextRunAt) await setNextRun(j.id, nextRun(j.schedule, now));
    else if (j.nextRunAt > now) later.push(j.nextRunAt.getTime());
    else if (!held(now)) await settle(j, j.nextRunAt, now);
  }
  return later;
}

/** A due job: on time it runs now; late, its kind says what happens (`dueNow`). */
async function settle(j: JobRow, was: Date, now: Date): Promise<void> {
  if (running.has(j.id)) return;
  const due = dueNow(j, was, now);
  const next = nextRun(j.schedule, now);
  if (due.do === 'run') void start(j, 'schedule');
  else if (due.do === 'skip') await skip(j, was, due.at, next);
  else if (due.do === 'ask') await askToCatchUp(j, was, due.times, next);
  else if (await owe(j, was, due.times, next)) getInLine(j.id);
}

/**
 * Put a job's owed run in the office's one line: it starts once every run
 * ahead of it ended. When its turn comes during an update's hold, or while the
 * job runs already, its times stay owed for the clock's next look.
 */
function getInLine(id: number): void {
  if (inLine.has(id)) return;
  inLine.add(id);
  const clock = (g.jobClock ??= {});
  clock.line = (clock.line ?? Promise.resolve())
    .then(async () => {
      if (held(new Date()) || running.has(id)) return;
      const j = await jobById(id);
      if (!j?.enabled) return;
      const owed = await takeOwed(id);
      if (owed.length) await start(j, 'schedule', owed);
    })
    .catch((e: unknown) => console.error(`Job ${id} did not catch up:`, e))
    .finally(() => inLine.delete(id));
}

/** Resolves once every owed run in line now has ended. For tests. */
export const lineDone = (): Promise<void> => g.jobClock?.line ?? Promise.resolve();

/**
 * Run a job. A run on time is for its scheduled time, and moves the schedule
 * on first, so a slow run never runs twice. A catch-up is for the `owed`
 * times, and its job moved on when they were owed. A manual one (Run now) is
 * for now, and leaves the schedule where it was.
 */
export async function start(j: JobRow, trigger: RunTrigger, owed?: Date[]): Promise<void> {
  if (running.has(j.id)) return;
  running.add(j.id);
  try {
    const now = new Date();
    const onTime = trigger === 'schedule' && !owed;
    // On time, the run claims its due time and moves the job on in one step,
    // so two looks at once start it once.
    const run = onTime ? await claimScheduledRun(j, now) : await startRun(j, trigger);
    if (!run) return;
    const times = owed ?? [onTime && j.nextRunAt ? j.nextRunAt : now];
    const r = await runJob(j, trigger, times).catch((e: unknown) => ({
      ok: false,
      text: e instanceof Error ? e.message : String(e),
      checkedFiles: undefined
    }));
    await finishRun(run, j, r.ok, r.text, r.checkedFiles);
  } finally {
    running.delete(j.id);
  }
}

/** Run now. It also takes the job off the desk's While you were away card. */
export async function runNow(id: number): Promise<void> {
  const j = await jobById(id);
  if (!j) return;
  await clearAway(id);
  void start(j, 'manual');
}

/** Start the clock once per process. */
export function startClock(): () => void {
  if (g.jobClock?.stop) return g.jobClock.stop;
  const changed = (e: OfficeEvent) => {
    if (e.type === 'change' && ['jobs', 'pokes', 'threads'].includes(e.table)) void plan();
  };
  const stop = () => {
    clearTimeout(g.jobClock?.timer);
    bus.off('event', changed);
    delete g.jobClock;
  };
  g.jobClock = { ...g.jobClock, started: true, stop, revision: 0 };
  listen();
  bus.on('event', changed);
  void closeStaleRuns().then(plan);
  return stop;
}
