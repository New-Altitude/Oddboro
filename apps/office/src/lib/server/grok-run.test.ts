// A Grok Odd's runs: its sandbox, its sign-in and its renewals. Run with `npm test -w @oddboro/office`.
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
import { randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  L,
  assertKeychainUntouched,
  awayFromHome,
  filesOf,
  bin,
  chat,
  chatOf,
  code,
  folder,
  followThrough,
  onPlatform,
  onWindows,
  ownerData,
  plain,
  rgBin,
  runOf,
  type Gave
} from './office-under-test.ts';

// After the office under test is set up, as its own imports are: the office reads where everything is as it loads.
const { deniedEdits } = await import('./files.ts');
const { grokLaunch } = await import('./grok.ts');

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
  const shown = plain(run.args);
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
      // The message in a file, and the system prompt in the agent file, never on the command line.
      '--prompt-file',
      '<home>/accounts/grok/office/runs/<id>.prompt.txt',
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

test("a Grok run's servers and system prompt come from an agent file, and its message from a file, only the owner reads, which go when the run ends", async () => {
  const run = await chatOf('gus');
  assert.equal(run.agentMode, 0o600);
  assert.equal(run.promptFileMode, 0o600);
  // Added to Grok's own prompt, as --rules added it.
  assert.equal(run.promptMode, 'extend');
  assert.match(run.system, /^You are Gus\./);
  assert.ok(run.env.RUN_KEY, 'the tool server got no key');
  assert.deepEqual(readdirSync(join(folder, 'accounts', 'grok', 'office', 'runs')), []);
});

test("on Windows, a Grok run's long message, its system prompt and a picture stay off its command line, which holds 32,767 characters", async () => {
  // Windows quotes each argument and parts them with a space.
  const length = (args: string[]) => args.reduce((n, a) => n + a.length + 3, 0);
  // The --deny and --allow rules stay on the command line: Grok takes them from
  // no per-run file. Everything else fits in a few thousand characters.
  const rule = (a: string, i: number, all: string[]) =>
    ['--deny', '--allow'].includes(a) || ['--deny', '--allow'].includes(all[i - 1]);
  const fits = (args: string[]) => {
    const rest = args.filter((a, i) => !rule(a, i, args));
    assert.ok(length(rest) < 4_000, `besides its rules, the command line takes ${length(rest)}`);
    assert.ok(length(args) < 32_767, `the command line takes ${length(args)} characters`);
  };
  const message = 'Count every chair in the hall. '.repeat(1_300);
  assert.ok(message.length > 40_000);
  const run = await onWindows(() => chatOf('gus', message));
  fits(run.args);
  assert.ok(run.message.endsWith(message), 'the message did not reach Grok whole');
  assert.match(run.system, /^You are Gus\./);

  // An office run's picture, 100 KB, goes in the message's .json file too.
  const picture = join(folder, 'big-picture.png');
  writeFileSync(picture, randomBytes(100_000));
  const launch = await onWindows(() =>
    grokLaunch({
      key: randomUUID(),
      account: L.OFFICE_ACCOUNT,
      staffId: 'office',
      dir: folder,
      reads: [],
      writes: [folder],
      deniedEdits: [],
      system: 'Draw what is asked. '.repeat(1_000),
      message: 'Draw a desk.',
      newSession: randomUUID(),
      servers: {},
      allowed: [],
      web: false,
      images: [{ path: picture, mediaType: 'image/png' }],
      bare: true
    })
  );
  try {
    fits(launch.args);
    const file = launch.args[launch.args.indexOf('--prompt-file') + 1];
    assert.ok(file.endsWith('.prompt.json'), file);
    const blocks = JSON.parse(readFileSync(file, 'utf8')) as { data?: string; text?: string }[];
    assert.equal(blocks[0].data, readFileSync(picture).toString('base64'));
    assert.equal(blocks[1].text, 'Draw a desk.');
  } finally {
    launch.done();
    rmSync(picture);
  }
});

test("the office's Grok home is the owner's alone, and an agent file a run that died with the office left goes at the next run", async () => {
  const grok = join(folder, 'accounts', 'grok', 'office');
  const stale = join(grok, 'runs', 'died-with-the-office.md');
  const message = join(grok, 'runs', 'died-with-the-office.prompt.json');
  mkdirSync(join(grok, 'runs'), { recursive: true });
  writeFileSync(stale, '---\nmcpServers: []\n---\n');
  writeFileSync(message, '[]');
  chmodSync(grok, 0o755);
  await chatOf('gus');
  assert.equal(statSync(grok).mode & 0o777, 0o700);
  assert.ok(!existsSync(stale), 'the dead run left its agent file, secrets and all');
  assert.ok(!existsSync(message), 'the dead run left its message');
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
  // On Linux /tmp and /var stay open: Grok cannot start with either shut (`grokShut`).
  const linux = process.platform === 'linux';
  const shut = [join(homedir(), 'Library'), '/Library', ...(linux ? [] : ['/tmp', '/var'])];
  for (const p of shut.filter(existsSync))
    assert.ok(run.profile?.includes(JSON.stringify(`${realpathSync(p)}/**`)), `${p} is not shut`);
  if (linux)
    for (const p of ['/tmp', '/var'])
      assert.ok(!run.profile?.includes(JSON.stringify(`${p}/**`)), `${p} is shut on Linux`);
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
  // Real time, not a mock clock: the renewal's limit is probe's, which is
  // execFile's own timer, and a mock clock cannot reach that.
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

test('no test reached the keychain', () => {
  assertKeychainUntouched();
});
