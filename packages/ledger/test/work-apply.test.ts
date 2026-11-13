// The work core's database side: the loader reads what a decider needs under
// its locks, and `applyWork` writes a change so the rows read back equal the
// rows `applyChange` gives in memory. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { eq, sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Level } from '../src/access-words.ts';
import {
  asks,
  attachments,
  followUps,
  goals,
  jobs,
  owner,
  pokes,
  reports,
  staff,
  tasks,
  threads,
  type HandOff
} from '../src/schema.ts';
import { random } from '../src/sequences.ts';
import type { Tx } from '../src/threads.ts';
import type { Decided } from '../src/transition.ts';
import { decide } from '../src/work/decide.ts';
import type { WorkEvent } from '../src/work/events.ts';
import { applyChange, type Change, type Odd, type WorkRows } from '../src/work/snapshot.ts';
import { parseAsk, parseFollowUp, parseTask, parseThread } from '../src/work/state.ts';
import { newRun } from '../src/work/threads.ts';
import { db } from './pglite.ts';

// Nothing answers here, so a ledger line is written with no embedding.
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { LOCK_ORDER, transition } = await import('../src/transition.ts');
const { loadWork, queuedRows } = await import('../src/work/load.ts');
const { applyWork } = await import('../src/work/apply.ts');
// The office's own handle, which is PGlite's here, so a transaction has the type the core takes.
const { db: officeDb } = await import('../src/db.ts');

/** Sequences per run; `WORK_APPLY_SEEDS` runs more. Sized so the file stays well under 5 seconds. */
const SEEDS = Number(process.env.WORK_APPLY_SEEDS ?? 2);
const LENGTH = 30;
const T0 = new Date('2026-11-12T09:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const OWNER = 'Sam';

const ODDS: Odd[] = [
  { id: 'lia', name: 'Lia', level: 'act', leftAt: null },
  { id: 'cal', name: 'Cal', level: 'draft', leftAt: null },
  { id: 'rae', name: 'Rae', level: 'read', leftAt: null },
  { id: 'gus', name: 'Gus', level: 'act', leftAt: minutes(-60) }
].map((o) => ({ ...o, level: o.level as Level, agent: 'claude', manager: false }));

const handOff = (from: string, more: Partial<HandOff> = {}): HandOff => ({
  from,
  title: `Work from ${from}`,
  brief: 'Do it.',
  ...more
});

/**
 * One office with a run in each state the runs family decides: queued and
 * running pick-ups, a colleague's hand-off with an open ask on it, a result
 * from one that left, a thread parked on an open task, a running pick-up
 * whose lifted task ended meanwhile, and work whose lead left.
 */
async function seedOffice(): Promise<void> {
  await db.execute(
    sql`truncate staff, threads, follow_ups, asks, tasks, reports, pokes, goals, attachments, jobs, ledger, owner restart identity cascade`
  );
  await db.insert(owner).values({ name: OWNER });
  await db.insert(staff).values(
    ODDS.map((o) => ({
      id: o.id,
      name: o.name,
      role: 'r',
      variant: 'v',
      portrait: 'p',
      remit: 'r',
      desk: 'd',
      agent: o.agent,
      permission: o.level,
      leftAt: o.leftAt
    }))
  );
  const task = { why: 'w', steps: [], createdAt: T0 };
  // 1: open, the park of thread 1. 2: done while run 2 ran, which lifted it.
  await db.insert(tasks).values([
    { ...task, staffId: 'lia', title: 'Sign the form' },
    { ...task, staffId: 'lia', title: 'Read the draft', status: 'done', doneAt: minutes(-5) }
  ]);
  const thread = (hubId: string, title: string) => ({
    hubId,
    holderId: hubId,
    title,
    createdAt: T0
  });
  await db
    .insert(threads)
    .values([
      { ...thread('lia', 'Parked work'), resumeOnTask: 1 },
      { ...thread('lia', 'Results coming back') },
      { ...thread('gus', 'Work its lead left'), status: 'stopped', endedAt: minutes(-60) },
      { ...thread('lia', 'Colleagues at work') },
      { ...thread('lia', 'A run goes here'), runs: ['k1'] },
      { ...thread('lia', 'Parked on the ended task'), resumeOnTask: 2 }
    ]);
  // Asks before runs, which point at them; an ask names its hand-off with no key.
  const ask = { why: 'w', ifApproved: 'i', createdAt: T0, threadId: 4 };
  await db.insert(asks).values([
    { ...ask, staffId: 'cal', title: 'May I?', handOffId: 6 },
    {
      ...ask,
      staffId: 'cal',
      title: 'Approved one',
      handOffId: 8,
      status: 'approved',
      decidedAt: minutes(-2)
    }
  ]);
  const run = { createdAt: T0 };
  const started = { startedAt: minutes(-10) };
  await db.insert(followUps).values([
    { ...run, staffId: 'lia', kind: 'resume', threadId: 1 },
    {
      ...run,
      ...started,
      staffId: 'lia',
      kind: 'handed_back',
      threadId: 2,
      unparkedTask: 2,
      handOff: handOff('cal', { outcome: 'done', id: 3 })
    },
    {
      ...run,
      ...started,
      staffId: 'cal',
      kind: 'hand_off',
      threadId: 2,
      handOff: handOff('lia'),
      outcome: 'done',
      result: 'Done.',
      doneAt: minutes(-20)
    },
    {
      ...run,
      staffId: 'lia',
      kind: 'handed_back',
      threadId: 2,
      handOff: handOff('rae', { outcome: 'done' })
    },
    {
      ...run,
      staffId: 'lia',
      kind: 'handed_back',
      threadId: 2,
      handOff: handOff('cal', { outcome: 'failed' })
    },
    { ...run, ...started, staffId: 'cal', kind: 'hand_off', threadId: 4, handOff: handOff('lia') },
    { ...run, staffId: 'rae', kind: 'hand_off', threadId: 4, handOff: handOff('lia') },
    { ...run, staffId: 'cal', kind: 'hand_off', threadId: 4, handOff: handOff('lia') },
    { ...run, staffId: 'cal', kind: 'carry_out', threadId: 4, askId: 2 },
    {
      ...run,
      ...started,
      staffId: 'gus',
      kind: 'handed_back',
      threadId: 3,
      handOff: handOff('cal', { outcome: 'done' })
    },
    { ...run, ...started, staffId: 'rae', kind: 'hand_off', threadId: 3, handOff: handOff('gus') },
    { ...run, staffId: 'lia', kind: 'resume', threadId: 5 },
    { ...run, staffId: 'cal', kind: 'answered', reportWhenDone: true },
    {
      ...run,
      staffId: 'rae',
      kind: 'task_done',
      taskId: 2,
      outcome: 'failed',
      result: 'Rae left.',
      doneAt: minutes(-30)
    }
  ]);
}

/** Every row of the four tables, as states. */
async function readRows(): Promise<Pick<WorkRows, 'threads' | 'followUps' | 'asks' | 'tasks'>> {
  const byId = <T extends { id: number }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  return {
    threads: byId((await db.select().from(threads)).map(parseThread)),
    followUps: byId((await db.select().from(followUps)).map(parseFollowUp)),
    asks: byId((await db.select().from(asks)).map(parseAsk)),
    tasks: byId((await db.select().from(tasks)).map(parseTask))
  };
}

/** The whole office in memory, as a loader that read everything would give it. */
async function readWorld(): Promise<WorkRows> {
  return {
    ...(await readRows()),
    staff: new Map(ODDS.map((o) => [o.id, o])),
    window: null,
    runsGoing: new Set(),
    owner: OWNER,
    prepared: {}
  };
}

/** One event through the shell, on the office's database, with the core's own loader and writer. */
async function run(e: WorkEvent, now: Date): Promise<Decided<Change>> {
  return officeDb.transaction((tx) =>
    transition(
      {
        name: e.kind,
        load: (q: Tx) => loadWork(q, e),
        decide: (rows: WorkRows, at: Date) => decide(rows, e, at),
        apply: applyWork
      },
      // The shell hands the after-effects back unrun: the deciders' own tests hold them.
      { tx, now }
    )
  );
}

/** Every event the runs family takes now, from the rows in memory and each claim's joined results. */
function offered(w: WorkRows, joined: Map<number, number[]>): WorkEvent[] {
  const events: WorkEvent[] = [
    {
      kind: 'runQueued',
      run: { staffId: 'lia', kind: 'resume', note: 'Go on.', threadId: 2 },
      onlyWhileOpen: true
    },
    {
      kind: 'runQueued',
      run: { staffId: 'gus', kind: 'resume', note: 'Go on.', threadId: 3 },
      onlyWhileOpen: true
    },
    { kind: 'runQueued', run: { staffId: 'cal', kind: 'carry_out', note: null, askId: 2 } },
    { kind: 'runQueued', run: { staffId: 'lia', kind: 'task_done', note: null, taskId: 1 } },
    { kind: 'runQueued', run: { staffId: 'rae', kind: 'edited', note: null } }
  ];
  for (const id of w.followUps.keys()) {
    events.push({ kind: 'runClaimed', id }, { kind: 'staleRunsClosed', id, about: 'the work' });
    for (const outcome of ['done', 'failed', 'waiting'] as const)
      events.push({
        kind: 'runFinished',
        id,
        about: 'the work',
        ended: { outcome, result: `Ran: ${outcome}`, joined: joined.get(id) ?? [] }
      });
  }
  return events;
}

type Written = {
  reports: { staffId: string; title: string; body: string }[];
  pokes: { staffId: string; message: string }[];
};

/** The reports and pokes written after the given ids. */
async function writtenAfter(last: { report: number; poke: number }): Promise<Written> {
  const r = await db.select().from(reports).orderBy(reports.id);
  const p = await db.select().from(pokes).orderBy(pokes.id);
  return {
    reports: r
      .filter((x) => x.id > last.report)
      .map(({ staffId, title, body }) => ({ staffId, title, body })),
    pokes: p.filter((x) => x.id > last.poke).map(({ staffId, message }) => ({ staffId, message }))
  };
}

function outsideOf(change: Change): Written {
  return {
    reports: change.outside.flatMap((o) =>
      o.kind === 'report' ? [{ staffId: o.staffId, title: o.title, body: o.body }] : []
    ),
    pokes: change.outside.flatMap((o) =>
      o.kind === 'poke' ? [{ staffId: o.staffId, message: o.message }] : []
    )
  };
}

test('every runs event decides on the loaded rows as on the whole office, and writes the rows applyChange gives', async () => {
  let events = 0;
  let changes = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    const rnd = random(seed);
    await seedOffice();
    let world = await readWorld();
    const joined = new Map<number, number[]>();
    let last = { report: 0, poke: 0 };
    for (let n = 1; n <= LENGTH; n++) {
      const choices = offered(world, joined);
      const e = choices[Math.floor(rnd() * choices.length)];
      const at = `seed ${seed}, event ${n}: ${JSON.stringify(e)}`;
      const now = minutes(n);
      const expected = decide(world, e, now);
      const got = await run(e, now);
      assert.deepStrictEqual(
        got,
        expected,
        `the loaded rows decide as the whole office does, ${at}`
      );
      events++;
      if (!('change' in expected)) continue;
      changes++;
      world = applyChange(world, expected.change);
      if (e.kind === 'runClaimed' && 'change' in got)
        joined.set(
          e.id,
          (got.change.result as { joined: { id: number }[] }).joined.map((g) => g.id)
        );
      const rows = await readRows();
      for (const table of ['threads', 'followUps', 'asks', 'tasks'] as const)
        assert.deepStrictEqual(rows[table], world[table], `${table} read back as in memory, ${at}`);
      const written = await writtenAfter(last);
      assert.deepStrictEqual(written, outsideOf(expected.change), `reports and pokes, ${at}`);
      last = {
        report: last.report + written.reports.length,
        poke: last.poke + written.pokes.length
      };
    }
  }
  // A run that changed nothing would check nothing.
  assert.ok(changes > SEEDS * 4, `${changes} of ${events} events changed rows`);
});

test('new rows written together point at each other and at an effect id by ref, as in memory', async () => {
  await seedOffice();
  const world = await readWorld();
  let goalId = 0;
  const change: Change = {
    put: [
      {
        table: 'threads',
        ref: 'work',
        insert: {
          hubId: 'lia',
          holderId: 'lia',
          title: 'New work',
          goalId: null,
          handOffsUsed: 0,
          runs: [],
          createdAt: T0,
          status: 'open',
          park: { on: 'none' }
        },
        points: { goalId: 'goal' }
      },
      {
        table: 'asks',
        ref: 'asked',
        insert: {
          ...[...world.asks.values()][0],
          status: 'open',
          title: 'Raised on the new work',
          threadId: null,
          handOffId: null
        },
        points: { threadId: 'work' }
      },
      {
        table: 'followUps',
        ref: 'run',
        insert: newRun({ staffId: 'lia', kind: 'resume' }, T0),
        points: { threadId: 'work', askId: 'asked', goalId: 'goal' }
      }
    ],
    outside: [
      {
        kind: 'perKind',
        effect: {
          name: 'goal',
          run: async (tx) => {
            const [g] = await tx
              .insert(goals)
              .values({ title: 'A goal' })
              .returning({ id: goals.id });
            goalId = g.id;
            return g;
          }
        }
      },
      { kind: 'attachments', staffId: 'lia', paths: ['notes/a.md'], to: { ask: 'asked' } }
    ],
    result: null
  };
  await officeDb.transaction((tx) => applyWork(tx, change));

  const expected = applyChange(world, change);
  // In memory the effect's id is made up as -1; the database gave the real one.
  for (const t of expected.threads.values()) if (t.goalId === -1) t.goalId = goalId;
  for (const f of expected.followUps.values()) if (f.goalId === -1) f.goalId = goalId;
  const rows = await readRows();
  for (const table of ['threads', 'followUps', 'asks', 'tasks'] as const)
    assert.deepStrictEqual(rows[table], expected[table], table);
  const newAsk = Math.max(...expected.asks.keys());
  const files = await db.select().from(attachments);
  assert.deepStrictEqual(
    files.map(({ staffId, path, askId, taskId }) => ({ staffId, path, askId, taskId })),
    [{ staffId: 'lia', path: 'notes/a.md', askId: newAsk, taskId: null }]
  );
});

test('a change that cannot be written leaves nothing behind, its effect included', async () => {
  await seedOffice();
  const before = await readRows();
  const change: Change = {
    put: [
      { table: 'threads', row: { ...before.threads.get(2)!, title: 'Renamed' } },
      {
        table: 'followUps',
        ref: 'run',
        insert: newRun({ staffId: 'lia', kind: 'resume' }, T0),
        points: { askId: 'no such ref' }
      }
    ],
    outside: [
      {
        kind: 'perKind',
        effect: {
          name: 'goal',
          run: async (tx) => {
            await tx.insert(goals).values({ title: 'A goal' });
          }
        }
      }
    ],
    result: null
  };
  await assert.rejects(
    officeDb.transaction((tx) => applyWork(tx, change)),
    /points at a ref no earlier put made/
  );
  assert.deepStrictEqual(await readRows(), before);
  assert.deepStrictEqual(await db.select().from(goals), []);
});

test('an Odd that leaves has its jobs off and its waiting pokes cancelled, and coming back turns the same jobs on', async () => {
  await seedOffice();
  const schedule = { every: 'day', at: '09:00' } as const;
  const job = { staffId: 'lia', instructions: 'i', schedule };
  await db.insert(jobs).values([
    { ...job, name: 'On' },
    { ...job, name: 'Off already', enabled: false }
  ]);
  await db.insert(pokes).values({ staffId: 'lia', at: minutes(30), message: 'Later.' });
  const at = minutes(1);
  const apply = (outside: Change['outside']) =>
    officeDb.transaction((tx) => applyWork(tx, { put: [], outside, result: null }));

  await apply([
    { kind: 'leave', staffId: 'lia', at },
    { kind: 'cancelPokes', staffId: 'lia' }
  ]);
  const [left] = await db.select().from(staff).where(eq(staff.id, 'lia'));
  assert.deepStrictEqual(
    { leftAt: left.leftAt, jobsOff: left.jobsOff },
    { leftAt: at, jobsOff: [1] }
  );
  assert.deepStrictEqual(
    (await db.select().from(jobs).orderBy(jobs.id)).map((j) => j.enabled),
    [false, false]
  );
  assert.deepStrictEqual(
    (await db.select().from(pokes)).map((p) => p.status),
    ['cancelled']
  );

  await apply([{ kind: 'comeBack', staffId: 'lia' }]);
  const [back] = await db.select().from(staff).where(eq(staff.id, 'lia'));
  assert.deepStrictEqual(
    { leftAt: back.leftAt, jobsOff: back.jobsOff },
    { leftAt: null, jobsOff: null }
  );
  const after = await db.select().from(jobs).orderBy(jobs.id);
  assert.deepStrictEqual(
    after.map((j) => j.enabled),
    [true, false]
  );
  assert.ok(after[0].nextRunAt, 'the job turned back on has its next run');
});

test('a run that failed before it started, or of a retired kind, is not queued', async () => {
  await seedOffice();
  // The column's type lists only the live kinds, so a retired row goes in as plain SQL.
  await db.execute(
    sql`insert into follow_ups (staff_id, kind, created_at) values ('lia', 'feedback', now())`
  );
  const queued = await db.select({ id: followUps.id }).from(followUps).where(queuedRows);
  const world = await readWorld();
  const expected = [...world.followUps.values()]
    .filter((f) => f.run.is === 'queued')
    .map((f) => ({ id: f.id }));
  assert.deepStrictEqual(queued, expected);
  // The office holds both kinds of row the test is about.
  const failed = world.followUps.get(14)?.run;
  assert.ok(failed?.is === 'ended' && failed.startedAt === null);
  assert.ok([...world.followUps.values()].some((f) => f.kind === 'feedback'));
});

test('every runs loader takes its locks in the one table order', async () => {
  await seedOffice();
  const dialect = new PgDialect();
  const events: WorkEvent[] = [
    {
      kind: 'runQueued',
      // An ask on work with asks, and a task: this one locks every table it can.
      run: { staffId: 'cal', kind: 'carry_out', note: null, askId: 2, taskId: 1, threadId: 1 }
    },
    { kind: 'runClaimed', id: 1 },
    {
      kind: 'runFinished',
      id: 2,
      about: 'the work',
      ended: { outcome: 'failed', result: 'r', joined: [4, 5] }
    },
    { kind: 'staleRunsClosed', id: 6, about: 'the work' }
  ];
  const every = new Set<string>();
  for (const e of events) {
    const locked: string[] = [];
    await officeDb.transaction(async (tx) => {
      const execute = tx.execute.bind(tx);
      mock.method(tx, 'execute', (query: SQL) => {
        const text = dialect.sqlToQuery(query).sql;
        const table = /from "(\w+)" .* for (update|share)$/.exec(text);
        if (table) locked.push(table[1]);
        return execute(query);
      });
      await loadWork(tx, e);
    });
    const order = locked.map((t) => LOCK_ORDER.indexOf(t as (typeof LOCK_ORDER)[number]));
    for (const t of locked) every.add(t);
    assert.ok(!order.includes(-1), `${e.kind} locked ${locked.join(', ')}`);
    assert.deepStrictEqual(
      order,
      order.toSorted((a, b) => a - b),
      `${e.kind} locked ${locked.join(', ')}`
    );
  }
  // Each table a runs decider reads was locked, so no lock was left out or went unchecked.
  assert.deepStrictEqual(
    [...every].sort(),
    LOCK_ORDER.filter((t) => t !== 'plan_limits').toSorted()
  );
});
