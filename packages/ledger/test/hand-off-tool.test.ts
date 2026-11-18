// The hand_off tool as a run sees it: the office tool server (src/mcp.ts) in a
// process of its own, as the office starts one for each run, over the office's
// own database (local-db.ts) in a throwaway folder. It checks
// what only the tool server decides: which runs are offered hand_off, that a
// hand-off or a goal's plan carries the run's key to its thread, that a
// hand-off that hands nothing on comes back as an error and one held for the
// owner's yes says it goes ahead on it, what a hand-off's result says, and where an ask or task raised in a chat goes: a goal's work
// to its lead, never onto the desk from a colleague, and a lead's onto the
// thread it names. A goal hire with no job opens no work and puts nothing on
// the desk through any tool. After every test each goal still has one
// thread (hand-off-setup.ts). The files a hand-off carries are in
// hand-off-files.test.ts, and the tools a run is offered and the keys they
// take in offered-tools.test.ts. Run with `npm test -w @oddboro/ledger`.
import {
  odd,
  handOffTool,
  said,
  fair,
  sale,
  chat,
  ask,
  raisedBy,
  put,
  partNow
} from './hand-off-setup.ts';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { db, toolServer } from './tool-server.ts';

const { goals, staff, threads } = await import('../src/schema.ts');
const { eq } = await import('drizzle-orm');
const { HAND_OFF_LIMIT, LEADS_NONE, threadPart } = await import('../src/threads.ts');
const { asks, followUps, jobs, staffGoals } = await import('../src/schema.ts');
const { home } = await import('../src/home.ts');

test("a run that only reads the owner's no or edit for a lesson is offered no hand_off, and so no continue_work", async () => {
  const plain = await handOffTool(await toolServer('lead', { RUN_KEY: 'k-plain' }));
  assert.ok(plain, 'a chat or follow-up on no thread is offered hand_off');
  assert.ok('continue_work' in (plain.inputSchema.properties ?? {}));
  const lesson = await handOffTool(
    await toolServer('lead', {
      RUN_KEY: 'k-lesson',
      LESSON_RUN: '1',
      OWNER_NOTE: 'Never on a Friday.'
    })
  );
  assert.equal(lesson, undefined);
});

test('the hand_off tool tells the lead to describe the work and the result, never the tools', async () => {
  const t = await handOffTool(await toolServer('lead', { RUN_KEY: 'k-tools' }));
  assert.ok(
    t?.description?.includes(
      'Describe the work and the result you need, never which tools to use: each colleague may run on another coding tool, with tools of its own.'
    )
  );
});

test("a hand-off carries the run's key to its thread, so the hold can see the run", async () => {
  const c = await toolServer('lead', { RUN_KEY: 'k-chat' });
  const r = await c.callTool({
    name: 'hand_off',
    arguments: {
      to: 'paige',
      title: 'Count the chairs',
      brief: 'Count them.'
    }
  });
  assert.equal(r.isError, undefined, said(r));
  const [t] = await db.select().from(threads).where(eq(threads.title, 'Count the chairs'));
  assert.deepEqual(t.runs, ['k-chat']);
});

test("a hand-off that hands nothing on comes back as an error that says so, and one held for the owner's yes says it goes ahead on it", async () => {
  const c = await toolServer('lead', { RUN_KEY: 'k-refused' });
  const r = await c.callTool({
    name: 'hand_off',
    arguments: { to: 'nobody', title: 'Lay the tables', brief: 'Lay them.' }
  });
  assert.equal(r.isError, true);
  assert.match(said(r), /^Nothing was handed off yet\. Nobody called "nobody" works here\./);
  const [parties] = await db
    .insert(threads)
    .values({
      title: 'Plan every party',
      hubId: 'lead',
      holderId: 'lead',
      handOffsUsed: HAND_OFF_LIMIT
    })
    .returning();
  const past = await c.callTool({
    name: 'hand_off',
    arguments: { to: 'paige', title: 'Plan one more', brief: 'Plan it.', continue_work: parties.id }
  });
  // Held, not refused: an error would have the lead hand on again what the ask holds.
  assert.equal(past.isError, undefined, said(past));
  assert.match(
    said(past),
    new RegExp(
      `^This round of work ${parties.id} has taken its ${HAND_OFF_LIMIT} hand-offs, so "Plan one more" waits on .+'s answer to ask #\\d+\\. On a yes it goes to Paige exactly as you wrote it`
    )
  );
  assert.match(said(past), /There is nothing more for you to do for it: do not hand it on again\./);
});

test("a goal's plan carries the run's key to the goal's thread, so the hold can see the run", async () => {
  const [g] = await db.insert(goals).values({ title: 'Host the summer fair' }).returning();
  const c = await toolServer('lead', { RUN_KEY: 'k-plan' });
  const r = await c.callTool({
    name: 'propose_goal_plan',
    arguments: {
      goal_id: g.id,
      why: 'Paige counts the chairs.',
      assign: [{ staff: 'paige', part: 'Count the chairs' }]
    }
  });
  assert.match(said(r), /^Ask \d+ is on/);
  const [t] = await db.select().from(threads).where(eq(threads.goalId, g.id));
  assert.deepEqual(t.runs, ['k-plan']);
});

test('a hand-off on a goal the lead does not serve comes back as an error', async () => {
  const c = await toolServer('lead', { RUN_KEY: 'k-held' });
  const goal = await c.callTool({
    name: 'hand_off',
    arguments: { to: 'paige', brief: 'Sort them.', title: 'Sort the mail', goal: 999 }
  });
  assert.equal(goal.isError, true, 'a refused hand-off read as handed over');
  assert.match(said(goal), /^Nothing was handed off yet\. Goal #999 is not one you serve\./);
});

test("a hand-off's result names the work by its title and colleague, never by a follow-up's id", async () => {
  const c = await toolServer('lead', { RUN_KEY: 'k-named' });
  const r = await c.callTool({
    name: 'hand_off',
    arguments: {
      to: 'paige',
      title: 'Stack the chairs',
      brief: 'Stack them.'
    }
  });
  const [t] = await db.select().from(threads).where(eq(threads.title, 'Stack the chairs'));
  assert.equal(
    said(r),
    `Handed "Stack the chairs" to Paige, on work ${t.id}. They start now. You pick up in a fresh run when they finish.\n${HAND_OFF_LIMIT - 1} hand-offs left this round.`
  );
});

test('continuing a finished thread starts a new round with its whole limit', async () => {
  const [t] = await db
    .insert(threads)
    .values({
      title: 'Plan the menu',
      hubId: 'lead',
      holderId: 'lead',
      status: 'done',
      handOffsUsed: HAND_OFF_LIMIT,
      endedAt: new Date()
    })
    .returning();
  const c = await toolServer('lead', { RUN_KEY: 'k-again' });
  const r = await c.callTool({
    name: 'hand_off',
    arguments: {
      to: 'paige',
      title: 'Price the menu',
      brief: 'Price it.',
      continue_work: t.id
    }
  });
  assert.equal(r.isError, undefined, said(r));
  assert.equal(said(r).split('\n')[1], `${HAND_OFF_LIMIT - 1} hand-offs left this round.`);
});

test("a goal hire with no job is offered tell_lead in chat, and raising the goal's work itself is refused as an error", async () => {
  const c = await toolServer('pia', { ...chat, RUN_KEY: 'k-pia' });
  const names = (await c.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('tell_lead'), 'serving the goal is enough, with no hand-off yet');
  const r = await c.callTool({ name: 'raise_ask', arguments: ask });
  assert.equal(r.isError, true);
  assert.match(said(r), /Pass .+ words to Mo with tell_lead/);
  const t = await c.callTool({
    name: 'give_owner_a_task',
    arguments: { title: 'Pick a blue', why: 'Only you know.', steps: ['Pick one'] }
  });
  assert.equal(t.isError, true);
  assert.deepEqual(await raisedBy('pia'), { asks: [], tasks: [] });
});

test('tell_lead requires a reading', async () => {
  const c = await toolServer('pia', { ...chat, RUN_KEY: 'k-pia-reading' });
  const tool = (await c.listTools()).tools.find((t) => t.name === 'tell_lead');
  assert.ok(tool?.inputSchema.required?.includes('reading'), "the lead reads it as the Odd's");
  assert.match(tool?.description ?? '', /work it out in chat and pass nothing on/);
});

test("tell_lead hands the lead the chat's last exchange, as the office set it", async () => {
  await db.insert(staff).values(odd('tam', 'Tam'));
  const [fence] = await db.insert(goals).values({ title: 'Paint the fence' }).returning();
  const [paint] = await db
    .insert(threads)
    .values({ title: fence.title, goalId: fence.id, hubId: 'mo', holderId: 'mo' })
    .returning();
  await db.insert(staffGoals).values({ staffId: 'tam', goalId: fence.id, part: 'The paint' });
  const c = await toolServer('tam', {
    OWNER_SAID: 'Tam, use green.',
    CHAT_EXCHANGE: 'Just before, Tam said: "Which colour?".',
    RUN_KEY: 'k-tam'
  });
  const r = await c.callTool({
    name: 'tell_lead',
    arguments: { work: paint.id, words: 'use green.', reading: 'They want green paint.' }
  });
  assert.equal(r.isError, undefined, said(r));
  const [wake] = await db.select().from(followUps).where(eq(followUps.threadId, paint.id));
  assert.match(
    wake.note ?? '',
    /They want green paint\. Just before, Tam said: "Which colour\?"\.$/
  );
});

test("tell_lead copies every file the owner attached into the colleague's part of the work under the owner's name for it, or the next free one, lists each for the lead, and says which did not come and why, never holding back the words", async (t) => {
  await db.insert(staff).values(odd('una', 'Una'));
  const [roof] = await db.insert(goals).values({ title: 'Fix the roof' }).returning();
  const [mend] = await db
    .insert(threads)
    .values({ title: roof.title, goalId: roof.id, hubId: 'mo', holderId: 'mo' })
    .returning();
  await db.insert(staffGoals).values({ staffId: 'una', goalId: roof.id, part: 'The tiles' });
  const shot = 'attachments/20261111-090000-aaaa-roof.png';
  const notes = 'attachments/20261111-090000-bbbb-notes.md';
  const plan = 'attachments/20261111-090000-cccc-plan.md';
  for (const [path, text] of [
    [shot, 'png'],
    [notes, 'the owner notes'],
    [plan, 'the plan']
  ])
    put(join(home('staff', 'una'), path), text);
  const part = threadPart(mend.id, 'una');
  // Already in the work: a different file where the notes would land, and the same plan.
  put(join(part, 'notes.md'), "Una's own notes");
  put(join(part, 'plan.md'), 'the plan');
  const c = await toolServer('una', {
    OWNER_SAID: 'Una, the leak is by the chimney [Image #1].',
    OWNER_FILES: JSON.stringify([
      { tag: 'Image #1', path: shot, name: 'roof.png' },
      { tag: 'notes.md', path: notes, name: 'notes.md' },
      { tag: 'plan.md', path: plan, name: 'plan.md' },
      { tag: 'gone.png', path: 'attachments/20261111-090000-dddd-gone.png', name: 'gone.png' }
    ]),
    RUN_KEY: 'k-una'
  });
  t.after(() => c.close());
  const tool = (await c.listTools()).tools.find((x) => x.name === 'tell_lead');
  assert.match(tool?.description ?? '', /Every file they attached to it goes too/);
  const r = await c.callTool({
    name: 'tell_lead',
    arguments: {
      work: mend.id,
      words: 'the leak is by the chimney [Image #1].',
      reading: 'The leak is near the chimney.'
    }
  });
  assert.equal(r.isError, undefined, said(r));
  assert.match(said(r), /The 3 files they attached went too\./);
  assert.match(said(r), /Did not go: gone\.png, since .+\. Tell .+ so\./);
  assert.deepEqual(partNow(part), {
    'notes-2.md': 'the owner notes',
    'notes.md': "Una's own notes",
    'plan.md': 'the plan',
    'roof.png': 'png'
  });
  const [wake] = await db.select().from(followUps).where(eq(followUps.threadId, mend.id));
  assert.equal(wake.staffId, 'mo');
  const note = wake.note ?? '';
  assert.ok(note.includes("words: the leak is by the chimney [Image #1]. Una's own reading"), note);
  assert.ok(
    note.endsWith(
      ` attached 3 files to that message, now in this work: Image #1 at ${join(part, 'roof.png')}; notes.md at ${join(part, 'notes-2.md')}; plan.md at ${join(part, 'plan.md')}. One file the owner attached did not come: gone.png, since the office cannot read it.`
    ),
    note
  );
  assert.ok(!note.includes('\n'), 'the note stays on one line');
});

test("tell_lead lands an attachment under the last part of the owner's name for it, and never under a hidden name or an instruction file's", async (t) => {
  await db.insert(staff).values(odd('uri', 'Uri'));
  const [deck] = await db.insert(goals).values({ title: 'Paint the deck' }).returning();
  const [paint] = await db
    .insert(threads)
    .values({ title: deck.title, goalId: deck.id, hubId: 'mo', holderId: 'mo' })
    .returning();
  await db.insert(staffGoals).values({ staffId: 'uri', goalId: deck.id, part: 'The boards' });
  const kept = (name: string) => {
    const path = `attachments/20261111-090000-eeee-${name}`;
    put(join(home('staff', 'uri'), path), name);
    return path;
  };
  const c = await toolServer('uri', {
    OWNER_SAID: 'Uri, use these colours.',
    OWNER_FILES: JSON.stringify([
      { tag: 'colours.md', path: kept('colours.md'), name: '../../colours.md' },
      { tag: '.env', path: kept('env.txt'), name: 'x/.env' },
      { tag: 'CLAUDE.md', path: kept('CLAUDE.md'), name: 'CLAUDE.md' }
    ]),
    RUN_KEY: 'k-uri'
  });
  t.after(() => c.close());
  const r = await c.callTool({
    name: 'tell_lead',
    arguments: { work: paint.id, words: 'use these colours.', reading: 'Use these colours.' }
  });
  assert.equal(r.isError, undefined, said(r));
  const part = threadPart(paint.id, 'uri');
  assert.deepEqual(partNow(part), { 'colours.md': 'colours.md' });
  const [wake] = await db.select().from(followUps).where(eq(followUps.threadId, paint.id));
  assert.ok(
    wake.note?.endsWith(
      ` now in this work: colours.md at ${join(part, 'colours.md')}. 2 files the owner attached did not come: .env, since it is a hidden file; CLAUDE.md, since it is an instruction file.`
    ),
    wake.note ?? ''
  );
});

test('tell_lead with no files attached says nothing of files, to the lead or in its description', async (t) => {
  await db.insert(staff).values(odd('xan', 'Xan'));
  await db.insert(staffGoals).values({ staffId: 'xan', goalId: fair.id, part: 'The till' });
  const c = await toolServer('xan', { OWNER_SAID: 'Xan, count the till twice.', RUN_KEY: 'k-xan' });
  t.after(() => c.close());
  const tool = (await c.listTools()).tools.find((x) => x.name === 'tell_lead');
  assert.doesNotMatch(tool?.description ?? '', /attached/);
  const r = await c.callTool({
    name: 'tell_lead',
    arguments: { work: sale.id, words: 'count the till twice.', reading: 'Count it twice.' }
  });
  assert.equal(r.isError, undefined, said(r));
  assert.doesNotMatch(said(r), /attached|Did not go/);
  const wakes = await db.select().from(followUps).where(eq(followUps.threadId, sale.id));
  assert.ok(
    wakes.some((w) =>
      w.note?.endsWith("Xan's own reading, which is not the owner's words: Count it twice.")
    )
  );
});

test('a goal hire with no job opens no work and puts nothing on the desk, whatever tool it reaches for', async () => {
  const c = await toolServer('pia', { ...chat, RUN_KEY: 'k-pia-all' });
  const work = {
    to: 'jo',
    title: 'Print the signs',
    brief: 'Print them.'
  };
  const calls = [
    { name: 'hand_off', arguments: work },
    { name: 'hand_off', arguments: { ...work, goal: fair.id } },
    { name: 'hand_off', arguments: { ...work, continue_work: sale.id } },
    { name: 'ask_for_access', arguments: { connector: 'gmail', level: 'read', why: 'Signs.' } },
    {
      name: 'propose_hire',
      arguments: {
        name: 'Remy',
        role: 'Printer',
        remit: 'Prints the signs.',
        job_description_file: 'notes/jd-printer.md',
        permission: 'draft',
        why: 'The signs need printing.'
      }
    }
  ];
  for (const call of calls) {
    const r = await c.callTool(call);
    assert.equal(r.isError, true, `${call.name} ${JSON.stringify(call.arguments)}: ${said(r)}`);
  }
  assert.deepEqual(await raisedBy('pia'), { asks: [], tasks: [] });
  assert.deepEqual(await db.select().from(threads).where(eq(threads.hubId, 'pia')), []);

  // Off a chat, where no tell_lead is offered, opening a thread still refuses it.
  const run = await toolServer('pia', { RUN_KEY: 'k-pia-run' });
  const opened = await run.callTool({ name: 'hand_off', arguments: work });
  assert.equal(opened.isError, true);
  assert.equal(said(opened), LEADS_NONE);
});

test('a goal hire with a job is told to pass goal work to the lead, and its own ask lands on no thread', async () => {
  const c = await toolServer('jo', { ...chat, RUN_KEY: 'k-jo' });
  const tool = (await c.listTools()).tools.find((t) => t.name === 'raise_ask');
  assert.match(
    tool?.description ?? '',
    /Never for work another Odd leads that you are on: .+ tell_lead\./
  );
  const own = await c.callTool({
    name: 'raise_ask',
    arguments: { ...ask, title: 'Pay the flour bill' }
  });
  assert.equal(own.isError, undefined, said(own));
  const [a] = (await raisedBy('jo')).asks;
  assert.equal(a.threadId, null);
});

test("a goal hire with a job opens its own job's work as a thread of its own", async () => {
  const c = await toolServer('jo', { ...chat, RUN_KEY: 'k-jo-open' });
  const own = await c.callTool({
    name: 'hand_off',
    arguments: { to: 'pia', title: 'Count the till', brief: 'Count it.' }
  });
  assert.equal(own.isError, undefined, said(own));
  const [led] = await db.select().from(threads).where(eq(threads.hubId, 'jo'));
  assert.equal(led.goalId, null, "its own job's work opens a thread of its own");
});

test('a lead off its threads may say which thread an ask is for, left out reads as none, and one it does not lead is refused', async () => {
  const c = await toolServer('mo', { ...chat, RUN_KEY: 'k-mo' });
  const tool = (await c.listTools()).tools.find((t) => t.name === 'raise_ask');
  assert.ok(tool && 'work' in (tool.inputSchema.properties ?? {}), 'a lead is offered work');
  assert.ok(
    !tool.inputSchema.required?.includes('work'),
    'work may be left out, and then the ask is for none of it'
  );
  const [lenas] = await db.select().from(threads).where(eq(threads.hubId, 'lead'));
  const wrong = await c.callTool({ name: 'raise_ask', arguments: { ...ask, work: lenas.id } });
  assert.equal(wrong.isError, true);
  assert.match(said(wrong), /not work you lead/);
  const right = await c.callTool({ name: 'raise_ask', arguments: { ...ask, work: sale.id } });
  assert.equal(right.isError, undefined, said(right));
  const [a] = (await raisedBy('mo')).asks;
  assert.equal(a.threadId, sale.id);
  const [t] = await db.select().from(threads).where(eq(threads.id, sale.id));
  assert.deepEqual(t.runs, ['k-mo'], "the lead's chat holds its pick-ups until it ends");
  assert.equal(t.status, 'open', 'the work stays open while the ask is on the desk');
});

test('a lead naming a thread it leads is never refused, even when it also serves a goal another Odd leads', async () => {
  // Lena leads the summer fair's thread, from her plan, has a job, and serves Mo's bake sale.
  await db.insert(jobs).values({
    staffId: 'lead',
    name: 'Daily post',
    instructions: 'Sort it.',
    schedule: { every: 'day', at: '09:00' }
  });
  await db.insert(staffGoals).values({ staffId: 'lead', goalId: fair.id, part: 'The till' });
  const [own] = await db.select().from(threads).where(eq(threads.title, 'Host the summer fair'));
  assert.equal(own.hubId, 'lead');
  const c = await toolServer('lead', { ...chat, RUN_KEY: 'k-lena' });
  const r = await c.callTool({
    name: 'raise_ask',
    arguments: { ...ask, title: 'Book the field', work: own.id }
  });
  assert.equal(r.isError, undefined, said(r));
  const [a] = await db.select().from(asks).where(eq(asks.title, 'Book the field'));
  assert.equal(a.threadId, own.id);
});
