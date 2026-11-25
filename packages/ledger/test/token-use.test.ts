// What the owner sees of token use: each Odd's latest runs, named by what
// they were for, and every Odd ranked over a day and a week. The office's own
// code on every migration, in an in-memory PGlite that stands in for db.ts
// (pglite.ts). Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { staff, usage } from '../src/schema.ts';
import { db, sql } from './pglite.ts';

const { recentRuns, officeUsage, recordUsage } = await import('../src/office-usage.ts');

const OPUS = 'claude-opus-5-5';
const HAIKU = 'claude-haiku-5-5';
/** One model's counts, as a run reports them: `read` from the cache, 10 more in and out. */
const used = (read: number) => ({
  inputTokens: 5,
  outputTokens: 5,
  cacheReadInputTokens: read,
  cacheCreationInputTokens: 0
});
const person = (id: string, name: string) => ({
  id,
  name,
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  desk: `You are ${name}.`
});
await db.insert(staff).values([person('ada', 'Ada'), person('bo', 'Bo'), person('cy', 'Cy')]);

/** Moves the rows kept last back in time, so each run has its own moment. */
const backdate = (hours: number) =>
  sql`update usage set created_at = now() - make_interval(hours => ${hours})
      where id = (select max(id) from usage)`;

beforeEach(async () => {
  await db.delete(usage);
});

test("an Odd's recent runs come newest first, one line per run whatever its models, named by what it was for", async () => {
  await recordUsage('ada', 'job', { [OPUS]: used(1000) }, undefined, 'Daily calendar brief');
  await backdate(3);
  // A run on two models keeps two rows at one moment: one run.
  await recordUsage(
    'ada',
    'follow-up',
    { [OPUS]: used(500), [HAIKU]: used(90) },
    undefined,
    'Book the flights'
  );
  await sql`update usage set created_at = now() - interval '2 hours' where label = 'Book the flights'`;
  await recordUsage('ada', 'chat', { [OPUS]: used(40_000) });
  await recordUsage('bo', 'chat', { [OPUS]: used(7) });
  const runs = await recentRuns('ada');
  assert.deepEqual(
    runs.map((r) => [r.kind, r.label, r.tokens]),
    [
      ['chat', null, 40_010],
      ['follow-up', 'Book the flights', 610],
      ['job', 'Daily calendar brief', 1010]
    ]
  );
  assert.equal((await recentRuns('ada', 2)).length, 2);
});

test('every Odd is ranked by its tokens over a day and a week, the office itself and an Odd that left included', async () => {
  // A run is its rows' one moment, so Ada's two runs get a moment each: two
  // calls in a row can share one on a fast runner (#312).
  await recordUsage('ada', 'job', { [OPUS]: used(100) });
  await backdate(1);
  await recordUsage('ada', 'job', { [OPUS]: used(100) });
  await recordUsage('bo', 'chat', { [OPUS]: used(5000) });
  await recordUsage(null, 'look', { [OPUS]: used(300) });
  // Cy's run was two days ago: in the week, not the day.
  await recordUsage('cy', 'chat', { [OPUS]: used(9000) });
  await backdate(48);
  await db.update(staff).set({ leftAt: new Date() }).where(eq(staff.id, 'cy'));
  const { d1, d7 } = await officeUsage();
  assert.deepEqual(
    d1.map((r) => [r.name, r.tokens]),
    [
      ['Bo', 5010],
      [null, 310],
      ['Ada', 220]
    ]
  );
  assert.deepEqual(
    d7.map((r) => r.name),
    ['Cy', 'Bo', null, 'Ada']
  );
  assert.equal(d1.find((r) => r.staffId === 'ada')?.runs, 2);
});
