// The rows a work decider reads, loaded and locked inside its transaction.
// An event names the rows it starts from; the loader adds every row its
// decider can reach from them, takes the locks in `LOCK_ORDER`, and reads
// the rows again under those locks, so the decider judges what it holds.
import { and, eq, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { fixedError } from '../errors.ts';
import { MANAGER_ROLE } from '../managers.ts';
import type { StaffRow } from '../office.ts';
import { gaveFolder, switchesOff } from '../office-folders.ts';
import { networkNote } from '../office-staff.ts';
import { ownerName } from '../office-usage.ts';
import { runsGoing } from '../run-registry.ts';
import { asks, followUps, staff, tasks, threads } from '../schema.ts';
import { sharing } from '../sharing.ts';
import type { Tx } from '../threads.ts';
import { lockRows } from '../transition.ts';
import { effectsOf } from './answers.ts';
import type { EventOf, WorkEvent } from './events.ts';
import type { Odd, Prepared, WorkRows } from './snapshot.ts';
import {
  parseAsk,
  parseFollowUp,
  parseTask,
  parseThread,
  RETIRED_KINDS,
  type Ask
} from './state.ts';
import { TWINNED } from './twins.ts';

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

/**
 * The rows an event starts from, by table. The decider reads each one and
 * the work each ask, task and run is on. It reads the rows in `only` alone,
 * not the work they are on. It may write rows of the tables in `update`,
 * which are locked for update instead of share. `ends` are the tasks it may
 * end, whose parked work it wakes.
 */
type Seeds = {
  followUps?: number[];
  threads?: number[];
  asks?: number[];
  tasks?: number[];
  staff?: string[];
  only?: { asks?: number[]; tasks?: number[] };
  update?: ('staff' | 'asks' | 'tasks')[];
  ends?: number[];
};

const one = <T>(id: T | null | undefined): T[] => (id == null ? [] : [id]);

/**
 * A kind of event added to `WorkEvent` fails the type check here until it
 * names its rows. Each reads what it needs to name them before any lock.
 */
const SEEDS: {
  [K in WorkEvent['kind']]: (tx: Tx, e: EventOf<K>) => Seeds | Promise<Seeds>;
} = {
  runQueued: (_, { run }) => ({
    threads: one(run.threadId),
    asks: one(run.askId),
    tasks: one(run.taskId)
  }),
  runClaimed: (_, e) => ({ followUps: [e.id] }),
  runFinished: (_, e) => ({ followUps: [e.id, ...e.ended.joined] }),
  staleRunsClosed: (_, e) => ({ followUps: [e.id] }),
  askRaised: async (tx, { ask }) => ({
    threads: one(ask.threadId),
    only: {
      asks: [
        ...one(ask.revises),
        // The Odd's open calls, which a repeat of one finds.
        ...(ask.kind === 'call'
          ? await idsOf(
              tx,
              asks,
              and(eq(asks.staffId, ask.staffId), eq(asks.kind, 'call'), eq(asks.status, 'open'))
            )
          : [])
      ]
    },
    update: ['asks']
  }),
  askDecided: async (tx, e) => {
    const [a] = await tx.select().from(asks).where(eq(asks.id, e.id));
    if (!a) return {};
    const yes = e.decision === 'approve';
    // The Odd's open asks of a twinned kind, which a yes or a no answers too.
    const twins =
      TWINNED.includes(a.kind) && e.decision !== 'iterate'
        ? await idsOf(
            tx,
            asks,
            and(eq(asks.staffId, a.staffId), eq(asks.kind, a.kind), eq(asks.status, 'open'))
          )
        : [];
    // The work the usage window's ask holds, which its yes frees.
    const held =
      yes && a.kind === 'window'
        ? await tx.select({ id: threads.id }).from(threads).where(eq(threads.heldBy, a.id))
        : [];
    return {
      asks: [a.id, ...twins],
      threads: held.map((t) => t.id),
      // The Odd hears the answer unless it left, and a held hand-off names its colleague.
      staff: [a.staffId, ...one(a.held?.to)],
      // A switch or folder yes changes the Odd's own row with the claim.
      update: yes && (a.kind === 'switch' || a.kind === 'folder') ? ['staff', 'asks'] : ['asks']
    };
  },
  taskGiven: async (tx, { task, oneOpen }) => ({
    threads: one(task.threadId),
    // The open tasks, the Odd's own when it has one, an open connect task among them answering this one.
    only: { tasks: oneOpen ? await openTaskIds(tx, task.staffId ?? undefined) : [] }
  }),
  taskEnded: async (tx, e) => {
    const [t] = await tx.select().from(tasks).where(eq(tasks.id, e.id));
    if (!t) return {};
    const [from] = t.askId === null ? [] : await tx.select().from(asks).where(eq(asks.id, t.askId));
    return {
      tasks: [t.id],
      asks: from ? await settledTogether(tx, from) : [],
      staff: one(t.staffId),
      update: ['tasks'],
      ends: [t.id]
    };
  },
  connectTasksDropped: async (tx, e) => {
    const open = await openTaskIds(tx, e.staffId);
    return { only: { tasks: open }, update: ['tasks'], ends: open };
  },
  goalStatusChanged: () => ({})
};

/**
 * Load and lock what the event's decider reads. Each thread the event can
 * touch comes with everything on it: its runs, and what was raised on it,
 * since a thread's status is worked out from all of them.
 */
export async function loadWork(tx: Tx, e: WorkEvent): Promise<WorkRows> {
  // TypeScript cannot tie the entry it looks up to this event's own kind, but
  // `SEEDS` pairs each kind with its own, so the one found by `e.kind` takes `e`.
  const seeds = await (SEEDS[e.kind] as (tx: Tx, e: WorkEvent) => Seeds | Promise<Seeds>)(tx, e);
  const reach = await reachOf(tx, seeds);
  const mode = (table: 'staff' | 'asks' | 'tasks') =>
    seeds.update?.includes(table) ? 'update' : 'share';

  await lockRows(tx, 'staff', [...reach.staff], mode('staff'));
  await lockRows(tx, 'threads', [...reach.threads], 'update');
  const threadIds = [...reach.threads];
  const threadRows = await tx.select().from(threads).where(inArray(threads.id, threadIds));

  const askIds = await idsOf(
    tx,
    asks,
    or(
      inArray(asks.id, [...reach.asks, ...(seeds.only?.asks ?? [])]),
      inArray(asks.threadId, threadIds),
      inArray(asks.handOffId, [...reach.handOffs])
    )
  );
  await lockRows(tx, 'asks', askIds, mode('asks'));

  const parkedOn = threadRows.flatMap((t) => one(t.resumeOnTask));
  const taskIds = await idsOf(
    tx,
    tasks,
    or(
      inArray(tasks.id, [...reach.tasks, ...(seeds.only?.tasks ?? []), ...parkedOn]),
      inArray(tasks.threadId, threadIds),
      inArray(tasks.askId, askIds),
      inArray(tasks.handOffId, [...reach.handOffs])
    )
  );
  await lockRows(tx, 'tasks', taskIds, mode('tasks'));
  // A park locks its task first (`parkOnTask`), so none comes once the task
  // is locked; one that came since the threads were locked is not in them.
  const late = (await parkedIds(tx, seeds.ends ?? [])).filter((id) => !reach.threads.has(id));
  if (late.length)
    throw fixedError('Work was parked on the task as it ended. Try again in a moment.');

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
  const asked = e.kind === 'askDecided' ? rows.asks.find((a) => a.id === e.id) : undefined;

  return {
    staff: new Map(odds.map((s): [string, Odd] => [s.id, oddOf(s)])),
    threads: new Map(rows.threads.map((t) => [t.id, t])),
    followUps: new Map(rows.followUps.map((f) => [f.id, f])),
    asks: new Map(rows.asks.map((a) => [a.id, a])),
    tasks: new Map(rows.tasks.map((k) => [k.id, k])),
    // No decider of a run, an ask or a task reads the usage window.
    window: null,
    runsGoing: new Set(runsGoing.keys()),
    owner: await ownerName(tx),
    prepared:
      e.kind === 'askDecided' && asked
        ? await prepareYes(
            tx,
            e,
            asked,
            odds.find((s) => s.id === asked.staffId)
          )
        : {}
  };
}

/**
 * What an owner's yes reads that takes I/O, worked out under the locks: the
 * switches a switch yes turns on and the network words they open, a folder
 * yes's ledger title, which shows the folder's real path, and what a held
 * hand-off carries, from access as it is at the yes. `odd` is the Odd's row
 * as the loader read it, before the claim changes it.
 */
async function prepareYes(
  tx: Tx,
  e: EventOf<'askDecided'>,
  ask: Ask,
  odd: StaffRow | undefined
): Promise<Prepared> {
  if (e.decision !== 'approve' || ask.status !== 'open') return {};
  if (ask.kind === 'switch' && odd) {
    const off = switchesOff(odd, ask.switches ?? []);
    const after = { ...odd };
    for (const s of off) after[s] = true;
    return { switches: { before: odd, off, networkBody: networkNote(odd, after).body } };
  }
  // The claim writes the event's folder onto the ask, in place of the one asked for.
  const given = (e.done?.folder ?? ask.folder)?.given;
  if (ask.kind === 'folder' && given)
    return { folderTitle: gaveFolder(odd?.name ?? ask.staffId, given.path, given.level) };
  if (effectsOf(ask.kind, 'approve').includes('start_held') && ask.held && ask.threadId) {
    // Only what the lead chose: an ask held by an earlier build also stored
    // what it carried then, which access may have changed since.
    const { from, to, title, brief, files } = ask.held;
    return {
      sharing: await sharing(tx, { from, to, title, brief, files, threadId: ask.threadId })
    };
  }
  return {};
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
 * thread parked on the task a run lifted, which that run's failure wakes, or
 * on a task the event ends. A thread that parks on a lifted task after this
 * read is left for the task's own end; one on a task the event ends is
 * caught under the task's lock.
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
  const threadIds = new Set([
    ...(seeds.threads ?? []),
    ...[...runs, ...askRows, ...taskRows, ...origins].flatMap((r) => one(r.threadId)),
    ...(await parkedIds(tx, [...lifted, ...(seeds.ends ?? [])]))
  ]);
  const hubs = await tx
    .select({ hubId: threads.hubId })
    .from(threads)
    .where(inArray(threads.id, [...threadIds]));
  return {
    threads: threadIds,
    staff: new Set([
      ...(seeds.staff ?? []),
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

/** The threads parked on any of the tasks. */
async function parkedIds(tx: Tx, taskIds: number[]): Promise<number[]> {
  const rows = await tx
    .select({ id: threads.id })
    .from(threads)
    .where(inArray(threads.resumeOnTask, taskIds));
  return rows.map((t) => t.id);
}

/** The open tasks, only this Odd's when one is named. */
const openTaskIds = (tx: Tx, staffId: string | undefined): Promise<number[]> =>
  idsOf(
    tx,
    tasks,
    and(eq(tasks.status, 'open'), staffId === undefined ? undefined : eq(tasks.staffId, staffId))
  );

/**
 * The asks the owner's one answer settled with `from`: of a twinned kind,
 * the same Odd and kind, decided the same way at the same moment. The
 * decider picks the same tool or folder among them (`answeredWith`).
 */
async function settledTogether(tx: Tx, from: typeof asks.$inferSelect): Promise<number[]> {
  const at = from.decidedAt?.getTime();
  if (!TWINNED.includes(from.kind) || from.status === 'open' || at === undefined) return [];
  const rows = await tx
    .select({ id: asks.id, decidedAt: asks.decidedAt })
    .from(asks)
    .where(
      and(eq(asks.staffId, from.staffId), eq(asks.kind, from.kind), eq(asks.status, from.status))
    );
  // The moment is compared in milliseconds, as the decider compares it.
  return rows.filter((r) => r.decidedAt?.getTime() === at).map((r) => r.id);
}
