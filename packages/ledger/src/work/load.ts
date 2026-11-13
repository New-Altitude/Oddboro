// The rows a work decider reads, loaded and locked inside its transaction.
// An event names the rows it starts from; the loader adds every row its
// decider can reach from them, takes the locks in `LOCK_ORDER`, and reads
// the rows again under those locks, so the decider judges what it holds.
import { and, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { MANAGER_ROLE } from '../managers.ts';
import { ownerName } from '../office-usage.ts';
import { runsGoing } from '../run-registry.ts';
import { asks, followUps, staff, tasks, threads } from '../schema.ts';
import type { Tx } from '../threads.ts';
import { lockRows } from '../transition.ts';
import type { WorkEvent } from './events.ts';
import type { Odd, WorkRows } from './snapshot.ts';
import { parseAsk, parseFollowUp, parseTask, parseThread, RETIRED_KINDS } from './state.ts';

/**
 * The one SQL test for a follow-up waiting to start. A row with an outcome
 * has ended even with no start time, as when its Odd left before starting it,
 * and a retired kind never starts.
 */
export const queuedRows: SQL = and(
  isNull(followUps.startedAt),
  isNull(followUps.outcome),
  // The column's type lists the live kinds only, so the test reads it as plain SQL.
  notInArray(sql`${followUps.kind}`, [...RETIRED_KINDS])
) as SQL; // `and` is undefined only when given no conditions.

/** The rows an event starts from, by table. */
type Seeds = { followUps?: number[]; threads?: number[]; asks?: number[]; tasks?: number[] };

const one = (id: number | null | undefined): number[] => (id == null ? [] : [id]);

/** A kind of event added to `WorkEvent` fails the type check here until it names its rows. */
const SEEDS: { [K in WorkEvent['kind']]: (e: Extract<WorkEvent, { kind: K }>) => Seeds } = {
  runQueued: ({ run }) => ({
    threads: one(run.threadId),
    asks: one(run.askId),
    tasks: one(run.taskId)
  }),
  runClaimed: (e) => ({ followUps: [e.id] }),
  runFinished: (e) => ({ followUps: [e.id, ...e.ended.joined] }),
  staleRunsClosed: (e) => ({ followUps: [e.id] })
};

/**
 * Load and lock what the event's decider reads. Each thread the event can
 * touch comes with everything on it: its runs, and what was raised on it,
 * since a thread's status is worked out from all of them.
 */
export async function loadWork(tx: Tx, e: WorkEvent): Promise<WorkRows> {
  // TypeScript cannot tie the entry it looks up to this event's own kind, but
  // `SEEDS` pairs each kind with its own, so the one found by `e.kind` takes `e`.
  const seeds = (SEEDS[e.kind] as (e: WorkEvent) => Seeds)(e);
  const reach = await reachOf(tx, seeds);

  await lockRows(tx, 'staff', [...reach.staff], 'share');
  await lockRows(tx, 'threads', [...reach.threads], 'update');
  const threadIds = [...reach.threads];
  const threadRows = await tx.select().from(threads).where(inArray(threads.id, threadIds));

  const askIds = await idsOf(
    tx,
    asks,
    or(
      inArray(asks.id, [...reach.asks]),
      inArray(asks.threadId, threadIds),
      inArray(asks.handOffId, [...reach.handOffs])
    )
  );
  await lockRows(tx, 'asks', askIds, 'share');

  const parkedOn = threadRows.flatMap((t) => one(t.resumeOnTask));
  const taskIds = await idsOf(
    tx,
    tasks,
    or(
      inArray(tasks.id, [...reach.tasks, ...parkedOn]),
      inArray(tasks.threadId, threadIds),
      inArray(tasks.askId, askIds),
      inArray(tasks.handOffId, [...reach.handOffs])
    )
  );
  await lockRows(tx, 'tasks', taskIds, 'share');

  const followUpIds = await idsOf(
    tx,
    followUps,
    or(
      inArray(followUps.id, [...(seeds.followUps ?? []), ...reach.handOffs]),
      inArray(followUps.threadId, threadIds)
    )
  );
  await lockRows(tx, 'follow_ups', followUpIds, 'update');

  const rows = {
    threads: threadRows.map(parseThread),
    asks: (await tx.select().from(asks).where(inArray(asks.id, askIds))).map(parseAsk),
    tasks: (await tx.select().from(tasks).where(inArray(tasks.id, taskIds))).map(parseTask),
    followUps: (await tx.select().from(followUps).where(inArray(followUps.id, followUpIds))).map(
      parseFollowUp
    )
  };
  // Every Odd the rows name, for names and whether it left. Only those known
  // before the threads were locked are locked: one first seen on a thread's
  // rows is read for its name, and `LOCK_ORDER` puts staff before threads.
  const named = new Set([
    ...reach.staff,
    ...rows.threads.map((t) => t.hubId),
    ...rows.followUps.flatMap((f) => [f.staffId, ...(f.handOff ? [f.handOff.from] : [])])
  ]);
  const odds = await tx
    .select()
    .from(staff)
    .where(inArray(staff.id, [...named]));

  return {
    staff: new Map(odds.map((s): [string, Odd] => [s.id, oddOf(s)])),
    threads: new Map(rows.threads.map((t) => [t.id, t])),
    followUps: new Map(rows.followUps.map((f) => [f.id, f])),
    asks: new Map(rows.asks.map((a) => [a.id, a])),
    tasks: new Map(rows.tasks.map((k) => [k.id, k])),
    // No decider of a run reads the usage window.
    window: null,
    runsGoing: new Set(runsGoing.keys()),
    owner: await ownerName(tx),
    prepared: {}
  };
}

function oddOf(s: typeof staff.$inferSelect): Odd {
  return {
    id: s.id,
    name: s.name,
    leftAt: s.leftAt,
    level: s.permission,
    agent: s.agent,
    manager: s.role === MANAGER_ROLE
  };
}

type Reach = {
  threads: Set<number>;
  staff: Set<string>;
  asks: Set<number>;
  tasks: Set<number>;
  /** The `hand_off` runs that the asks and tasks reached serve. */
  handOffs: Set<number>;
};

/**
 * Which threads and Odds the event can touch, read before any lock. It
 * follows only links a row keeps for life (a run's Odd, thread, ask and
 * task, what an ask or task was raised on), so the locks taken from it still
 * cover the rows once locked. The one link that can change is a park: a
 * thread parked on the task a run lifted, which that run's failure wakes. A
 * thread that parks on it after this read is left for the task's own end.
 */
async function reachOf(tx: Tx, seeds: Seeds): Promise<Reach> {
  const runs = await tx
    .select()
    .from(followUps)
    .where(inArray(followUps.id, seeds.followUps ?? []));
  const lifted = runs.flatMap((f) => one(f.unparkedTask));
  const taskIds = [...(seeds.tasks ?? []), ...runs.flatMap((f) => one(f.taskId)), ...lifted];
  const taskRows = await tx.select().from(tasks).where(inArray(tasks.id, taskIds));
  const askIds = [
    ...(seeds.asks ?? []),
    ...runs.flatMap((f) => one(f.askId)),
    ...taskRows.flatMap((k) => one(k.askId))
  ];
  const askRows = await tx.select().from(asks).where(inArray(asks.id, askIds));
  const handOffs = [...askRows, ...taskRows].flatMap((r) => one(r.handOffId));
  const origins = await tx.select().from(followUps).where(inArray(followUps.id, handOffs));
  const parked = await tx
    .select({ id: threads.id })
    .from(threads)
    .where(inArray(threads.resumeOnTask, lifted));
  const threadIds = new Set([
    ...(seeds.threads ?? []),
    ...[...runs, ...askRows, ...taskRows, ...origins].flatMap((r) => one(r.threadId)),
    ...parked.map((t) => t.id)
  ]);
  const hubs = await tx
    .select({ hubId: threads.hubId })
    .from(threads)
    .where(inArray(threads.id, [...threadIds]));
  return {
    threads: threadIds,
    staff: new Set([
      ...[...runs, ...origins].flatMap((f) => [f.staffId, ...(f.handOff ? [f.handOff.from] : [])]),
      ...hubs.map((t) => t.hubId)
    ]),
    asks: new Set(askIds),
    tasks: new Set(taskIds),
    handOffs: new Set(handOffs)
  };
}

/** The ids of a table's rows that `where` picks. */
async function idsOf(
  tx: Tx,
  table: typeof asks | typeof tasks | typeof followUps,
  where: SQL | undefined
): Promise<number[]> {
  const rows: { id: number }[] = await tx.select({ id: table.id }).from(table).where(where);
  return rows.map((r) => r.id);
}
