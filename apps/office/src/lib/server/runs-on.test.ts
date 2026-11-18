// The AI tool each Odd runs on: the Runs on picker, moving an Odd, its level and its model.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  L,
  PATCH,
  agents,
  assertKeychainUntouched,
  awayFromHome,
  currentOffice,
  gave,
  hireRoute,
  history,
  bin,
  chat,
  chatOf,
  folder,
  isBusy,
  onPlatform,
  plain,
  runOf,
  startedBy
} from './office-under-test.ts';

// After the office under test is set up, as its own imports are: the office reads where everything is as it loads.
const { agentCommand } = await import('./agent-sign-in.ts');
// The model an Odd with none of its own runs on each tool, which the picker sends for its Office default card.
const { shownOfficeModel } = await import('./claude.ts');

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

// Each tool's model is written out, not read from `shownOfficeModel`, so a
// change to which model the picker shows fails here.
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
          commandsHow: L.commandsHow('claude', 'darwin'),
          // Setup's model, Opus until the owner picks Sonnet.
          officeModel: 'claude-opus-5-5'
        },
        {
          id: 'grok',
          name: 'Grok',
          installed: false,
          signIn: { how: 'browser', installing: false, signedIn: false },
          commandsHow: L.commandsHow('grok', 'darwin'),
          // No Grok model set, so Grok's own default.
          officeModel: 'grok-4.7'
        },
        // The office under test's Codex home holds a sign-in file with no account in it.
        {
          id: 'codex',
          name: 'Codex',
          installed: false,
          signIn: { how: 'browser', installing: false, signedIn: true },
          commandsHow: L.commandsHow('codex', 'darwin'),
          // No Codex model set, so Codex's own default.
          officeModel: 'gpt-6.1-sol'
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
      commandsHow: L.commandsHow('grok', 'win32'),
      officeModel: shownOfficeModel('grok')
    },
    {
      id: 'codex',
      name: 'Codex',
      installed: false,
      // The office's Codex home is signed in under test.
      signIn: { ...out, signedIn: true },
      commandsHow: L.commandsHow('codex', 'win32'),
      officeModel: shownOfficeModel('codex')
    }
  ];
  const installed = [
    {
      id: 'claude',
      name: 'Claude Code',
      installed: true,
      signIn: out,
      commandsHow,
      officeModel: shownOfficeModel('claude'),
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
              commandsHow,
              officeModel: shownOfficeModel('claude')
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
          {
            id: 'claude',
            name: 'Claude Code',
            installed: true,
            signIn: out,
            commandsHow,
            officeModel: shownOfficeModel('claude')
          },
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
    const denied = plain(onWork.claudeSettings!.permissions.deny);
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

test('no test reached the keychain', () => {
  assertKeychainUntouched();
});
