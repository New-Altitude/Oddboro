// A run as the office starts it (`followThrough`, `chat`), in an office under
// test (office-under-test.ts). It checks the wiring only a run shows: which
// runs work at Draft or only read for a lesson, that the run's key reaches
// the tool server and is held in `runsGoing` while the run goes, what the
// colleague's run is handed when the owner lets work past its round's limit
// keep going, each tool's exact arguments, a run stuck before its tool starts,
// the manager's first questions and a new hire's first day. What a run is told
// of its work is in thread-run.test.ts, the tool an Odd runs on in
// runs-on.test.ts, Grok's runs in grok-run.test.ts and Codex's in
// codex-run.test.ts. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import type { McpServer } from './launch.ts';
import {
  L,
  assertKeychainUntouched,
  bus,
  filesOf,
  history,
  chat,
  chatOf,
  folder,
  followThrough,
  odd,
  ownerData,
  ownerHome,
  plain,
  hide,
  runOf,
  startedBy,
  type Gave
} from './office-under-test.ts';

// After the office under test is set up, as its own imports are: the office reads where everything is as it loads.
const { configServers } = await import('./launch.ts');
const { LAUNCHES } = await import('./cli.ts');
const { deniedEdits } = await import('./files.ts');

test("a colleague's run on a hand-off works at Draft, is not told to hand its colleagues work, and its key is held while it goes and only then", async () => {
  const h = await L.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Count the chairs', brief: 'Count them.' },
    thread: { title: 'The fair' }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const run = await runOf(h.id);
  // Paige holds hand_off, but a colleague's run is not offered it, so it is not told to call it.
  assert.match(run.system, /You cannot hand them work/);
  assert.doesNotMatch(run.system, /call hand_off/);
  assert.equal(run.env.CEILING, 'draft');
  assert.equal(run.env.LESSON_RUN, undefined);
  assert.equal(run.env.HAND_OFF_ID, String(h.id));
  assert.ok(run.env.RUN_KEY, 'the run has no key');
  assert.deepEqual(run.going, [run.env.RUN_KEY], 'the run went without its key held');
  assert.equal(L.runsGoing.size, 0, 'the key is still held after the run ended');
});

test("a run that reads the owner's no for a lesson works at Draft, hands nothing on and is not told the work its Odd leads; a carry-out is told it and does neither", async () => {
  // Work Lena leads, so a run that may hand on has a thread to be told of.
  await L.pg`insert into threads (title, hub_id, holder_id) values ('Plan the picnic', 'lead', 'lead')`;
  const no = await L.raiseAsk('lead', { title: 'Book the band', why: 'w', ifApproved: 'i' });
  await L.decideAsk(no.ask.id, 'deny', 'Never book on a Friday.');
  const lesson = await runOf(await startedBy(no.ask.id, 'denied'), no.ask.id);
  assert.equal(lesson.env.LESSON_RUN, '1');
  assert.equal(lesson.env.CEILING, 'draft');
  assert.doesNotMatch(lesson.system, /Plan the picnic/);
  assert.match(lesson.system, /You cannot hand them work/);
  assert.doesNotMatch(lesson.system, /call hand_off/);
  const yes = await L.raiseAsk('lead', { title: 'Book the hall', why: 'w', ifApproved: 'i' });
  await L.decideAsk(yes.ask.id, 'approve', null);
  const carry = await runOf(await startedBy(yes.ask.id, 'carry_out'), yes.ask.id);
  assert.equal(carry.env.LESSON_RUN, undefined);
  assert.equal(carry.env.CEILING, undefined);
  assert.equal(carry.env.APPROVED_ASK, String(yes.ask.id));
  assert.match(carry.system, /Plan the picnic/);
});

test('a twin pair of access asks starts one carry-out, on the hand-off twin, told it also answers the other; and a run lists what its Odd has open on the desk', async () => {
  const h = await L.handOff({
    from: 'lead',
    to: 'cleo',
    work: { title: 'Read the inbox', brief: 'Read it.' },
    thread: { title: 'The inbox' }
  });
  assert.ok('id' in h, JSON.stringify(h));
  // Its run ended waiting on the owner, so the carry-out on the thread may start.
  const handed = await L.startFollowUp(h.id);
  assert.ok(handed, "Cleo's hand-off could not start");
  await L.finishFollowUp(handed, 'Read the inbox', 'waiting', 'Asked for Gmail.');
  const access = { connector: 'gmail', level: 'read' as const };
  const firstDay = await L.raiseAsk('cleo', {
    title: 'Connect Gmail (read)',
    why: 'w',
    ifApproved: 'i',
    access
  });
  const twin = await L.raiseAsk('cleo', {
    title: 'Connect Gmail (read)',
    why: 'w',
    ifApproved: 'i',
    access,
    handOffId: h.id,
    threadId: h.thread
  });
  await L.decideAsk(firstDay.ask.id, 'approve', null);
  const [connect] = await L.pg<{ id: number }[]>`
    select id from tasks where ask_id = ${firstDay.ask.id}`;
  await L.finishTask(connect.id, true, null);
  const carries = await L.pg<{ id: number; askId: number }[]>`
    select id, ask_id as "askId" from follow_ups where staff_id = 'cleo' and kind = 'carry_out'`;
  assert.deepEqual(
    carries.map((c) => c.askId),
    [twin.ask.id]
  );
  const task = await L.giveTask('cleo', { title: 'Pick a label', why: 'w', steps: ['Pick one.'] });
  // The floor shows the carry-out as serving the hand-off, so the giver's chat reads Cleo back on it while it goes.
  const serving = new Set<number | undefined>();
  const seen = (e: { type: string; inProgress?: Record<string, { handOffId?: number }[]> }) => {
    if (e.type === 'working') for (const w of e.inProgress?.cleo ?? []) serving.add(w.handOffId);
  };
  bus.on('event', seen);
  const run = await runOf(carries[0].id, twin.ask.id).finally(() => bus.off('event', seen));
  assert.deepEqual([...serving], [h.id]);
  assert.ok(
    run.system.includes(
      `This also answers your ask #${firstDay.ask.id}, which another of your runs raised for the same tool: do that work once, here.`
    ),
    run.system
  );
  assert.ok(
    run.system.includes(
      `## Still on the owner's desk from you\n\n- Task #${task.id}: Pick a label\n`
    ),
    run.system
  );
});

test("the colleague's run a yes to keep going starts is handed the held work as the lead wrote it", async () => {
  const stall = (thread: { id: number } | { title: string }) =>
    L.handOff({
      from: 'lead',
      to: 'paige',
      work: { title: 'Plan a stall', brief: 'Plan it.' },
      thread
    });
  const first = await stall({ title: 'The stalls' });
  assert.ok('id' in first, JSON.stringify(first));
  for (let n = 2; n <= L.HAND_OFF_LIMIT; n++)
    assert.ok('id' in (await stall({ id: first.thread })));
  const over = await stall({ id: first.thread });
  assert.ok('asked' in over, JSON.stringify(over));
  const [prior] = await L.pg<{ n: number }[]>`
    select count(*)::int as n from follow_ups where thread_id = ${over.thread} and kind = 'hand_off'`;
  await L.decideAsk(over.asked, 'approve', null);
  const [held] = await L.pg<{ id: number }[]>`
    select id from follow_ups where thread_id = ${over.thread} and kind = 'hand_off'
    order by id desc limit 1`;
  const [after] = await L.pg<{ n: number }[]>`
    select count(*)::int as n from follow_ups where thread_id = ${over.thread} and kind = 'hand_off'`;
  assert.equal(after.n, prior.n + 1, 'the yes started no hand-off');
  const run = await runOf(held.id);
  assert.equal(run.env.HAND_OFF_ID, String(held.id));
  const told = `${run.system}\n${run.message}`;
  assert.match(told, /Lena handed you a piece of work/);
  assert.match(told, /- What: Plan a stall/);
  assert.match(told, /Plan it\./);
});

/** One command server and one hosted one, as access() builds them, and as a run's config has always written them. */
const SERVERS = {
  office: { type: 'stdio', command: 'node', args: ['mcp.ts'], env: { RUN_KEY: 'k' } },
  notes: { type: 'http', url: 'https://notes.example/mcp', headers: { Authorization: 'a' } }
} satisfies Record<string, McpServer>;
const WRITTEN = {
  office: { command: 'node', args: ['mcp.ts'], env: { RUN_KEY: 'k' } },
  notes: { type: 'http', url: 'https://notes.example/mcp', headers: { Authorization: 'a' } }
};

test("a Claude Code run's MCP config gives a command server and a hosted one in the shape it always had", async () => {
  const { mcp } = await chatOf('cleo');
  const config = mcp as { mcpServers: Record<string, object> };
  assert.deepEqual(Object.keys(config.mcpServers.office), ['command', 'args', 'env']);
  assert.deepEqual(configServers(SERVERS), WRITTEN);
});

test("a Grok run's agent file gives a command server and a hosted one in the shape it always had", async () => {
  const dir = join(folder, 'staff', 'gus');
  const launch = await LAUNCHES.grok({
    key: 'agent-file-shape',
    account: 'office',
    staffId: 'gus',
    dir,
    reads: [],
    writes: [dir],
    granted: [],
    commands: false,
    network: false,
    system: 'You are Gus.',
    input: 'Hello.',
    servers: SERVERS,
    allowed: [],
    timeoutMs: 60_000,
    web: false
  });
  assert.ok('args' in launch, JSON.stringify(launch));
  const agent = readFileSync(launch.args[launch.args.indexOf('--agent') + 1], 'utf8');
  launch.done();
  // Grok takes a list of one-server objects, in the order the run's servers
  // come, and each command server keeps the owner's home (`ownersHome`).
  assert.deepEqual(JSON.parse(/^mcpServers: (.*)$/m.exec(agent)![1]), [
    { office: { ...WRITTEN.office, env: { ...WRITTEN.office.env, HOME: homedir() } } },
    { notes: WRITTEN.notes }
  ]);
});

/** Wait until `ok`. */
async function until(ok: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error('Waited too long');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('a run stuck before its tool starts ends at its time limit, saying where it stopped, and its tool never starts after', async () => {
  const { run } = await import('./staff.ts');
  const cleo = (await L.staffer('cleo'))!;
  const logged: string[] = [];
  const log = mock.method(console, 'error', (...a: unknown[]) => {
    logged.push(a.map(String).join(' '));
  });
  // Opening the run's tools reads the Odd's lessons: a lock on them holds the
  // run while it gets ready, as a hung database or embedding once held a chat.
  // On a connection of its own, since the held run takes the ledger's.
  const pg = L.openPool(L.DATABASE_URL, { max: 2, onnotice: () => {} });
  const lock = await pg.reserve();
  const events: { type: string; message?: string }[] = [];
  try {
    await lock`begin`;
    await lock`lock table lessons in access exclusive mode`;
    const started = Date.now();
    const r = await run(cleo, 'Hello?', {
      kind: 'chat',
      timeoutMs: 2_000,
      onEvent: (e) => void events.push(e)
    });
    assert.equal(r.ok, false);
    assert.match(r.text, /^No reply after /);
    assert.ok(Date.now() - started < 4_000, 'the run outlived its time limit');
    assert.deepEqual(events, [{ type: 'error', message: r.text }]);
    assert.ok(
      logged.some((l) =>
        /^Cleo's chat run stopped after .+ minutes, opening its tools' gateway\.$/.test(l)
      ),
      logged.join('\n')
    );
  } finally {
    await lock`rollback`;
    lock.release();
    await pg.end();
  }
  // With the lock gone the run gets ready, too late: Claude Code never starts.
  await until(() => logged.some((l) => l.endsWith('so Claude Code never started.')));
  assert.equal(L.runsGoing.size, 0);
  assert.equal(events.length, 1, 'the owner was told twice');
  log.mock.restore();
});

test("a Claude Code Odd's chat gets the arguments it always had, with its rules, sandbox and system prompt in files, the office's file tools in place of its own, plus the new instruction files' denies", async () => {
  const run = await chatOf('sam');
  const { args } = run;
  assert.deepEqual(plain(hide(args, '--mcp-config', '--settings', '--append-system-prompt-file')), [
    '-p',
    // A chat reads stream-json, so Send now can add to its turn.
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    // The office carries its files, and it has no shell or web: no tool of its own at all.
    '--tools',
    '',
    '--permission-mode',
    'dontAsk',
    '--setting-sources',
    'user',
    '--strict-mcp-config',
    '--mcp-config',
    '<mcp-config>',
    '--disable-slash-commands',
    '--settings',
    '<settings>',
    '--add-dir',
    '<home>/data',
    '--model',
    'opus',
    // No level picked: Medium (`effortFor`).
    '--effort',
    'medium',
    '--append-system-prompt-file',
    '<append-system-prompt-file>',
    '--session-id',
    '<id>'
  ]);
  const { allow, deny } = run.claudeSettings!.permissions;
  // The sessions folder Claude Code names after the Odd's folder differs from Mac to Mac.
  assert.deepEqual(
    plain(allow).map((a) =>
      /^Read\(\/~\/\.claude\/projects\/[^/]+\/\*\*\)$/.test(a) ? '<sessions>' : a
    ),
    [
      'Read(/<home>/staff/sam/**)',
      'Read(/<home>/data/**)',
      '<sessions>',
      'Edit(/<home>/staff/sam/**)',
      'mcp__office',
      'mcp__files'
    ]
  );
  // What the home folder holds differs from Mac to Mac, so the read denies are compared apart.
  assert.deepEqual(
    plain(deny).filter((a) => !a.startsWith('Read(')),
    // cb54187's instruction-file denies, plus Grok's, Codex's and Gemini's for an Odd that
    // might move to one, each as the path and everything under it (`denyRules`).
    [
      'CLAUDE.md',
      'CLAUDE.local.md',
      '.claude',
      '.grok',
      'AGENTS.md',
      '.mcp.json',
      'AGENTS.override.md',
      '.codex',
      '.agents',
      'GEMINI.md',
      '.gemini'
    ].flatMap((f) =>
      [`/<home>/staff/sam/${f}`, `/<home>/staff/sam/**/${f}`].flatMap((p) => [
        `Edit(${p})`,
        `Edit(${p}/**)`
      ])
    )
    // No repository's hooks or config: those are refused only in a folder the owner gave it (`repoRunPaths`).
  );
  // Each read deny holds the folder itself and what is in it.
  const denied = plain(deny);
  assert.ok(denied.includes('Read(/~/.ssh)') && denied.includes('Read(/~/.ssh/**)'));
  // The office's file server, under this Node, holds the folders the rules above name.
  const dir = join(folder, 'staff', 'sam');
  assert.deepEqual(filesOf(run), {
    command: process.execPath,
    args: [L.FILES_SERVER],
    walls: {
      cwd: dir,
      reads: [ownerData],
      writes: [dir],
      noWrite: deniedEdits({ dir, writes: [dir], granted: [] })
    }
  });
});

test("a Claude Code run for an owner with hundreds of Claude Code projects fits on Windows' command line, each project's deny in its settings file", () =>
  ownerHome(async (home) => {
    const projects = join(home, '.claude', 'projects');
    const named = (i: number) =>
      join(projects, `-Users-someone-code-a-project-with-a-long-name-${i}`);
    for (let i = 0; i < 400; i++) mkdirSync(named(i), { recursive: true });
    const run = await chatOf('cleo');
    // Windows quotes each argument and parts them with a space, 32,767 characters in all.
    const line = run.args.reduce((n, a) => n + a.length + 3, 0);
    assert.ok(line < 4_000, `the command line takes ${line} characters`);
    assert.ok(run.claudeSettings!.permissions.deny.includes(`Read(${L.rulePath(named(399))}/**)`));
  }));

test("a manager's first three questions come one at a time: the office asks the next at once with no run, and the third answer runs the manager with all three in its chat", async () => {
  const { sayInChat } = await import('./staff.ts');
  await L.pg`insert into staff ${L.pg([odd('mona', 'Mona')])}`;
  sayInChat('mona', L.MANAGERS[0].hello('Ada'));
  const said: { type: string; text?: string }[] = [];
  const answer = (text: string) => chat('mona', text, (e) => said.push(e));

  // Each tap gets an acknowledgment and the next set of choices without a run.
  const [first, second, third] = L.FIRST_QUESTIONS;
  await answer(first.answers[1]);
  await answer(second.answers[0]);
  const afterFirst = `Let's start with the project that keeps slipping.\n\n${second.ask}`;
  const afterSecond = `We'll bring you drafts to review.\n\n${third.ask}`;
  assert.deepEqual(said, [
    { type: 'done', text: afterFirst },
    { type: 'done', text: afterSecond }
  ]);
  assert.deepEqual(
    history('mona').map((e) => [e.from, e.text]),
    [
      ['staff', L.MANAGERS[0].hello('Ada')],
      ['owner', first.answers[1]],
      ['staff', afterFirst],
      ['owner', second.answers[0]],
      ['staff', afterSecond]
    ]
  );

  // The third answer is a real run, and the manager hears every question and answer.
  const run = await chatOf('mona', L.FIRST_QUESTIONS[2].answers[0]);
  for (const line of [
    L.FIRST_QUESTIONS[0].ask,
    L.FIRST_QUESTIONS[0].answers[1],
    L.FIRST_QUESTIONS[1].ask,
    second.answers[0],
    L.FIRST_QUESTIONS[2].ask
  ])
    assert.ok(run.message.includes(line), `the manager's run hears "${line}"`);
  assert.ok(run.message.endsWith(L.FIRST_QUESTIONS[2].answers[0]));
});

test("a new hire's first day and the manager's planning say how an Odd gets Run commands or Browse the web, the planning has each Odd ask for its own level and office tools, and a lesson never does", async () => {
  await L.startFirstDay('sam');
  const [day] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = 'sam' and kind = 'first_day' order by id desc limit 1`;
  const first = await runOf(day.id);
  const firstText = `${first.system}\n${first.message}`;
  assert.ok(
    firstText.includes(
      `4. If a tool you need is not in my_access, ask for it with ask_for_access. For Run commands or Browse the web, ask with ask_for_switch when my_access says ${await L.ownerName()} can switch it on.`
    ),
    firstText
  );
  assert.ok(
    first.system.includes(
      "tell them plainly that more access is the Settings tab's job, not a lesson's."
    ),
    first.system
  );
  const [g] = await L.pg<
    { id: number }[]
  >`insert into goals (title) values ('Plant the orchard') returning id`;
  const [row] = await L.pg<{ id: number }[]>`
    insert into follow_ups (staff_id, kind, goal_id) values ('sam', 'goal', ${g.id}) returning id`;
  const f = await L.startFollowUp(row.id);
  assert.ok(f, 'the planning run could not start');
  const r = await followThrough(f, undefined, undefined, await L.goal(g.id));
  assert.equal(r.outcome, 'done', r.text);
  const plan = JSON.parse(r.text) as Gave;
  const planText = `${plan.system}\n${plan.message}`;
  const owner = await L.ownerName();
  // The Odd asks for a level or an office tool itself, so the plan never hands the owner steps for one.
  assert.ok(
    planText.includes(
      'Never put a level raise or an office tool in owner_steps: the Odd asks for it itself with ask_for_level or ask_for_office_tool when its part needs it.'
    ),
    planText
  );
  // The Odd asks for a switch itself, so the plan never hands the owner steps for one.
  assert.ok(
    planText.includes(
      `For Run commands or Browse the web, never put switching it on in owner_steps: the Odd asks for it itself with ask_for_switch when its part needs it, and office_report says whether ${owner} can switch it on for that Odd.`
    ),
    planText
  );
});

test('no test reached the keychain', () => {
  assertKeychainUntouched();
});
