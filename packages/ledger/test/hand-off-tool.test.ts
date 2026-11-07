// The hand_off tool as a run sees it: the office tool server (src/mcp.ts) in a
// process of its own, as the office starts one for each run, over the office's
// own database (local-db.ts) in a throwaway folder on a free port. It checks
// what only the tool server decides: which runs are offered hand_off, that a
// hand-off or a goal's plan carries the run's key to its thread, that a
// hand-off that hands nothing on comes back as an error and one held for the
// owner's yes says it goes ahead on it, what a hand-off's result says, and where an ask or task raised in a chat goes: a goal's work
// to its lead, never onto the desk from a colleague, and a lead's onto the
// thread it names. A goal hire with no job opens no work and puts nothing on
// the desk through any tool. Every tool refuses a key it does not take, so an
// old parameter name does nothing. After every test each goal still has one
// thread. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { db, sql, toolServer } from './tool-server.ts';
import { oneThreadPerGoal } from './one-thread.ts';

const { connectors, goals, grants, staff, threads } = await import('../src/schema.ts');
const { eq, inArray } = await import('drizzle-orm');
const { OFFICE_TOOLS, STARTER_TOOLS } = await import('../src/tools.ts');
const { MANAGER_ROLE } = await import('../src/managers.ts');
const { HAND_OFF_LIMIT, LEADS_NONE } = await import('../src/threads.ts');
afterEach(() => oneThreadPerGoal(sql, MANAGER_ROLE));

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
await db
  .insert(staff)
  .values([
    { ...odd('lead', 'Lena'), tools: [...STARTER_TOOLS, 'propose_goal_plan'] },
    odd('paige', 'Paige')
  ]);
// Lena reads Gmail, which Paige lacks.
// Every office has Gmail (0009_google): mark it connected.
await db.update(connectors).set({ readyAt: new Date() }).where(eq(connectors.id, 'gmail'));
await db.insert(grants).values({ staffId: 'lead', connectorId: 'gmail', level: 'read' });

const handOffTool = async (c: Client) =>
  (await c.listTools()).tools.find((t) => t.name === 'hand_off');
/** The first text a tool call returned. */
const said = (r: Awaited<ReturnType<Client['callTool']>>) =>
  (r.content as { type: string; text: string }[])[0]?.text ?? '';

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

// A goal's thread, led by Mo, that Pia (no job) and Jo (a job) serve.
const { asks, jobs, staffGoals, tasks } = await import('../src/schema.ts');
await db
  .insert(staff)
  .values([
    odd('mo', 'Mo'),
    { ...odd('pia', 'Pia'), tools: [...STARTER_TOOLS, 'propose_hire'] },
    odd('jo', 'Jo')
  ]);
// A job description Pia could propose a hire with, so only the goal check stops it.
const { home } = await import('../src/home.ts');
mkdirSync(home('staff', 'pia', 'notes'), { recursive: true });
writeFileSync(home('staff', 'pia', 'notes', 'jd-printer.md'), 'Prints signs.');
const [fair] = await db.insert(goals).values({ title: 'Run the bake sale' }).returning();
const [sale] = await db
  .insert(threads)
  .values({ title: fair.title, goalId: fair.id, hubId: 'mo', holderId: 'mo' })
  .returning();
await db.insert(staffGoals).values([
  { staffId: 'pia', goalId: fair.id, part: 'The signs' },
  { staffId: 'jo', goalId: fair.id, part: 'The cakes' }
]);
await db.insert(jobs).values({
  staffId: 'jo',
  name: 'Weekly accounts',
  instructions: 'Add up.',
  schedule: { every: 'day', at: '09:00' }
});
const chat = { OWNER_SAID: 'Pia, can you make the signs blue?' };
const ask = { title: 'Make the signs blue', why: 'They asked.', if_approved: 'I make them.' };
const raisedBy = async (staffId: string) => ({
  asks: await db.select().from(asks).where(eq(asks.staffId, staffId)),
  tasks: await db.select().from(tasks).where(eq(tasks.staffId, staffId))
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

test('a lead off its threads must say which thread an ask is for, and one it does not lead is refused', async () => {
  const c = await toolServer('mo', { ...chat, RUN_KEY: 'k-mo' });
  const tool = (await c.listTools()).tools.find((t) => t.name === 'raise_ask');
  assert.ok(tool?.inputSchema.required?.includes('work'), 'it has to choose, null or a number');
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

// A chat resumed after a parameter was renamed still uses the old name. Every
// tool refuses a key it does not take (mcp.ts `tool`), and names the ones it does.
/** A finished piece of work Lena leads, to continue. */
const finished = async (title: string) =>
  (
    await db
      .insert(threads)
      .values({
        title,
        hubId: 'lead',
        holderId: 'lead',
        status: 'done',
        endedAt: new Date()
      })
      .returning()
  )[0];
const workCount = async () => (await db.select().from(threads)).length;
const more = { to: 'paige', brief: 'Do it again.' };

test("a hand_off with a parameter's old name is refused, names continue_work, and opens no new work", async () => {
  const t = await finished('Fold the napkins');
  const c = await toolServer('lead', { RUN_KEY: 'k-old-name' });
  const before = await workCount();
  const r = await c.callTool({
    name: 'hand_off',
    arguments: { ...more, title: 'Fold more napkins', continue_thread: t.id }
  });
  assert.equal(r.isError, true, said(r));
  assert.match(said(r), /hand_off takes only .*\bcontinue_work\b.*\. Nothing was done\./);
  assert.equal(await workCount(), before, 'the old name opened new work');
});

test("a raise_ask with a parameter's old name is refused, names work, and puts nothing on the desk", async () => {
  const before = (await raisedBy('mo')).asks.length;
  const c = await toolServer('mo', { ...chat, RUN_KEY: 'k-mo-old' });
  const r = await c.callTool({ name: 'raise_ask', arguments: { ...ask, thread: sale.id } });
  assert.equal(r.isError, true, said(r));
  assert.match(said(r), /raise_ask takes only .*\bwork\b.*\. Nothing was done\./);
  assert.equal((await raisedBy('mo')).asks.length, before);
});

test('a call with only the keys a tool takes still works, with its optional ones or without', async () => {
  const t = await finished('Iron the cloths');
  const c = await toolServer('lead', { RUN_KEY: 'k-known' });
  const before = await workCount();
  const r = await c.callTool({
    name: 'hand_off',
    arguments: { ...more, title: 'Iron more cloths', continue_work: t.id }
  });
  assert.equal(r.isError, undefined, said(r));
  assert.match(said(r), new RegExp(`on work ${t.id}\\.`));
  assert.equal(await workCount(), before, 'continuing opened new work');
  const asks = await c.callTool({ name: 'my_asks', arguments: {} });
  assert.equal(asks.isError, undefined, said(asks));
});

test('every office tool refuses a key it does not take, and says which keys it does', async () => {
  // Every office tool granted, serving the bake sale Mo leads: a chat offers
  // tell_lead, and a run on that work offers resume_at.
  await db.insert(staff).values({ ...odd('all', 'Ada'), tools: OFFICE_TOOLS.map((t) => t.id) });
  await db.insert(staffGoals).values({ staffId: 'all', goalId: fair.id, part: 'Everything' });
  // Gmail at any level offers propose_reply.
  await db.insert(grants).values({ staffId: 'all', connectorId: 'gmail', level: 'read' });
  const reached = new Set<string>();
  const runs: Record<string, string>[] = [chat, { THREAD_ID: String(sale.id) }];
  for (const env of runs) {
    const c = await toolServer('all', { ...env, RUN_KEY: `k-all-${reached.size}` });
    for (const { name } of (await c.listTools()).tools) {
      reached.add(name);
      const r = await c.callTool({ name, arguments: { not_a_key: 1 } });
      assert.equal(r.isError, true, `${name}: ${said(r)}`);
      assert.match(said(r), new RegExp(`${name} takes (only|no arguments).*Nothing was done\\.`));
    }
  }
  assert.deepEqual(
    OFFICE_TOOLS.map((t) => t.id).filter((id) => !reached.has(id)),
    [],
    'an office tool this test never reached'
  );
  assert.deepEqual(await raisedBy('all'), { asks: [], tasks: [] });
  assert.deepEqual(await db.select().from(threads).where(eq(threads.hubId, 'all')), []);
});

test("the hand_off tool names what each colleague lacks of the lead's tools once, in plain words", async () => {
  // The tool server's home, holding the folder Lena gave her Odds, so it is
  // shown as ~/x and is on the disk for a colleague that has it.
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-lacks-')));
  const x = join(home, 'x');
  mkdirSync(x);
  const folders = [{ path: x, write: false }];
  await db.update(staff).set({ web: true, folders }).where(eq(staff.id, 'lead'));
  // Wes has Gmail and the web, so lacks the folder; Fay has Gmail and the folder, so lacks the web.
  await db.insert(staff).values([
    { ...odd('wes', 'Wes'), web: true },
    { ...odd('fay', 'Fay'), folders }
  ]);
  await db
    .insert(grants)
    .values(
      ['wes', 'fay'].map((staffId) => ({ staffId, connectorId: 'gmail', level: 'read' as const }))
    );
  try {
    const t = await handOffTool(
      await toolServer('lead', { RUN_KEY: 'k-lacks', HOME: home, USERPROFILE: home })
    );
    const lines = (t?.description ?? '').split('\n');
    for (const line of [
      `- wes: Wes, Tester. Tests. Lacks your folder ${join('~', 'x')}.`,
      '- fay: Fay, Tester. Tests. Lacks the web.',
      `- paige: Paige, Tester. Tests. Lacks your Gmail, the web, and your folder ${join('~', 'x')}.`
    ])
      assert.ok(lines.includes(line), `${line}\n${t?.description}`);
  } finally {
    await db.delete(grants).where(inArray(grants.staffId, ['wes', 'fay']));
    await db.delete(staff).where(inArray(staff.id, ['wes', 'fay']));
    await db.update(staff).set({ web: false, folders: [] }).where(eq(staff.id, 'lead'));
    rmSync(home, { recursive: true, force: true });
  }
});
