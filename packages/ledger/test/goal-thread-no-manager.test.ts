// An office with no manager yet: a goal's one thread is led by the Odd that
// opened it, and another Odd's hand-off for the goal finds that thread, which
// it does not lead, so it is refused rather than opening a second.
// In an in-memory PGlite that stands in for db.ts (pglite.ts). Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { goals, staff, threads } from '../src/schema.ts';
import { db, sql } from './pglite.ts';
import { oneThreadPerGoal } from './one-thread.ts';

const { handOff } = await import('../src/hand-offs.ts');
const { MANAGER_ROLE } = await import('../src/managers.ts');

const odd = (id: string, name: string) => ({
  id,
  name,
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft' as const,
  desk: `You are ${name}.`
});
await db.insert(staff).values([odd('ada', 'Ada'), odd('bo', 'Bo')]);
afterEach(() => oneThreadPerGoal(sql, MANAGER_ROLE));

/** `from` hands `to` a piece of the goal's work. */
const forGoal = (from: string, to: string, goalId: number) =>
  handOff({
    from,
    to,
    work: { title: 'Water the beds', brief: 'Water them.' },
    thread: { title: 'Water the beds', goalId }
  });

test("with no manager, the Odd that opened a goal's thread leads it, and another's hand-off for the goal opens no second one", async () => {
  const [g] = await db.insert(goals).values({ title: 'Grow tomatoes' }).returning();
  const first = await forGoal('ada', 'bo', g.id);
  assert.ok('id' in first, JSON.stringify(first));
  const second = await forGoal('bo', 'ada', g.id);
  assert.ok(
    'problem' in second && /not work you lead/.test(second.problem),
    JSON.stringify(second)
  );
  const rows = await db.select().from(threads).where(eq(threads.goalId, g.id));
  assert.deepEqual(
    rows.map((t) => [t.id, t.hubId]),
    [[first.thread, 'ada']]
  );
});
