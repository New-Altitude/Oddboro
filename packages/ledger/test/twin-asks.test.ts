// Two runs of one Odd that each find the same tool missing raise two asks
// for it (a hire's first day and its lead's first hand-off start together).
// The owner sees the first alone, and their answer answers both, each going
// back where it came from, and one run per place does the work. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { asks, followUps, staff, tasks, threads } from '../src/schema.ts';
import { db } from './pglite.ts';

// The ledger rows a decision writes embed nothing: no Ollama answers here.
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { decideAsk, desk, finishTask, raiseAsk, standsFor } = await import('../src/office.ts');

await db.insert(staff).values({
  id: 'paige',
  name: 'Paige',
  role: 'Mail clerk',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'act',
  desk: 'You are Paige.'
});

const askFor = (connector: string, level: 'read' | 'act' = 'read') =>
  raiseAsk('paige', {
    title: `Connect ${connector} (${level})`,
    why: 'w',
    ifApproved: 'i',
    access: { connector, level }
  }).then((r) => r.ask);
const shown = async () => (await desk()).asks.map((a) => a.id);
const row = async (id: number) => (await db.select().from(asks).where(eq(asks.id, id)))[0];
const carryOuts = async () =>
  (await db.select().from(followUps).where(eq(followUps.kind, 'carry_out'))).map((f) => f.askId);

test('the owner sees the first of two asks for the same tool, and a yes answers both after one connect task', async () => {
  const first = await askFor('gmail');
  const twin = await askFor('gmail');
  assert.ok((await shown()).includes(first.id));
  assert.ok(!(await shown()).includes(twin.id), 'the twin waits behind the first');

  await decideAsk(first.id, 'approve', null);
  const answered = await row(twin.id);
  assert.equal(answered.status, 'approved');
  assert.deepEqual(answered.decidedAt, (await row(first.id)).decidedAt);

  const connect = await db.select().from(tasks).where(eq(tasks.staffId, 'paige'));
  assert.equal(connect.length, 1, 'one connect task, not two');
  await finishTask(connect[0].id, true, null);
  assert.deepEqual(await carryOuts(), [first.id], 'one run does the work, not one per ask');
});

test('one answer starts one run per place a result goes back to: the hand-off twin carries it out, not the plain one', async () => {
  await db.delete(followUps);
  const plain = await askFor('google-drive');
  const onHandOff = await raiseAsk('paige', {
    title: 'Connect google-drive (read)',
    why: 'w',
    ifApproved: 'i',
    access: { connector: 'google-drive', level: 'read' },
    handOffId: 41
  }).then((r) => r.ask);
  await decideAsk(plain.id, 'approve', null);
  const [connect] = await db.select().from(tasks).where(eq(tasks.askId, plain.id));
  await finishTask(connect.id, true, null);
  assert.deepEqual(await carryOuts(), [onHandOff.id], 'the hand-off twin carries it out');
  assert.deepEqual(
    (await standsFor((await row(onHandOff.id))!)).map((a) => a.id),
    [plain.id],
    'and is told it stands for the plain one'
  );
  assert.deepEqual(await standsFor((await row(plain.id))!), []);
});

test('a no answers both, and only the first starts a run to read why', async () => {
  const first = await askFor('google-drive');
  const twin = await askFor('google-drive');
  await decideAsk(first.id, 'deny', 'Not Drive yet.');
  assert.equal((await row(twin.id)).status, 'denied');
  const denied = await db.select().from(followUps).where(eq(followUps.kind, 'denied'));
  assert.deepEqual(
    denied.map((f) => f.askId),
    [first.id]
  );
  // The denied run tells the Odd the no for both: neither ask, on no work, wakes it again.
  const answered = await db.select().from(followUps).where(eq(followUps.kind, 'answered'));
  assert.deepEqual(
    answered.filter((f) => f.askId === first.id || f.askId === twin.id),
    []
  );
});

test('a no to a folder ask answers its twin on a thread, and that thread hears it', async () => {
  const [work] = await db
    .insert(threads)
    .values({ title: 'Sort the notes', hubId: 'paige', holderId: 'paige' })
    .returning();
  const folder = { path: '/tmp/twin-asks-folder', level: 'read' as const };
  const ask = {
    kind: 'folder' as const,
    title: 'Read the notes folder',
    why: 'w',
    ifApproved: 'i',
    folder
  };
  const { ask: first } = await raiseAsk('paige', ask);
  const { ask: twin } = await raiseAsk('paige', { ...ask, threadId: work.id });
  await decideAsk(first.id, 'deny', null);
  assert.equal((await row(twin.id)).status, 'denied');
  assert.ok(!(await shown()).includes(twin.id), 'the twin does not come back on the desk');
  const onThread = await db.select().from(followUps).where(eq(followUps.threadId, work.id));
  assert.deepEqual(
    onThread.map((f) => f.askId),
    [twin.id]
  );
});

test('an ask for more than the first is no twin: both show, and an answer to the bigger one answers the smaller', async () => {
  const read = await askFor('notes', 'read');
  const write = await askFor('notes', 'act');
  const now = await shown();
  assert.ok(now.includes(read.id) && now.includes(write.id));
  await decideAsk(write.id, 'deny', null);
  assert.equal((await row(read.id)).status, 'denied');
});

test('sending one back leaves its twin waiting', async () => {
  const first = await askFor('calendar');
  const twin = await askFor('calendar');
  await decideAsk(first.id, 'iterate', 'Say which calendar.');
  assert.equal((await row(twin.id)).status, 'open');
  assert.ok((await shown()).includes(twin.id), 'with the first sent back, the twin shows');
});
