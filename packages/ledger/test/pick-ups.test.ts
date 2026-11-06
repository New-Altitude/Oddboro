// How work comes back to a thread's lead: an Odd runs once at a time on a
// thread, results that land while the lead runs there come back together in
// one pick-up, and a colleague's run that ends waiting goes back as waiting
// only while something it raised is still open, so the lead is never told it
// waits on the owner after the owner answered. The office's own code on every
// migration, in an in-memory PGlite that stands in for db.ts (pglite.ts). Run
// with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import {
  asks,
  followUps,
  goals,
  planLimits,
  reports,
  staff,
  tasks,
  threads,
  type FollowUpKind
} from '../src/schema.ts';
import { db } from './pglite.ts';

// The ledger rows a finished run writes embed nothing: no Ollama answers here.
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const H = await import('../src/hand-offs.ts');
const O = await import('../src/office.ts');
const T = await import('../src/threads.ts');
const B = await import('../src/lead-brief.ts');

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
await db.insert(staff).values([odd('lead', 'Lena'), odd('paige', 'Paige'), odd('rex', 'Rex')]);

type Row = typeof followUps.$inferSelect;

/**
 * `lead` hands `to` a piece of work: on a new thread, or on `thread`. `run` is
 * the key of the chat or job it comes from, as `hand_off` passes it.
 */
async function give(to: string, title: string, thread?: number, run?: string): Promise<Row> {
  const r = await H.handOff({
    from: 'lead',
    to,
    work: { title, brief: `Do ${title}.` },
    thread: thread ? { id: thread } : { title: `Thread for ${title}` },
    run
  });
  assert.ok('id' in r, JSON.stringify(r));
  return byId(r.id);
}
async function byId(id: number): Promise<Row> {
  const [row] = await db.select().from(followUps).where(eq(followUps.id, id));
  return row;
}
/** Every follow-up on a thread of one kind, oldest first. */
const onThread = (id: number, kind: FollowUpKind) =>
  db
    .select()
    .from(followUps)
    .where(and(eq(followUps.threadId, id), eq(followUps.kind, kind)))
    .orderBy(followUps.id);
const listed = async (id: number) => (await O.followUpsToDo()).some((t) => t.id === id);
/** A run that starts and ends at once. */
async function runs(
  f: Row,
  outcome: 'done' | 'failed' | 'waiting',
  text: string,
  joined?: number[]
) {
  assert.ok(await O.startFollowUp(f.id), `follow-up ${f.id} could not start`);
  await O.finishFollowUp(f, f.handOff?.title ?? 'work', outcome, text, { joined });
}
async function threadOf(id: number) {
  const [t] = await db.select().from(threads).where(eq(threads.id, id));
  return t;
}
/** The colleague's run on `h` raises one ask on the hand-off, as raise_ask does. */
async function raises(h: Row, title: string) {
  const { ask } = await O.raiseAsk(h.staffId, {
    title,
    why: 'The work needs it.',
    ifApproved: 'I do it.',
    handOffId: h.id,
    threadId: h.threadId ?? undefined
  });
  return ask;
}

test('a colleague whose run ends waiting, with its ask still open, goes back waiting, and the later no goes back too', async () => {
  const h = await give('paige', 'Book the venue');
  assert.ok(await O.startFollowUp(h.id));
  const ask = await raises(h, 'Email the venue');
  await O.finishFollowUp(
    h,
    'Book the venue',
    'waiting',
    'Drafted the email; it waits on your yes.'
  );
  await O.decideAsk(ask.id, 'deny', null);
  const backs = await onThread(h.threadId ?? 0, 'handed_back');
  assert.deepEqual(
    backs.map((b) => [b.handOff?.outcome, !!b.handOff?.answered]),
    [
      ['waiting', false],
      ['failed', true]
    ]
  );
});

test('a no that comes while the colleague still runs goes back, and its run ending waiting sends nothing stale after it', async () => {
  const h = await give('paige', 'Price the venue');
  assert.ok(await O.startFollowUp(h.id));
  const ask = await raises(h, 'Call the venue');
  await O.decideAsk(ask.id, 'deny', null);
  await O.finishFollowUp(h, 'Price the venue', 'waiting', 'Asked to call the venue.');
  const backs = await onThread(h.threadId ?? 0, 'handed_back');
  assert.deepEqual(
    backs.map((b) => [b.handOff?.outcome, !!b.handOff?.answered]),
    [['failed', true]]
  );
  // The lead picks the answer up, and nothing waits on the owner any more.
  await runs(backs[0], 'done', 'Moved on without the call.');
  assert.equal((await threadOf(h.threadId ?? 0)).status, 'done');
  const [line] = (await H.handOffsFor('lead')).filter((l) => l.id === h.id);
  assert.equal(line.status, 'failed');
});

test("a yes that comes while the colleague still runs starts its carry-out only once that run ends, and only the carry-out's result goes back", async () => {
  const h = await give('rex', 'Draft the invite');
  assert.ok(await O.startFollowUp(h.id));
  const ask = await raises(h, 'Send the invite');
  await O.decideAsk(ask.id, 'approve', null);
  const [carry] = await onThread(h.threadId ?? 0, 'carry_out');
  assert.equal(carry.staffId, 'rex');
  assert.equal(
    await listed(carry.id),
    false,
    'the carry-out is listed while the run that raised it runs'
  );
  assert.equal(await O.startFollowUp(carry.id), undefined);
  await O.finishFollowUp(h, 'Draft the invite', 'waiting', 'The invite waits on your yes.');
  assert.deepEqual(await onThread(h.threadId ?? 0, 'handed_back'), []);
  assert.equal(await listed(carry.id), true);
  await runs(carry, 'done', 'Sent the invite.');
  const backs = await onThread(h.threadId ?? 0, 'handed_back');
  assert.deepEqual(
    backs.map((b) => [b.handOff?.outcome, b.note]),
    [['done', 'Sent the invite.']]
  );
});

test('a run that ends waiting having raised nothing still goes back waiting, so the lead is never left without word', async () => {
  const h = await give('paige', 'Check the menu');
  await runs(h, 'waiting', 'Waiting, though I asked for nothing.');
  const backs = await onThread(h.threadId ?? 0, 'handed_back');
  assert.deepEqual(
    backs.map((b) => b.handOff?.outcome),
    ['waiting']
  );
});

test('a lone result is listed and starts at once, and its pick-up joins nothing', async () => {
  const h = await give('paige', 'Write the toast');
  await runs(h, 'done', 'Wrote the toast.');
  const [back] = await onThread(h.threadId ?? 0, 'handed_back');
  assert.equal(await listed(back.id), true);
  assert.deepEqual(await H.resultsToJoin(back), []);
  assert.ok(await O.startFollowUp(back.id));
});

test('results that land while the lead runs on its thread wait, then come back together in one run', async () => {
  const first = await give('paige', 'Piece one');
  const thread = first.threadId ?? 0;
  const second = await give('rex', 'Piece two', thread);
  const third = await give('paige', 'Piece three', thread);
  // Two hand-offs to one colleague run side by side: new work never waits.
  for (const h of [first, second, third]) assert.ok(await O.startFollowUp(h.id));
  await O.finishFollowUp(first, 'Piece one', 'done', 'One is done.');
  const [b1] = await onThread(thread, 'handed_back');
  assert.ok(await O.startFollowUp(b1.id), 'the lead picks the first result up');
  await O.finishFollowUp(second, 'Piece two', 'done', 'Two is done.');
  await O.finishFollowUp(third, 'Piece three', 'failed', 'Three could not be done.');
  const [, b2, b3] = await onThread(thread, 'handed_back');
  for (const b of [b2, b3]) {
    assert.equal(await listed(b.id), false, 'a result is listed while the lead runs');
    assert.equal(await O.startFollowUp(b.id), undefined, 'the lead ran twice at once');
  }
  await O.finishFollowUp(b1, 'Piece one', 'done', 'Checked one; waiting on two and three.');
  assert.ok(await O.startFollowUp(b2.id));
  assert.equal(
    await O.startFollowUp(b3.id),
    undefined,
    'a second pick-up started beside the first'
  );
  const joined = await H.resultsToJoin(b2);
  assert.deepEqual(
    joined.map((j) => j.id),
    [b3.id]
  );
  await O.finishFollowUp(b2, 'Piece two', 'done', 'Both are in.', { joined: [b3.id] });
  const ended = await onThread(thread, 'handed_back');
  assert.deepEqual(
    ended.map((b) => [b.outcome, b.result]),
    [
      ['done', 'Checked one; waiting on two and three.'],
      ['done', 'Both are in.'],
      ['done', 'Both are in.']
    ]
  );
  const onIt = await db.select().from(followUps).where(eq(followUps.threadId, thread));
  for (const f of onIt) assert.equal(await listed(f.id), false);
});

test("the lead's other runs on its thread wait for its pick-up too", async () => {
  const h = await give('rex', 'Order the cake');
  const thread = h.threadId ?? 0;
  await runs(h, 'done', 'Ordered.');
  const [back] = await onThread(thread, 'handed_back');
  assert.ok(await O.startFollowUp(back.id));
  const { ask } = await O.raiseAsk('lead', {
    title: 'Pay for the cake',
    why: 'It needs paying.',
    ifApproved: 'I pay it.',
    threadId: thread
  });
  await O.decideAsk(ask.id, 'approve', null);
  const [carry] = await onThread(thread, 'carry_out');
  assert.equal(await O.startFollowUp(carry.id), undefined);
  await O.finishFollowUp(back, 'Order the cake', 'done', 'Checked the order.');
  assert.ok(await O.startFollowUp(carry.id));
});

test('a pick-up brief names each result it takes, and a lone one reads as it always did', () => {
  const h = { from: 'paige', title: 'Piece one', brief: 'Do one.', outcome: 'done' as const };
  const base = {
    kind: 'handed_back' as const,
    h,
    colleague: { id: 'paige', name: 'Paige' },
    me: 'lead',
    result: 'One is done.',
    thread: 7
  };
  const lone = H.handOffBrief(base).join('\n');
  assert.equal(H.handOffBrief({ ...base, joined: [] }).join('\n'), lone);
  assert.doesNotMatch(lone, /More came back/);
  assert.match(lone, /what came back from Paige/);
  const both = H.handOffBrief({
    ...base,
    joined: [
      {
        h: { from: 'rex', title: 'Piece two', brief: 'Do two.', outcome: 'failed' },
        colleague: { id: 'rex', name: 'Rex' },
        result: 'Two could not be done.'
      }
    ]
  }).join('\n');
  assert.match(both, /More came back while you were busy on this work/);
  assert.match(
    both,
    /- Rex took "Piece two"\. They could not finish it\. What they sent back:\n\nTwo could not be done\./
  );
  assert.match(both, /what came back from each colleague/);
});

test("the lead's brief names the hand-offs still out, and leaves out a result its run already holds", async () => {
  const first = await give('paige', 'Count the chairs');
  const thread = first.threadId ?? 0;
  await give('rex', 'Count the tables', thread);
  await runs(first, 'done', 'Forty chairs.');
  const [back] = await onThread(thread, 'handed_back');
  const story = await B.threadStory(await threadOf(thread));
  const brief = B.threadBrief({ story, shown: [back.id] }).join('\n');
  assert.match(brief, /Still out: "Count the tables" \(Rex\)\./);
  assert.doesNotMatch(brief, /Count the chairs" \(Paige\)\./);
  assert.doesNotMatch(brief, /The latest result/);
  assert.match(B.threadBrief({ story }).join('\n'), /The latest result, from Paige, in full/);
});

test("a lead's chat that hands off on a thread holds its pick-ups there until it ends, and what landed meanwhile comes back in one run", async () => {
  const chat = randomUUID();
  O.runsGoing.add(chat);
  const first = await give('paige', 'Write the speech', undefined, chat);
  const thread = first.threadId ?? 0;
  const second = await give('rex', 'Book the band', thread, chat);
  for (const h of [first, second]) assert.ok(await O.startFollowUp(h.id));
  await O.finishFollowUp(first, 'Write the speech', 'done', 'The speech is written.');
  const [b1] = await onThread(thread, 'handed_back');
  assert.equal(await listed(b1.id), false, 'a result is listed while the chat still hands off');
  assert.equal(await O.startFollowUp(b1.id), undefined, 'the lead picked up beside its own chat');
  // The chat goes on handing off, and new work still starts at once.
  const third = await give('paige', 'Sign off the plan', thread, chat);
  assert.ok(await O.startFollowUp(third.id));
  await O.finishFollowUp(second, 'Book the band', 'done', 'The band is booked.');
  const [, b2] = await onThread(thread, 'handed_back');
  assert.equal(await O.startFollowUp(b2.id), undefined);
  O.runsGoing.delete(chat);
  assert.equal(await listed(b1.id), true, 'the chat ended, and its pick-up still waits');
  assert.ok(await O.startFollowUp(b1.id));
  assert.deepEqual(
    (await H.resultsToJoin(b1)).map((j) => j.id),
    [b2.id]
  );
  assert.equal(
    await O.startFollowUp(b2.id),
    undefined,
    'a second pick-up started beside the first'
  );
});

test("a lead's chat that hands off on a thread another run opened holds its pick-ups there until it ends", async () => {
  const opened = await give('paige', 'Paint the sign');
  const thread = opened.threadId ?? 0;
  const chat = randomUUID();
  O.runsGoing.add(chat);
  await give('rex', 'Hang the sign', thread, chat);
  await runs(opened, 'done', 'Painted.');
  const [back] = await onThread(thread, 'handed_back');
  assert.equal(
    await listed(back.id),
    false,
    'the lead picked up beside the chat that handed off there'
  );
  O.runsGoing.delete(chat);
  assert.equal(await listed(back.id), true);
});

test("a lone hand-off picks up at once, even while the lead's chat hands off on another thread", async () => {
  const chat = randomUUID();
  O.runsGoing.add(chat);
  await give('rex', 'Hire the photographer', undefined, chat);
  const lone = await give('paige', 'Print the menus');
  await runs(lone, 'done', 'The menus are printed.');
  const [back] = await onThread(lone.threadId ?? 0, 'handed_back');
  assert.equal(await listed(back.id), true);
  assert.ok(await O.startFollowUp(back.id));
  O.runsGoing.delete(chat);
});

test("a lead's chat holds only the lead: a colleague's carry-out on the thread starts while it goes", async () => {
  const chat = randomUUID();
  O.runsGoing.add(chat);
  const h = await give('rex', 'Draft the menu', undefined, chat);
  assert.ok(await O.startFollowUp(h.id));
  const ask = await raises(h, 'Send the menu');
  // Goes back waiting, as the ask is still open: a result row on the thread from rex.
  await O.finishFollowUp(h, 'Draft the menu', 'waiting', 'The menu waits on your yes.');
  await O.decideAsk(ask.id, 'approve', null);
  const [carry] = await onThread(h.threadId ?? 0, 'carry_out');
  assert.equal(carry.staffId, 'rex');
  assert.ok(await O.startFollowUp(carry.id));
  O.runsGoing.delete(chat);
});

test('after a restart, a result from a chat that was handing off picks up at once, even beside a new chat', async () => {
  const before = randomUUID();
  O.runsGoing.add(before);
  const h = await give('paige', 'Plan the seating', undefined, before);
  const thread = h.threadId ?? 0;
  assert.ok(await O.startFollowUp(h.id));
  // The restart: a new process, where the old chat's key was never held,
  // and its cut-off runs fail, so the result goes back.
  O.runsGoing.delete(before);
  const after = randomUUID();
  O.runsGoing.add(after);
  await O.closeStaleFollowUps();
  const [back] = await onThread(thread, 'handed_back');
  assert.equal(back.handOff?.outcome, 'failed');
  assert.equal(await listed(back.id), true);
  assert.ok(await O.startFollowUp(back.id));
  O.runsGoing.delete(after);
});

/** What the owner's desk got for `staffId`'s runs a restart cut off. */
const cutOffReports = (staffId: string) =>
  db
    .select()
    .from(reports)
    .where(and(eq(reports.staffId, staffId), eq(reports.body, O.CUT_OFF_RESULT)));

test("a hand-off a restart cut off goes back to its lead only, with nothing on the owner's desk", async () => {
  await O.closeStaleFollowUps();
  const before = (await cutOffReports('paige')).length;
  const h = await give('paige', 'Paint the doors');
  assert.ok(await O.startFollowUp(h.id));
  await O.closeStaleFollowUps();
  const backs = await onThread(h.threadId ?? 0, 'handed_back');
  assert.deepEqual(
    backs.map((b) => [b.staffId, b.handOff?.outcome]),
    [['lead', 'failed']]
  );
  assert.equal(
    (await cutOffReports('paige')).length,
    before,
    'the lead redoes it, so the owner is not asked'
  );
});

test("a run a restart cut off with no lead to wake still goes on the owner's desk", async () => {
  await O.closeStaleFollowUps();
  const before = (await cutOffReports('rex')).length;
  const { ask } = await O.raiseAsk('rex', { title: 'Sweep the yard', why: 'w', ifApproved: 'i' });
  await O.decideAsk(ask.id, 'approve', null);
  const [carry] = await db
    .select()
    .from(followUps)
    .where(and(eq(followUps.askId, ask.id), eq(followUps.kind, 'carry_out')));
  assert.equal(carry.threadId, null);
  assert.ok(await O.startFollowUp(carry.id));
  await O.closeStaleFollowUps();
  assert.equal((await cutOffReports('rex')).length, before + 1);
});

/** Everything on the owner's desk: reports, asks and tasks, in any state. */
const deskItems = async () =>
  (await db.select().from(reports)).length +
  (await db.select().from(asks)).length +
  (await db.select().from(tasks)).length;

test("a failed hand-off on a goal wakes its lead once, and puts nothing on the owner's desk", async () => {
  const [g] = await db.insert(goals).values({ title: 'Light the pier' }).returning();
  const r = await H.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Hang the lamps', brief: 'Hang them.' },
    thread: { title: 'Light the pier', goalId: g.id }
  });
  assert.ok('id' in r, JSON.stringify(r));
  const h = await byId(r.id);
  const before = await deskItems();
  await runs(h, 'failed', 'The ladder broke.');
  const backs = await onThread(r.thread, 'handed_back');
  assert.deepEqual(
    backs.map((b) => [b.staffId, b.handOff?.outcome]),
    [['lead', 'failed']]
  );
  assert.equal(await deskItems(), before, 'the lead handles it, so the owner is not told');
});

test("a failed run with no lead to wake puts one report on the owner's desk", async () => {
  const { ask } = await O.raiseAsk('rex', { title: 'Mend the gate', why: 'w', ifApproved: 'i' });
  await O.decideAsk(ask.id, 'approve', null);
  const [carry] = await db
    .select()
    .from(followUps)
    .where(and(eq(followUps.askId, ask.id), eq(followUps.kind, 'carry_out')));
  const before = await deskItems();
  await runs(carry, 'failed', 'The hinge snapped.');
  const told = await db
    .select()
    .from(reports)
    .where(and(eq(reports.staffId, 'rex'), eq(reports.body, 'The hinge snapped.')));
  assert.equal(told.length, 1);
  assert.equal(await deskItems(), before + 1);
});

test("answers that come while the lead's chat holds its thread join one pick-up, which the claim returns whole", async () => {
  const chat = randomUUID();
  O.runsGoing.add(chat);
  const h = await give('paige', 'Choose the venue', undefined, chat);
  const thread = h.threadId ?? 0;
  await T.answerThread(thread, 'First answer.');
  await T.answerThread(thread, 'Second answer.');
  const [wake, ...more] = await onThread(thread, 'resume');
  assert.equal(more.length, 0, 'the lead would wake twice');
  assert.equal(await listed(wake.id), false);
  O.runsGoing.delete(chat);
  assert.equal((await O.startFollowUp(wake.id))?.note, 'First answer.\nSecond answer.');
});

test('an answer joins a pick-up still to start even with no run holding it, so a pick-up listed before it misses nothing', async () => {
  const h = await give('rex', 'Order the flowers');
  const thread = h.threadId ?? 0;
  await T.answerThread(thread, 'Roses.');
  const [wake] = await onThread(thread, 'resume');
  assert.equal(await listed(wake.id), true);
  await T.answerThread(thread, 'Not red ones.');
  assert.equal((await onThread(thread, 'resume')).length, 1);
  assert.equal((await O.startFollowUp(wake.id))?.note, 'Roses.\nNot red ones.');
  // Once the pick-up started, the next answer writes one of its own.
  await T.answerThread(thread, 'And lilies.');
  assert.equal((await onThread(thread, 'resume')).length, 2);
});

test("a chat whose hand-off passed the round's limit: the owner's yes starts it beside the chat, and holds the lead's pick-up until the chat ends", async () => {
  const [year] = await db
    .insert(threads)
    .values({ title: 'The year', hubId: 'lead', holderId: 'lead', handOffsUsed: T.HAND_OFF_LIMIT })
    .returning();
  const chat = randomUUID();
  O.runsGoing.add(chat);
  const r = await H.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Plan the year', brief: 'Plan it.' },
    thread: { id: year.id },
    run: chat
  });
  assert.ok('asked' in r, JSON.stringify(r));
  await O.decideAsk(r.asked, 'approve', 'Start with spring.');
  const [held] = await onThread(r.thread, 'hand_off');
  assert.equal(await listed(held.id), true, 'a hand-off is new work, so it runs beside the chat');
  const [wake] = await onThread(r.thread, 'resume');
  assert.equal(
    await listed(wake.id),
    false,
    'the pick-up runs beside the chat that opened the thread'
  );
  O.runsGoing.delete(chat);
  assert.equal(await listed(wake.id), true);
});

test("a chat whose hand-off the usage window held holds the pick-up the window's yes starts, until the chat ends", async () => {
  const w = { fiveHour: 0.9, fiveHourResetsAt: new Date(Date.now() + 7_200_000), sevenDay: 0.1 };
  await db
    .insert(planLimits)
    .values({ id: 'claude', ...w })
    .onConflictDoUpdate({ target: planLimits.id, set: w });
  const chat = randomUUID();
  O.runsGoing.add(chat);
  const r = await H.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Book the hall', brief: 'Book it.' },
    thread: { title: 'The hall' },
    run: chat
  });
  assert.ok('problem' in r, JSON.stringify(r));
  const [held] = await db.select().from(asks).where(eq(asks.kind, 'window'));
  await O.decideAsk(held.id, 'approve', null);
  const [t] = await db.select().from(threads).where(eq(threads.title, 'The hall'));
  const [wake] = await onThread(t.id, 'resume');
  assert.equal(await listed(wake.id), false, 'the pick-up runs beside the chat the window held');
  O.runsGoing.delete(chat);
  assert.equal(await listed(wake.id), true);
  await db.delete(planLimits);
});

test('a carry-out on no thread that hands off holds the pick-up of its result while it runs', async () => {
  const { ask } = await O.raiseAsk('lead', { title: 'Plan the party', why: 'w', ifApproved: 'i' });
  await O.decideAsk(ask.id, 'approve', null);
  const [carry] = await db
    .select()
    .from(followUps)
    .where(and(eq(followUps.askId, ask.id), eq(followUps.kind, 'carry_out')));
  assert.equal(carry.threadId, null);
  assert.ok(await O.startFollowUp(carry.id));
  // The office gives every run a key, this one too, and hand_off passes it on.
  const key = randomUUID();
  O.runsGoing.add(key);
  const h = await give('rex', 'Find a caterer', undefined, key);
  await runs(h, 'done', 'Found one.');
  const [back] = await onThread(h.threadId ?? 0, 'handed_back');
  assert.equal(
    await O.startFollowUp(back.id),
    undefined,
    'the lead picked up beside its carry-out'
  );
  O.runsGoing.delete(key);
  assert.ok(await O.startFollowUp(back.id));
});

test("a chat that raises a goal's plan holds the pick-up the owner's yes starts on the goal's thread, until the chat ends", async () => {
  const [g] = await db.insert(goals).values({ title: 'Run the fair' }).returning();
  const chat = randomUUID();
  O.runsGoing.add(chat);
  const { ask } = await O.raiseAsk('lead', {
    kind: 'plan',
    title: 'Plan for: Run the fair',
    why: 'w',
    ifApproved: 'i',
    plan: { goalId: g.id, items: [{ kind: 'assign', staff: 'rex', part: 'Stalls' }] },
    run: chat
  });
  await O.decideAsk(ask.id, 'approve', null);
  const [wake] = await onThread(ask.threadId ?? 0, 'resume');
  assert.equal(
    await listed(wake.id),
    false,
    'the pick-up runs beside the chat that raised the plan'
  );
  O.runsGoing.delete(chat);
  assert.equal(await listed(wake.id), true);
});

test('a task given on a hand-off and finished while the run goes sends no stale waiting, and its pick-up runs', async () => {
  const h = await give('rex', 'Sign the lease');
  assert.ok(await O.startFollowUp(h.id));
  const t = await O.giveTask('rex', {
    title: 'Sign it',
    why: 'w',
    steps: ['Sign it'],
    handOffId: h.id,
    threadId: h.threadId ?? undefined
  });
  await O.finishTask(t.id, true, 'Signed.');
  await O.finishFollowUp(h, 'Sign the lease', 'waiting', 'Waiting on the signature.');
  assert.deepEqual(await onThread(h.threadId ?? 0, 'handed_back'), []);
  const [done] = await onThread(h.threadId ?? 0, 'task_done');
  assert.ok(await O.startFollowUp(done.id));
});

test("only both sides of a hand-off, a pick-up, and a run reading the owner's no or edit work at Draft; only the last two hand nothing on", async () => {
  // Every kind, from the one map the type checker holds to the full list.
  const kinds = Object.keys((await import('../src/lessons.ts')).NOTE_IS_OWNERS) as FollowUpKind[];
  assert.deepEqual(kinds.filter(H.atDraft), [
    'denied',
    'hand_off',
    'handed_back',
    'resume',
    'edited'
  ]);
  assert.deepEqual(kinds.filter(H.servesNoThread), ['denied', 'edited']);
});

test('a thread keeps the key of every run that handed off on it, so each holds the pick-up while it goes', async () => {
  const [first, second] = [randomUUID(), randomUUID()];
  O.runsGoing.add(first);
  O.runsGoing.add(second);
  const h = await give('paige', 'Hang the lights', undefined, first);
  const thread = h.threadId ?? 0;
  await give('rex', 'Test the lights', thread, second);
  assert.deepEqual((await threadOf(thread)).runs, [first, second]);
  await T.answerThread(thread, 'Warm white.');
  const [wake] = await onThread(thread, 'resume');
  O.runsGoing.delete(second);
  assert.equal(await listed(wake.id), false, 'the pick-up ran beside the first run');
  O.runsGoing.delete(first);
  assert.equal(await listed(wake.id), true);
});
