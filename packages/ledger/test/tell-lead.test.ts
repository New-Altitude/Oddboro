// What the owner tells a colleague in chat about a thread reaches the
// thread's lead: the colleague's chat lists the threads it works on and does
// not lead, and tell_lead passes the owner's own words to the lead. The
// office's own code on every migration, in an in-memory PGlite that stands in
// for db.ts (pglite.ts). Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { followUps, staff, threads } from '../src/schema.ts';
import { db } from './pglite.ts';

// Loaded once db.ts is this database, so every query they make lands here.
const { handOff } = await import('../src/hand-offs.ts');
const { raiseAsk } = await import('../src/office.ts');
const { tellLead, threadsOn, threadsOnBrief } = await import('../src/threads.ts');

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
await db.insert(staff).values([odd('cole', 'Cole'), odd('bram', 'Bram'), odd('rex', 'Rex')]);

/** `hub` hands `to` a piece of work on a new thread. Returns the thread. */
async function onThread(hub: string, to: string, title: string): Promise<number> {
  const r = await handOff({
    from: hub,
    to,
    work: { title: 'Draw the presets', brief: 'Draw two presets.' },
    thread: { title }
  });
  assert.ok('id' in r, JSON.stringify(r));
  return r.thread;
}
const presets = await onThread('cole', 'bram', 'Presets for the sim');
const ownThread = await onThread('bram', 'rex', 'Bram leads this one');

const said = 'Thanks Bram. On the presets: make the colours warmer.\nAlso, lunch at one?';
const tell = (staffId: string, threadId: number, words = 'make the colours warmer.') =>
  tellLead({ staffId, threadId, owner: 'Sam', said, words });
const resumes = (id: number) =>
  db
    .select()
    .from(followUps)
    .where(and(eq(followUps.threadId, id), eq(followUps.kind, 'resume')));

test("a colleague's chat lists the threads it works on and does not lead, with each lead and where it stands", async () => {
  const rows = await threadsOn('bram');
  assert.deepEqual(rows, [
    { id: presets, title: 'Presets for the sim', stage: 'under_way', lead: 'Cole', goalId: null }
  ]);
  const brief = threadsOnBrief(rows);
  assert.match(brief, /^## Work you are on$/m);
  assert.ok(brief.includes(`- Work ${presets}: Presets for the sim, led by Cole (under way).`));
  assert.match(brief, /pass their words to its lead with tell_lead/);
  assert.equal(threadsOnBrief(await threadsOn('cole')), '');
});

test("tell_lead writes one resume for the lead, carrying the owner's own words", async () => {
  const r = await tell('bram', presets);
  assert.deepEqual(r, { lead: 'Cole' });
  const [wake, ...more] = await resumes(presets);
  assert.equal(more.length, 0);
  assert.equal(wake.staffId, 'cole');
  assert.equal(
    wake.note,
    "Bram passed you what Sam told them in chat about this work. You decide what comes of it and hand on any work it needs; Bram does nothing more with it. Sam's words: make the colours warmer."
  );
});

test("words that are not the owner's are refused, so nothing else reaches the lead as theirs", async () => {
  const before = (await resumes(presets)).length;
  const r = await tell('bram', presets, 'make the colours colder.');
  assert.ok('problem' in r && r.problem.includes('copied exactly'), JSON.stringify(r));
  assert.equal((await resumes(presets)).length, before);
});

test('tell_lead on a thread the Odd leads is refused', async () => {
  const r = await tell('bram', ownThread);
  assert.ok('problem' in r && r.problem.includes('You lead work'), JSON.stringify(r));
  assert.equal((await resumes(ownThread)).length, 0);
});

test('tell_lead on a thread the Odd is not on is refused', async () => {
  const r = await tell('rex', presets);
  assert.ok('problem' in r && r.problem.includes('is not work you are on'), JSON.stringify(r));
});

test('tell_lead on a thread the owner stopped is refused', async () => {
  const stopped = await onThread('cole', 'bram', 'Stopped work');
  await db
    .update(threads)
    .set({ status: 'stopped', endedAt: new Date() })
    .where(eq(threads.id, stopped));
  const r = await tell('bram', stopped);
  assert.ok('problem' in r && r.problem.includes('stopped'), JSON.stringify(r));
  assert.equal((await resumes(stopped)).length, 0);
});

test("a colleague's chat says the work waits on the owner while an ask raised on it is open", async () => {
  const raised = await onThread('cole', 'bram', 'Presets to buy');
  await raiseAsk('cole', {
    title: 'Buy a preset pack',
    why: 'It saves a day.',
    ifApproved: 'I buy it.',
    threadId: raised
  });
  const row = (await threadsOn('bram')).find((t) => t.id === raised);
  assert.ok(row, 'Bram is not on the work');
  assert.equal(row.stage, 'waiting_on_you');
  assert.ok(threadsOnBrief([row]).includes('led by Cole (waiting on {owner})'));
});
