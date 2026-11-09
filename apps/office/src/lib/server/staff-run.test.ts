// A run as the office starts it (`followThrough`, `chat`), in an office under
// test (office-under-test.ts). It checks the wiring only a run shows: which
// runs work at Draft or only read for a lesson, that the run's key reaches
// the tool server and is held in `runsGoing` while the run goes, what the
// colleague's run is handed when the owner lets work past its round's limit
// keep going, each tool's exact arguments, and what moving an Odd to another
// tool does. Codex's own runs are in codex-run.test.ts. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  L,
  PATCH,
  agents,
  assertKeychainUntouched,
  awayFromHome,
  currentOffice,
  filesOf,
  gave,
  hireRoute,
  history,
  bin,
  chat,
  chatOf,
  code,
  folder,
  followThrough,
  isBusy,
  odd,
  onPlatform,
  onWindows,
  ownerData,
  plain,
  hide,
  rgBin,
  runOf,
  startedBy,
  type Gave
} from './office-under-test.ts';
// After the office under test is set up, as its own imports are: the office reads where everything is as it loads.
const { agentCommand } = await import('./agent-sign-in.ts');
const { deniedEdits } = await import('./files.ts');

test("a colleague's run on a hand-off works at Draft, and its key is held while it goes and only then", async () => {
  const h = await L.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Count the chairs', brief: 'Count them.' },
    thread: { title: 'The fair' }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const run = await runOf(h.id);
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
  const run = await runOf(carries[0].id, twin.ask.id);
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

test("a Claude Code Odd's chat gets the arguments it always had, with the office's file tools in place of its own, plus the new instruction files' denies", async () => {
  const run = await chatOf('cleo');
  const { args } = run;
  const shown = plain(hide(args, '--mcp-config', '--settings', '--append-system-prompt'))
    // The sessions folder Claude Code names after the Odd's folder, and what the
    // home folder holds, differ from Mac to Mac.
    .filter((a, i, all) => !(a.startsWith('Read(') && all.indexOf('--disallowedTools') < i))
    .map((a) => (/^Read\(\/~\/\.claude\/projects\/[^/]+\/\*\*\)$/.test(a) ? '<sessions>' : a));
  assert.deepEqual(shown, [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    // The office carries its files, and it has no shell or web: no tool of its own at all.
    '--tools',
    '',
    '--allowedTools',
    'Read(/<home>/staff/cleo/**)',
    'Read(/<home>/data/**)',
    '<sessions>',
    'Edit(/<home>/staff/cleo/**)',
    'mcp__office',
    'mcp__files',
    '--disallowedTools',
    // cb54187's instruction-file denies, plus Grok's, Codex's and Gemini's for an Odd that
    // might move to one, each as the path and everything under it (`denyRules`).
    ...[
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
      [`/<home>/staff/cleo/${f}`, `/<home>/staff/cleo/**/${f}`].flatMap((p) => [
        `Edit(${p})`,
        `Edit(${p}/**)`
      ])
    ),
    // No repository's hooks or config: those are refused only in a folder the owner gave it (`repoRunPaths`).
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
    '--append-system-prompt',
    '<append-system-prompt>',
    '--session-id',
    '<id>'
  ]);
  // Each read deny, compared above only by its place, holds the folder itself and what is in it.
  const denied = plain(args.slice(args.indexOf('--disallowedTools')));
  assert.ok(denied.includes('Read(/~/.ssh)') && denied.includes('Read(/~/.ssh/**)'));
  // The office's file server, under this Node, holds the folders the rules above name.
  const dir = join(folder, 'staff', 'cleo');
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

test("a Grok Odd's chat on a Mac starts grok sandboxed in its own folder, with no file, shell, web or image tool of its own, and only the office's MCP tools, its file tools among them", async () => {
  const run = await onPlatform('darwin', () => chatOf('gus'));
  // The office carries its files on a Mac too, inside its kernel profile.
  const dir = join(folder, 'staff', 'gus');
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
  assert.deepEqual(Object.keys(run.servers ?? {}), ['office', 'files']);
  const shown = plain(run.args).map((a) => a.replace(/^(--single|--rules)=[^]*$/, '$1=<$1>'));
  // The instruction files are pinned below; the rest is compared whole, so a
  // repository's hooks or config in its own folder, which no rule refuses, would show there.
  const own = (a: string) =>
    /^(Edit|Write)\(<home>\/staff\/gus\/.*(CLAUDE|\.claude|\.grok|AGENTS|\.mcp\.json|\.codex|\.agents|GEMINI|\.gemini)/.test(
      a
    );
  const rules = shown.filter((a, i) => own(a) && shown[i - 1] === '--deny');
  // Eleven names, each as the path and everything under it, at the top and below, for Edit and Write.
  assert.equal(rules.length, 88);
  for (const p of ['<home>/staff/gus/.grok/**', '<home>/staff/gus/**/AGENTS.md']) {
    assert.ok(rules.includes(`Edit(${p})`), p);
    assert.ok(rules.includes(`Write(${p})`), p);
  }
  assert.deepEqual(
    shown.filter((a, i) => !own(a) && !own(shown[i + 1] ?? '')),
    [
      '--single=<--single>',
      '--output-format',
      'streaming-messages-json',
      '--include-partial-messages',
      '--sandbox',
      'odd-gus',
      '--agent',
      '<home>/accounts/grok/office/runs/<id>.md',
      '--permission-mode',
      'dontAsk',
      '--no-subagents',
      '--no-auto-update',
      // Grok has no "no tools", so todo_write, which touches no file, stands in.
      '--tools',
      'todo_write',
      // No level picked: Medium (`effortFor`).
      '--reasoning-effort=medium',
      ...[
        // Every account's folder, and Grok's old home before accounts.
        '<home>/accounts',
        '<home>/grok',
        '<node>',
        '<code>/packages',
        '<code>/node_modules',
        '/usr',
        '/bin',
        '/sbin',
        '/etc',
        '/dev',
        '/System',
        '/Library',
        '/private',
        '/tmp',
        '/var',
        '~/Library'
      ].flatMap((p) => ['--deny', `Read(${p})`, '--deny', `Read(${p}/**)`]),
      ...['<home>/accounts', '<home>/grok'].flatMap((p) =>
        ['Edit', 'Write'].flatMap((t) => ['--deny', `${t}(${p})`, '--deny', `${t}(${p}/**)`])
      ),
      // No edit allowed to a tool of Grok's own: dontAsk refuses any it might gain.
      '--allow',
      'MCPTool(office__*)',
      '--allow',
      'MCPTool(files__*)',
      '--rules=<--rules>',
      '-s',
      '<id>'
    ]
  );
});

test("a Grok Odd's chat on Linux or Windows has no file tool of its own and gets the office's, with their walls; on Linux its kernel profile still holds it, and Windows has none", async () => {
  const dir = join(folder, 'staff', 'gus');
  for (const platform of ['linux', 'win32'] as const) {
    const chat = () => chatOf('gus');
    const run = await (platform === 'win32' ? onWindows(chat) : onPlatform(platform, chat));
    const args = plain(run.args);
    // Grok has no "no tools", so todo_write, which touches no file, stands in.
    assert.equal(args[args.indexOf('--tools') + 1], 'todo_write', platform);
    assert.ok(args.includes('MCPTool(files__*)'), platform);
    assert.equal(args[args.indexOf('MCPTool(files__*)') - 1], '--allow', platform);
    assert.doesNotMatch(run.system, /search_tool/);
    assert.deepEqual(
      filesOf(run),
      {
        command: process.execPath,
        args: [L.FILES_SERVER],
        walls: {
          cwd: dir,
          reads: [ownerData],
          writes: [dir],
          noWrite: deniedEdits({ dir, writes: [dir], granted: [] })
        }
      },
      platform
    );
    if (platform === 'linux') {
      assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), [
        '--sandbox',
        'odd-gus'
      ]);
      assert.ok(run.profile?.startsWith('[profiles.odd-gus]'), run.profile);
    } else {
      assert.ok(!args.includes('--sandbox'), args.join(' '));
      assert.equal(run.profile, undefined);
    }
  }
  // With Browse the web, the web tools join todo_write.
  await L.pg`update staff set web = true where id = 'gus'`;
  try {
    const run = await onPlatform('linux', () => chatOf('gus'));
    assert.equal(run.args[run.args.indexOf('--tools') + 1], 'todo_write,web_search,web_fetch');
  } finally {
    await L.pg`update staff set web = false where id = 'gus'`;
  }
});

test("a Grok Odd's run reading the owner's edit is denied an edit or write to that file", async () => {
  const dir = join(folder, 'staff', 'gus', 'notes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plan.md'), 'The owner wrote this.');
  assert.ok(
    await L.learnFromEdit('gus', { path: 'notes/plan.md', before: 'Gus wrote this.' }, 'x')
  );
  const [f] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = 'gus' and kind = 'edited' and outcome is null`;
  const args = plain((await runOf(f.id)).args);
  for (const rule of [
    'Edit(<home>/staff/gus/notes/plan.md)',
    'Write(<home>/staff/gus/notes/plan.md)'
  ])
    assert.equal(args[args.indexOf(rule) - 1], '--deny', rule);
});

test('a message or job description that starts with a dash reaches grok whole, never as a flag', async () => {
  const said = '- buy milk\n- call the vet';
  await L.pg`update staff set desk = ${'- You are Gus.'} where id = 'gus'`;
  try {
    const run = await chatOf('gus', said);
    assert.ok(run.message.endsWith(said), run.message);
    assert.match(run.system, /^- You are Gus\./);
  } finally {
    await L.pg`update staff set desk = ${'You are Gus.'} where id = 'gus'`;
  }
});

test("a Grok run never gets Grok's grep, with ripgrep on PATH, and the kernel never reads ripgrep's folder", async () => {
  const run = await chatOf('gus');
  assert.equal(run.args[run.args.indexOf('--tools') + 1], 'todo_write');
  assert.ok(!run.profile?.includes(rgBin), run.profile);
});

test("a Grok run's environment switches off every other tool's setup, and carries no key or node options from the office's own", async () => {
  const { grokEnv } = await chatOf('gus');
  assert.deepEqual(grokEnv, {
    GROK_HOME: join(folder, 'accounts', 'grok', 'office'),
    TMPDIR: join(folder, 'accounts', 'grok', 'office', 'tmp'),
    GROK_CLAUDE_AGENTS_ENABLED: 'false',
    GROK_CLAUDE_HOOKS_ENABLED: 'false',
    GROK_CLAUDE_MCPS_ENABLED: 'false',
    GROK_CLAUDE_RULES_ENABLED: 'false',
    GROK_CLAUDE_SKILLS_ENABLED: 'false',
    GROK_CURSOR_AGENTS_ENABLED: 'false',
    GROK_CURSOR_HOOKS_ENABLED: 'false',
    GROK_CURSOR_MCPS_ENABLED: 'false',
    GROK_CURSOR_RULES_ENABLED: 'false',
    GROK_CURSOR_SKILLS_ENABLED: 'false',
    GROK_MEMORY: '0',
    GROK_SUBAGENTS: '0',
    GROK_WORKFLOWS: '0',
    GROK_WEB_FETCH: '0',
    GROK_TELEMETRY_ENABLED: 'false',
    GROK_TELEMETRY_TRACE_UPLOAD: 'false'
  });
});

test("a Grok run's tool servers keep the owner's home, whatever home grok gets", async () => {
  const run = await chatOf('gus');
  for (const server of ['office', 'files'])
    assert.equal((run.servers?.[server].env as Record<string, string>).HOME, homedir(), server);
});

test('a Docker socket that is a link gives a Grok run a home whose .docker/run leads to its folder, so Grok starts sandboxed (issue #52)', async () => {
  const { grokHome, runHome } = await import('./grok.ts');
  const h = grokHome();
  const at = mkdtempSync(join(folder, 'socket-'));
  const socket = join(at, 'docker.sock');
  const run = join(h.home, '.docker', 'run');
  // No socket, or one that is no link: the owner's home.
  assert.equal(runHome(h, socket), undefined);
  writeFileSync(socket, '');
  assert.equal(runHome(h, socket), undefined);
  rmSync(socket);
  // As OrbStack links it.
  symlinkSync(join(at, 'orbstack', 'run', 'docker.sock'), socket);
  assert.equal(runHome(h, socket), h.home);
  assert.equal(readlinkSync(run), join(at, 'orbstack', 'run'));
  // Moved to Colima, linked by a relative path: the run's link follows.
  rmSync(socket);
  symlinkSync(join('colima', 'default', 'docker.sock'), socket);
  assert.equal(runHome(h, socket), h.home);
  assert.equal(readlinkSync(run), join(at, 'colima', 'default'));
  // A target with another name cannot go on Grok's list.
  rmSync(socket);
  symlinkSync(join(at, 'docker.sock.real'), socket);
  assert.equal(runHome(h, socket), undefined);
});

test("a Grok run its sandbox refuses for a socket link says so in plain words, with the way to another tool; any other stop gives the tool's last lines", async () => {
  const { stoppedWhy } = await import('./cli.ts');
  // Grok 1.0.77's refusal (issue #52), for a podman socket `runHome` cannot clear.
  const refused =
    "warning: sandbox could not be applied: socket deny resolution failed: could not resolve runtime-socket deny path /var/run/podman/podman.sock: endpoint is a symlink to a path outside the deny list\nerror: could not apply the 'odd-jamal' sandbox profile; see the warning above for the cause. Refusing to start with its protections missing.\n";
  const said =
    "Grok can't start on this computer. Its sandbox won't run while /var/run/podman/podman.sock is a link to a place Grok doesn't know, which some container apps set up. The office never runs Grok without its sandbox.";
  const later = 'Or wait for a Grok update that fixes this.';
  assert.equal(
    stoppedWhy('grok', 1, refused),
    [
      said,
      "To keep this Odd working:\n1. Open this Odd's Settings tab.\n2. Under Model, pick another tool.",
      later
    ].join('\n\n')
  );
  assert.equal(
    stoppedWhy('grok', 1, refused, true),
    [
      said,
      'To keep the office working:\n1. Open Setup.\n2. Under Your AI, pick another tool.',
      later
    ].join('\n\n')
  );
  // Another tool's words are never read as Grok's.
  assert.match(stoppedWhy('codex', 1, refused), /^Codex stopped \(exit 1\)\. warning: /);
  assert.equal(stoppedWhy('grok', 2, 'one\ntwo\nthree\n'), 'Grok stopped (exit 2). two three');
});

test("every Odd is told of the owner's data folder, on Grok as on Claude Code", async () => {
  assert.ok((await chatOf('gus')).system.includes(`data folder: ${ownerData}`));
  assert.ok((await chatOf('cleo')).system.includes(`data folder: ${ownerData}`));
});

test('every Odd is told to do the work with its own tools when a brief names tools it lacks', async () => {
  assert.ok(
    (await chatOf('cleo')).system.includes(
      '- If a brief names tools you do not have, do the work with your own tools.'
    )
  );
});

test("a Grok Odd's sandbox lets it read the owner's data folder, and no deny rule shuts it", async () => {
  const run = await chatOf('gus');
  const readOnly = /^read_only = (.+)$/m.exec(run.profile ?? '')?.[1];
  assert.ok(readOnly && (JSON.parse(readOnly) as string[]).includes(ownerData), run.profile);
  const denied = run.args.filter((_, i) => run.args[i - 1] === '--deny');
  assert.ok(denied.length, 'the run got no deny rules to check');
  assert.deepEqual(
    denied.filter((rule) => rule.includes(ownerData)),
    [],
    'a deny rule shuts the data folder'
  );
  const deny = /^deny = (.+)$/m.exec(run.profile ?? '')?.[1];
  assert.ok(deny, run.profile);
  assert.ok(!deny.includes(ownerData), 'the kernel shuts the data folder');
});

test("Grok's MCP calls reach the floor by the tool they name, once each", async () => {
  assert.deepEqual((await chatOf('gus')).tools, ['mcp__office__raise_ask']);
});

test("a Grok run's servers come from an agent file only the owner reads, which goes when the run ends", async () => {
  const run = await chatOf('gus');
  assert.equal(run.agentMode, 0o600);
  assert.ok(run.env.RUN_KEY, 'the tool server got no key');
  assert.deepEqual(readdirSync(join(folder, 'accounts', 'grok', 'office', 'runs')), []);
});

test("the office's Grok home is the owner's alone, and an agent file a run that died with the office left goes at the next run", async () => {
  const grok = join(folder, 'accounts', 'grok', 'office');
  const stale = join(grok, 'runs', 'died-with-the-office.md');
  mkdirSync(join(grok, 'runs'), { recursive: true });
  writeFileSync(stale, '---\nmcpServers: []\n---\n');
  chmodSync(grok, 0o755);
  await chatOf('gus');
  assert.equal(statSync(grok).mode & 0o777, 0o700);
  assert.ok(!existsSync(stale), 'the dead run left its agent file, secrets and all');
});

test('the office keeps a config.toml it did not write, and writes one only into a home with none', async () => {
  const config = join(folder, 'accounts', 'grok', 'office', 'config.toml');
  await chatOf('gus');
  assert.match(readFileSync(config, 'utf8'), /\[compat\.codex\]\nsessions = false/);
  writeFileSync(config, '[auth.oauth2]\nprincipal_type = "Team"\n');
  await chatOf('gus');
  assert.equal(readFileSync(config, 'utf8'), '[auth.oauth2]\nprincipal_type = "Team"\n');
});

test("a Grok Odd's run on a thread reads the thread's folder and writes only its own part, and its profile goes after", async () => {
  const h = await L.handOff({
    from: 'lead',
    to: 'gus',
    work: { title: 'Paint the sign', brief: 'Paint it.' },
    thread: { title: 'The sign' }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const f = await L.startFollowUp(h.id);
  assert.ok(f);
  const r = await followThrough(f);
  assert.equal(r.outcome, 'done', r.text);
  const run = JSON.parse(r.text) as Gave;
  const thread = L.threadFolder(f.threadId!);
  const part = join(thread, 'gus');
  const name = run.args[run.args.indexOf('--sandbox') + 1];
  assert.match(name, /^run-/);
  assert.deepEqual(run.profile?.trim().split('\n').slice(0, 4), [
    `[profiles.${name}]`,
    'extends = "strict"',
    `read_only = ${JSON.stringify([dirname(process.execPath), code('packages'), code('node_modules'), ownerData, thread])}`,
    `read_write = ${JSON.stringify([join(folder, 'accounts', 'grok', 'office', 'tmp'), part])}`
  ]);
  // The kernel shuts what `strict` reads that no Odd needs, by its real path.
  for (const p of [join(homedir(), 'Library'), '/Library', '/tmp', '/var'].filter(existsSync))
    assert.ok(run.profile?.includes(JSON.stringify(`${realpathSync(p)}/**`)), `${p} is not shut`);
  assert.ok(
    run.profile?.includes(JSON.stringify(`${part}/**/.grok`)),
    'a planted .grok is not denied'
  );
  // The next Grok run drops the profile of a run that ended.
  await chatOf('gus');
  const sandbox = readFileSync(join(folder, 'accounts', 'grok', 'office', 'sandbox.toml'), 'utf8');
  assert.ok(!sandbox.includes(name), sandbox);
  assert.ok(sandbox.includes('[profiles.odd-gus]'));
});

test('a Grok Odd on a Mac without grok fails its run naming Grok, and never runs on Claude Code', async () => {
  // Only the stand-ins' folder, and an empty home, so the Mac's own grok, on
  // PATH or in xAI's install folder, is not found either.
  const path = process.env.PATH;
  process.env.PATH = bin;
  renameSync(join(bin, 'grok'), join(bin, 'grok-away'));
  try {
    let error = '';
    await awayFromHome(() =>
      chat('gus', 'Hello.', (e) => {
        if (e.type === 'error') error = e.message;
      })
    );
    assert.match(error, /^Could not start Grok: spawn grok ENOENT/);
  } finally {
    renameSync(join(bin, 'grok-away'), join(bin, 'grok'));
    process.env.PATH = path;
  }
});

test("a Grok run from an office Grok home nobody signed in to points to its Settings tab to sign in, one past Grok's plan limit says so in the office's words with no link, and another early end says what went wrong", async () => {
  const ended = async (errors: string[]) => {
    const stream = join(folder, 'ended.jsonl');
    writeFileSync(
      stream,
      JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors
      }) + '\n'
    );
    let error = '';
    await chat('gus', `Replay ${stream}`, (e) => {
      if (e.type === 'error') error = e.message;
    });
    return error;
  };
  // As grok 1.0.46 ended a run from a home with no sign-in (measured).
  assert.equal(
    await ended([
      'Not signed in. To authenticate without a browser, run:\n  grok login --device-code\n\nAlternatively, set the XAI_API_KEY environment variable or run `grok login` on a machine with a browser.'
    ]),
    "Grok is not signed in for this office. Sign in on this Odd's Settings tab, under Model."
  );
  // The line the walk on 2026-11-04 saw (its upsell link stood in for), and
  // the error under it in Grok's log.
  for (const limit of [
    "You've reached your free Grok Build usage limit. Upgrade for more: https://example.com/upgrade",
    "API error (status 429 Too Many Requests): subscription:free-usage-exhausted: You've used all the included free usage for model grok-4.7"
  ])
    assert.equal(
      await ended([limit]),
      "Grok's plan limit is reached; this Odd can't work until it resets or the plan changes."
    );
  assert.equal(
    await ended(['The model is busy.']),
    'The session ended early (error_during_execution): The model is busy.'
  );
});

/**
 * Put a sign-in in the office's Grok home that runs out `auth` ms from now,
 * and the one `grok models` renews it to `renewed` ms from now, in the shape
 * Grok writes (an account per key, `expires_at` in microseconds), and run
 * `fn` with them. Then take both and the stand-in's log away again.
 */
async function withGrokSignIn(
  sets: { auth: number; renewed?: number },
  fn: () => Promise<void>
): Promise<void> {
  const grok = join(folder, 'accounts', 'grok', 'office');
  const signIn = (inMs: number) =>
    JSON.stringify({
      'https://auth.x.ai::test': {
        key: 'not-a-token',
        refresh_token: 'not-a-token',
        expires_at: new Date(Date.now() + inMs).toISOString().replace('Z', '000+00:00')
      }
    });
  mkdirSync(grok, { recursive: true });
  writeFileSync(join(grok, 'auth.json'), signIn(sets.auth));
  if (sets.renewed !== undefined) writeFileSync(join(grok, 'renewed.json'), signIn(sets.renewed));
  try {
    await fn();
  } finally {
    for (const f of ['auth.json', 'renewed.json', 'models.log'])
      rmSync(join(grok, f), { force: true });
  }
}
/** How many times the office ran `grok models`, which renews the sign-in. */
const renewals = () => {
  const log = join(folder, 'accounts', 'grok', 'office', 'models.log');
  return existsSync(log) ? readFileSync(log, 'utf8').length : 0;
};
const HOUR = 60 * 60_000;

test('a Grok run whose sign-in outlasts it starts without renewing it', async () => {
  await withGrokSignIn({ auth: 6 * HOUR }, async () => {
    await chatOf('gus');
    assert.equal(renewals(), 0);
  });
});

test('a Grok run whose sign-in could run out before it ends renews it outside the sandbox first, then starts', async () => {
  // A chat may take 5 minutes: 12 minutes left is inside its margin.
  await withGrokSignIn({ auth: 12 * 60_000, renewed: 6 * HOUR }, async () => {
    await chatOf('gus');
    assert.equal(renewals(), 1);
  });
});

test('a Grok run whose sign-in ran out and could not be renewed is refused at once pointing to its Settings tab to sign in, and starts nothing', async () => {
  await withGrokSignIn({ auth: -HOUR }, async () => {
    const started = Date.now();
    let error = '';
    await chat('gus', 'Hello.', (e) => {
      if (e.type === 'error') error = e.message;
    });
    assert.equal(
      error,
      "Grok is not signed in for this office. Sign in on this Odd's Settings tab, under Model."
    );
    assert.equal(renewals(), 1);
    assert.ok(Date.now() - started < 10_000, 'the refused run did not end at once');
  });
});

test('Grok runs starting together share one renewal of their sign-in', async () => {
  const { grokSignedOut } = await import('./grok.ts');
  await withGrokSignIn({ auth: 12 * 60_000, renewed: 6 * HOUR }, async () => {
    const lasts = 5 * 60_000;
    assert.deepEqual(await Promise.all([grokSignedOut(lasts), grokSignedOut(lasts)]), [
      undefined,
      undefined
    ]);
    assert.equal(renewals(), 1);
  });
});

test('a renewal that hangs and ignores SIGTERM is killed at 30 seconds, and the run goes on', async () => {
  const { grokSignedOut } = await import('./grok.ts');
  const hang = join(folder, 'accounts', 'grok', 'office', 'hang.pid');
  // 0 until grok models starts; process.kill reads 0 as this whole process group.
  const pid = () => Number(readFileSync(hang, 'utf8'));
  await withGrokSignIn({ auth: 12 * 60_000 }, async () => {
    writeFileSync(hang, '');
    let timer: NodeJS.Timeout | undefined;
    try {
      const started = Date.now();
      const ended = await Promise.race([
        grokSignedOut(5 * 60_000).then((refused) => ({ refused })),
        new Promise<false>((stop) => (timer = setTimeout(() => stop(false), 40_000)))
      ]);
      const took = Date.now() - started;
      assert.ok(ended, 'the renewal was still going at 40 seconds');
      // The sign-in still has 12 minutes, so the killed renewal refuses nothing.
      assert.equal(ended.refused, undefined, 'the run was refused after its renewal was killed');
      assert.ok(took >= 29_000 && took < 35_000, `the renewal ended after ${took} ms`);
      assert.ok(pid() > 0, 'grok models never started');
      assert.throws(() => process.kill(pid(), 0), { code: 'ESRCH' }, 'grok models still runs');
    } finally {
      clearTimeout(timer);
      try {
        if (pid() > 0) process.kill(pid(), 'SIGKILL');
      } catch {
        // Already gone, as it should be.
      }
      rmSync(hang, { force: true });
    }
  });
});

/** The owner's PATCH of an Odd from its card. */
const patch = (id: string, body: unknown) =>
  PATCH({
    params: { id },
    request: new Request(`http://office/api/staff/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
  } as unknown as Parameters<typeof PATCH>[0]);
const refused = (status: number) => (e: unknown) => (e as { status?: number }).status === status;

test('the "Runs on" picker hears only of the tools on this Mac', async () => {
  const only = join(folder, 'only-claude');
  mkdirSync(only, { recursive: true });
  writeFileSync(join(only, 'claude'), '#!/bin/sh\n');
  chmodSync(join(only, 'claude'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = only;
  try {
    // An empty home too, so the Mac's own Grok in xAI's install folder is not found.
    const res = await awayFromHome(() =>
      onPlatform('darwin', async () => agents.GET({} as Parameters<typeof agents.GET>[0]))
    );
    assert.deepEqual(await res.json(), {
      computer: 'Mac',
      office: 'claude',
      drawsLooks: true,
      // No account added beyond each tool's Office account.
      accounts: [],
      later: [{ id: 'gemini', name: 'Gemini', why: 'Coming soon. We are still testing it.' }],
      tools: [
        // The office's own Claude Code folder is not signed in, and neither is this stand-in.
        {
          id: 'claude',
          name: 'Claude Code',
          installed: true,
          signIn: { how: 'browser', installing: false, signedIn: false },
          commandsHow: L.commandsHow('claude', 'darwin')
        },
        {
          id: 'grok',
          name: 'Grok',
          installed: false,
          signIn: { how: 'browser', installing: false, signedIn: false },
          commandsHow: L.commandsHow('grok', 'darwin')
        },
        // The office under test's Codex home holds a sign-in file with no account in it.
        {
          id: 'codex',
          name: 'Codex',
          installed: false,
          signIn: { how: 'browser', installing: false, signedIn: true },
          commandsHow: L.commandsHow('codex', 'darwin')
        }
      ]
    });
  } finally {
    process.env.PATH = path;
  }
});

test('on Windows the "Runs on" picker says computer, lists Grok and Codex beside Claude Code, and counts claude.exe or an npm claude.cmd with Claude Code beside it as installed, but not a bare claude or a shim alone, whatever PATHEXT says; an Odd on npm\'s Claude Code runs its script under this Node, then the run\'s own arguments', async () => {
  const shims = join(folder, 'win-shims');
  const npm = join(folder, 'win-npm');
  const native = join(folder, 'win-native');
  const pkg = join(npm, 'node_modules', '@anthropic-ai', 'claude-code');
  for (const [dir, files] of [
    [shims, ['claude', 'claude.cmd', 'claude.ps1']],
    [npm, ['claude', 'claude.cmd', 'claude.ps1']],
    [native, ['claude.exe']]
  ] as const) {
    mkdirSync(dir, { recursive: true });
    for (const f of files) {
      writeFileSync(join(dir, f), '');
      chmodSync(join(dir, f), 0o755);
    }
  }
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ bin: { claude: 'cli.js' } }));
  // Claude Code's script is the stand-in Claude, after it notes how it was started.
  const started = join(folder, 'win-npm-started.json');
  writeFileSync(
    join(pkg, 'cli.js'),
    `require('node:fs').writeFileSync(${JSON.stringify(started)}, JSON.stringify(process.argv));
require(${JSON.stringify(join(bin, 'claude'))});
`
  );
  const { PATH: path, PATHEXT: pathext } = process.env;
  process.env.PATHEXT = '.CMD;.PS1';
  const picker = async () =>
    (await agents.GET({} as Parameters<typeof agents.GET>[0])).json() as Promise<{
      computer: string;
      office: string;
      tools: { id: string; installed: boolean }[];
      later: { id: string; why: string }[];
    }>;
  // Its version read through the same command a run starts, npm's script under this Node too.
  const out = { how: 'browser', installing: false, signedIn: false };
  const commandsHow = L.commandsHow('claude', 'win32');
  // Grok and Codex run on Windows too, with no shell; neither is on PATH here.
  const others = [
    {
      id: 'grok',
      name: 'Grok',
      installed: false,
      signIn: out,
      commandsHow: L.commandsHow('grok', 'win32')
    },
    {
      id: 'codex',
      name: 'Codex',
      installed: false,
      // The office's Codex home is signed in under test.
      signIn: { ...out, signedIn: true },
      commandsHow: L.commandsHow('codex', 'win32')
    }
  ];
  const installed = [
    {
      id: 'claude',
      name: 'Claude Code',
      installed: true,
      signIn: out,
      commandsHow,
      version: '2.1.318'
    },
    ...others
  ];
  try {
    // Away from home, so the Mac's own ~/.local/bin, where Windows' installer puts claude.exe, is never read.
    await awayFromHome(() =>
      onPlatform('win32', async () => {
        process.env.PATH = shims;
        assert.deepEqual(await picker(), {
          computer: 'computer',
          office: 'claude',
          drawsLooks: true,
          accounts: [],
          tools: [
            {
              id: 'claude',
              name: 'Claude Code',
              installed: false,
              signIn: { how: 'browser', installing: false, signedIn: false },
              commandsHow
            },
            ...others
          ],
          later: [{ id: 'gemini', name: 'Gemini', why: 'Coming soon. We are still testing it.' }]
        });
        // A shim alone first, then npm's, with Claude Code's script run under this Node.
        process.env.PATH = [shims, npm].join(delimiter);
        assert.deepEqual(agentCommand('claude'), [process.execPath, [join(pkg, 'cli.js')]]);
        assert.deepEqual((await picker()).tools, installed);
        const run = await runOf((await gave('lead', 'paige', { title: 'The Windows run' })).id);
        assert.deepEqual(JSON.parse(readFileSync(started, 'utf8')), [
          process.execPath,
          join(pkg, 'cli.js'),
          ...run.args
        ]);
        process.env.PATH = [shims, native].join(delimiter);
        assert.deepEqual(agentCommand('claude'), [join(native, 'claude.exe'), []]);
        // Installed. This Mac cannot run a stand-in claude.exe, so it has no version to say.
        assert.deepEqual((await picker()).tools, [
          { id: 'claude', name: 'Claude Code', installed: true, signIn: out, commandsHow },
          ...others
        ]);
      })
    );
  } finally {
    process.env.PATH = path;
    if (pathext === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = pathext;
  }
});

test('moving an Odd to another tool clears its chat session; picking the tool it is on keeps it', async () => {
  const session = L.chatSession('sam');
  mkdirSync(join(session, '..'), { recursive: true });
  writeFileSync(session, '{"sessionId":"s1"}');
  await patch('sam', { agent: 'claude' });
  assert.ok(existsSync(session), 'a move to the tool it is on cleared the session');
  const moved = await onPlatform('darwin', () => patch('sam', { agent: 'grok' }));
  assert.equal(moved.status, 200);
  assert.ok(!existsSync(session), 'the session of the tool it left is still there');
  assert.equal((await L.staffer('sam'))?.agent, 'grok');
  await assert.rejects(async () => patch('sam', { agent: 'cursor' }), refused(400));
});

test('on Linux the "Runs on" picker and a move offer Claude Code, Grok and Codex, and never Gemini', async () => {
  await onPlatform('linux', async () => {
    const res = await agents.GET({} as Parameters<typeof agents.GET>[0]);
    assert.deepEqual(
      ((await res.json()) as { tools: { id: string }[] }).tools.map((t) => t.id),
      ['claude', 'grok', 'codex']
    );
    try {
      for (const agent of ['grok', 'codex']) {
        assert.equal((await patch('cleo', { agent })).status, 200, agent);
        assert.equal((await L.staffer('cleo'))?.agent, agent);
      }
      await assert.rejects(async () => patch('cleo', { agent: 'gemini' }), refused(400));
    } finally {
      await patch('cleo', { agent: 'claude' });
    }
  });
  assert.equal((await L.staffer('cleo'))?.agent, 'claude');
});

/** The ready-made managers' looks, one for each hire, so no hire is refused for a look taken. */
const looks = L.MANAGERS.filter((m) => m.look);
/** The hire drawer's POST of a new Odd in a ready-made manager's look, on `agent` when given. */
async function hireOn(name: string, agent?: string) {
  const preset = looks.shift();
  assert.ok(preset?.look, 'no ready-made manager look is left');
  const room = (await currentOffice()).world.rooms[0].id.split('#')[0];
  const res = await hireRoute.POST({
    request: new Request('http://office/api/staff', {
      method: 'POST',
      body: JSON.stringify({
        name,
        role: 'Tester',
        remit: 'Tests.',
        desk: `You are ${name}.`,
        room,
        permission: 'read',
        look: preset.look,
        portraitPx: L.managerPortrait(preset.id),
        agent
      })
    })
  } as unknown as Parameters<typeof hireRoute.POST>[0]);
  return ((await res.json()) as { id: string }).id;
}

test('a hire made with Runs on Grok is on Grok before any run: its hello and its first hand-off run on Grok', async () => {
  const id = await onPlatform('darwin', () => hireOn('Greta', 'grok'));
  assert.equal((await L.staffer(id))?.agent, 'grok');
  // The hello starts in the background as the hire returns; it is the hire's first run.
  for (let i = 0; !history(id).length || isBusy(id); i++) {
    assert.ok(i < 500, 'the hello never landed');
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.match(history(id)[0].text, /"grokEnv"/, 'the hello did not run on Grok');
  const h = await gave('lead', id, { title: 'Greta starts' });
  assert.ok((await runOf(h.id)).grokEnv, 'the first hand-off did not run on Grok');
});

test('the hire flow offers no Gemini today: the picker does not list it, and a hire on it is refused', async () => {
  await onPlatform('darwin', async () => {
    const res = await agents.GET({} as Parameters<typeof agents.GET>[0]);
    assert.ok(
      !((await res.json()) as { tools: { id: string }[] }).tools.some((t) => t.id === 'gemini')
    );
    await assert.rejects(
      async () => hireOn('Gemma', 'gemini'),
      (e: { status?: number; body?: { message?: string } }) =>
        e.status === 400 && e.body?.message === 'Pick claude or grok or codex'
    );
  });
  assert.equal(
    (await L.roster()).find((p) => p.name === 'Gemma'),
    undefined
  );
});

test('an Odd mid-reply cannot move to another tool, and stays on its own', async () => {
  const release = join(folder, 'release-paige');
  const replied = chat('paige', `Hold until ${release} exists.`, () => {});
  for (let i = 0; !isBusy('paige'); i++) {
    assert.ok(i < 200, 'the chat never started');
    await new Promise((r) => setTimeout(r, 10));
  }
  await assert.rejects(
    async () => onPlatform('darwin', () => patch('paige', { agent: 'grok' })),
    refused(409)
  );
  writeFileSync(release, '');
  await replied;
  assert.equal((await L.staffer('paige'))?.agent, 'claude');
});

test("a recorded Grok chat replays as it ran: the floor sees each tool by Claude Code's name, the reply is the result's, and the next message resumes its session", async () => {
  const fixture = (n: number) =>
    fileURLToPath(new URL(`./fixtures/grok-chat-${n}.jsonl`, import.meta.url));
  const turn = async (n: number) => {
    const tools: string[] = [];
    let text = '';
    await chat('gus', `Replay ${fixture(n)}`, (e) => {
      if (e.type === 'tool') tools.push(e.name);
      if (e.type === 'done') text = e.text;
      if (e.type === 'error') text = e.message;
    });
    const args = JSON.parse(
      readFileSync(join(folder, 'accounts', 'grok', 'office', 'replay-args.json'), 'utf8')
    ) as string[];
    return { tools, text, args };
  };
  const session = '00000000-0000-4000-8000-000000000001';
  try {
    const one = await turn(1);
    assert.deepEqual(one.tools, ['Write', 'ToolSearch', 'Read', 'Glob', 'mcp__office__my_access']);
    assert.equal(one.text, 'My level is Draft.\npelican');
    assert.equal(JSON.parse(readFileSync(L.chatSession('gus'), 'utf8')).sessionId, session);
    const two = await turn(2);
    assert.equal(two.args[two.args.indexOf('-r') + 1], session);
    assert.ok(!two.args.includes('-s'), 'the second message started a new session');
    assert.equal(two.text, 'pelican');
  } finally {
    // Later Grok chats start a session of their own, and replay no "Replay" line to the stand-in.
    rmSync(L.chatSession('gus'), { force: true });
    rmSync(L.home('staff', 'gus', 'chat.jsonl'), { force: true });
  }
});

test("a run never loads the owner's own CLAUDE.md or keeps an auto-memory, and still gets the office's instructions and its message", async () => {
  // A parent session's settings are dropped, and the run's own are set.
  process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '0';
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0';
  try {
    const yes = await L.raiseAsk('lead', { title: 'Paint the sign', why: 'w', ifApproved: 'i' });
    await L.decideAsk(yes.ask.id, 'approve', null);
    const run = await runOf(await startedBy(yes.ask.id, 'carry_out'), yes.ask.id);
    assert.equal(run.claudeMds, '1');
    assert.equal(run.autoMemory, '1');
    assert.match(run.system, /You are Lena\./, "the Odd's job description is in the system prompt");
    assert.match(run.message, /Paint the sign/, 'the message names the work');
  } finally {
    delete process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS;
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
  }
});

test("a lead's chat is told where its goal stands as it starts, and reads the goal's folder; a colleague's chat does neither", async () => {
  const [g] = await L.pg<
    { id: number }[]
  >`insert into goals (title) values ('Host the summer fair') returning id`;
  const h = await L.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Count the chairs', brief: 'Count them.' },
    thread: { title: 'The summer fair', goalId: g.id }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const folder = L.threadFolder(h.thread);
  const before = await chatOf('lead', 'Where is the fair up to?');
  assert.match(before.system, /Count the chairs \(Paige\): not back yet\./);
  assert.equal(
    before.system.split(`## Work ${h.thread}\n`).length,
    2,
    "the goal's work is told in full once"
  );
  assert.ok(
    !before.system.includes(`- Work ${h.thread}:`),
    "the goal's work is not listed again among the lead's latest work"
  );
  assert.doesNotMatch(before.system, /^0$/m, 'an Odd that serves no goal gets no stray 0');
  assert.match(before.system, /Answer .+ from it, over anything you said earlier in this chat\./);
  assert.ok(
    before.args.includes(`Read(/${folder}/**)`),
    "the lead's chat may read the goal's folder"
  );
  assert.ok(before.args.includes(folder), "the goal's folder is added to the lead's chat");
  assert.ok(!before.args.includes(`Read(/${L.home('threads')})`), 'no deny rule covers it');
  assert.ok(
    !before.args.some((a) => a.startsWith(`Edit(/${folder}`)),
    "the lead's chat writes nothing there"
  );

  const f = await L.startFollowUp(h.id);
  assert.ok(f, "Paige's hand-off could not start");
  await L.finishFollowUp(f, 'Count the chairs', 'done', 'Forty chairs.');
  const after = await chatOf('lead', 'And now?');
  assert.match(after.system, /Count the chairs \(Paige\): finished\./);
  // The lead's pick-up of the result gets the same story, without the result its brief already holds.
  const [back] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = 'lead' and kind = 'handed_back' and thread_id = ${h.thread}`;
  const pickUp = await runOf(back.id);
  assert.match(pickUp.system, /Count the chairs \(Paige\): finished\./);
  assert.doesNotMatch(pickUp.system, /The latest result, from Paige, in full/);

  const colleague = await chatOf('paige', 'How did the count go?');
  assert.doesNotMatch(colleague.system, /Count the chairs \(Paige\)/);
  assert.ok(!colleague.args.includes(folder), "a colleague's chat reads no goal folder");
});

test("a Grok lead's chat may read its goal's folder, as it is told, through the Odd's own profile", async () => {
  const [g] = await L.pg<
    { id: number }[]
  >`insert into goals (title) values ('Fix the gate') returning id`;
  const h = await L.handOff({
    from: 'gus',
    to: 'paige',
    work: { title: 'Find a hinge', brief: 'Find one.' },
    thread: { title: 'The gate', goalId: g.id }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const folder = L.threadFolder(h.thread);
  const run = await chatOf('gus', 'Where is the gate up to?');
  assert.ok(run.system.includes(folder), "the chat is not told the goal's folder");
  assert.match(run.system, /you may read the folder above/);
  assert.ok(run.args.includes('odd-gus'), "the chat leaves the Odd's own profile");
  assert.ok(
    run.profile?.includes(
      `read_only = ${JSON.stringify([dirname(process.execPath), code('packages'), code('node_modules'), ownerData, folder])}`
    ),
    run.profile
  );
  assert.ok(!run.profile?.includes(`${folder}/gus`), 'the chat writes in the goal folder');
});

test("the run a finished task starts is told where a file attached from a goal's folder is", async () => {
  const name = 'threads/4242/paige/rules.md';
  const task = await L.giveTask('lead', {
    title: 'Read the rules',
    why: 'They changed.',
    steps: ['Read them'],
    attach: [name]
  });
  await L.finishTask(task.id, true, null);
  const [row] = await L.pg<{ id: number }[]>`
    select id from follow_ups where task_id = ${task.id} and kind = 'task_done'`;
  const f = await L.startFollowUp(row.id);
  assert.ok(f, 'the task_done follow-up could not start');
  const r = await followThrough(f, undefined, undefined, task);
  assert.equal(r.outcome, 'done', r.text);
  const { message, system } = JSON.parse(r.text) as Gave;
  assert.ok(
    `${system}\n${message}`.includes(`- Attached, with anything they filled in: ${L.home(name)}.`),
    'the run is not told where the file is'
  );
});

test("a lead woken by a colleague's tell_lead is told the work is its to decide and hand on", async () => {
  const [g] = await L.pg<
    { id: number }[]
  >`insert into goals (title) values ('Paint the barn') returning id`;
  const h = await L.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Mix the paint', brief: 'Mix it.' },
    thread: { title: 'The barn', goalId: g.id }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const said = 'Make the barn red.';
  const told = await L.tellLead({
    staffId: 'paige',
    threadId: h.thread,
    owner: 'Sam',
    said,
    words: said
  });
  assert.deepEqual(told, { lead: 'Lena' });
  const [wake] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = 'lead' and kind = 'resume' and thread_id = ${h.thread}`;
  assert.ok(wake, 'tell_lead woke no pick-up');
  const { system } = await runOf(wake.id);
  assert.match(
    system,
    /- Paige passed you what Sam told them in chat about this work\. You decide what comes of it and hand on any work it needs; Paige does nothing more with it\. Sam's words: Make the barn red\./
  );
});

test('no test reached the keychain', () => {
  assertKeychainUntouched();
});

test("a manager's first three questions come one at a time: the office asks the next at once with no run, and the third answer runs the manager with all three in its chat", async () => {
  const { sayInChat } = await import('./staff.ts');
  await L.pg`insert into staff ${L.pg([odd('mona', 'Mona')])}`;
  sayInChat('mona', L.MANAGERS[0].hello('Ada'));
  const said: { type: string; text?: string }[] = [];
  const answer = (text: string) => chat('mona', text, (e) => said.push(e));

  // A tap and a typed answer go the same way: no run, and the next question at once.
  await answer(L.FIRST_QUESTIONS[0].answers[1]);
  await answer('Mostly keep my calendar sane');
  assert.deepEqual(said, [
    { type: 'done', text: L.FIRST_QUESTIONS[1].ask },
    { type: 'done', text: L.FIRST_QUESTIONS[2].ask }
  ]);
  assert.deepEqual(
    history('mona').map((e) => [e.from, e.text]),
    [
      ['staff', L.MANAGERS[0].hello('Ada')],
      ['owner', L.FIRST_QUESTIONS[0].answers[1]],
      ['staff', L.FIRST_QUESTIONS[1].ask],
      ['owner', 'Mostly keep my calendar sane'],
      ['staff', L.FIRST_QUESTIONS[2].ask]
    ]
  );

  // The third answer is a real run, and the manager hears every question and answer.
  const run = await chatOf('mona', L.FIRST_QUESTIONS[2].answers[0]);
  for (const line of [
    L.FIRST_QUESTIONS[0].ask,
    L.FIRST_QUESTIONS[0].answers[1],
    L.FIRST_QUESTIONS[1].ask,
    'Mostly keep my calendar sane',
    L.FIRST_QUESTIONS[2].ask
  ])
    assert.ok(run.message.includes(line), `the manager's run hears "${line}"`);
  assert.ok(run.message.endsWith(L.FIRST_QUESTIONS[2].answers[0]));
});

test("each Odd thinks at the level the owner picks from its tool's own levels, Medium until then, and the Office Manager never below Medium", async () => {
  const levelOf = async (id: string) => {
    const { args } = await chatOf(id);
    const at = args.indexOf('--effort');
    return at >= 0 ? args[at + 1] : args.find((a) => a.startsWith('--reasoning-effort='));
  };
  // Tests before this one move Odds between tools: each keeps the tool it had.
  const before = await L.pg<{ id: string; agent: string; role: string }[]>`
    select id, agent, role from staff where id in ('sam', 'gus', 'paige')`;
  await L.pg`update staff set agent = 'claude' where id in ('sam', 'paige')`;
  await L.pg`update staff set agent = 'grok' where id = 'gus'`;
  try {
    // Claude Code: `--effort`, Medium until the owner picks.
    assert.equal(await levelOf('sam'), 'medium');
    await patch('sam', { effort: 'xhigh' });
    assert.equal(await levelOf('sam'), 'xhigh');
    // A level its tool does not take, or no level at all, is refused.
    await assert.rejects(async () => patch('sam', { effort: 'ultra' }), refused(400));
    await assert.rejects(async () => patch('sam', { effort: 'loud' }), refused(400));
    // Grok takes Low to High; a level kept from another tool becomes the nearest it takes.
    await patch('gus', { effort: 'low' });
    assert.equal(await levelOf('gus'), '--reasoning-effort=low');
    await L.pg`update staff set effort = 'max' where id = 'gus'`;
    assert.equal(await levelOf('gus'), '--reasoning-effort=high');

    // The Office Manager: Low is refused, and a Low stored before still runs at Medium.
    await L.pg`update staff set role = ${L.MANAGER_ROLE} where id = 'paige'`;
    await assert.rejects(
      async () => patch('paige', { effort: 'low' }),
      (e: unknown) => {
        assert.equal((e as { status?: number }).status, 400);
        assert.match(
          String((e as { body?: { message?: string } }).body?.message),
          /Medium or more/
        );
        return true;
      }
    );
    await L.pg`update staff set effort = 'low' where id = 'paige'`;
    assert.equal(await levelOf('paige'), 'medium');
    await patch('paige', { effort: 'high' });
    assert.equal(await levelOf('paige'), 'high');
  } finally {
    for (const o of before)
      await L.pg`update staff set effort = null, agent = ${o.agent}, role = ${o.role} where id = ${o.id}`;
  }
});

test("each Odd runs on the model the owner picks from its tool's own list, the office's until then", async () => {
  const before = await L.pg<{ id: string; agent: string }[]>`
    select id, agent from staff where id in ('sam', 'gus')`;
  await L.pg`update staff set agent = 'claude' where id = 'sam'`;
  await L.pg`update staff set agent = 'grok' where id = 'gus'`;
  const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  try {
    // Claude Code: the office's Opus from setup until the owner picks.
    assert.equal(after((await chatOf('sam')).args, '--model'), 'opus');
    await patch('sam', { model: 'claude-fable-5-1' });
    assert.equal(after((await chatOf('sam')).args, '--model'), 'claude-fable-5-1');
    // A model from another tool's list, or none at all, is refused.
    await assert.rejects(async () => patch('sam', { model: 'grok-4.6' }), refused(400));
    await assert.rejects(async () => patch('sam', { model: 7 }), refused(400));
    // Back to the office's.
    await patch('sam', { model: null });
    assert.equal(after((await chatOf('sam')).args, '--model'), 'opus');
    // Grok: `-m`, only once picked.
    assert.ok(!(await chatOf('gus')).args.includes('-m'));
    await patch('gus', { model: 'grok-4.6' });
    assert.equal(after((await chatOf('gus')).args, '-m'), 'grok-4.6');
    // A model kept from another tool does not carry over.
    await L.pg`update staff set agent = 'claude' where id = 'gus'`;
    assert.equal(after((await chatOf('gus')).args, '--model'), 'opus');
  } finally {
    for (const o of before)
      await L.pg`update staff set model = null, agent = ${o.agent} where id = ${o.id}`;
  }
});

test("an Odd signs in through the account it is on: its own folder for each, the owner's own Claude login only until the office's is signed in, and a move starts a session that hears the chat", async () => {
  const { forgetClaudeAccount } = await import('./claude.ts');
  const accounts = join(folder, 'accounts');
  const signIn = (dir: string, email: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'signed-in'), email);
  };
  const before = await L.pg<{ id: string; agent: string; account: string | null }[]>`
    select id, agent, account from staff where id in ('sam', 'gus')`;
  await L.pg`update staff set agent = 'claude', account = null where id = 'sam'`;
  await L.pg`update staff set agent = 'grok', account = null where id = 'gus'`;
  const added: string[] = [];
  try {
    // Claude Code's Office account, not signed in: the owner's own login, no folder of its own.
    forgetClaudeAccount();
    assert.equal((await chatOf('sam')).configDir, null);
    // Signed in: its own folder from the next run on.
    signIn(join(accounts, 'claude', 'office'), 'office@example.com');
    forgetClaudeAccount();
    assert.equal((await chatOf('sam')).configDir, join(accounts, 'claude', 'office'));

    // An added Claude account: refused until signed in, saying where.
    const work = await L.addAccount('claude', 'Work');
    added.push(work.id);
    await patch('sam', { account: work.id });
    let said = '';
    await chat('sam', 'Hello.', (e) => {
      if (e.type === 'error') said = e.message;
    });
    assert.match(
      said,
      /^Claude Code is not signed in for this office\. Sign in on this Odd's Settings tab/
    );
    signIn(join(accounts, 'claude', work.id), 'work@example.com');
    forgetClaudeAccount(work.id);
    const onWork = await chatOf('sam');
    assert.equal(onWork.configDir, join(accounts, 'claude', work.id));
    // Its own sessions stay readable; every other account's folder does not.
    const denied = plain(onWork.args.slice(onWork.args.indexOf('--disallowedTools')));
    assert.ok(denied.includes('Read(/<home>/accounts/codex)'), denied.join(' '));
    assert.ok(denied.includes('Read(/<home>/accounts/claude/office)'), denied.join(' '));

    // Another tool's account is not one this Odd may use.
    const personal = await L.addAccount('grok', 'Personal');
    added.push(personal.id);
    await assert.rejects(async () => patch('sam', { account: personal.id }), refused(400));

    // Grok: the account's own home, and a move starts a new session that hears the chat so far.
    await chatOf('gus', 'Remember the word marigold.');
    await patch('gus', { account: personal.id });
    const moved = await chatOf('gus');
    assert.equal(moved.grokEnv?.GROK_HOME, join(accounts, 'grok', personal.id));
    assert.match(moved.message, /This is a new session/);
    assert.match(moved.message, /marigold/);
  } finally {
    for (const o of before)
      await L.pg`update staff set agent = ${o.agent}, account = ${o.account} where id = ${o.id}`;
    for (const id of added) await L.removeAccount(id);
    rmSync(join(accounts, 'claude', 'office', 'signed-in'), { force: true });
    forgetClaudeAccount();
  }
});

test("a new hire's first day and the manager's planning say how an Odd gets Run commands or Browse the web, the planning says where a level is raised, and a lesson never does", async () => {
  await L.startFirstDay('sam');
  const [day] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = 'sam' and kind = 'first_day' order by id desc limit 1`;
  const first = await runOf(day.id);
  const firstText = `${first.system}\n${first.message}`;
  assert.ok(
    firstText.includes(
      `3. If a tool you need is not in my_access, ask for it with ask_for_access. For Run commands or Browse the web, ask with ask_for_switch when my_access says ${await L.ownerName()} can switch it on.`
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
  const r = await followThrough(f, undefined, undefined, undefined, await L.goal(g.id));
  assert.equal(r.outcome, 'done', r.text);
  const plan = JSON.parse(r.text) as Gave;
  const planText = `${plan.system}\n${plan.message}`;
  const owner = await L.ownerName();
  assert.ok(
    planText.includes(
      "put any level raise in owner_steps, as a step on that Odd's Settings tab, under Model. Have the Odd ask"
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
