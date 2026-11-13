// The one way a change to the office's work happens. A transition loads the
// rows it needs and locks them, decides with a pure function, and applies the
// change, all in one transaction. What it does outside the database (a ledger
// line, a run started) waits until the commit, so nothing outside sees a
// change that could still roll back.
import { sql } from 'drizzle-orm';
import { db } from './db.ts';
import { record } from './office-ledger.ts';
import type { Tx } from './threads.ts';

/**
 * Something a transition does after its commit: a ledger line, or a closure
 * the decider's input carried, named by `then` for the log.
 */
export type After =
  { record: Parameters<typeof record>[0] } | { then: string; run: () => Promise<unknown> };

/** What a decider says: no, with the reason in words, or the change to apply and what follows it. */
export type Decided<C> = { refused: string } | { change: C; after: After[] };

/**
 * Run one transition: load with locks, decide, apply, in one transaction.
 * With the caller's own `tx` the caller owns the commit, so the after-effects
 * come back unrun, and the caller runs them with `runAfters` once it commits.
 */
export async function transition<W, C>(
  step: {
    name: string;
    /** Reads and locks, taking locks in `LOCK_ORDER`. */
    load: (tx: Tx) => Promise<W>;
    /** Pure: no I/O, no clock. */
    decide: (work: W, now: Date) => Decided<C>;
    apply: (tx: Tx, change: C) => Promise<void>;
  },
  o: { tx?: Tx; now?: Date } = {}
): Promise<Decided<C>> {
  const inTx = async (tx: Tx): Promise<Decided<C>> => {
    const work = await step.load(tx);
    // Taken after the load, which can wait on another transaction's locks, so
    // the decider judges the rows at the time it holds them.
    const decided = step.decide(work, o.now ?? new Date());
    if ('change' in decided) await step.apply(tx, decided.change);
    return decided;
  };
  if (o.tx) return inTx(o.tx);
  const decided = await db.transaction(inTx);
  if ('change' in decided) await runAfters(step.name, decided.after);
  return decided;
}

/**
 * Run after-effects in order, once their transaction has committed. The
 * transition's own runner, and the caller's when it passed its own `tx`.
 */
export async function runAfters(name: string, after: After[]): Promise<void> {
  for (const a of after) {
    try {
      if ('record' in a) await record(a.record);
      else await a.run();
    } catch (err) {
      // Reported, not thrown: the change is committed and stays so, and the
      // after-effects behind this one still run.
      console.error(`${name}: the after-effect ${'record' in a ? 'record' : a.then} failed:`, err);
    }
  }
}

/**
 * The order every transition locks tables in, so two transitions never wait
 * on each other. `plan_limits` comes first: a hand-off in a transition takes
 * it first, because a hand-off the usage window holds writes threads and asks
 * after it. Today's `takeHandOff` does not run in a transition, and locks the
 * thread before `holdForWindow` locks `plan_limits`.
 */
export const LOCK_ORDER = [
  'plan_limits',
  'staff',
  'threads',
  'asks',
  'tasks',
  'follow_ups'
] as const;

/**
 * Lock rows of one table by id. Postgres sorts before it locks, so two
 * transitions locking the same rows take them in one order and cannot
 * deadlock, whatever order the ids come in.
 */
export async function lockRows(
  tx: Tx,
  table: (typeof LOCK_ORDER)[number],
  ids: (string | number)[],
  mode: 'update' | 'share'
): Promise<void> {
  if (ids.length === 0) return;
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );
  const lock = mode === 'update' ? sql`for update` : sql`for share`;
  await tx.execute(
    sql`select id from ${sql.identifier(table)} where id in (${list}) order by id ${lock}`
  );
}
