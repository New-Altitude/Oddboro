// The office clock. It keeps one timer, set for the soonest due job, poke or
// parked thread, and resets it whenever the jobs, pokes or threads table
// changes. A thread's hub parks it until a time (resume_at); the clock starts
// the hub's pick-up then. A job missed while the Mac slept runs once when the
// clock next looks, then goes back on its schedule; a poke that late is marked
// missed (see deliverPoke); a thread that late wakes then. While an
// update is about to install (`held()` in update.ts) it starts no scheduled
// job: a due one waits and runs once the app is back.
import {
  claimScheduledRun,
  closeStaleRuns,
  enabledJobs,
  finishRun,
  job as jobById,
  nextRun,
  parkedThreads,
  setNextRun,
  startRun,
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
  jobClock?: { timer?: ReturnType<typeof setTimeout>; revision: number; stop: () => void };
};
const running = new Set<number>();

async function plan(): Promise<void> {
  const clock = g.jobClock;
  if (!clock) return;
  const revision = ++clock.revision;
  const now = new Date();
  let soonest = now.getTime() + LONGEST_WAIT_MS;
  for (const j of await enabledJobs()) {
    if (!j.nextRunAt) {
      await setNextRun(j.id, nextRun(j.schedule, now));
      continue;
    }
    if (j.nextRunAt <= now) {
      if (!held(now)) void start(j, 'schedule');
    } else soonest = Math.min(soonest, j.nextRunAt.getTime());
  }
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
 * Run a job. A scheduled run moves the schedule on first, so a slow run never
 * runs twice. A manual one (Run now) leaves the schedule where it was.
 */
export async function start(j: JobRow, trigger: RunTrigger): Promise<void> {
  if (running.has(j.id)) return;
  running.add(j.id);
  try {
    const run =
      trigger === 'schedule' ? await claimScheduledRun(j, new Date()) : await startRun(j, trigger);
    if (!run) return;
    const r = await runJob(j, trigger).catch((e: unknown) => ({
      ok: false,
      text: e instanceof Error ? e.message : String(e),
      checkedFiles: undefined
    }));
    await finishRun(run, j, r.ok, r.text, r.checkedFiles);
  } finally {
    running.delete(j.id);
  }
}

export async function runNow(id: number): Promise<void> {
  const j = await jobById(id);
  if (j) void start(j, 'manual');
}

/** Start the clock once per process. */
export function startClock(): () => void {
  if (g.jobClock) return g.jobClock.stop;
  const changed = (e: OfficeEvent) => {
    if (e.type === 'change' && ['jobs', 'pokes', 'threads'].includes(e.table)) void plan();
  };
  const stop = () => {
    clearTimeout(g.jobClock?.timer);
    bus.off('event', changed);
    delete g.jobClock;
  };
  g.jobClock = { stop, revision: 0 };
  listen();
  bus.on('event', changed);
  void closeStaleRuns().then(plan);
  return stop;
}
