// The owner's items as one kind of thing: Clear closes one with no run of its
// own, Delete hides it from the desk and the chat but keeps it restorable, and
// what waits is ordered by what waits on what. The office's own code on every
// migration, in an in-memory PGlite (pglite.ts). Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { asks, followUps, staff, tasks } from '../src/schema.ts';
import { db } from './pglite.ts';

// The ledger rows a decision writes embed nothing: no Ollama answers here.
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const {
  addReport,
  clearItem,
  deleteItem,
  deliveries,
  desk,
  giveTask,
  nextItem,
  openNeeds,
  orderItems,
  raiseAsk,
  restoreItem
} = await import('../src/office.ts');

await db.insert(staff).values({
  id: 'ivy',
  name: 'Ivy',
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Ivy.'
});

const onDesk = async () => {
  const d = await desk();
  return [...d.asks, ...d.tasks, ...d.reports].map((r) => r.title);
};

test('clearing an ask closes it as set aside and starts no run', async () => {
  const { ask } = await raiseAsk('ivy', { title: 'Order the chairs', why: 'w', ifApproved: 'i' });
  assert.equal(await clearItem({ kind: 'ask', id: ask.id }), true);
  const [row] = await db.select().from(asks).where(eq(asks.id, ask.id));
  assert.equal(row.status, 'denied');
  assert.match(row.reason ?? '', /^Set aside by /);
  const runs = await db.select().from(followUps).where(eq(followUps.askId, ask.id));
  assert.equal(runs.length, 0, 'a cleared ask started a run');
  assert.equal(await clearItem({ kind: 'ask', id: ask.id }), false, 'cleared twice');
});

test('clearing a task drops it, and a report is marked read', async () => {
  const t = await giveTask('ivy', { title: 'Sign the lease', why: 'w', steps: ['Sign'] });
  assert.equal(await clearItem({ kind: 'task', id: t.id }), true);
  const [row] = await db.select().from(tasks).where(eq(tasks.id, t.id));
  assert.equal(row.status, 'dropped');
  await addReport('ivy', 'Weekly numbers', 'All fine.');
  const r = (await desk()).reports.find((x) => x.title === 'Weekly numbers')!;
  assert.equal(await clearItem({ kind: 'report', id: r.id }), true);
  assert.ok(!(await onDesk()).includes('Weekly numbers'));
});

test('deleting hides an item from the desk and the chat, and restore brings it back closed', async () => {
  const { ask } = await raiseAsk('ivy', { title: 'Book the van', why: 'w', ifApproved: 'i' });
  const ref = { kind: 'ask' as const, id: ask.id };
  assert.equal(await deleteItem(ref), true);
  assert.ok(!(await onDesk()).includes('Book the van'));
  assert.ok(!(await deliveries('ivy')).some((d) => d.title === 'Book the van'));
  assert.ok((await deliveries('ivy', 200, true)).some((d) => d.title === 'Book the van'));
  assert.equal(await restoreItem(ref), true);
  const back = (await deliveries('ivy')).find((d) => d.title === 'Book the van');
  assert.equal(back?.status, 'denied', 'a restored item opened again');
  assert.equal(await restoreItem(ref), false, 'restored twice');
});

test('an item older than the restore window stays deleted', async () => {
  const { ask } = await raiseAsk('ivy', { title: 'Paint the hall', why: 'w', ifApproved: 'i' });
  await deleteItem({ kind: 'ask', id: ask.id });
  await db
    .update(asks)
    .set({ hiddenAt: new Date(Date.now() - 31 * 86_400_000) })
    .where(eq(asks.id, ask.id));
  assert.equal(await restoreItem({ kind: 'ask', id: ask.id }), false);
});

test('a new item may wait only on an ask or task open now', async () => {
  const { ask } = await raiseAsk('ivy', {
    title: 'Connect the calendar',
    why: 'w',
    ifApproved: 'i'
  });
  assert.deepEqual(await openNeeds([{ kind: 'ask', id: ask.id }]), [{ kind: 'ask', id: ask.id }]);
  assert.equal(typeof (await openNeeds([{ kind: 'ask', id: 99999 }])), 'string');
  await clearItem({ kind: 'ask', id: ask.id });
  assert.equal(typeof (await openNeeds([{ kind: 'ask', id: ask.id }])), 'string');
  const waits = await raiseAsk('ivy', {
    title: 'Hire a scheduler',
    why: 'w',
    ifApproved: 'i',
    needs: [{ kind: 'task', id: 1 }]
  });
  assert.deepEqual(waits.ask.needs, [{ kind: 'task', id: 1 }]);
});

test('what can be done now comes first, then what unblocks most, then the oldest', () => {
  const at = (n: number) => new Date(2026, 0, n);
  const items = [
    { kind: 'ask' as const, id: 1, createdAt: at(1), needs: [{ kind: 'ask' as const, id: 3 }] },
    { kind: 'ask' as const, id: 2, createdAt: at(2) },
    { kind: 'ask' as const, id: 3, createdAt: at(3) },
    { kind: 'task' as const, id: 4, createdAt: at(4), needs: [{ kind: 'ask' as const, id: 3 }] }
  ];
  const order = orderItems(items).map((i) => `${i.kind}:${i.id}`);
  assert.deepEqual(order, ['ask:3', 'ask:2', 'ask:1', 'task:4']);
  assert.equal(nextItem(items)?.id, 3);
  // Waiting on something no longer waiting is no wait at all.
  assert.equal(orderItems([items[0]])[0].blockedBy.length, 0);
});
