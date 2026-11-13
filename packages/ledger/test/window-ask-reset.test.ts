// The usage window's ask leaves the desk at the window's reset, even when the
// work it held was stopped before then: the office's own code on every
// migration, in an in-memory PGlite that stands in for db.ts (pglite.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { asks, ledger, planLimits, staff, threads } from '../src/schema.ts';
import { db } from './pglite.ts';

process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { handOff } = await import('../src/hand-offs.ts');
const { parkedThreads, wakeThread, HAND_OFF_LIMIT } = await import('../src/threads.ts');
const { decideAsk, WINDOW_ASK_LAPSED, windowAsksDue, withdrawAsk } =
  await import('../src/office.ts');
const { removeOdd } = await import('../src/leaving.ts');
const { MANAGER_ROLE } = await import('../src/managers.ts');
const { WINDOW_MS } = await import('../src/office-usage.ts');

const odd = (id: string, name: string, agent: 'claude' | 'codex' = 'claude') => ({
  id,
  name,
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft' as const,
  agent,
  desk: `You are ${name}.`
});
await db
  .insert(staff)
  .values([
    odd('cole', 'Cole'),
    odd('ivy', 'Ivy'),
    odd('rex', 'Rex'),
    odd('cody', 'Cody', 'codex')
  ]);

/** The plan's 5-hour window as a run last reported it. */
async function window(share: number, resetsAt: Date) {
  const w = { fiveHour: share, fiveHourResetsAt: resetsAt };
  await db
    .insert(planLimits)
    .values({ id: 'claude', sevenDay: 0, ...w })
    .onConflictDoUpdate({ target: planLimits.id, set: w });
}

/** What the office clock does at a look (jobs.ts `plan`), once the reset has passed. */
async function clockAfterReset() {
  await db.update(threads).set({ resumeAt: new Date(Date.now() - 1000) });
  await window(0.9, new Date(Date.now() - 1000));
  for (const t of await parkedThreads()) await wakeThread(t.id);
  for (const a of await windowAsksDue())
    if (a.at <= new Date()) await withdrawAsk(a.id, WINDOW_ASK_LAPSED);
}

/** The ask left the desk as the office's no, with one line in the ledger saying the window reset. */
async function leftAtReset(id: number) {
  const [after] = await db.select().from(asks).where(eq(asks.id, id));
  assert.notEqual(after.status, 'open', 'the window ask still sits on the desk after its reset');
  assert.equal(after.status, 'denied');
  const lines = await db
    .select({ actor: ledger.actor, title: ledger.title, reason: ledger.reason })
    .from(ledger)
    .where(eq(ledger.askId, id));
  assert.deepEqual(lines, [
    { actor: 'office', title: `Withdrawn: ${after.title}`, reason: WINDOW_ASK_LAPSED }
  ]);
}

/** The work by its title, and the window ask that holds it. */
const windowAsk = async (title: string) => {
  const [t] = await db.select().from(threads).where(eq(threads.title, title));
  const [a] = await db
    .select()
    .from(asks)
    .where(eq(asks.id, t.heldBy ?? -1));
  return { thread: t, ask: a };
};

test('a window ask whose only held work the owner stopped with a no to more hand-offs leaves the desk at the reset', async () => {
  await window(0.9, new Date(Date.now() + 3_600_000));
  const held = await handOff({
    from: 'cole',
    to: 'ivy',
    work: { title: 'Tune gravity', brief: 'Tune it.' },
    thread: { title: 'Build a moon' }
  });
  assert.ok('problem' in held, 'the window holds the hand-off');
  const { thread, ask } = await windowAsk('Build a moon');
  assert.equal(thread.heldBy, ask.id);

  // The round is used up, so a hand-off to an Odd on another tool asks the owner to go on.
  await db.update(threads).set({ handOffsUsed: HAND_OFF_LIMIT }).where(eq(threads.id, thread.id));
  await handOff({
    from: 'cole',
    to: 'cody',
    work: { title: 'Map craters', brief: 'Map them.' },
    thread: { id: thread.id }
  });
  const [goOn] = await db.select().from(asks).where(eq(asks.kind, 'hand_offs'));
  assert.ok(goOn, 'a hand_offs ask is raised');
  await decideAsk(goOn.id, 'deny', 'Enough');
  const stopped = (await db.select().from(threads).where(eq(threads.id, thread.id)))[0];
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.heldBy, null, 'the stop clears the window hold');

  await clockAfterReset();
  await leftAtReset(ask.id);
});

test('a window ask whose only held work belonged to an Odd that left leaves the desk at the reset', async () => {
  // A new window: the last one's ask was raised a day ago.
  await db
    .update(asks)
    .set({ createdAt: new Date(Date.now() - 86_400_000) })
    .where(eq(asks.kind, 'window'));
  // Mo is the manager, so the window ask is filed under Mo, not the Odd leaving.
  await db.insert(staff).values({ ...odd('mo', 'Mo'), role: MANAGER_ROLE });
  await window(0.9, new Date(Date.now() + 3_600_000));
  const held = await handOff({
    from: 'rex',
    to: 'ivy',
    work: { title: 'Tune gravity', brief: 'Tune it.' },
    thread: { title: 'Build a ring' }
  });
  assert.ok('problem' in held, 'the window holds the hand-off');
  const { ask } = await windowAsk('Build a ring');
  assert.equal(ask.staffId, 'mo');
  assert.equal(await removeOdd('rex'), undefined);

  await clockAfterReset();
  await leftAtReset(ask.id);
});

test("a window ask is due at its own window's reset, one from an older window is due already, and with no reset reported one is due a window after it was raised", async () => {
  // A new window: the last one's ask was raised a day ago.
  await db
    .update(asks)
    .set({ createdAt: new Date(Date.now() - 86_400_000) })
    .where(eq(asks.kind, 'window'));
  const resets = new Date(Date.now() + 3_600_000);
  await window(0.9, resets);
  assert.ok(
    'problem' in
      (await handOff({
        from: 'cole',
        to: 'ivy',
        work: { title: 'Tune gravity', brief: 'Tune it.' },
        thread: { title: 'Build a comet' }
      }))
  );
  const { ask } = await windowAsk('Build a comet');
  assert.deepEqual(await windowAsksDue(), [{ id: ask.id, at: resets }]);

  const raised = new Date(Date.now() - 86_400_000);
  await db.update(asks).set({ createdAt: raised }).where(eq(asks.id, ask.id));
  assert.deepEqual(await windowAsksDue(), [{ id: ask.id, at: raised }]);

  await db.update(planLimits).set({ fiveHourResetsAt: null });
  assert.deepEqual(await windowAsksDue(), [
    { id: ask.id, at: new Date(raised.getTime() + WINDOW_MS) }
  ]);
});
