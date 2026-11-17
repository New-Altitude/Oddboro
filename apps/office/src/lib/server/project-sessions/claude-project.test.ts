// The continue path's list asks Claude Code which sessions run in a project.
// When it cannot answer, the owner reads plain words, never the raw error of
// starting the command, its path, or what it printed.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';

// Listing reads the Claude folders named in the office's settings file: one of
// this test's own, set before the office's code loads, so no test touches the real one.
process.env.ODDBORO_ENV = join(mkdtempSync(join(tmpdir(), 'office-claude-env-')), 'settings');
const { CLAUDE_LIST_FAILED, claudeProjects, markedClaudeProjects } =
  await import('./claude-project.ts');
const { claudeAccountOf, claudeFolderMark, claudeHome, forgetClaudeAccount } =
  await import('../claude.ts');
const { OFFICE_ACCOUNT, setClaudeFolders } = await import('@oddboro/ledger');

/** The office's words for each system it runs on, written out. */
const NOT_INSTALLED: [NodeJS.Platform, string][] = [
  ['darwin', 'Claude Code is not installed on this Mac.'],
  ['linux', 'Claude Code is not installed on this computer.'],
  ['win32', 'Claude Code is not installed on this computer.']
];
const FAILED = "Claude Code could not list this project's conversations. Try again.";

/** What listing `folder` throws, with PATH only `path`. */
async function refusal(folder: string, path: string): Promise<string> {
  const was = process.env.PATH;
  process.env.PATH = path;
  try {
    return await claudeProjects(folder).then(
      () => assert.fail('listing should have failed'),
      (e: Error) => e.message
    );
  } finally {
    process.env.PATH = was;
  }
}

test('with no Claude Code on this computer, listing a project says it is not installed on this Mac or computer, with no raw error or path', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'office-claude-project-')));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    for (const [system, words] of NOT_INSTALLED) {
      Object.defineProperty(process, 'platform', { value: system });
      // An empty folder as the whole PATH, so no claude can be found.
      const refused = await refusal(root, root);
      assert.equal(refused, CLAUDE_LIST_FAILED.missing(), system);
      assert.equal(refused, words, system);
      assert.doesNotMatch(refused, /ENOENT/);
      assert.ok(!refused.includes(root), refused);
    }
  } finally {
    Object.defineProperty(process, 'platform', platform);
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * How a stand-in `claude` answers `agents --json`, as a shell script body.
 * Each prints its own path, as a real failure's text would, so a test sees
 * whether any of it reaches the owner.
 */
const ANSWERS: [string, string][] = [
  ['exits 1', 'echo "Command failed: $0 agents" >&2; exit 1'],
  ['exits 0 with text that is not JSON', 'echo "$0: not JSON"'],
  ['exits 0 with an object, not a list', 'echo "{}"']
];

test(
  'when Claude Code fails, or answers with anything but a list, listing a project says it could not list them, with no path or raw error',
  { skip: process.platform === 'win32' && 'the stand-ins are shell scripts' },
  async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'office-claude-project-')));
    try {
      for (const [how, body] of ANSWERS)
        await t.test(`a claude that ${how}`, async () => {
          const bin = await mkdtemp(join(root, 'bin-'));
          writeFileSync(join(bin, 'claude'), `#!/bin/sh\n${body}\n`);
          chmodSync(join(bin, 'claude'), 0o755);
          const refused = await refusal(root, bin);
          assert.equal(refused, CLAUDE_LIST_FAILED.failed);
          assert.equal(refused, FAILED);
          assert.ok(!refused.includes(root), refused);
        });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test('when Claude Code does not answer in time, listing a project says it could not list them, with no command text', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'office-claude-project-')));
  const started: string[][] = [];
  // probe reaches execFile through its import, so the stand-in goes on the
  // module and the import is brought up to date with it. execFile marks the
  // error `killed` when its own timer stopped the command.
  mock.method(
    childProcess,
    'execFile',
    (cmd: string, args: string[], _options: object, done: (e: Error) => void) => {
      started.push([cmd, ...args]);
      done(
        Object.assign(new Error(`Command failed: ${cmd} ${args.join(' ')}`), {
          killed: true,
          signal: 'SIGTERM'
        })
      );
      return {};
    }
  );
  syncBuiltinESMExports();
  try {
    const refused = await refusal(root, root);
    assert.deepEqual(
      started.map((s) => s.slice(-5)),
      [['agents', '--json', '--cwd', root, '--all']]
    );
    assert.equal(refused, FAILED);
    assert.ok(!refused.includes(root), refused);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'conversations from every known folder are listed, each with its folder and login',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'office-claude-folders-')));
    const project = join(root, 'app');
    const calls = join(root, 'calls.log');
    const bin = join(root, 'bin');
    mkdirSync(project);
    mkdirSync(bin);
    // A stand-in claude that finds its folder as Claude Code does, and logs
    // each call with the CLAUDE_CONFIG_DIR it got.
    writeFileSync(
      join(bin, 'claude'),
      `#!/bin/sh
dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
echo "\${CLAUDE_CONFIG_DIR:-default} $1 $2" >> "${calls}"
case "$1 $2" in
  "auth status") cat "$dir/auth.json" 2>/dev/null || echo '{"loggedIn":false}' ;;
  "agents --json") [ -f "$dir/agents-fail" ] && exit 1; cat "$dir/agents.json" 2>/dev/null || echo '[]' ;;
esac
`
    );
    chmodSync(join(bin, 'claude'), 0o755);
    const home = homedir();
    const own = join(home, '.claude');
    const b = join(home, '.claude-b');
    const out = join(home, '.claude-out');
    const key = join(home, '.claude-key');
    const missing = join(home, '.claude-gone');
    const login = (dir: string, auth: object) =>
      writeFileSync(join(dir, 'auth.json'), JSON.stringify(auth));
    const ids = [0, 1, 2, 3].map((i) => `0000000${i}-0000-4000-8000-00000000000${i}`);
    for (const [i, dir] of [own, b, out, key].entries()) {
      const at = join(dir, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(at, { recursive: true });
      writeFileSync(
        join(at, ids[i] + '.jsonl'),
        JSON.stringify({ type: 'user', cwd: project, message: { content: 'Work ' + i } }) + '\n'
      );
    }
    login(own, { loggedIn: true, email: 'owner@example.com' });
    login(b, { loggedIn: true, email: 'owner@example.com' });
    login(out, { loggedIn: false });
    login(key, { loggedIn: true });
    // One running in b alone with no saved file yet; out cannot list what runs.
    const running = '00000009-0000-4000-8000-000000000009';
    writeFileSync(
      join(b, 'agents.json'),
      JSON.stringify([{ sessionId: running, cwd: project, kind: 'background', id: 'job-1' }])
    );
    writeFileSync(join(out, 'agents-fail'), '');
    setClaudeFolders([b, out, key, missing]);
    const was = process.env.PATH;
    process.env.PATH = `${bin}:${was}`;
    const marks = async () =>
      Object.fromEntries(
        (await markedClaudeProjects(project)).map((r) => [r.id, [r.configDir, r.mark]])
      );
    try {
      assert.deepEqual(await marks(), {
        [ids[0]]: [own, '~/.claude · owner@example.com'],
        [ids[1]]: [b, '~/.claude-b · owner@example.com'],
        [ids[2]]: [out, '~/.claude-out · signed out'],
        [ids[3]]: [key, '~/.claude-key · signed in'],
        [running]: [b, '~/.claude-b · owner@example.com']
      });
      login(b, { loggedIn: true, email: 'second@example.com' });
      assert.equal((await marks())[ids[1]][1], '~/.claude-b · second@example.com');
      const authCalls = () =>
        readFileSync(calls, 'utf8')
          .split('\n')
          .filter((l) => l === `${b} auth status`).length;
      const before = authCalls();
      await Promise.all([
        claudeFolderMark(b, { fresh: true }),
        claudeFolderMark(b, { fresh: true })
      ]);
      assert.equal(authCalls(), before + 1);
      // Within the minute, a mark not asked fresh reads the login kept, one after another too.
      await claudeFolderMark(b);
      await claudeFolderMark(b);
      assert.equal(authCalls(), before + 1);
      const log = readFileSync(calls, 'utf8');
      assert.ok(!log.includes(missing), log);
      assert.ok(!existsSync(missing));
      assert.match(log, /^default agents --json$/m);
    } finally {
      process.env.PATH = was;
      setClaudeFolders([]);
      await rm(root, { recursive: true, force: true });
    }
  }
);

/** Wait for `done`, up to 5 s. */
async function until(done: () => boolean) {
  const end = performance.now() + 5000;
  while (!done()) {
    if (performance.now() > end) assert.fail('The stand-in claude was not called in time.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test(
  'a sign-in forgets a login read already under way, so the next read starts again and its answer stands',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'office-claude-login-')));
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const dir = claudeHome();
    mkdirSync(dir, { recursive: true });
    const calls = join(dir, 'calls.log');
    // A stand-in claude that reads its sign-in, logs the call, then answers
    // only once the test lets that call (by its number) go.
    writeFileSync(
      join(bin, 'claude'),
      `#!/bin/sh
dir="$CLAUDE_CONFIG_DIR"
out=$(cat "$dir/auth.json")
echo "$1 $2" >> "$dir/calls.log"
n=$(wc -l < "$dir/calls.log" | tr -d ' ')
while [ -d "$dir" ] && [ ! -f "$dir/go-$n" ]; do sleep 0.02; done
echo "$out"
`
    );
    chmodSync(join(bin, 'claude'), 0o755);
    const login = (auth: object) => writeFileSync(join(dir, 'auth.json'), JSON.stringify(auth));
    const called = () =>
      existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').length - 1 : 0;
    const go = (n: number) => writeFileSync(join(dir, `go-${n}`), '');
    login({ loggedIn: false });
    const was = process.env.PATH;
    process.env.PATH = `${bin}:${was}`;
    try {
      // A run asks while the owner is still signing in, and its read is under way.
      const before = claudeAccountOf();
      await until(() => called() === 1);
      login({ loggedIn: true, email: 'owner@example.com' });
      forgetClaudeAccount();
      const after = claudeAccountOf(OFFICE_ACCOUNT, true);
      await until(() => called() === 2);
      go(2);
      assert.equal((await after)?.email, 'owner@example.com');
      // The read from before the sign-in ends last, and changes nothing kept.
      go(1);
      assert.equal(await before, undefined);
      assert.equal((await claudeAccountOf())?.email, 'owner@example.com');
      assert.equal(called(), 2);
    } finally {
      process.env.PATH = was;
      forgetClaudeAccount();
      for (const n of [1, 2]) go(n);
      await rm(root, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  }
);

/**
 * Which folder owns a conversation: where it is saved, the newest file when
 * two folders hold it, the first folder listed when both are as new, and,
 * running with no saved file, the one folder that listed it, else none.
 */
const OWNERS: {
  state: string;
  saved: { first?: number; second?: number };
  runningIn?: ('first' | 'second')[];
  owner: 'first' | 'second' | null;
}[] = [
  { state: 'saved in one folder', saved: { second: 1_000 }, owner: 'second' },
  { state: 'newer in the first', saved: { first: 2_000, second: 1_000 }, owner: 'first' },
  { state: 'newer in the second', saved: { first: 1_000, second: 2_000 }, owner: 'second' },
  { state: 'as new in both', saved: { first: 1_500, second: 1_500 }, owner: 'first' },
  {
    state: 'running in both, saved in neither',
    saved: {},
    runningIn: ['first', 'second'],
    owner: null
  }
];

test(
  'a conversation belongs to the folder with its newest file, the first listed on a tie, and to none when two run it unsaved',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'office-claude-owner-')));
    const project = join(root, 'owned');
    const bin = join(root, 'bin');
    mkdirSync(project);
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'claude'),
      `#!/bin/sh
dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
[ "$1 $2" = "agents --json" ] && { cat "$dir/agents.json" 2>/dev/null || echo '[]'; }
exit 0
`
    );
    chmodSync(join(bin, 'claude'), 0o755);
    const dirs = { first: join(homedir(), '.claude'), second: join(homedir(), '.claude-second') };
    const ids = OWNERS.map((_, i) => `0000010${i}-0000-4000-8000-00000000010${i}`);
    const running: Record<'first' | 'second', object[]> = { first: [], second: [] };
    for (const [i, { saved, runningIn }] of OWNERS.entries()) {
      for (const [which, seconds] of Object.entries(saved)) {
        const at = join(
          dirs[which as 'first' | 'second'],
          'projects',
          project.replace(/[^a-zA-Z0-9]/g, '-')
        );
        mkdirSync(at, { recursive: true });
        const file = join(at, ids[i] + '.jsonl');
        writeFileSync(
          file,
          JSON.stringify({ type: 'user', cwd: project, message: { content: 'Work' } }) + '\n'
        );
        utimesSync(file, seconds, seconds);
      }
      for (const which of runningIn ?? [])
        running[which].push({
          sessionId: ids[i],
          cwd: project,
          kind: 'background',
          id: `job-${i}`
        });
    }
    for (const which of ['first', 'second'] as const)
      writeFileSync(join(dirs[which], 'agents.json'), JSON.stringify(running[which]));
    setClaudeFolders([dirs.second]);
    const was = process.env.PATH;
    process.env.PATH = `${bin}:${was}`;
    try {
      const owners = Object.fromEntries(
        (await claudeProjects(project)).map((r) => [r.id, r.configDir])
      );
      assert.deepEqual(
        owners,
        Object.fromEntries(OWNERS.map(({ owner }, i) => [ids[i], owner && dirs[owner]]))
      );
    } finally {
      process.env.PATH = was;
      setClaudeFolders([]);
      for (const dir of Object.values(dirs)) rmSync(join(dir, 'agents.json'), { force: true });
      await rm(root, { recursive: true, force: true });
    }
  }
);

/**
 * Lists `project` with a stand-in claude whose own folder saves `saved` and
 * whose `claude agents` prints `running`, and returns each listed row by id.
 */
async function listedWith(saved: string[], running: object[]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'office-claude-kinds-')));
  const project = join(root, 'app');
  const bin = join(root, 'bin');
  const own = join(homedir(), '.claude');
  const at = join(own, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project);
  mkdirSync(bin);
  mkdirSync(at, { recursive: true });
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh
dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
[ "$1 $2" = "agents --json" ] && { cat "$dir/agents.json" 2>/dev/null || echo '[]'; }
exit 0
`
  );
  chmodSync(join(bin, 'claude'), 0o755);
  for (const id of saved)
    writeFileSync(
      join(at, id + '.jsonl'),
      JSON.stringify({ type: 'user', cwd: project, message: { content: 'Work' } }) + '\n'
    );
  writeFileSync(
    join(own, 'agents.json'),
    JSON.stringify(running.map((row) => ({ cwd: project, ...row })))
  );
  const was = process.env.PATH;
  process.env.PATH = `${bin}:${was}`;
  try {
    return Object.fromEntries((await claudeProjects(project)).map((r) => [r.id, r]));
  } finally {
    process.env.PATH = was;
    rmSync(join(own, 'agents.json'), { force: true });
    rmSync(at, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}

test(
  'A stopped background session lists as not running with its job, a terminal session lists as running with no job, and one id with both lists as the terminal one',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const [stopped, terminal, bothBgFirst, bothTerminalFirst] = [0, 1, 2, 3].map(
      (i) => `0000020${i}-0000-4000-8000-00000000020${i}`
    );
    const pid = process.pid;
    const background = (id: string) => ({ sessionId: id, kind: 'background', id: id.slice(0, 8) });
    const inTerminal = (id: string) => ({
      sessionId: id,
      kind: 'interactive',
      pid,
      status: 'idle'
    });
    const rows = await listedWith(
      [stopped, terminal, bothBgFirst, bothTerminalFirst],
      [
        background(stopped),
        inTerminal(terminal),
        background(bothBgFirst),
        inTerminal(bothBgFirst),
        inTerminal(bothTerminalFirst),
        background(bothTerminalFirst)
      ]
    );
    const state = (id: string) => {
      const { live, job, pid, status, movable } = rows[id];
      return { live, job, pid, status, movable };
    };
    assert.deepEqual(state(stopped), {
      live: false,
      job: stopped.slice(0, 8),
      pid: undefined,
      status: undefined,
      movable: false
    });
    const open = { live: true, job: '', pid, status: 'idle', movable: true };
    assert.deepEqual(state(terminal), open);
    assert.deepEqual(state(bothBgFirst), open);
    assert.deepEqual(state(bothTerminalFirst), open);
    assert.equal(Object.keys(rows).length, 4);
  }
);

test(
  'a terminal session with no saved conversation is left out, and a background one with none stays listed',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const [fresh, started] = [0, 1].map((i) => `0000030${i}-0000-4000-8000-00000000030${i}`);
    const rows = await listedWith(
      [],
      [
        { sessionId: fresh, kind: 'interactive', pid: process.pid, status: 'idle' },
        { sessionId: started, kind: 'background', id: started.slice(0, 8), pid: process.pid }
      ]
    );
    assert.deepEqual(Object.keys(rows), [started]);
    assert.equal(rows[started].job, started.slice(0, 8));
  }
);

test(
  'an sdk or remote session with a process is not running here and cannot be moved, since only interactive and background sessions are read',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const [sdk, remote] = [0, 1].map((i) => `0000040${i}-0000-4000-8000-00000000040${i}`);
    const rows = await listedWith(
      [sdk, remote],
      [
        { sessionId: sdk, kind: 'sdk', pid: process.pid, status: 'idle' },
        { sessionId: remote, kind: 'remote', pid: process.pid, status: 'idle' }
      ]
    );
    for (const id of [sdk, remote]) {
      const { live, pid, movable } = rows[id];
      assert.deepEqual({ live, pid, movable }, { live: false, pid: undefined, movable: false }, id);
    }
  }
);

test(
  'a terminal session listed with a process id of 0 or below has no process, so it is not running and cannot be moved',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const [zero, negative] = [0, 1].map((i) => `0000050${i}-0000-4000-8000-00000000050${i}`);
    const rows = await listedWith(
      [zero, negative],
      [
        { sessionId: zero, kind: 'interactive', pid: 0, status: 'idle' },
        { sessionId: negative, kind: 'interactive', pid: -1, status: 'idle' }
      ]
    );
    for (const id of [zero, negative]) {
      const { live, pid, movable } = rows[id];
      assert.deepEqual({ live, pid, movable }, { live: false, pid: undefined, movable: false }, id);
    }
  }
);
