// The loop every AI run goes through (drive.ts), in an office under test
// (office-under-test.ts) with its stand-in tools: how each tool's run ends,
// one row per way a run goes, and how a run and what it started stop. Run
// with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import type { Agent } from '@oddboro/ledger';
import { L, bin, folder, onWindows, withEnv } from './office-under-test.ts';

// After the office under test set its home, so each launch reads it.
const { drive, ownsGroup, processGone } = await import('./drive.ts');
const { LAUNCHES } = await import('./cli.ts');
const { claudeLaunch } = await import('./claude.ts');
const { stopGroups } = await import('./launch.ts');
type RunEnd = import('./drive.ts').RunEnd;
type Sink = import('./drive.ts').Sink;
type Launch = import('./cli.ts').Launch;
type CliRun = import('./cli.ts').CliRun;
type Driven = Launch & { read: NonNullable<Launch['read']> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Wait up to `ms` for `done`, and say whether it came. */
async function until(done: () => boolean, ms = 2000): Promise<boolean> {
  for (const start = Date.now(); !done(); await sleep(20))
    if (Date.now() - start > ms) return false;
  return true;
}
/** `child`'s end: at once when it already ended. */
const closed = (child: ChildProcessWithoutNullStreams): Promise<void> =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((r) => child.once('close', () => r()));
/** Kill each pid still there, for a test's `finally`. */
function killLeft(pids: (number | undefined)[]): void {
  for (const pid of pids)
    if (pid && !processGone(pid))
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // It went between the check and the kill.
      }
}
/** A run that never ends by itself, and records no tool of its own. */
const holding = (): ChildProcessWithoutNullStreams =>
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)']);

test('processGone says a running process is not gone', async () => {
  const child = spawn('sleep', ['60']);
  try {
    assert.equal(processGone(child.pid!), false);
  } finally {
    child.kill('SIGKILL');
    await closed(child);
  }
});

test('processGone says a process that exited and was reaped is gone', async () => {
  const child = spawn('true');
  await closed(child);
  assert.equal(processGone(child.pid!), true);
});

/** `fn`, with a stand-in `ps` first on PATH that prints `stat` for any process. */
function withPsSaying<T>(stat: string, fn: () => T): Promise<T> {
  const dir = mkdtempSync(join(folder, 'ps-'));
  writeFileSync(join(dir, 'ps'), `#!/bin/sh\necho ${stat}\n`);
  chmodSync(join(dir, 'ps'), 0o755);
  return withEnv({ PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` }, fn);
}

test('processGone says a process that exited but waits to be reaped is gone, though a signal still finds it', async () => {
  const child = spawn('sleep', ['60']);
  try {
    assert.equal(await withPsSaying('Z', () => processGone(child.pid!)), true);
  } finally {
    child.kill('SIGKILL');
    await closed(child);
  }
});

test('processGone says a sleeping process that a signal finds is not gone', async () => {
  const child = spawn('sleep', ['60']);
  try {
    assert.equal(await withPsSaying('S', () => processGone(child.pid!)), false);
  } finally {
    child.kill('SIGKILL');
    await closed(child);
  }
});

test('a stop returns every pid it found under the run, the tool first, off Windows', async () => {
  const at = join(mkdtempSync(join(folder, 'tree-')), 'grandchild.pid');
  const tool = spawn(
    process.execPath,
    [
      '-e',
      `const c = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });
require('node:fs').writeFileSync(${JSON.stringify(at)}, String(c.pid));
setInterval(() => {}, 1000);`
    ],
    { detached: true, stdio: 'ignore' }
  );
  let grandchild: number | undefined;
  try {
    assert.ok(await until(() => existsSync(at) && readFileSync(at, 'utf8') !== ''));
    grandchild = Number(readFileSync(at, 'utf8'));
    const found = stopGroups(tool.pid!);
    assert.equal(found[0], tool.pid);
    assert.ok(found.includes(grandchild), `the stop did not find ${grandchild} in ${found}`);
  } finally {
    killLeft([grandchild, tool.pid]);
  }
});

/**
 * `fn`, as on Windows, with SystemRoot at a folder whose System32\taskkill.exe
 * is a stand-in that logs its arguments, a line each, and stops nothing. The
 * office's tests do not run on Windows, so this checks the command a stop
 * chooses there, through the real `execFileSync`, not a real kill.
 */
async function withTaskkill<T>(fn: (log: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(folder, 'windows-'));
  const log = join(root, 'taskkill.log');
  mkdirSync(join(root, 'System32'));
  writeFileSync(
    join(root, 'System32', 'taskkill.exe'),
    `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\n`
  );
  chmodSync(join(root, 'System32', 'taskkill.exe'), 0o755);
  return onWindows(() => withEnv({ SystemRoot: root }, () => fn(log)));
}

test('a stop on Windows returns only the run, since taskkill walks the tree itself', async () => {
  const child = holding();
  try {
    assert.deepEqual(await withTaskkill(async () => stopGroups(child.pid!)), [child.pid]);
  } finally {
    child.kill('SIGKILL');
    await closed(child);
  }
});

test("a run stopped on Windows stops its tool's whole tree with taskkill", async () => {
  const launch: Driven = { args: [], env: {}, stdin: '', done: () => {}, read: () => [] };
  const stop = new AbortController();
  let child: ChildProcessWithoutNullStreams | undefined;
  try {
    const { end, log } = await withTaskkill(async (log) => {
      const going = drive(
        () => (child = holding()),
        launch,
        { event: () => {} },
        { deadline: Date.now() + 60_000, signal: stop.signal }
      );
      stop.abort();
      return { end: await going, log };
    });
    assert.deepEqual(end, { outcome: 'stopped' });
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
      '/PID',
      String(child!.pid),
      '/T',
      '/F'
    ]);
  } finally {
    if (child) {
      child.kill('SIGKILL');
      await closed(child);
    }
  }
});

// The table: each way a run goes, for each tool, through `drive` with the
// tool's own launch and stand-in. Grok has no reader yet, so it has no rows.
type Tool = Exclude<Agent, 'grok'>;
const TOOLS = L.AGENTS.filter((a): a is Tool => a !== 'grok');

/** The launch a run on `tool` starts with: Claude Code's own, else the tool's entry in `LAUNCHES`. */
const LAUNCH: Record<Tool, (r: CliRun) => Promise<Launch | { refused: string }>> = {
  claude: async (r) => claudeLaunch(r),
  codex: (r) => LAUNCHES.codex(r),
  gemini: (r) => LAUNCHES.gemini(r)
};

/** What a row's run gave its check. */
type Ran = {
  /** Whether `drive` called `start`. */
  started: boolean;
  child?: ChildProcessWithoutNullStreams;
  /** Every event the sink got, in order. */
  events: Parameters<Sink['event']>[0][];
  /** Whether the run took added words while it went (`live.add` set at its first event). */
  tookWords: boolean;
};

type Row = {
  /** What the run does, as a sentence for the test's name. */
  does: string;
  tools: readonly Tool[];
  /** The message's last line carries the stand-in's marker, if any. */
  message: string;
  check: (end: RunEnd, ran: Ran) => void;
};

const ROWS: Row[] = [
  {
    does: "a run whose tool succeeds ends done with the tool's reply",
    tools: TOOLS,
    message: 'Hello from the driver.',
    check: (end, ran) => {
      assert.equal(end.outcome, 'done', JSON.stringify(end));
      assert.ok(end.outcome === 'done');
      const reply = (end.text ?? end.spoken).trim();
      assert.ok(reply.endsWith('\nOutcome: done'), reply);
      const gave = JSON.parse(reply.slice(0, reply.lastIndexOf('\nOutcome:'))) as {
        message: string;
      };
      assert.ok(gave.message.includes('Hello from the driver.'), gave.message);
      assert.equal(ran.tookWords, false);
    }
  }
];

/** Start `tool`'s launch for `message` through `drive`, then hand the end to the row's check. */
async function driveRow(tool: Tool, row: Row): Promise<void> {
  const dir = mkdtempSync(join(folder, 'drive-'));
  const launch = await LAUNCH[tool]({
    key: randomUUID(),
    staffId: 'drive',
    dir,
    reads: [],
    writes: [dir],
    granted: [],
    web: false,
    commands: false,
    network: false,
    system: 'You are a stand-in.',
    input: row.message,
    // The stand-ins read the office's own server from what the launch wrote.
    servers: { office: { type: 'stdio', command: 'node', args: [], env: {} } },
    allowed: [],
    timeoutMs: 600_000,
    account: L.OFFICE_ACCOUNT
  });
  assert.ok('args' in launch, JSON.stringify(launch));
  const { read } = launch;
  assert.ok(read, `${tool}'s launch has no reader`);
  const live = L.reserveRun({ staffId: 'drive', kind: 'chat' });
  const ran: Ran = { started: false, events: [], tookWords: false };
  try {
    const end = await drive(
      () => {
        ran.started = true;
        ran.child = spawn(join(bin, tool), launch.args, {
          cwd: dir,
          env: launch.env,
          detached: ownsGroup(launch),
          windowsHide: true
        });
        return ran.child;
      },
      { ...launch, read },
      {
        event: (e) => {
          if (!ran.events.length) ran.tookWords = live.add !== undefined;
          ran.events.push(e);
        }
      },
      { deadline: Date.now() + 60_000, signal: live.stop.signal, live }
    );
    row.check(end, ran);
  } finally {
    L.releaseRun(live);
    if (ran.child) {
      killLeft([ran.child.pid]);
      await closed(ran.child);
    }
  }
}

for (const row of ROWS)
  for (const tool of row.tools)
    test(`${row.does}, on ${L.AGENT_NAMES[tool]}`, () => driveRow(tool, row));
