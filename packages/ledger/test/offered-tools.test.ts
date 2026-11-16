// The tools a run is offered, and continuing finished work. Run with `npm test -w @oddboro/ledger`.
import {
  odd,
  handOffTool,
  said,
  fair,
  sale,
  HOLDERS,
  chat,
  ask,
  raisedBy,
  workCount
} from './hand-off-setup.ts';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { db, toolServer } from './tool-server.ts';
import { TEMP_IN_APPDATA } from './store-states.ts';

const {
  asks: asksTable,
  connectors,
  grants,
  owner,
  staff,
  tasks: tasksTable,
  threads
} = await import('../src/schema.ts');
const { ASK_REPLACED } = await import('../src/desk-answers.ts');
const { eq, inArray } = await import('drizzle-orm');
const { isOffered, OFFICE_TOOLS, RIDES_WITH } = await import('../src/tools.ts');
const { connectProject, shareProject } = await import('../src/project-sessions.ts');
const { staffGoals, staffSkills, tasks } = await import('../src/schema.ts');

// A chat resumed after a parameter was renamed still uses the old name. Every
// tool refuses a key it does not take (mcp-run.ts `tool`), and names the ones it does.
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

test('my_tasks lists each task the Odd gave and how the owner finished it', async () => {
  await db.insert(staff).values(odd('tasker', 'Tasha'));
  const given = (title: string) => ({ staffId: 'tasker', title, why: 'w' });
  await db.insert(tasksTable).values([
    {
      ...given('Pick a blue'),
      status: 'done',
      doneAt: new Date(),
      note: 'Thanks.',
      steps: [
        {
          text: 'Pick one',
          done: true,
          action: { kind: 'choice', options: ['Navy'] },
          answer: 'Navy'
        }
      ]
    },
    { ...given('Sign the form'), status: 'dropped', doneAt: new Date(), steps: [] },
    {
      ...given('Sort the post'),
      steps: [
        { text: 'Pick one', done: true, action: { kind: 'choice', options: ['A'] }, answer: 'A' }
      ]
    }
  ]);
  const r = await (
    await toolServer('tasker', { RUN_KEY: 'k-tasks' })
  ).callTool({
    name: 'my_tasks',
    arguments: {}
  });
  assert.equal(r.isError, undefined, said(r));
  assert.match(said(r), /FINISHED: Pick a blue \(Pick one: Navy Thanks\.\)/);
  assert.match(said(r), /DROPPED: Sign the form$/m);
  assert.match(said(r), /OPEN: Sort the post$/m);
});

test('my_asks says an ask the Odd replaced was replaced, and still says what the owner sent back', async () => {
  await db.insert(staff).values(odd('asker', 'Asha'));
  const raised = (title: string) => ({ staffId: 'asker', title, why: 'w', ifApproved: 'i' });
  await db.insert(asksTable).values([
    { ...raised('Buy paint'), status: 'revise', reason: ASK_REPLACED, decidedAt: new Date() },
    { ...raised('Buy brushes'), status: 'revise', reason: 'Fewer.', decidedAt: new Date() }
  ]);
  const r = await (
    await toolServer('asker', { RUN_KEY: 'k-asks' })
  ).callTool({
    name: 'my_asks',
    arguments: {}
  });
  assert.equal(r.isError, undefined, said(r));
  assert.match(said(r), /REPLACED: Buy paint$/m);
  assert.match(said(r), /SENT BACK: Buy brushes \(change: Fewer\.\)/);
  assert.ok(!said(r).includes(ASK_REPLACED), said(r));
});

test('every office tool refuses a key it does not take, and says which keys it does', async () => {
  // Every office tool granted, serving the bake sale Mo leads: a chat offers
  // tell_lead, and a run on that work offers resume_at.
  await db.insert(staff).values({ ...odd('all', 'Ada'), tools: OFFICE_TOOLS.map((t) => t.id) });
  await db.insert(staffGoals).values({ staffId: 'all', goalId: fair.id, part: 'Everything' });
  // Gmail at any level offers propose_reply, and at write ask_for_standing_yes.
  await db.insert(grants).values({ staffId: 'all', connectorId: 'gmail', level: 'act' });
  // A skill the owner attached offers read_skill.
  await db
    .insert(staffSkills)
    .values({ staffId: 'all', name: 'every', description: 'Use always.', text: 'Do it.' });
  // A native conversation shared with Ada offers the project tools, in Advanced
  // mode. The owner row keeps the name every other test here reads.
  await db
    .insert(owner)
    .values({ name: 'the owner', advancedAt: new Date() })
    .onConflictDoUpdate({ target: owner.id, set: { advancedAt: new Date() } });
  const project = await connectProject('claude', 'every-tool-test', '/project', 'Tests');
  await shareProject(project.id, 'all');
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
    OFFICE_TOOLS.filter((t) => !t.prompt)
      .map((t) => t.id)
      .filter((id) => !reached.has(id)),
    [],
    'an office tool this test never reached'
  );
  assert.deepEqual(await raisedBy('all'), { asks: [], tasks: [] });
  assert.deepEqual(await db.select().from(threads).where(eq(threads.hubId, 'all')), []);
});

// A chat with the owner's words offers tell_lead, and a run on the sale's
// thread offers resume_at.
const RUNS = { chat, thread: { THREAD_ID: String(sale.id) } };
type Run = keyof typeof RUNS;
/**
 * A tool that rides with a listed one and is offered in one kind of run only.
 * A listed tool says so on its own row (`inChat`), which the test reads and a
 * test below pins.
 */
const RIDES_ONLY_IN: Partial<Record<keyof typeof RIDES_WITH, Run>> = { resume_at: 'thread' };
const registered = async (staffId: string, run: Run) => {
  const c = await toolServer(staffId, { ...RUNS[run], RUN_KEY: `k-${staffId}-${run}` });
  return (await c.listTools()).tools.map((t) => t.name).sort();
};

test('every tool the server registers is a listed office tool or rides with one', async () => {
  const listed = new Set<string>([...OFFICE_TOOLS.map((t) => t.id), ...Object.keys(RIDES_WITH)]);
  for (const run of ['chat', 'thread'] as const)
    assert.deepEqual(
      (await registered('tot', run)).filter((n) => !listed.has(n)),
      [],
      run
    );
});

// One test per tool server: each takes seconds to start, and a test has 15.
for (const [id, holds] of Object.entries(HOLDERS))
  for (const run of ['chat', 'thread'] as const)
    test(`an Odd holding ${holds.length} of the office tools (${id}) in a ${run} has exactly the always tools, the ones it holds and the ones that ride with them, as each row's conditions allow`, async () => {
      // None of these Odds is the Office Manager, only Tot holds Gmail, and none at Read and write.
      const toolRun = { gmail: id === 'tot', write: false, chat: run === 'chat', manager: false };
      const offered = new Set<string>(
        OFFICE_TOOLS.filter((t) => isOffered(holds, t.id, toolRun)).map((t) => t.id)
      );
      // A cast only to name the keys: Object.keys types them as strings.
      const riding = (Object.keys(RIDES_WITH) as (keyof typeof RIDES_WITH)[]).filter(
        (name) => offered.has(RIDES_WITH[name]) && (RIDES_ONLY_IN[name] ?? run) === run
      );
      const want = [...offered, ...riding].sort();
      assert.deepEqual(await registered(id, run), want, `${id} in a ${run}`);
    });

// The test above works out what a run gets with `isOffered`, so a condition
// dropped from a row, or from `isOffered`, changes what it expects too. These
// hold the rows themselves, and what `isOffered` gives for each condition.
test('only leave_office, withdraw, tell_lead, draft_bug_report, oddboro_update, remove_odd and bring_back_odd wait for a chat, only leave_office is kept from the manager, and only see_office shapes the prompt and is never offered, even to a chat holding it', () => {
  const where = (field: 'inChat' | 'notToManager' | 'prompt') =>
    OFFICE_TOOLS.filter((t) => t[field]).map((t) => t.id);
  assert.deepEqual(where('inChat'), [
    'leave_office',
    'withdraw',
    'tell_lead',
    'draft_bug_report',
    'oddboro_update',
    'remove_odd',
    'bring_back_odd'
  ]);
  assert.deepEqual(where('notToManager'), ['leave_office']);
  assert.deepEqual(where('prompt'), ['see_office']);
  assert.equal(
    isOffered(['see_office'], 'see_office', { chat: true, manager: false, gmail: false }),
    false
  );
});

test('isOffered gives an always tool to every run its row allows, and a held tool only to an Odd holding it', () => {
  const job = { chat: false, manager: false, gmail: false };
  const chatRun = { ...job, chat: true };
  // my_tasks sets no condition: even the manager's job run with no Gmail has it.
  assert.equal(isOffered([], 'my_tasks', { ...job, manager: true }), true);
  assert.equal(isOffered([], 'leave_office', chatRun), true);
  assert.equal(isOffered([], 'leave_office', job), false);
  assert.equal(isOffered([], 'leave_office', { ...chatRun, manager: true }), false);
  assert.equal(isOffered([], 'tell_lead', job), false);
  assert.equal(isOffered([], 'tell_lead', chatRun), true);
  assert.equal(isOffered([], 'propose_reply', chatRun), false);
  assert.equal(isOffered([], 'propose_reply', { ...job, gmail: true }), true);
  assert.equal(isOffered([], 'ask_for_standing_yes', job), false);
  assert.equal(isOffered([], 'ask_for_standing_yes', { ...job, write: true }), true);
  assert.equal(isOffered([], 'search_ledger', chatRun), false);
  assert.equal(isOffered(['search_ledger'], 'search_ledger', job), true);
});

test('a hire proposal names every office tool the owner can give, and none every Odd has', async () => {
  const c = await toolServer('tot', { RUN_KEY: 'k-tot-hint' });
  const hire = (await c.listTools()).tools.find((t) => t.name === 'propose_hire');
  const hint = (hire?.inputSchema.properties?.office_tools as { description?: string })
    ?.description;
  const named = hint?.match(/has: (.*)\. Leave/)?.[1].split(', ');
  assert.deepEqual(
    named,
    OFFICE_TOOLS.filter((t) => !t.always).map((t) => t.id)
  );
});

test(
  "the hand_off tool names what each colleague lacks of the lead's tools once, in plain words",
  { skip: TEMP_IN_APPDATA },
  async () => {
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
      const t = await handOffTool(await toolServer('lead', { RUN_KEY: 'k-lacks', HOME: home }));
      const lines = (t?.description ?? '').split('\n');
      for (const line of [
        '- wes: Wes, Tester. Tests. Lacks your folder ~/x.',
        '- fay: Fay, Tester. Tests. Lacks the web.',
        '- paige: Paige, Tester. Tests. Lacks your Gmail, the web, and your folder ~/x.'
      ])
        assert.ok(lines.includes(line), `${line}\n${t?.description}`);
    } finally {
      await db.delete(grants).where(inArray(grants.staffId, ['wes', 'fay']));
      await db.delete(staff).where(inArray(staff.id, ['wes', 'fay']));
      await db.update(staff).set({ web: false, folders: [] }).where(eq(staff.id, 'lead'));
      rmSync(home, { recursive: true, force: true });
    }
  }
);

test("an Odd that names GitHub's address with a key header gets the catalog's GitHub, which signs in", async () => {
  const c = await toolServer('jo', { RUN_KEY: 'k-jo-github' });
  const r = await c.callTool({
    name: 'ask_for_access',
    arguments: {
      connector: 'https://api.githubcopilot.com/mcp/x/repos/readonly',
      level: 'read',
      why: 'Read the repositories.',
      key_header: 'Authorization'
    }
  });
  assert.equal(r.isError, undefined, said(r));
  const [github] = await db.select().from(connectors).where(eq(connectors.id, 'github'));
  assert.deepEqual(github?.config, { url: 'https://api.githubcopilot.com/mcp/', oauth: true });
  const asked = (await raisedBy('jo')).asks.filter((a) => a.kind === 'access');
  assert.deepEqual(
    asked.map((a) => a.access?.connector),
    ['github']
  );
  const byAddress = (await db.select().from(connectors)).filter((x) => x.id !== 'github');
  assert.ok(!byAddress.some((x) => x.config.url?.includes('githubcopilot')));
});

test("resume_at after_task parks on another work's open task, and refuses one done, on this work, or missing", async () => {
  await db.insert(staff).values(odd('tess', 'Tess'));
  const work = async (title: string) =>
    (await db.insert(threads).values({ title, hubId: 'tess', holderId: 'tess' }).returning())[0];
  const mine = await work('Plan the menu');
  const other = await work('Book the caterer');
  const task = async (title: string, threadId: number, status: 'open' | 'done' = 'open') =>
    (
      await db
        .insert(tasks)
        // A done task has its time, as the office ends one.
        .values({
          staffId: 'tess',
          title,
          why: 'w',
          steps: [],
          threadId,
          status,
          doneAt: status === 'done' ? new Date() : null
        })
        .returning()
    )[0];
  const open = await task('Proof the menu', other.id);
  const done = await task('Print the menu', other.id, 'done');
  const onThis = await task('Taste the soup', mine.id);
  const c = await toolServer('tess', { RUN_KEY: 'k-tess', THREAD_ID: String(mine.id) });
  const park = (after_task: number, more: Record<string, unknown> = {}) =>
    c.callTool({ name: 'resume_at', arguments: { after_task, ...more } });
  const parkedOn = async (id: number) =>
    (await db.select().from(threads).where(eq(threads.id, id)))[0].resumeOnTask;

  const refusals: [Awaited<ReturnType<typeof park>>, RegExp][] = [
    [await park(done.id), /Already finished: do it now, in this run\./],
    [await park(onThis.id), /That task is on this work/],
    [await park(999_999), /There is no task 999999\./],
    [await park(open.id, { in_minutes: 5 }), /after_task alone/],
    [await park(open.id, { at: '18:50' }), /after_task alone/]
  ];
  for (const [r, why] of refusals) {
    assert.equal(r.isError, true, said(r));
    assert.match(said(r), why);
    assert.equal(await parkedOn(mine.id), null, said(r));
  }

  const r = await park(open.id);
  assert.ok(!r.isError, said(r));
  assert.match(
    said(r),
    new RegExp(`Work ${mine.id} picks back up when .+ drops "Proof the menu"\\.`)
  );
  assert.equal(await parkedOn(mine.id), open.id);

  const notMine = await toolServer('tess', { RUN_KEY: 'k-tess-2', THREAD_ID: String(sale.id) });
  const led = await notMine.callTool({ name: 'resume_at', arguments: { after_task: open.id } });
  assert.equal(led.isError, true, said(led));
  assert.match(said(led), /has ended, or is not work you lead/);
  assert.equal(await parkedOn(sale.id), null);
});
