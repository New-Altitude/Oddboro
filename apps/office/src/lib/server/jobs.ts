// The office clock. It keeps one timer, set for the soonest due job, poke or
// parked thread, and resets it whenever the jobs, pokes or threads table
// changes. A thread's hub parks it until a time (resume_at); the clock starts
// the hub's pick-up then. A job missed while the Mac slept runs once when the
// clock next looks, then goes back on its schedule; a poke that late is marked
// missed (see deliverPoke); a thread that late wakes then. While an
// update is about to install (`held()` in update.ts) it starts no scheduled
// job: a due one waits and runs once the app is back.
import {
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

const g = globalThis as unknown as { jobClock?: { timer?: ReturnType<typeof setTimeout> } };
const running = new Set<number>();

async function plan(): Promise<void> {
  const clock = g.jobClock!;
  clearTimeout(clock.timer);
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
    if (trigger === 'schedule') await setNextRun(j.id, nextRun(j.schedule, new Date()));
    const run = await startRun(j, trigger);
    const r = await runJob(j, trigger);
    await finishRun(run, j, r.ok, r.text);
  } finally {
    running.delete(j.id);
  }
}

export async function runNow(id: number): Promise<void> {
  const j = await jobById(id);
  if (j) void start(j, 'manual');
}

/** Start the clock once per process. */
export function startClock(): void {
  if (g.jobClock) return;
  g.jobClock = {};
  listen();
  bus.on('event', (e: OfficeEvent) => {
    if (e.type === 'change' && ['jobs', 'pokes', 'threads'].includes(e.table)) void plan();
  });
  void closeStaleRuns().then(plan);
}
