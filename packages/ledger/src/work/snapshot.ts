// The rows a decision reads, and the change it makes, as data. A loader reads
// `WorkRows` under its locks; a decider returns a `Change`; `applyChange`
// gives the rows that change leaves in memory, which a decider reads between
// its own steps (`Draft`) and the tests read between events.
//
// Pure: the imports below that reach the database are types only.
import type { Level, OwnSwitch } from '../access-words.ts';
import type { Agent } from '../agents.ts';
import { fixedError } from '../errors.ts';
import type { CarriedFile } from '../hand-offs.ts';
import type { record } from '../office-ledger.ts';
import type { AskRow, StaffRow } from '../office.ts';
import type { AskStatus, HandOff } from '../schema.ts';
import type { Tx } from '../threads.ts';
import type { Ask, FollowUp, Task, Thread } from './state.ts';

export type Odd = {
  id: string;
  name: string;
  leftAt: Date | null;
  level: Level;
  agent: Agent;
  manager: boolean;
};

/** Facts a decider needs that take I/O to learn, which the loader works out under the same locks as the rows. */
export type Prepared = {
  /**
   * A switch yes: the Odd's staff row as the loader read it, the asked
   * switches still off in it, and the answer line's network words, which read
   * the platform and the office's network hold.
   */
  switches?: { before: StaffRow; off: OwnSwitch[]; networkBody: string | undefined };
  /** The hand-off `handOn` starts, as `sharing()` gives it for the Odds on the thread. */
  sharing?: HandOff;
  /** A folder yes's answer line, which reads the file system to show the path. */
  folderTitle?: string;
};

/** The loaded rows, as states. Named so, since the office's `Work` is a run's item. */
export type WorkRows = {
  staff: Map<string, Odd>;
  threads: Map<number, Thread>;
  followUps: Map<number, FollowUp>;
  asks: Map<number, Ask>;
  tasks: Map<number, Task>;
  window: {
    share: number;
    resetsAt: Date | null;
    ask: { id: number; status: AskStatus } | null;
  } | null;
  /** The keys of the runs going now, which only the office's memory holds. */
  runsGoing: ReadonlySet<string>;
  /** The owner's name, for answer lines and report titles. */
  owner: string;
  prepared: Prepared;
};

type Tables = { threads: Thread; followUps: FollowUp; asks: Ask; tasks: Task };
/** The id fields a new row may take from another new row in the same change. `heldBy` is a window park's ask. */
type Links = {
  threads: 'goalId' | 'heldBy';
  followUps: 'threadId' | 'askId' | 'taskId' | 'goalId';
  asks: 'threadId' | 'handOffId';
  tasks: 'threadId' | 'askId' | 'handOffId';
};
/** A row before it has an id. Distributes over a state union, which a plain `Omit` would flatten. */
export type Fresh<T> = T extends unknown ? Omit<T, 'id'> : never;

/**
 * One row written whole: an existing row's new state, or a new row. A new
 * row has a `ref`, its name in this change. `points` names, per id field, the
 * `ref` of a new row or a `perKind` effect whose id that field takes, so rows
 * written together can point at each other before any has an id.
 */
export type Put = {
  [T in keyof Tables]:
    | { table: T; row: Tables[T] }
    | {
        table: T;
        ref: string;
        insert: Fresh<Tables[T]>;
        points?: Partial<Record<Links[T], string>>;
      };
}[keyof Tables];

/** A line for the Ledger, as `record` takes it. */
export type LedgerLine = Parameters<typeof record>[0];

/** An in-transaction write outside the four tables that an entry function supplies, as an ask's `link` is. */
export type PerKindInTx = {
  /** Names it in an error, and is the `ref` a put may point at. */
  name: string;
  /** `ask`: the ask this change claims, on an ask's answer. */
  run: (tx: Tx, ask?: AskRow) => Promise<{ id: string | number } | void>;
};

/** A write inside the transaction outside the four tables, as named data. */
export type Outside =
  | { kind: 'report'; staffId: string; title: string; body: string }
  | { kind: 'poke'; staffId: string; message: string }
  | { kind: 'cancelPokes'; staffId: string }
  /** The Odd leaves at `at`, its jobs off, as a removal does. */
  | { kind: 'leave'; staffId: string; at: Date }
  | { kind: 'comeBack'; staffId: string }
  | { kind: 'carryFiles'; threadId: number; from: string; files: CarriedFile[] }
  /** Only where the line is written inside the transaction today. */
  | { kind: 'record'; line: LedgerLine }
  /** The files an Odd attached, inserted with the new ask or task they point at (its put's `ref`). */
  | {
      kind: 'attachments';
      staffId: string;
      paths: string[];
      to: { ask: string } | { task: string };
    }
  | { kind: 'perKind'; effect: PerKindInTx };

export type Change<R = unknown> = {
  /** Applied in order: a later put of a row wins. */
  put: Put[];
  outside: Outside[];
  /** What the entry function returns to its caller. */
  result: R;
};

/**
 * The rows a change leaves, in memory. Each `perKind` effect gets a made-up
 * id, -1 for the first and -2 for the next, since none runs here, and no
 * made-up id can equal a real row's. A new row gets the next id after its
 * table's highest, as a serial column gives it.
 */
export function applyChange(rows: WorkRows, change: Change): WorkRows {
  const ids = madeUpIds(change.outside);
  const next = copy(rows);
  for (const o of change.outside) {
    const odd = 'staffId' in o ? next.staff.get(o.staffId) : undefined;
    if (o.kind === 'leave' && odd) next.staff.set(odd.id, { ...odd, leftAt: o.at });
    if (o.kind === 'comeBack' && odd) next.staff.set(odd.id, { ...odd, leftAt: null });
  }
  for (const p of change.put) putOne(next, p, ids);
  return next;
}

function madeUpIds(outside: readonly Outside[]): Map<string, number> {
  const ids = new Map<string, number>();
  for (const o of outside) if (o.kind === 'perKind') ids.set(o.effect.name, -(ids.size + 1));
  return ids;
}

function copy(rows: WorkRows): WorkRows {
  return {
    ...rows,
    staff: new Map(rows.staff),
    threads: new Map(rows.threads),
    followUps: new Map(rows.followUps),
    asks: new Map(rows.asks),
    tasks: new Map(rows.tasks)
  };
}

/** Writes one put into `rows`, which it owns, and keeps a new row's id under its `ref`. */
function putOne(rows: WorkRows, p: Put, ids: Map<string, number>): number {
  const map = rows[p.table] as Map<number, Tables[typeof p.table]>;
  if ('row' in p) {
    map.set(p.row.id, p.row);
    return p.row.id;
  }
  if (ids.has(p.ref)) throw fixedError('Two rows in one change share a ref.');
  const id = Math.max(0, ...map.keys()) + 1;
  // A new row's state is its insert with the id it got and each id it points at.
  const row = { ...p.insert, id } as Tables[typeof p.table];
  for (const [field, ref] of Object.entries(p.points ?? {})) {
    const to = ids.get(ref);
    if (to === undefined)
      throw fixedError('A row in a change points at a ref no earlier put made.');
    pointAt(row, field, to);
  }
  map.set(id, row);
  ids.set(p.ref, id);
  return id;
}

/** Sets one id field a new row points with. A window park keeps its ask in the park, not a column. */
function pointAt(row: Tables[keyof Tables], field: string, id: number): void {
  if (field === 'heldBy') {
    if ('park' in row && row.park.on === 'window') row.park = { ...row.park, ask: id };
    return;
  }
  Reflect.set(row, field, id);
}

/**
 * A change being decided, step by step. Each step reads `rows`, the loaded
 * rows as the puts so far leave them, so a helper sees what the steps before
 * it wrote. A later put of a row this change inserts folds into that insert,
 * so the change writes each new row once. `outside` is fixed when the draft
 * starts, so a put can point at a `perKind` effect's ref from the first step.
 */
export type Draft = {
  readonly loaded: WorkRows;
  rows: WorkRows;
  put: Put[];
  readonly outside: Outside[];
  readonly ids: Map<string, number>;
};

export function draft(rows: WorkRows, outside: Outside[] = []): Draft {
  return { loaded: rows, rows, put: [], outside, ids: madeUpIds(outside) };
}

export function putAll(d: Draft, puts: readonly Put[]): void {
  const rows = copy(d.rows);
  for (const p of puts) {
    const inserted = 'row' in p ? insertOf(d, p) : undefined;
    if (inserted && 'row' in p) {
      // Its points stay; the row's own id fields hold the same ids they give.
      const { id: _, ...insert } = p.row;
      d.put[inserted.at] = { ...inserted.put, insert } as Put;
      putOne(rows, p, d.ids);
      continue;
    }
    putOne(rows, p, d.ids);
    d.put.push(p);
  }
  d.rows = rows;
}

/** The insert in this draft that gave `p`'s row its id, if one did. */
function insertOf(
  d: Draft,
  p: Extract<Put, { row: unknown }>
): { at: number; put: Extract<Put, { ref: string }> } | undefined {
  if (d.loaded[p.table].has(p.row.id)) return undefined;
  const at = d.put.findIndex(
    (q) => 'ref' in q && q.table === p.table && d.ids.get(q.ref) === p.row.id
  );
  return at < 0 ? undefined : { at, put: d.put[at] as Extract<Put, { ref: string }> };
}

/** The finished change. */
export function changeOf<R>(d: Draft, result: R): Change<R> {
  return { put: d.put, outside: d.outside, result };
}
