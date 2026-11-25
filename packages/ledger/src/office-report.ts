// The office report in parts that fit one tool result (#201). A run that
// gets a result too big for it loses it to a file the Odd cannot read, so
// a report too big for one call comes as each Odd in brief, then one Odd in
// full, its runs in pages.

/**
 * The most one office_report call returns, in characters of compact JSON:
 * about 12,000 tokens, well under Claude Code's 25,000 for one tool result,
 * so the run keeps it and stays small.
 */
export const REPORT_CHARS = 40_000;

type Run = { job: string; status: string; at: string | null };
type Job = { name: string; state: string; next: string | null };
type Entry = { id: string; name: string; role: string; jobs: Job[]; runs: Run[] };
type From = { from: string | null };
type FollowUp = From & { outcome: string | null };

/** What office_report reads: officeActivity, with each Odd's access added. */
export type FullReport<S extends Entry = Entry> = {
  since: string | null;
  now: string | null;
  staff: S[];
  asks: { open: From[]; decided: From[] };
  followUps: FollowUp[];
  tasksForOwner: { open: From[]; done: From[] };
};

export type ReportPart = { odd?: string; page?: number; limit?: number };

const size = (v: unknown) => JSON.stringify(v).length;
const count = (runs: Run[], status: string) => runs.filter((r) => r.status === status).length;
const by = <T extends From>(list: T[], id: string | null) => list.filter((x) => x.from === id);

/**
 * The part of the report one call asked for. With no Odd named: the whole
 * report when it fits, or else each Odd in brief. With an Odd: its own part
 * in full, with its runs in pages when they do not fit in one.
 */
export function reportPart<S extends Entry>(
  full: FullReport<S>,
  { odd, page = 1, limit = REPORT_CHARS }: ReportPart
): object | string {
  if (!odd) return size(full) <= limit ? full : brief(full);
  const entry = full.staff.find((s) => s.id === odd);
  if (!entry)
    return `No Odd "${odd}" in the office report. Its ids: ${full.staff.map((s) => s.id).join(', ')}.`;
  const own = {
    since: full.since,
    now: full.now,
    staff: [entry],
    asks: { open: by(full.asks.open, odd), decided: by(full.asks.decided, odd) },
    followUps: by(full.followUps, odd),
    tasksForOwner: {
      open: by(full.tasksForOwner.open, odd),
      done: by(full.tasksForOwner.done, odd)
    }
  };
  if (size(own) <= limit) return own;
  const pages = runPages(entry.runs, limit - size({ ...own, staff: [{ ...entry, runs: [] }] }));
  const n = Math.min(Math.max(page, 1), pages.length);
  return {
    ...own,
    staff: [{ ...entry, runs: pages[n - 1] }],
    page: {
      n,
      of: pages.length,
      note:
        n < pages.length
          ? `${entry.name}'s runs fill ${pages.length} pages, oldest first. Call office_report again with the same odd and hours, and page ${n + 1}, for the next.`
          : `This is the last page of ${entry.name}'s runs.`
    }
  };
}

/**
 * Each Odd in a line or two: its jobs, and how many runs, asks and tasks it
 * had. Every list here grows with the Odds and their jobs, never with the hours.
 */
function brief<S extends Entry>(full: FullReport<S>) {
  return {
    since: full.since,
    now: full.now,
    parts: `The whole report is too big for one call, so each Odd is in brief here. For one Odd's runs with their summaries, its access, asks, follow-ups and tasks, call office_report again with the same hours and odd set to its id.`,
    staff: full.staff.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      jobs: s.jobs.map((j) => ({ name: j.name, state: j.state, next: j.next })),
      runs: {
        done: count(s.runs, 'done'),
        failed: count(s.runs, 'failed'),
        running: count(s.runs, 'running')
      },
      failedJobs: Object.fromEntries(
        [...new Set(s.runs.filter((r) => r.status === 'failed').map((r) => r.job))].map((job) => [
          job,
          s.runs.filter((r) => r.status === 'failed' && r.job === job).length
        ])
      ),
      asks: { open: by(full.asks.open, s.id).length, decided: by(full.asks.decided, s.id).length },
      followUps: {
        open: by(full.followUps, s.id).filter((f) => f.outcome === null).length,
        all: by(full.followUps, s.id).length
      },
      tasksForOwner: {
        open: by(full.tasksForOwner.open, s.id).length,
        done: by(full.tasksForOwner.done, s.id).length
      }
    })),
    // Asks and tasks no Odd raised are in no Odd's part, so they come here whole.
    fromTheOffice: {
      asks: { open: by(full.asks.open, null), decided: by(full.asks.decided, null) },
      tasksForOwner: {
        open: by(full.tasksForOwner.open, null),
        done: by(full.tasksForOwner.done, null)
      }
    }
  };
}

/** Runs packed in order into pages of at most `room` characters, at least one run a page. */
function runPages(runs: Run[], room: number): Run[][] {
  const pages: Run[][] = [[]];
  let used = 0;
  for (const r of runs) {
    const n = size(r) + 1;
    if (pages.at(-1)!.length && used + n > room) {
      pages.push([]);
      used = 0;
    }
    pages.at(-1)!.push(r);
    used += n;
  }
  return pages;
}
