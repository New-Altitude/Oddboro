// Where a thread stands as its runs move, and a new run on it, as steps a
// decider takes on its `Draft`. `settle` is the one place a thread's status
// and holder are worked out, as `settleThread` in ../threads.ts is today.
//
// Pure: every import that reaches the database is a type.
import type { LiveKind } from './events.ts';
import { putAll, type Draft, type Fresh, type WorkRows } from './snapshot.ts';
import type { FollowUp, FollowUpBase } from './state.ts';

/**
 * Whether something raised on a thread is still open on the owner's desk: an
 * ask raised on it, or a task given on it or from an ask raised on it, as
 * `waitingOn` reads it.
 */
function raisedOpen(rows: WorkRows, threadId: number): boolean {
  const raised = [...rows.asks.values()].filter((a) => a.threadId === threadId);
  const raisedIds = new Set(raised.map((a) => a.id));
  return (
    raised.some((a) => a.status === 'open') ||
    [...rows.tasks.values()].some(
      (k) =>
        k.status === 'open' &&
        (k.threadId === threadId || (k.askId !== null && raisedIds.has(k.askId)))
    )
  );
}

/**
 * Where an open thread stands from its runs: open while one has yet to end,
 * while it is parked, while something raised on it is open, before any run
 * has ended, and while the last run to end ended waiting, since the owner's
 * answer to what that run raised brings the lead back. Else it ends as its
 * last run ended. Its holder has the newest run still to end, else it is the
 * lead. An ended thread stays as it ended. Puts the thread only when its
 * status or holder changes.
 */
export function settle(d: Draft, threadId: number, now: Date): void {
  const t = d.rows.threads.get(threadId);
  if (t?.status !== 'open') return;
  const runs = [...d.rows.followUps.values()].filter((f) => f.threadId === threadId);
  const pending = runs.filter((f) => f.run.is !== 'ended').sort((a, b) => b.id - a.id)[0];
  const last = runs
    .flatMap((f) => (f.run.is === 'ended' ? [{ id: f.id, ...f.run }] : []))
    .sort((a, b) => b.doneAt.getTime() - a.doneAt.getTime() || b.id - a.id)[0];
  const holderId = pending?.staffId ?? t.hubId;
  if (
    pending ||
    t.park.on !== 'none' ||
    !last ||
    last.outcome === 'waiting' ||
    raisedOpen(d.rows, threadId)
  ) {
    if (holderId !== t.holderId) putAll(d, [{ table: 'threads', row: { ...t, holderId } }]);
    return;
  }
  const { status: _, park: __, ...base } = t;
  putAll(d, [{ table: 'threads', row: { ...base, holderId, status: last.outcome, endedAt: now } }]);
}

type RunColumns = Omit<FollowUpBase, 'id' | 'createdAt'>;

/** A run to add: its Odd and kind, and any column it sets. Every other column is empty, as a new row's are. */
export function newRun(
  r: Pick<RunColumns, 'staffId'> & { kind: LiveKind } & Partial<RunColumns>,
  now: Date
): Fresh<FollowUp> {
  return {
    askId: null,
    reportId: null,
    taskId: null,
    goalId: null,
    handOff: null,
    threadId: null,
    edit: null,
    note: null,
    pickedUp: null,
    reportWhenDone: false,
    chatCard: null,
    ...r,
    createdAt: now,
    run: { is: 'queued' }
  };
}

/** Adds a run, and settles the thread it works on, as `addFollowUp` does: so a thread's holder and status never fall behind its runs. */
export function addRun(d: Draft, run: Fresh<FollowUp>, now: Date): void {
  putAll(d, [{ table: 'followUps', ref: `run ${d.ids.size}`, insert: run }]);
  if (run.threadId !== null) settle(d, run.threadId, now);
}
