// The Odd planning a goal logs progress on it before any plan is approved, so
// nobody serves it yet, and an Odd that neither serves the goal nor leads its
// thread is still refused. Through the real tool server (tool-server.ts). Run
// with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { db, toolServer } from './tool-server.ts';

const { goalProgress, staff, staffGoals, threads } = await import('../src/schema.ts');
const { addGoal } = await import('../src/goals.ts');
const { MANAGER_ROLE } = await import('../src/managers.ts');

const odd = (id: string, name: string, role: string) => ({
  id,
  name,
  role,
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft' as const,
  desk: `You are ${name}.`
});
await db.insert(staff).values([odd('lea', 'Lea', MANAGER_ROLE), odd('ben', 'Ben', 'Bookkeeper')]);

const said = (r: Awaited<ReturnType<Awaited<ReturnType<typeof toolServer>>['callTool']>>) =>
  (r.content as { text: string }[])[0].text;

test('the lead planning a goal logs progress on it, and an Odd with no part in it cannot', async () => {
  const g = await addGoal({
    title: 'Send every invoice within three days of a project ending',
    horizon: 'ongoing',
    area: 'work'
  });
  assert.equal(
    (await db.select().from(staffGoals).where(eq(staffGoals.goalId, g.id))).length,
    0,
    'nobody serves the goal before a plan is approved'
  );
  const [t] = await db.select().from(threads).where(eq(threads.goalId, g.id));
  assert.equal(t?.hubId, 'lea', 'the manager leads the goal thread');

  const note = 'Asked for the client list before planning';
  const lea = await toolServer('lea', { RUN_KEY: 'k-lea' });
  const ok = await lea.callTool({
    name: 'log_progress',
    arguments: { goal_id: g.id, health: 'blocked', note }
  });
  assert.equal(said(ok), `Logged on goal #${g.id}.`);

  const ben = await toolServer('ben', { RUN_KEY: 'k-ben' });
  const no = await ben.callTool({
    name: 'log_progress',
    arguments: { goal_id: g.id, health: 'on_track', note: 'Not mine to say' }
  });
  assert.match(said(no), /neither serve goal #\d+ nor lead its thread/);

  const logged = await db.select().from(goalProgress).where(eq(goalProgress.goalId, g.id));
  assert.deepEqual(
    logged.map((p) => [p.staffId, p.note]),
    [['lea', note]]
  );
});
