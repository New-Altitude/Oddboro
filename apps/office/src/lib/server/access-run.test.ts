// What an Odd's own tools reach in a run, in an office under test
// (office-under-test.ts): which launch holds a shell, whether commands reach
// the internet and what happens when Claude Code refuses that, which of the
// owner's developer tool folders commands may read, and that the run, its
// prompt and its my_access read one profile. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir, hostname, networkInterfaces, tmpdir, type NetworkInterfaceInfo } from 'node:os';
import { dirname, join, matchesGlob } from 'node:path';
import { test } from 'node:test';
import {
  chat,
  chatOf,
  filesOf,
  folder,
  gave,
  L,
  odd,
  onPlatform,
  onWindows,
  ownerHome,
  runOf,
  setOwn,
  withEnv,
  type Gave
} from './office-under-test.ts';

const { LAUNCHES } = await import('./cli.ts');
const { DEV_FOLDERS, DEV_SECRETS, MAC_NAMES, macAddresses } = await import('./sandbox.ts');
const { networkHeld, resetHeldNetwork } = L;
const { shellEnv } = await import('./launch.ts');
const { runJob } = await import('./staff.ts');

await L.pg`insert into staff ${L.pg([
  odd('ava', 'Ava'),
  odd('bo', 'Bo'),
  odd('cy', 'Cy'),
  odd('dee', 'Dee'),
  odd('eli', 'Eli'),
  { ...odd('kit', 'Kit'), agent: 'grok' },
  { ...odd('cole', 'Cole'), agent: 'codex' }
])}`;

/** Run commands is on only on a Mac (`commandsHow`), where Claude Code's sandbox was measured. */
const onMac = { skip: process.platform !== 'darwin' && 'Run commands runs on a Mac only' };

/** A folder outside the office made now, by its real path, as `checkFolder` stores one. */
function made(...parts: string[]): string {
  const p = join(folder, 'given', ...parts);
  mkdirSync(p, { recursive: true });
  return realpathSync(p);
}
/** The value after `flag`. */
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
/** Every value given with `flag`, which may come more than once. */
const each = (args: string[], flag: string) => args.filter((_, i) => args[i - 1] === flag);
/** The values after `flag`, up to the next flag. */
function listAfter(args: string[], flag: string): string[] {
  const from = args.indexOf(flag) + 1;
  const end = args.findIndex((a, i) => i >= from && a.startsWith('--'));
  return args.slice(from, end);
}
type Sandbox = {
  filesystem: { denyRead: string[]; allowRead: string[]; denyWrite: string[] };
  network: { allowedDomains: string[]; deniedDomains?: string[] };
  credentials: { envVars: { name: string; mode: string }[] };
};
const sandboxOf = (run: Gave) =>
  (JSON.parse(after(run.args, '--settings')) as { sandbox?: Sandbox }).sandbox;
/** The run's temp folder, where Run commands puts its commands' own files. */
const tmpOf = (run: Gave) => `/private/tmp/ob-${run.env.RUN_KEY.slice(0, 8)}`;
/** The paths of a Claude Code run's Read allows, in order. */
const readAllows = (run: Gave) =>
  listAfter(run.args, '--allowedTools')
    .filter((a) => a.startsWith('Read(/'))
    .map((a) => a.slice('Read(/'.length, -'/**)'.length));

/** A run on another tool, with `commands` as given and nothing else switched on. */
const run = (commands: boolean) => {
  const dir = join(folder, 'staff', 'nobody');
  return {
    key: 'refused',
    account: 'office',
    staffId: 'nobody',
    dir,
    reads: [],
    writes: [dir],
    granted: [],
    system: 'You are nobody.',
    input: 'Hello.',
    servers: {},
    allowed: [],
    timeoutMs: 60_000,
    web: false,
    commands,
    network: false
  };
};

// No tool's sign-in check refuses in the office under test, so a launch that
// got past its refusal would start.
test("each tool's launch gives a shell exactly when commandsHow says and the office's file tools where the office carries its files, on every system, and refuses a run it cannot hold", async () => {
  /** A Codex run's `-c` value for `key`. */
  const codexSet = (args: string[], key: string) =>
    args.find((a, i) => args[i - 1] === '-c' && a.startsWith(`${key}=`))?.slice(key.length + 1);
  // Every Odd here has Run commands stored on, so only its tool decides.
  for (const [id, agent] of [
    ['bo', 'claude'],
    ['kit', 'grok'],
    ['cole', 'codex']
  ] as const) {
    await setOwn(id, { commands: true });
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      // Its temp folder is made in /private/tmp, which only a real Mac has.
      if (agent === 'claude' && platform === 'darwin' && process.platform !== 'darwin') continue;
      const on = `${agent} on ${platform}`;
      assert.ok(L.AGENT_PLATFORMS[agent].runs.includes(platform), on);
      const chat = () => chatOf(id);
      const run = await (platform === 'win32' ? onWindows(chat) : onPlatform(platform, chat));
      const shell = L.runsCommands(agent, platform, true);
      const carried = L.filesViaOffice(agent, platform);
      // The office's file server, and its tools allowed, exactly where it carries the files.
      assert.equal(filesOf(run) !== undefined, carried, on);
      const tools = after(run.args, '--tools');
      if (agent === 'claude') {
        // Its own file tools never, since the office carries them on every system.
        assert.equal(tools, shell ? 'Bash' : '', on);
        assert.ok(listAfter(run.args, '--allowedTools').includes('mcp__files'), on);
      }
      if (agent === 'grok') {
        assert.ok(!shell, on);
        // No file tool of its own on any system; todo_write stands in.
        assert.equal(tools, 'todo_write', on);
        assert.equal(each(run.args, '--allow').includes('MCPTool(files__*)'), carried, on);
      }
      if (agent === 'codex') {
        // The shell where its sandbox held commands, held by its permission profile; on Windows Codex's read-only mode.
        assert.equal(codexSet(run.args, 'features.shell_tool'), String(shell), on);
        assert.equal(codexSet(run.args, 'features.unified_exec'), String(shell), on);
        assert.equal(shell, platform !== 'win32', on);
        if (platform === 'win32') {
          assert.equal(codexSet(run.args, 'sandbox_mode'), '"read-only"', on);
          assert.equal(run.permissions, undefined, on);
        } else {
          assert.equal(codexSet(run.args, 'sandbox_mode'), undefined, on);
          assert.deepEqual(run.permissions?.network, { enabled: false }, on);
        }
      }
    }
  }
  assert.deepEqual(await LAUNCHES.grok(run(true)), { refused: L.COMMANDS_WHY.grok });
  assert.deepEqual(await LAUNCHES.gemini(run(true)), { refused: L.COMMANDS_WHY.gemini });
  // Codex runs without commands too: no shell, and no process group of its own, since only a shell leaves processes behind.
  for (const commands of [false, true]) {
    const launch = await LAUNCHES.codex(run(commands));
    assert.ok('args' in launch, JSON.stringify(launch));
    try {
      assert.equal(codexSet(launch.args, 'features.shell_tool'), String(commands));
      assert.equal(launch.ownGroup, commands ? true : undefined);
    } finally {
      launch.done();
    }
  }
});

test('every developer tool credential file sits in a listed folder, and no listed folder is in or holds a secret store', () => {
  // Any folder stands for the home: the lists name paths inside it.
  const at = (p: string) => join('/home', p);
  for (const s of DEV_SECRETS)
    assert.ok(
      DEV_FOLDERS.some((f) => L.within(at(s), at(f))),
      `${s} is in no listed folder`
    );
  for (const f of DEV_FOLDERS)
    for (const s of L.SECRET_STORES)
      assert.ok(
        !L.within(at(f), at(s)) && !L.within(at(s), at(f)),
        `${f} and the secret store ${s}`
      );
  assert.ok(!DEV_FOLDERS.some((f) => L.within(at(f), at('.docker'))), '~/.docker is listed');
});

test(
  "a handed-over run keeps the Odd's own Run commands, Browse the web and given folders; its write grant works at Draft, each change held by the gateway",
  onMac,
  async () => {
    await L.addConnector({
      id: 'notes',
      name: 'Notes',
      description: 'Notes for tests.',
      kind: 'http',
      config: { url: 'http://127.0.0.1:9/mcp' },
      readTools: ['read_note'],
      tools: ['read_note', 'write_note'],
      readyAt: new Date()
    });
    await L.pg`insert into grants (staff_id, connector_id, level) values ('ava', 'notes', 'act')`;
    const w = made('handed', 'write');
    await setOwn('ava', { commands: true, web: true, folders: [{ path: w, write: true }] });
    const h = await gave('lead', 'ava', { title: 'Handed over' });
    const run = await runOf(h.id);
    // The office carries its files, so no file tool of its own.
    assert.equal(after(run.args, '--tools'), 'Bash,WebSearch,WebFetch');
    assert.ok(filesOf(run)?.walls.writes.includes(w), 'the given folder left the file tools');
    assert.ok(sandboxOf(run), 'the handed-over run lost its sandbox');
    const allowed = listAfter(run.args, '--allowedTools');
    assert.ok(allowed.includes(`Edit(${L.rulePath(w)}/**)`), allowed.join(' '));
    assert.equal(run.env.CEILING, 'draft');
    // Every tool is listed: the gateway holds each change for the owner's yes.
    assert.ok(allowed.includes('mcp__notes'), allowed.join(' '));
  }
);

/** One interface's address as `networkInterfaces` gives it; only the address and its family matter here. */
const nic = (family: 'IPv4' | 'IPv6', address: string, internal = false): NetworkInterfaceInfo =>
  ({
    family,
    address,
    internal,
    netmask: '',
    mac: '',
    cidr: null,
    scopeid: 0
  }) as NetworkInterfaceInfo;

test("every address of every interface and this Mac's own names are denied to commands, IPv6 bare and in brackets, beside the loopback names and the any-address", () => {
  const cases: [string, ReturnType<typeof networkInterfaces>, string, string[]][] = [
    [
      'a Mac on a network',
      {
        lo0: [
          nic('IPv4', '127.0.0.1', true),
          nic('IPv6', '::1', true),
          nic('IPv6', 'fe80::1', true)
        ],
        en0: [
          nic('IPv4', '192.168.1.20'),
          nic('IPv6', '2001:db8::20'),
          nic('IPv6', 'fe80::1c2b:3a4d:5e6f:7081')
        ],
        utun0: [nic('IPv6', 'fe80::9abc:def0:1234:5678')]
      },
      'Ada-MacBook.local',
      [
        'Ada-MacBook.local',
        'ada-macbook',
        'ada-macbook.local',
        '192.168.1.20',
        '2001:db8::20',
        '[2001:db8::20]',
        'fe80::1c2b:3a4d:5e6f:7081',
        '[fe80::1c2b:3a4d:5e6f:7081]',
        'fe80::9abc:def0:1234:5678',
        '[fe80::9abc:def0:1234:5678]',
        'fe80::1',
        '[fe80::1]'
      ]
    ],
    // With Wi-Fi off only loopback is up, and the list still builds.
    [
      'a Mac with only loopback up',
      { lo0: [nic('IPv4', '127.0.0.1', true), nic('IPv6', '::1', true)] },
      'Ada-MacBook',
      ['Ada-MacBook', 'ada-macbook', 'ada-macbook.local']
    ],
    [
      'no interfaces at all, on a network domain',
      {},
      'Ada.example.com',
      ['Ada.example.com', 'ada', 'ada.local']
    ]
  ];
  for (const [name, interfaces, host, own] of cases) {
    const denied = macAddresses(interfaces, host);
    for (const a of [...MAC_NAMES, ...own])
      assert.ok(denied.includes(a), `${name}: ${a} is not denied`);
    assert.ok(denied.includes('::') && denied.includes('[::]'), `${name}: ${denied.join(' ')}`);
    assert.equal(new Set(denied).size, denied.length, `${name}: an address is listed twice`);
  }
});

test(
  "Claude's commands reach the internet only with Browse the web on, and never an address of this Mac",
  onMac,
  async () => {
    await setOwn('bo', { commands: true, web: true });
    const network = sandboxOf(await chatOf('bo'))?.network;
    assert.deepEqual(network?.allowedDomains, ['*']);
    const own = Object.values(networkInterfaces()).flatMap((l) => (l ?? []).map((i) => i.address));
    for (const a of [...MAC_NAMES, ...own, hostname()])
      assert.ok(network?.deniedDomains?.includes(a), `${a} is not denied`);
    // Closed, the network keeps its exact settings: no deny list beside it.
    await setOwn('bo', { commands: true });
    assert.deepEqual(sandboxOf(await chatOf('bo'))?.network, { allowedDomains: [] });
  }
);

test(
  'a Claude Code that refuses the open network fails that run in plain words, and later runs keep commands off the internet and say so',
  onMac,
  async () => {
    const owner = await L.ownerName();
    const title = "Kept Odds' commands off the internet";
    await setOwn('cy', { commands: true, web: true });
    await setOwn('eli', { commands: true, web: true });
    try {
      // Two runs refused at once, both started before either ended.
      const release = join(folder, 'release-refusals');
      const errors: Record<string, string> = {};
      const refused = ['cy', 'eli'].map((id) =>
        chat(id, `Hold until ${release} exists. Refuse the open network.`, (e) => {
          if (e.type === 'error') errors[id] = e.message;
        })
      );
      for (let i = 0; L.runsGoing.size < 2; i++) {
        assert.ok(i < 500, 'both runs never started');
        await new Promise((r) => setTimeout(r, 10));
      }
      writeFileSync(release, '');
      await Promise.all(refused);
      // The owner sent each message, and the chat dropped it, so they send it again.
      assert.deepEqual(errors, {
        cy: "This version of Claude Code will not let commands reach the internet, so Cy's commands now run with no network. Send your message again.",
        eli: "This version of Claude Code will not let commands reach the internet, so Eli's commands now run with no network. Send your message again."
      });
      // The Ledger line is written after the run ends, without holding it up.
      // The hold lives in memory, so a restart lifts it, and the line says so.
      let lines: { actor: string; body: string }[] = [];
      for (let i = 0; i < 100 && !lines.length; i++) {
        lines = await L.pg<
          { actor: string; body: string }[]
        >`select actor, body from ledger where title = ${title}`;
        if (!lines.length) await new Promise((r) => setTimeout(r, 20));
      }
      assert.deepEqual(
        lines.map((l) => ({ ...l })),
        [
          {
            actor: 'office',
            body: 'This version of Claude Code refuses to let commands reach the whole internet. Commands keep working, with no network. Restarting the office lifts this.'
          }
        ]
      );
      const next = await chatOf('cy', 'Refuse the open network.');
      assert.deepEqual(sandboxOf(next)?.network, { allowedDomains: [] });
      assert.equal(next.env.OFFICE_NETWORK_HELD, '1');
      assert.ok(next.system.includes(L.NETWORK_HELD_LINE), next.system);
      // The prompt and my_access say the same of the held network.
      const told = L.accessInRun(await L.capabilities((await L.staffer('cy'))!), owner, next.env);
      assert.ok(told.includes(L.NETWORK_HELD_LINE), told);
      const tools = told.split('\n').find((l) => l.startsWith('Your own tools'));
      assert.ok(tools && next.system.includes(tools), `${tools}\n${next.system}`);
      assert.equal(
        (await L.pg`select 1 from ledger where title = ${title}`).length,
        1,
        'a held network was recorded twice'
      );
      // An Odd with commands and no web lost no network to the hold, so is told
      // nothing of it. Its tool server still hears the office holds it, as a
      // Codex Odd's does, since office_report there speaks of every Odd.
      await setOwn('eli', { commands: true });
      const offline = await chatOf('eli');
      assert.equal(offline.env.OFFICE_NETWORK_HELD, '1');
      assert.ok(!offline.system.includes(L.NETWORK_HELD_LINE), offline.system);
      const codex = await chatOf('cole');
      assert.equal(codex.env.OFFICE_NETWORK_HELD, '1');
      assert.ok(!codex.system.includes(L.NETWORK_HELD_LINE), codex.system);
      // Nor does a Claude Code Odd with no shell, whose tool server still hears it.
      await setOwn('ava', {});
      const noShell = await chatOf('ava');
      assert.equal(noShell.env.OFFICE_NETWORK_HELD, '1');
      assert.ok(!noShell.system.includes(L.NETWORK_HELD_LINE), noShell.system);
    } finally {
      resetHeldNetwork();
    }
  }
);

test(
  'a refused job run says it stopped and is not tried again, never to send a message the owner never sent',
  onMac,
  async () => {
    await setOwn('dee', { commands: true, web: true });
    const job = await L.addJob({
      staffId: 'dee',
      name: 'Count the chairs',
      instructions: 'Refuse the open network.',
      schedule: { every: 'day', at: '07:00' }
    });
    try {
      const r = await runJob(job, 'manual');
      assert.deepEqual(r, {
        ok: false,
        text: "This version of Claude Code will not let commands reach the internet, so Dee's commands now run with no network. This run stopped and is not tried again."
      });
    } finally {
      resetHeldNetwork();
    }
  }
);

test(
  "a run with its network closed that fails with Claude Code's refusal words keeps its own words and holds no network",
  onMac,
  async () => {
    // A Claude Code that fails every run with the refusal words. The network
    // was never opened, so they cannot be a refusal of it.
    const bin = join(folder, 'refusal-words-bin');
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, 'claude');
    writeFileSync(
      claude,
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  process.stderr.write('Overly broad patterns like "*" are not allowed\\n');
  process.exit(1);
});
`
    );
    chmodSync(claude, 0o755);
    await setOwn('eli', { commands: true });
    try {
      const errors: string[] = [];
      await withEnv({ PATH: `${bin}:${process.env.PATH}` }, () =>
        chat('eli', 'Hello.', (e) => {
          if (e.type === 'error') errors.push(e.message);
        })
      );
      assert.deepEqual(errors, [
        'Claude Code stopped (exit 1). Overly broad patterns like "*" are not allowed'
      ]);
      assert.equal(networkHeld(), false);
    } finally {
      // A run held by mistake would hold every later test's network.
      resetHeldNetwork();
    }
  }
);

test(
  "a run that succeeds and quotes Claude Code's refusal words keeps the network open",
  onMac,
  async () => {
    await setOwn('eli', { commands: true, web: true });
    const quoted = await chatOf('eli', 'It said: Overly broad patterns like "*" are not allowed.');
    assert.ok(quoted.message.includes('Overly broad patterns'), quoted.message);
    assert.equal(networkHeld(), false);
    assert.deepEqual(sandboxOf(await chatOf('eli'))?.network?.allowedDomains, ['*']);
  }
);

/**
 * Whether Claude Code's commands read `file` in a sandbox's `fs`: it is in a
 * folder they read, and no deny inside that folder names it, as a path or a
 * glob. The broad denies (`~/`, the temp folders) sit outside every folder
 * read, which overrides them.
 */
const commandsRead = (fs: Sandbox['filesystem'], file: string) => {
  const folders = fs.allowRead.filter((r) => L.within(file, r));
  return (
    folders.length > 0 &&
    !fs.denyRead.some(
      (d) => folders.some((r) => L.within(d, r)) && (L.within(file, d) || matchesGlob(file, d))
    )
  );
};

test(
  "with Run commands, Claude reads the owner's developer tool folders that exist, never their credential files, and npm caches in the run's temp",
  onMac,
  () =>
    ownerHome(async (home) => {
      const h = realpathSync(home);
      const at = (...p: string[]) => join(h, ...p);
      for (const d of ['.npm', '.cargo', '.local/bin', '.nvm/versions/node/v1.0.0/bin'])
        mkdirSync(at(d), { recursive: true });
      // Each credential file, and a file beside it that commands still read.
      const files: [string, 'shut' | 'read'][] = [
        ['.nvm/versions/node/v1.0.0/etc/npmrc', 'shut'],
        ['.nvm/versions/node/v1.0.0/bin/node', 'read'],
        ['.volta/tools/image/node/v1.0.0/etc/npmrc', 'shut'],
        ['.volta/tools/image/node/v1.0.0/bin/node', 'read'],
        ['.gradle/init.gradle', 'shut'],
        ['.gradle/init.gradle.kts', 'shut'],
        ['.gradle/init.d/proxy.gradle', 'shut'],
        ['.gradle/wrapper/gradle-wrapper.properties', 'read'],
        ['go/pkg/mod/cache/vcs/0a1b/config', 'shut'],
        ['go/pkg/mod/cache/vcs/0a1b/HEAD', 'read'],
        ['.cargo/git/db/dep-0a1b/config', 'shut'],
        ['.cargo/git/db/dep-0a1b/HEAD', 'read'],
        ['go/src/a/.git/config', 'shut'],
        ['go/.git/config', 'shut'],
        ['go/src/a/.git/HEAD', 'read'],
        ['go/src/a/config', 'read']
      ];
      for (const [f] of files) {
        mkdirSync(dirname(at(f)), { recursive: true });
        writeFileSync(at(f), '');
      }
      await setOwn('dee', { commands: true });
      const run = await chatOf('dee');
      const fs = sandboxOf(run)?.filesystem;
      for (const read of [at('.npm'), at('.cargo'), at('.local/bin'), at('.nvm')])
        assert.ok(fs?.allowRead.includes(read), `${read} is not read`);
      assert.ok(!fs?.allowRead.some((p) => p.startsWith(at('.pyenv'))), '~/.pyenv is read');
      for (const shut of [
        at('.cargo', 'credentials'),
        at('.cargo', 'credentials.toml'),
        at('.cargo', 'config'),
        at('.cargo', 'config.toml'),
        at('.nvm/versions/node/v1.0.0/etc/npmrc'),
        at('.volta/tools/image/node/v1.0.0/etc/npmrc'),
        at('.gradle/init.d'),
        at('.gradle/init.d/proxy.gradle'),
        at('go/pkg/mod/cache/vcs/0a1b/config'),
        at('go/pkg/mod/cache/vcs/*/config'),
        at('.cargo/git/db/dep-0a1b/config'),
        at('.cargo/git/db/*/config'),
        at('go/**/.git/config'),
        at('.npm', '**/.env'),
        at('.npm', '**/.env.*'),
        at('.local/bin', '**/.env')
      ])
        assert.ok(fs?.denyRead.includes(shut), `${shut} is not shut`);
      for (const [f, want] of files)
        assert.equal(fs && commandsRead(fs, at(f)) ? 'read' : 'shut', want, f);
      const tmp = tmpOf(run);
      assert.deepEqual(run.npm, {
        npm_config_cache: join(tmp, 'npm'),
        npm_config_userconfig: join(tmp, 'npmrc')
      });
      // Only commands read them: the file tools' Read allows name none.
      assert.ok(!readAllows(run).some((p) => p.startsWith(h)), readAllows(run).join(' '));
    })
);

test(
  'a link in ~/.local/bin opens only its own file in the home, and no developer tool folder opens one that holds the home',
  onMac,
  () =>
    ownerHome(async (home) => {
      const h = realpathSync(home);
      const at = (...p: string[]) => join(h, ...p);
      const outside = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-outside-')));
      try {
        for (const d of ['.local/bin', 'Downloads', '.config/y', '.local/share/z[1]/bin'])
          mkdirSync(at(d), { recursive: true });
        for (const [name, target] of [
          ['x', at('Downloads/x')],
          ['y', at('.config/y/y')],
          ['z', at('.local/share/z[1]/bin/z')],
          ['w', join(outside, 'w')]
        ]) {
          writeFileSync(target, '');
          symlinkSync(target, at('.local/bin', name));
        }
        // A developer tool folder that is really the folder holding the home.
        symlinkSync(dirname(h), at('go'));
        await setOwn('dee', { commands: true });
        const reads = sandboxOf(await chatOf('dee'))?.filesystem.allowRead ?? [];
        assert.ok(reads.includes(at('Downloads/x')), `the link's own file is not read: ${reads}`);
        assert.ok(!reads.includes(at('Downloads')), "the link's folder is read");
        for (const shut of [at('.config/y'), at('.local/share/z[1]/bin'), outside])
          assert.ok(!reads.some((p) => p.startsWith(shut)), `${shut} is read`);
        assert.ok(!reads.includes(dirname(h)), 'the folder holding the home is read');
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    })
);

test(
  "the Odd's prompt and its my_access say the same about its own tools and the tool its runs go through",
  onMac,
  async () => {
    const owner = await L.ownerName();
    await setOwn('dee', {
      commands: true,
      web: true,
      folders: [
        { path: made('same', 'read'), write: false },
        { path: made('same', 'write'), write: true }
      ]
    });
    const run = await chatOf('dee');
    const dee = (await L.staffer('dee'))!;
    const told = L.accessInRun(await L.capabilities(dee), owner, run.env);
    const lines = told.split('\n');
    const runsOn = L.runsOnLine(dee.agent);
    assert.ok(lines.includes(runsOn), told);
    assert.ok(run.system.includes(`- ${runsOn}\n`), `${runsOn}\n${run.system}`);
    const tools = lines.find((l) => l.startsWith('Your own tools'));
    assert.ok(tools && run.system.includes(tools), `${tools}\n${run.system}`);
    const folders = lines.slice(lines.indexOf(`Folders ${owner} gave you:`) + 1, -1);
    assert.equal(folders.length, 2, told);
    for (const l of folders) assert.ok(run.system.includes(`  ${l}\n`), `${l}\n${run.system}`);
  }
);

test("a chat's replay walks the given write folders the profile lists", async () => {
  const gone = made('replay', 'gone');
  await setOwn('ava', { folders: [{ path: gone, write: true }] });
  await chatOf('ava');
  rmSync(gone, { recursive: true });
  // A file the Odd's own folder gained since, which the replay names.
  const notes = join(folder, 'staff', 'ava', 'notes');
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, 'since.md'), 'New.');
  // The stand-in keeps no session, so each chat starts a new one, with the replay.
  const { message } = await chatOf('ava');
  assert.ok(message.includes('(Files in your folder that changed during it: '), message);
  assert.ok(!message.includes('in your folder and the folders'), message);
});

test(
  "every tool reads one list: what a Codex run reads is what a Claude run reads, less its own folder and Claude Code's sessions folder",
  onMac,
  () =>
    ownerHome(async () => {
      const r = made('one-list', 'read');
      await setOwn('bo', { folders: [{ path: r, write: false }] });
      const onClaude = await runOf((await gave('lead', 'bo', { title: 'On Claude' })).id);
      const claudeThread = L.threadFolder(
        (
          await L.pg<{ id: number }[]>`
      select id from threads where title = 'On Claude'`
        )[0].id
      );
      const dir = join(folder, 'staff', 'bo');
      const sessions = join(homedir(), '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
      const claude = readAllows(onClaude)
        .filter((p) => p !== dir && p !== sessions)
        .map((p) => (p === claudeThread ? '<thread>' : p));
      await L.pg`update staff set agent = 'codex' where id = 'bo'`;
      try {
        const h = await gave('lead', 'bo', { title: 'On Codex' });
        const onCodex = await runOf(h.id);
        const fs = Object.entries(onCodex.permissions?.filesystem ?? {});
        // The run's reads come after node's OpenSSL config; this empty home has no developer tool folders.
        const from = fs.findIndex(([p]) => p.endsWith('/openssl.cnf')) + 1;
        const codex = fs
          .slice(from)
          .filter(([, v]) => v === 'read')
          .map(([p]) => (p === L.threadFolder(h.thread) ? '<thread>' : p));
        assert.deepEqual(codex, claude);
        assert.equal(claude.length, 3, claude.join(' '));
      } finally {
        await L.pg`update staff set agent = 'claude' where id = 'bo'`;
      }
    })
);

test(
  "with Run commands and Browse the web both on, the office's secrets stay hidden from commands that reach the internet",
  onMac,
  () =>
    withEnv({ FAKE_OWNER_API_TOKEN: 'x' }, async () => {
      await setOwn('bo', { commands: true, web: true });
      const sandbox = sandboxOf(await chatOf('bo'));
      assert.deepEqual(sandbox?.network, {
        allowedDomains: ['*'],
        deniedDomains: macAddresses(networkInterfaces(), hostname())
      });
      const hidden = sandbox?.credentials.envVars ?? [];
      for (const name of ['FAKE_OWNER_API_TOKEN', 'ANTHROPIC_API_KEY'])
        assert.ok(
          hidden.some((v) => v.name === name && v.mode === 'deny'),
          `${name} reaches commands: ${JSON.stringify(hidden)}`
        );
    })
);

test("--add-dir holds the run's temp only with Run commands on", onMac, async () => {
  await setOwn('bo', { commands: true });
  const on = await chatOf('bo');
  assert.equal(each(on.args, '--add-dir').at(-1), tmpOf(on));
  await setOwn('bo', { web: true });
  const off = await chatOf('bo');
  assert.ok(
    !each(off.args, '--add-dir').some((p) => p.startsWith('/private/tmp/')),
    each(off.args, '--add-dir').join(' ')
  );
});

test('npm_config_cache is the same <tmp>/npm for Claude and Codex', onMac, async () => {
  await setOwn('bo', { commands: true });
  const claude = await chatOf('bo');
  const npm = (env: Record<string, string>) => ({
    npm_config_cache: env.npm_config_cache,
    npm_config_userconfig: env.npm_config_userconfig
  });
  assert.deepEqual(claude.npm, npm(shellEnv(tmpOf(claude))));
  const codex = await chatOf('cole');
  assert.deepEqual(
    npm(codex.git ?? {}),
    npm(shellEnv(join(folder, 'codex-tmp', codex.env.RUN_KEY)))
  );
  assert.equal(claude.npm?.npm_config_cache, join(tmpOf(claude), 'npm'));
});
