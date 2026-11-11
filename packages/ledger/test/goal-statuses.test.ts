// Which goals count as live, held to GOAL_IS_LIVE: the threads a lead's chat
// is told of (`ledStories`), and the goals `my_goals` lists, through the real
// tool server (tool-server.ts). Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db, toolServer } from './tool-server.ts';

const { GOAL_STATUSES, goals, staff, staffGoals, threads } = await import('../src/schema.ts');
const { GOAL_IS_LIVE } = await import('../src/goal-words.ts');
const { ledStories } = await import('../src/lead-brief.ts');
const { MANAGER_ROLE } = await import('../src/managers.ts');

// Lea manages the office, so she leads each goal's thread: one goal in each status.
await db.insert(staff).values({
  id: 'lea',
  name: 'Lea',
  role: MANAGER_ROLE,
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Lea.'
});
for (const status of GOAL_STATUSES) {
  const [g] = await db
    .insert(goals)
    .values({ title: `The ${status} goal`, status })
    .returning();
  await db.insert(staffGoals).values({ staffId: 'lea', goalId: g.id, part: 'All of it' });
  await db.insert(threads).values({ title: g.title, goalId: g.id, hubId: 'lea', holderId: 'lea' });
}
const live = GOAL_STATUSES.filter((s) => GOAL_IS_LIVE[s]).map((s) => `The ${s} goal`);

test('the goals a lead brief and my_goals count as live are exactly those GOAL_IS_LIVE marks', async () => {
  const told = (await ledStories('lea', 'chat')).map((s) => s.thread.title);
  assert.deepEqual(told.sort(), [...live].sort(), "a lead's chat");

  const c = await toolServer('lea', { RUN_KEY: 'k-lea' });
  const r = await c.callTool({ name: 'my_goals', arguments: {} });
  const listed = [...(r.content as { text: string }[])[0].text.matchAll(/^## Goal #\d+: (.*)$/gm)];
  assert.deepEqual(listed.map((m) => m[1]).sort(), [...live].sort(), 'my_goals');
});
