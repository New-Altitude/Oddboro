// A Codex Odd's run as the office starts it, in an office under test
// (office-under-test.ts) with a stand-in `codex` first on PATH: its exact
// arguments, the permission profile the kernel holds it to on a chat, a
// thread run, a lead's chat and a run reading the owner's edit, its
// environment and temp folder, the office's Codex home and sign-in, what it is
// told about its own tools, how its stream (a recorded live turn too) reaches
// the floor and the usage records, and that what its shell left running in the
// run's process tree stops with it. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  L,
  assertKeychainUntouched,
  bin,
  chat,
  chatOf,
  codexLaunches,
  folder,
  gave,
  goal,
  odd,
  ownerData,
  plain,
  runOf
} from './office-under-test.ts';

const { mcpServers } = await import('./codex.ts');
const { stopGroups } = await import('./launch.ts');

await L.pg`insert into staff ${L.pg([
  { ...odd('cody', 'Cody'), agent: 'codex' },
  { ...odd('cass', 'Cass'), agent: 'codex' },
  { ...odd('cole', 'Cole'), agent: 'codex' }
])}`;

const CODEX_HOME = join(folder, 'codex');
/** The names no run may write in a folder it writes, as files.ts has them. */
const INSTRUCTIONS = [
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
];
/** Each instruction file in `w` shut, at the top and below, the path and everything under it. */
const shut = (w: string) =>
  Object.fromEntries(
    INSTRUCTIONS.flatMap((n) =>
      [`${w}/${n}`, `${w}/${n}/**`, `${w}/**/${n}`, `${w}/**/${n}/**`].map((p) => [p, 'deny'])
    )
  );
/** A profile's paths with this machine's folder and each run's id as stand-ins. */
const plainPaths = (fs: Record<string, string>) =>
  Object.fromEntries(Object.entries(fs).map(([p, v]) => [plain([p])[0], v]));
/** The `-c` values too long to compare whole, as stand-ins. */
const hideSets = (args: string[]) =>
  args.map((a, i) =>
    args[i - 1] === '-c' && /^(developer_instructions|permissions|mcp_servers)=/.test(a)
      ? `${a.slice(0, a.indexOf('='))}=<…>`
      : a
  );
/** One chat message's error, for a run that never replies. */
async function chatError(id: string, message = 'Hello.'): Promise<string> {
  let error = '';
  await chat(id, message, (e) => {
    if (e.type === 'error') error = e.message;
  });
  return error;
}
/** A new chat session for `id`, as if it never chatted. */
const forget = (id: string) => rmSync(L.chatSession(id), { force: true });

test("a Codex Odd's first chat starts codex exec with every switch the office sets, its message on stdin", async () => {
  const run = await chatOf('cody');
  assert.deepEqual(plain(hideSets(run.args)), [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--strict-config',
    '--ignore-rules',
    ...[
      'approval_policy="never"',
      'web_search="disabled"',
      'agents.enabled=false',
      'allow_login_shell=false',
      'shell_environment_policy.inherit="core"',
      'history.persistence="none"',
      'analytics.enabled=false',
      'check_for_update_on_startup=false',
      'cli_auth_credentials_store="file"',
      'project_root_markers=[]',
      'skills.bundled.enabled=false',
      'skills.include_instructions=false',
      ...[
        'view_image',
        'multi_agent',
        'hooks',
        'memories',
        'apps',
        'remote_plugin',
        'goals',
        'shell_snapshot',
        'plugins',
        'browser_use',
        'computer_use',
        'image_generation',
        'in_app_browser',
        'skill_mcp_dependency_install',
        'workspace_dependencies',
        'tool_suggest',
        'sleep_tool'
      ].map((f) => `features.${f}=false`),
      'developer_instructions=<…>',
      'permissions=<…>',
      'default_permissions="odd"',
      'mcp_servers=<…>'
    ].flatMap((c) => ['-c', c]),
    '-'
  ]);
  assert.match(run.system, /You are Cody\./);
  assert.ok(run.message.endsWith('Hello.'), run.message);
});

test("a Codex Odd's chat is held by the kernel to its own folder and its own temp folder, reads the owner's data folder it is told of, the developer folder xcode-select picks and node's OpenSSL config, and never reaches an instruction file, /tmp or the network", async () => {
  const run = await chatOf('cody');
  assert.ok(run.system.includes(`data folder: ${ownerData}`), run.system);
  assert.deepEqual(run.permissions?.network, { enabled: false });
  assert.deepEqual(plainPaths(run.permissions?.filesystem ?? {}), {
    ':root': 'deny',
    ':minimal': 'read',
    ':slash_tmp': 'deny',
    '/Library/Developer/CommandLineTools': 'read',
    '/private/var/db/xcode_select_link': 'read',
    '<home>/Applications/Xcode.app/Contents/Developer': 'read',
    '/System/Library/OpenSSL/openssl.cnf': 'read',
    '<home>/data': 'read',
    '<home>/staff/cody': 'write',
    '<home>/codex-tmp/<id>': 'write',
    ...shut('<home>/staff/cody')
  });
});

test('a Codex run reads the developer folder xcode-select names by its real path, never the link it named', async () => {
  const fs = (await chatOf('cody')).permissions?.filesystem ?? {};
  // The test's own folder may sit behind a link too (/var is one on a Mac).
  const apps = join(realpathSync(folder), 'Applications');
  assert.equal(fs[join(apps, 'Xcode.app', 'Contents', 'Developer')], 'read');
  assert.equal(fs[join(apps, 'Linked.app', 'Contents', 'Developer')], undefined);
});

test("a Codex run asks xcode-select with PATH alone, so DEVELOPER_DIR in the office's environment names no folder it reads", async () => {
  const fs = (await chatOf('cody')).permissions?.filesystem ?? {};
  assert.ok(process.env.DEVELOPER_DIR, 'the office under test sets DEVELOPER_DIR');
  assert.equal(fs[realpathSync(process.env.DEVELOPER_DIR)], undefined);
});

test("a Codex colleague's run on a thread reads the thread's folder and the owner's data folder, and writes only its own part of the thread", async () => {
  const h = await gave('cody', 'cass', { title: 'Codex thread' });
  const run = await runOf(h.id);
  const thread = L.threadFolder(h.thread);
  const fs = run.permissions?.filesystem ?? {};
  assert.equal(fs[thread], 'read');
  assert.equal(fs[ownerData], 'read');
  assert.equal(fs[join(thread, 'cass')], 'write');
  assert.equal(fs[join(folder, 'staff', 'cass')], 'write');
  for (const w of [join(folder, 'staff', 'cass'), join(thread, 'cass')])
    for (const [p, v] of Object.entries(shut(w))) assert.equal(fs[p], v, p);
});

test("a Codex lead's chat reads the folder of the goal it leads, and writes nothing there", async () => {
  const h = await gave('cody', 'cass', { title: 'Codex goal', goalId: await goal('Codex goal') });
  const thread = L.threadFolder(h.thread);
  const fs = (await chatOf('cody')).permissions?.filesystem ?? {};
  assert.equal(fs[thread], 'read');
  assert.ok(
    !Object.entries(fs).some(([p, v]) => p.startsWith(thread) && v === 'write'),
    'the chat writes in the goal folder'
  );
});

test("a Codex run reading the owner's edit may read that file and never write it", async () => {
  const dir = join(folder, 'staff', 'cass', 'notes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plan.md'), 'The owner wrote this.');
  assert.ok(
    await L.learnFromEdit('cass', { path: 'notes/plan.md', before: 'Cass wrote this.' }, 'x')
  );
  const [f] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = 'cass' and kind = 'edited' and outcome is null`;
  const fs = (await runOf(f.id)).permissions?.filesystem ?? {};
  assert.equal(fs[join(dir, 'plan.md')], 'read');
  assert.equal(fs[join(dir, 'plan.md', '**')], 'read');
});

test("a Codex run's environment has the office's Codex home and the run's own temp folder, and no key, Codex setting or node options from the office's own", async () => {
  const run = await chatOf('cody');
  assert.deepEqual(run.codexEnv, {
    CODEX_HOME,
    TMPDIR: join(folder, 'codex-tmp', run.env.RUN_KEY)
  });
  assert.equal(run.temp, true, 'the temp folder was not there while the run went');
});

test("a Codex run's temp folder goes when it ends, and one a run that died with the office left goes at the next run", async () => {
  await chatOf('cody');
  assert.deepEqual(readdirSync(join(folder, 'codex-tmp')), []);
  mkdirSync(join(folder, 'codex-tmp', 'died-with-the-office'));
  await chatOf('cody');
  assert.deepEqual(readdirSync(join(folder, 'codex-tmp')), []);
});

test('a message that starts with a dash reaches codex whole on stdin, never as a flag', async () => {
  forget('cody');
  const said = '- buy milk\n- call the vet';
  const run = await chatOf('cody', said);
  assert.ok(run.message.endsWith(said), run.message);
  assert.equal(run.args.at(-1), '-');
  // The owner's words also reach the office's tool server, inside `-c mcp_servers`; never as an argument of their own.
  assert.ok(!run.args.some((a) => a.startsWith('- buy milk')), 'the message went on argv');
});

test("Codex's shell commands, MCP calls and file changes reach the floor once each by Claude Code's names, and the reply is the last message", async () => {
  const run = await chatOf('cole');
  assert.deepEqual(run.tools, ['Bash', 'mcp__office__raise_ask', 'Edit']);
  assert.ok(!run.message.includes('Looking.'));
});

test("a Codex run's tokens are recorded with cached and cache-written tokens apart from the rest of its input", async () => {
  await chatOf('cole');
  let rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 100 && !rows.length; i++) {
    rows = await L.pg`
      select model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
      from usage where staff_id = 'cole'`;
    if (!rows.length) await new Promise((r) => setTimeout(r, 20));
  }
  // The stand-in's turn: 1000 in, 600 of them cached and 100 cache-written; 50 out, 20 of them reasoning.
  assert.deepEqual(rows[0], {
    model: 'codex',
    input_tokens: 300,
    output_tokens: 50,
    cache_read_tokens: 600,
    cache_write_tokens: 100
  });
});

test("a Codex Odd's next chat resumes the session its last one started", async () => {
  forget('cole');
  const first = await chatOf('cole');
  assert.ok(!first.args.includes('resume'), 'a first chat resumed a session');
  const next = await chatOf('cole');
  assert.deepEqual(next.args.slice(-3), ['resume', '019a0000-0000-7000-8000-00000000c0de', '-']);
});

test('a Codex Odd is told it has a shell confined to its folders with no network, never that it has no shell', async () => {
  const run = await chatOf('cody');
  assert.match(
    run.system,
    /Your own tools are a shell and file edits, confined to your folders, with no network and no web\./
  );
  assert.doesNotMatch(run.system, /no shell/);
});

test('a recorded Codex turn replays as it ran: the floor sees the office call, the file change and the shell command once each, the reply is the last message, and the next chat resumes its thread', async () => {
  // A live codex-cli 0.166.0 turn on the free plan, with the owner's paths and the thread id made up.
  const fixture = fileURLToPath(new URL('./fixtures/codex-chat.jsonl', import.meta.url));
  forget('cass');
  const tools: string[] = [];
  let text = '';
  try {
    await chat('cass', `Replay ${fixture}`, (e) => {
      if (e.type === 'tool') tools.push(e.name);
      if (e.type === 'done') text = e.text;
      if (e.type === 'error') text = e.message;
    });
    assert.deepEqual(tools, ['mcp__office__my_goals', 'Edit', 'Bash']);
    assert.ok(text.startsWith('1. `my_goals` returned: `You serve no goals yet.`'), text);
    assert.ok(!text.includes('follow the sequence'), 'the first message joined the reply');
    const next = await chatOf('cass');
    assert.deepEqual(next.args.slice(-3), ['resume', '019a0000-0000-7000-8000-0000000c0de2', '-']);
  } finally {
    forget('cass');
  }
});

test('whatever a Codex run left running stops when the run ends', async () => {
  const at = join(folder, 'sleeper.pid');
  await chatOf('cole', `Leave a sleeper at ${at}`);
  const pid = Number(readFileSync(at, 'utf8'));
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    for (let i = 0; i < 100 && alive(); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(alive(), false, 'the sleep the run started outlived it');
  } finally {
    if (alive()) process.kill(pid);
  }
});

test('stopping a run mid-command stops the command too, though Codex runs each command in a process group of its own', async () => {
  const at = join(folder, 'command.pid');
  // A stand-in for codex as a run times out: in a group of its own, with a
  // command it started in another group still running.
  const tool = spawn(
    process.execPath,
    [
      '-e',
      `const c = require('node:child_process').spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
require('node:fs').writeFileSync(${JSON.stringify(at)}, String(c.pid));
setInterval(() => {}, 1000);`
    ],
    { detached: true, stdio: 'ignore' }
  );
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const wait = async (done: () => boolean) => {
    for (let i = 0; i < 100 && !done(); i++) await new Promise((r) => setTimeout(r, 20));
  };
  await wait(() => existsSync(at));
  const command = Number(readFileSync(at, 'utf8'));
  try {
    assert.ok(tool.pid && alive(command), 'the stand-in did not start its command');
    stopGroups(tool.pid);
    await wait(() => !alive(command) && !alive(tool.pid!));
    assert.equal(alive(command), false, 'the command outlived the run');
    assert.equal(alive(tool.pid), false, 'the tool outlived the run');
  } finally {
    for (const pid of [command, tool.pid]) if (pid && alive(pid)) process.kill(pid);
  }
});

test("a Codex turn that fails ends the run with Codex's own words", async () => {
  const stream = join(folder, 'codex-failed.jsonl');
  writeFileSync(
    stream,
    [
      { type: 'thread.started', thread_id: '019a0000-0000-7000-8000-00000000fa11' },
      { type: 'turn.failed', error: { message: 'The model is busy.' } }
    ]
      .map((e) => JSON.stringify(e))
      .join('\n') + '\n'
  );
  assert.equal(await chatError('cass', `Replay ${stream}`), 'The model is busy.');
});

test("the office keeps a config.toml it did not write, so the owner's workspace pin stays", async () => {
  const config = join(CODEX_HOME, 'config.toml');
  const pinned = 'forced_chatgpt_workspace_id = "ws-test"\n';
  writeFileSync(config, pinned);
  await chatOf('cody');
  assert.equal(readFileSync(config, 'utf8'), pinned);
});

test('a Codex run from an office Codex home nobody signed in to points to its Access tab to sign in to that home, which keeps the sign-in as a file, and starts nothing', async () => {
  const auth = join(CODEX_HOME, 'auth.json');
  const config = join(CODEX_HOME, 'config.toml');
  const before = codexLaunches().length;
  renameSync(auth, `${auth}.away`);
  rmSync(config);
  try {
    assert.equal(
      await chatError('cody'),
      "Codex is not signed in for this office. Sign in on this Odd's Access tab, under Runs on."
    );
    assert.equal(codexLaunches().length, before, 'codex started without a sign-in');
    assert.match(readFileSync(config, 'utf8'), /^cli_auth_credentials_store = "file"$/m);
  } finally {
    renameSync(`${auth}.away`, auth);
  }
});

test('a Codex Odd on a Mac without codex fails its run naming Codex, and never runs on Claude Code', async () => {
  // Only the stand-ins' folder, so the Mac's own codex, if it has one, is not found either.
  const path = process.env.PATH;
  process.env.PATH = bin;
  renameSync(join(bin, 'codex'), join(bin, 'codex-away'));
  try {
    assert.match(await chatError('cody'), /^Could not start Codex: spawn codex ENOENT/);
  } finally {
    renameSync(join(bin, 'codex-away'), join(bin, 'codex'));
    process.env.PATH = path;
  }
});

test("a Codex run's MCP servers call their tools without asking, a server granted by tool gets only those, and the office's must start", () => {
  const servers = mcpServers(
    {
      office: { type: 'stdio', command: 'node', args: ['mcp.ts'], env: { RUN_KEY: 'k' } },
      notes: { type: 'http', url: 'https://notes.example/mcp', headers: { Authorization: 'a' } }
    },
    ['mcp__office', 'mcp__notes__search', 'mcp__notes__read']
  );
  assert.deepEqual(servers, {
    office: {
      command: 'node',
      args: ['mcp.ts'],
      env: { RUN_KEY: 'k' },
      default_tools_approval_mode: 'approve',
      required: true
    },
    notes: {
      url: 'https://notes.example/mcp',
      http_headers: { Authorization: 'a' },
      default_tools_approval_mode: 'approve',
      enabled_tools: ['search', 'read']
    }
  });
});

test('no test reached the keychain', () => {
  assertKeychainUntouched();
});
