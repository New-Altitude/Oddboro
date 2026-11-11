// One entry for each run, from waiting for a slot through process exit.
// The clock still owns which jobs are due. This registry owns live execution.
import { randomUUID } from 'node:crypto';
import type { UsageKind } from './schema.ts';

export type WorkAbout = {
  key: string;
  kind: 'job' | 'goal';
  id: number;
  title: string;
  leadId: string;
  lead: string;
};

export type Work = {
  /** Unique while the office runs. */
  id: number;
  kind: 'job' | 'follow-up' | 'draft';
  /** The job's name or the ask's title. */
  label: string;
  /** What kind of work it is, in a few words: "Carrying out ask #20". */
  detail: string;
  /** When it started, or joined the line for a slot. */
  since: string;
  /** True while it waits for a free slot. */
  queued: boolean;
  askId?: number;
  about?: WorkAbout;
  /** The tool the staffer is using now, as Claude Code names it. */
  doing?: string;
  /** Tool calls so far. */
  steps: number;
};

export type LiveRun = {
  key: string;
  staffId: string;
  kind: UsageKind | 'hello';
  stop: AbortController;
  end: { promise: Promise<void>; resolve: () => void };
  turnId?: string;
  work?: Work;
  /** A queued background run is released by the preceding run or by Stop. */
  enter?: () => void;
};

const changingStaff = new Set<string>();

/** A persona conversion cannot race an old run or admit a new one halfway through. */
export async function withIdleStaff<T>(staffId: string, change: () => Promise<T>): Promise<T> {
  if (changingStaff.has(staffId) || [...runsGoing.values()].some((r) => r.staffId === staffId))
    throw new Error('Wait for this Odd to finish or stop its work, then try again.');
  changingStaff.add(staffId);
  try {
    return await change();
  } finally {
    changingStaff.delete(staffId);
  }
}

export const runsGoing = new Map<string, LiveRun>();

export function reserveRun(
  input: Pick<LiveRun, 'staffId' | 'kind' | 'turnId' | 'work'> & { key?: string }
): LiveRun {
  if (changingStaff.has(input.staffId))
    throw new Error('This Odd is changing to its persona. Try again once it is connected.');
  let resolve: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const run: LiveRun = {
    ...input,
    key: input.key ?? randomUUID(),
    stop: new AbortController(),
    // Promise calls its executor before the constructor returns.
    end: { promise, resolve: resolve! }
  };
  if (runsGoing.has(run.key)) throw new Error('That run is already registered.');
  runsGoing.set(run.key, run);
  return run;
}

export function releaseRun(run: LiveRun): void {
  if (runsGoing.get(run.key) !== run) return;
  runsGoing.delete(run.key);
  run.end.resolve();
}
