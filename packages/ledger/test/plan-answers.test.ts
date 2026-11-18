// A plan's yes: its hire asks, job changes and owner task commit with the answer,
// or none of them do. Run with `npm test -w @oddboro/ledger`.
import { aGoal, markNow, reached } from './desk-answers-setup.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { asks, jobs } from '../src/schema.ts';
import { db } from './pglite.ts';

const { ask: askRow, raiseAsk } = await import('../src/office.ts');
const { approvePlan } = await import('../src/goals.ts');

test("a plan yes's hire asks, job changes and owner task commit with its answer, so one that fails leaves the plan open and wakes nobody", async () => {
  const goalId = await aGoal('Sell flour');
  // Two jobs of one name, as an Odd can have until the owner renames one, so changing it fails.
  const weigh = {
    staffId: 'ivy',
    name: 'Weigh flour',
    instructions: 'Weigh it.',
    schedule: { every: 'day', at: '09:00' } as const
  };
  await db.insert(jobs).values([weigh, weigh]);
  const { ask } = await raiseAsk('ada', {
    title: 'Plan the flour sale',
    why: 'w',
    ifApproved: 'i',
    kind: 'plan',
    plan: {
      goalId,
      items: [
        {
          kind: 'hire',
          hire: {
            name: 'Bo',
            role: 'Baker',
            permission: 'draft',
            remit: 'Bakes.',
            jobDescriptionFile: 'baker.md'
          },
          part: 'Bakes the samples'
        },
        {
          kind: 'assign',
          staff: 'ivy',
          part: 'Weighs it',
          editJob: { name: weigh.name, instructions: 'Weigh it twice.' }
        }
      ],
      ownerSteps: ['Buy the sacks']
    }
  });
  const mark = await markNow();
  await assert.rejects(approvePlan(ask.id, [0, 1], null), /Two jobs have that name/);
  assert.equal((await askRow(ask.id))?.status, 'open');
  assert.deepEqual(await reached(mark), []);
  const hires = await db.select().from(asks).where(eq(asks.kind, 'hire'));
  assert.deepEqual(
    hires.filter((h) => h.hire?.goal?.id === goalId),
    []
  );
});

// The lead's run reads the plan's hire asks, so they are written in the yes's
// transaction, before that run is queued. The other test fails the plan on a job
// change, which the yes's transaction makes before any hire ask.
test('a plan yes whose hire ask cannot be written leaves the plan open, writes no hire ask and queues no run for its lead', async () => {
  const goalId = await aGoal('Sell rye');
  const { ask } = await raiseAsk('ada', {
    title: 'Plan the rye sale',
    why: 'w',
    ifApproved: 'i',
    kind: 'plan',
    plan: {
      goalId,
      items: [
        {
          kind: 'hire',
          hire: {
            name: 'Cy',
            role: 'Baker',
            permission: 'draft',
            remit: 'Bakes.',
            jobDescriptionFile: 'baker.md'
          },
          part: 'Bakes the loaves'
        }
      ]
    }
  });
  await db.execute(
    sql.raw(
      `create function refuse_hire() returns trigger as $$ begin if new.kind = 'hire' then raise exception 'hire refused'; end if; return new; end $$ language plpgsql`
    )
  );
  await db.execute(
    sql.raw(
      'create trigger refuse_hire before insert on asks for each row execute function refuse_hire()'
    )
  );
  const mark = await markNow();
  try {
    await assert.rejects(approvePlan(ask.id, [0], null), /Failed query: insert into "asks"/);
  } finally {
    await db.execute(sql.raw('drop trigger refuse_hire on asks'));
    await db.execute(sql.raw('drop function refuse_hire()'));
  }
  assert.equal((await askRow(ask.id))?.status, 'open');
  assert.deepEqual(await reached(mark), []);
  const hires = await db.select().from(asks).where(eq(asks.kind, 'hire'));
  assert.deepEqual(
    hires.filter((h) => h.hire?.goal?.id === goalId),
    []
  );
});

// A transition in its own transaction runs again when Postgres ends it to
// break a deadlock. The plan's write keeps the hire asks it raised in memory,
// so a second run must not hand back the first run's, which rolled back.
test('a plan yes that Postgres ends once to break a deadlock gives back only the hire asks it wrote', async () => {
  const goalId = await aGoal('Sell spelt');
  const hire = (name: string) => ({
    kind: 'hire' as const,
    hire: {
      name,
      role: 'Baker',
      permission: 'draft' as const,
      remit: 'Bakes.',
      jobDescriptionFile: 'baker.md'
    },
    part: 'Bakes the loaves'
  });
  const { ask } = await raiseAsk('ada', {
    title: 'Plan the spelt sale',
    why: 'w',
    ifApproved: 'i',
    kind: 'plan',
    plan: { goalId, items: [hire('Dot'), hire('Eli')] }
  });
  // A sequence is not rolled back, so only the first run is ended.
  const run = async (statements: string[]) => {
    for (const statement of statements) await db.execute(sql.raw(statement));
  };
  await run([
    'create sequence deadlock_once',
    `create function deadlock_once() returns trigger as $$ begin if old.kind = 'plan' and new.status <> 'open' and nextval('deadlock_once') = 1 then raise exception 'deadlock detected' using errcode = 'deadlock_detected'; end if; return new; end $$ language plpgsql`,
    'create trigger deadlock_once before update on asks for each row execute function deadlock_once()'
  ]);
  let given: number[];
  try {
    given = (await approvePlan(ask.id, [0, 1], null)).hires.map((h) => h.id);
  } finally {
    await run([
      'drop trigger deadlock_once on asks',
      'drop function deadlock_once()',
      'drop sequence deadlock_once'
    ]);
  }
  assert.equal((await askRow(ask.id))?.status, 'approved');
  const written = (await db.select().from(asks).where(eq(asks.kind, 'hire')))
    .filter((h) => h.hire?.goal?.id === goalId)
    .map((h) => h.id);
  assert.equal(written.length, 2);
  assert.deepEqual(given, written);
});
