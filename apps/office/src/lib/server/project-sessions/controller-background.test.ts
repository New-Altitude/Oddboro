// A project's Claude Code conversations run in Claude Code's background
// service, through the controller the project route drives. A stand-in claude
// logs each whole command and answers from files in the Claude folder it was
// given, and the terminal library is a stand-in that keeps what each terminal
// was opened with.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { app, save } from './controller-under-test.ts';

/** Each terminal opened: its arguments, folder and environment. */
const spawned: { args: string[]; cwd: string; env: Record<string, string> }[] = [];
/** Each size any terminal was set to, in order, as [cols, rows]. */
const resized: number[][] = [];
mock.module('@oddboro/ledger/project-terminal', {
  namedExports: {
    openProjectTerminal: async (
      _file: string,
      args: string[],
      options: { cwd: string; env: Record<string, string> }
    ) => {
      spawned.push({ args, cwd: options.cwd, env: options.env });
      let exited: ((e: { exitCode: number }) => void) | undefined;
      return {
        onData: () => {},
        onExit: (done: typeof exited) => void (exited = done),
        write: () => {},
        resize: (cols: number, rows: number) => void resized.push([cols, rows]),
        kill: () => {
          // Logged beside claude's commands, so a test can tell which came first.
          appendFileSync(calls, `terminal closed ${JSON.stringify(args)}\n`);
          exited?.({ exitCode: 0 });
        }
      };
    }
  }
});
const { L, folder, onPlatform, request, withEnv } = await import('../office-under-test.ts');
const { projectController } = await import('./controller.ts');
const { ClaudeNeedsTrust, endTerminalSession } = await import('./claude-background.ts');
const { PROJECT_WORDS } = await import('../../project-words.ts');

// The stand-in claude. Every call logs its whole command, then a Node helper
// answers it from the Claude folder it runs under: `--version` from one file
// for the computer, `agents --json` from the folder's `agents.json` (without
// `--all`, leaving out background sessions that ended, as Claude Code does, or
// from `agents-now.json` when a test wrote one: what Move here's second read
// finds just before its signal, since connect's reads all pass `--all`),
// and `--bg` with the folder's `bg.out`, else the line Claude Code prints. A
// background start adds its session to `agents.json`, under the folder's
// `start-id` when the test names one. `stop` and `rm` log again with the
// project folder and the Claude folder they ran in.
const calls = join(folder, 'background-calls.log');
const bin = join(folder, 'background-bin');
mkdirSync(bin);
const standIn = join(bin, 'claude');
const versionFile = join(bin, 'version');
const helper = join(bin, 'answer.mjs');
writeFileSync(
  helper,
  `import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [dir, ...args] = process.argv.slice(2);
const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined);
const rows = JSON.parse(read('agents.json') ?? '[]');
if (args[0] === '--version') process.stdout.write(readFileSync(${JSON.stringify(versionFile)}, 'utf8'));
else if (args[0] === 'auth') console.log('{"loggedIn":false}');
else if (args[0] === 'agents') {
  const ended = (r) => r.pid === undefined && ['done', 'stopped', 'failed'].includes(r.state);
  const now = read('agents-now.json');
  if (!args.includes('--all') && now !== undefined) process.stdout.write(now);
  else console.log(JSON.stringify(args.includes('--all') ? rows : rows.filter((r) => !ended(r))));
} else if (args[0] === '--bg') {
  const said = read('bg.out');
  const resume = args.indexOf('--resume');
  if (said !== undefined) process.stdout.write(said);
  else if (resume >= 0) console.log('backgrounded · ' + args[resume + 1].slice(0, 8) + ' · Work');
  else {
    const sessionId = read('start-id')?.trim() ?? randomUUID();
    rows.push({ sessionId, id: sessionId.slice(0, 8), kind: 'background', status: 'idle', cwd: process.cwd() });
    writeFileSync(join(dir, 'agents.json'), JSON.stringify(rows));
    console.log('backgrounded · ' + sessionId.slice(0, 8) + ' · ' + args[args.indexOf('-n') + 1]);
  }
} else if (args[0] === 'stop' || args[0] === 'rm')
  appendFileSync(${JSON.stringify(calls)}, args.join(' ') + ' in ' + process.cwd() + ' under ' + dir + '\\n');
`
);
writeFileSync(
  standIn,
  `#!/bin/sh
echo "$*" >> "${calls}"
exec "${process.execPath}" "${helper}" "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "$@"
`
);
chmodSync(standIn, 0o755);
process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
/** The stand-in by the name a Windows office starts, claude.exe, in a folder of its own. */
const windowsBin = join(folder, 'background-windows-bin');
mkdirSync(windowsBin);
symlinkSync(standIn, join(windowsBin, 'claude.exe'));
const onWindows = <T>(fn: () => Promise<T>) =>
  withEnv({ PATH: `${windowsBin}${delimiter}${process.env.PATH}` }, () => onPlatform('win32', fn));

const NEWEST = '2.1.325 (Claude Code)';
let stamp = 1_700_000_000;
/**
 * The stand-in now says it is `version`. The office reads a version once per
 * change to the binary's file, so the file's change time moves on too.
 */
function version(v: string) {
  writeFileSync(versionFile, v + '\n');
  stamp += 60;
  utimesSync(standIn, stamp, stamp);
}
version(NEWEST);

/** Each command claude ran since the test began, one per line, and each terminal closed. */
const logged = () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n') : []);

/** A Claude folder named in Setup, the only one, so every test reads its own. */
function claudeFolder(name: string) {
  const dir = join(homedir(), name);
  mkdirSync(dir, { recursive: true });
  L.setClaudeFolders([dir]);
  return dir;
}
/** What `claude agents --json` lists in the Claude folder `dir`. */
const agents = (dir: string, rows: object[]) =>
  writeFileSync(join(dir, 'agents.json'), JSON.stringify(rows));
/** What a read without `--all` lists in `dir` from now on: Move here's second read. */
const agentsNow = (dir: string, rows: object[]) =>
  writeFileSync(join(dir, 'agents-now.json'), JSON.stringify(rows));
/** Claude Code's row for `id` open in a terminal, run by the process `pid`. */
const inTerminal = (id: string, pid: number, status: string) => ({
  sessionId: id,
  kind: 'interactive',
  pid,
  status,
  cwd: app
});
/**
 * A process standing in for a terminal session's. A `sleep` child is the only
 * process a test lets the office signal. The test ends it.
 */
const terminalSession = () => spawn('sleep', ['30'], { stdio: 'ignore' });
const alive = (p: ReturnType<typeof terminalSession>) =>
  p.exitCode === null && p.signalCode === null;
/** The process id of a terminal session that has already exited. */
async function endedSession() {
  const p = terminalSession();
  p.kill();
  await once(p, 'exit');
  return p.pid!;
}
/**
 * A terminal session that answers Ctrl+C as `onInterrupt` says, once its
 * handler is in place. It touches `exiting` just before it exits.
 */
async function slowSession(onInterrupt: 'exit after a second' | 'ignore', exiting: string) {
  const handler =
    onInterrupt === 'ignore'
      ? '() => {}'
      : `() => setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(exiting)}, ''); process.exit(0); }, 1000)`;
  const p = spawn(
    process.execPath,
    ['-e', `process.on('SIGINT', ${handler}); console.log('ready'); setInterval(() => {}, 1000);`],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  );
  await once(p.stdout!, 'data');
  return p;
}
/** Every signal the office sends, still sent. */
const signals = mock.method(process, 'kill');
const interrupted = (pid: number | undefined) =>
  signals.mock.calls.some((k) => k.arguments[0] === pid && k.arguments[1] === 'SIGINT');
/** Where the plugin of the session `id` lives, which `--plugin-dir` names. */
const pluginOf = (id: string) => L.home('project-sessions', id, 'market', 'plugin');
const lastTerminal = () => spawned.at(-1)!;
const SHELL_STAND_IN = { skip: process.platform === 'win32' && 'the stand-in is a shell script' };
/** What `claude --bg` prints in a project folder Claude Code was never told to trust. */
const NOT_TRUSTED = `Workspace not trusted. Run \`claude\` in ${app} once to accept the workspace trust dialog.\n`;

const c = projectController();
/** The controller's runtimes and its release: no public method releases every one. */
const inside = c as unknown as {
  sessions: Map<string, unknown>;
  release(runtime: unknown): Promise<void>;
};
// The route answers only with Advanced mode on, which needs an owner.
await L.setOwnerName('Tester');
await L.setAdvancedMode(true);

beforeEach(() => writeFileSync(calls, ''));
afterEach(async () => {
  for (const runtime of [...inside.sessions.values()]) await inside.release(runtime);
  L.setClaudeFolders([]);
});
after(() => signals.mock.restore());

test(
  "Start runs a new conversation in Claude Code's background service with the office plugin and shows it with claude attach",
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-start');
    const fixture = randomUUID();
    writeFileSync(join(dir, 'start-id'), fixture);
    const s = await c.connect('claude', app, { configDir: dir, title: 'Fix the login page' });
    assert.ok(
      logged().includes(`--bg -n Fix the login page --plugin-dir ${pluginOf(s.id)}`),
      logged().join('\n')
    );
    assert.ok(!logged().some((line) => line.includes('--session-id')));
    assert.equal(s.nativeId, fixture);
    await c.terminal(s.id);
    assert.deepEqual(lastTerminal().args, ['attach', fixture.slice(0, 8)]);
  }
);

test(
  'Continue of a saved conversation never backgrounded continues it in the background under its own id, even after a /bg copied it elsewhere',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-continue');
    const continues = async (id: string) => {
      const s = await c.connect('claude', app, { nativeId: id, configDir: dir });
      await c.terminal(s.id);
      assert.ok(
        logged().includes(`--bg --resume ${id} --plugin-dir ${pluginOf(s.id)}`),
        logged().join('\n')
      );
      assert.deepEqual(lastTerminal().args, ['attach', id.slice(0, 8)]);
    };
    const id = randomUUID();
    save(dir, id);
    await continues(id);

    // The owner's /bg in a terminal ran a copy under another id, which runs
    // in the background; the conversation itself has only its saved file.
    const copy = terminalSession();
    try {
      const copied = randomUUID();
      const other = randomUUID();
      save(dir, copied);
      save(dir, other);
      agents(dir, [
        {
          sessionId: other,
          id: other.slice(0, 8),
          kind: 'background',
          pid: copy.pid,
          status: 'idle',
          cwd: app
        }
      ]);
      await continues(copied);
      assert.ok(!interrupted(copy.pid));
    } finally {
      copy.kill();
    }
  }
);

test(
  'A conversation with a background row, running or stopped, opens with claude attach and never with flags',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-attach');
    const job = terminalSession();
    try {
      const stopped = randomUUID();
      const running = randomUUID();
      save(dir, stopped);
      save(dir, running);
      agents(dir, [
        {
          sessionId: stopped,
          id: stopped.slice(0, 8),
          kind: 'background',
          state: 'stopped',
          cwd: app
        },
        {
          sessionId: running,
          id: running.slice(0, 8),
          kind: 'background',
          pid: job.pid,
          status: 'idle',
          cwd: app
        }
      ]);
      for (const id of [stopped, running]) {
        const s = await c.connect('claude', app, { nativeId: id, configDir: dir });
        await c.terminal(s.id);
        assert.deepEqual(lastTerminal().args, ['attach', id.slice(0, 8)]);
      }
      assert.ok(!logged().some((line) => line.startsWith('--bg')), logged().join('\n'));
      assert.ok(!interrupted(job.pid));
    } finally {
      job.kill();
    }
  }
);

test(
  'Open terminal refuses a conversation opened in a plain terminal since it was connected, and resumes no copy beside it',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-opened-since');
    const id = randomUUID();
    save(dir, id);
    const s = await c.connect('claude', app, { nativeId: id, configDir: dir });
    const session = terminalSession();
    try {
      agents(dir, [inTerminal(id, session.pid!, 'idle')]);
      const opened = spawned.length;
      await assert.rejects(c.terminal(s.id), { message: PROJECT_WORDS.useMove });
      assert.ok(!logged().some((line) => line.startsWith('--bg')), logged().join('\n'));
      assert.equal(spawned.length, opened, 'a terminal opened');
      assert.ok(!interrupted(session.pid) && alive(session));
    } finally {
      session.kill();
    }
  }
);

test(
  'Open terminal checks the Claude Code version again, so one below 2.1.285 since connect is refused in plain words before anything starts',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-version-terminal');
    const id = randomUUID();
    save(dir, id);
    const s = await c.connect('claude', app, { nativeId: id, configDir: dir });
    const opened = spawned.length;
    try {
      version('2.1.284 (Claude Code)');
      await assert.rejects(c.terminal(s.id), { message: PROJECT_WORDS.update });
      assert.ok(!logged().some((line) => line.startsWith('--bg')), logged().join('\n'));
      assert.equal(spawned.length, opened, 'a terminal opened');
    } finally {
      version(NEWEST);
    }
  }
);

test(
  'Open terminal on a saved conversation whose folder Claude Code no longer trusts says it could not start, with no trust question',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-untrusted-continue');
    const id = randomUUID();
    save(dir, id);
    const s = await c.connect('claude', app, { nativeId: id, configDir: dir });
    writeFileSync(join(dir, 'bg.out'), NOT_TRUSTED);
    const opened = spawned.length;
    await assert.rejects(c.terminal(s.id), { message: PROJECT_WORDS.startFailed });
    assert.equal(spawned.length, opened, 'a terminal opened');
  }
);

test(
  "A conversation open in a terminal is refused with Move here's words, and with move it is ended at idle and opened in the background",
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-move');
    const id = randomUUID();
    save(dir, id);
    const session = terminalSession();
    const busy = terminalSession();
    try {
      agents(dir, [inTerminal(id, session.pid!, 'idle')]);
      await assert.rejects(c.connect('claude', app, { nativeId: id, configDir: dir }), {
        message: PROJECT_WORDS.useMove
      });
      assert.ok(!interrupted(session.pid));

      // Only an idle session is ended: one replying or asking is left running.
      for (const [status, words] of [
        ['busy', PROJECT_WORDS.busy],
        ['waiting', PROJECT_WORDS.waiting]
      ]) {
        agents(dir, [inTerminal(id, busy.pid!, status)]);
        await assert.rejects(
          c.connect('claude', app, { nativeId: id, configDir: dir, move: true }),
          { message: words }
        );
        assert.ok(!interrupted(busy.pid) && alive(busy), status);
      }

      // Move here through the route: the session ends, and Claude Code drops its row.
      agents(dir, [inTerminal(id, session.pid!, 'idle')]);
      const dropped = once(session, 'exit').then(() => agents(dir, []));
      const answer = await request('/api/project-sessions', 'POST', {
        body: {
          action: 'connect',
          agent: 'claude',
          folder: app,
          nativeId: id,
          configDir: dir,
          move: true
        }
      });
      const s = (await answer.json()) as { id: string };
      assert.ok(interrupted(session.pid));
      await dropped;
      await c.terminal(s.id);
      assert.ok(
        logged().includes(`--bg --resume ${id} --plugin-dir ${pluginOf(s.id)}`),
        logged().join('\n')
      );
      assert.deepEqual(lastTerminal().args, ['attach', id.slice(0, 8)]);

      // A terminal session with no saved conversation has nothing to continue.
      const unsaved = randomUUID();
      agents(dir, [inTerminal(unsaved, busy.pid!, 'idle')]);
      assert.ok(!(await c.list('claude', app)).some((row) => row.id === unsaved));
    } finally {
      session.kill();
      busy.kill();
    }
  }
);

test(
  'A resume that prints another id is a copy: stopped, then removed, in the project under its Claude folder, and refused',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-copy');
    const id = randomUUID();
    save(dir, id);
    writeFileSync(join(dir, 'bg.out'), 'backgrounded · deadbeef · Work\n');
    const s = await c.connect('claude', app, { nativeId: id, configDir: dir });
    // The conversation resumes as its terminal opens, so that is where the copy is refused.
    await assert.rejects(c.terminal(s.id), { message: PROJECT_WORDS.copied });
    // In order, in the project, under the Claude folder the copy started in.
    assert.deepEqual(
      logged().filter((line) => line.includes(' under ')),
      [`stop deadbeef in ${app} under ${dir}`, `rm deadbeef in ${app} under ${dir}`]
    );
  }
);

test(
  'Move here is offered and works on Mac and Linux, and Windows gets the walk-through words',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-systems');
    const id = randomUUID();
    save(dir, id);
    const session = terminalSession();
    try {
      agents(dir, [inTerminal(id, session.pid!, 'idle')]);
      const movable = async () =>
        (await c.list('claude', app)).find((row) => row.id === id)?.movable;
      assert.equal(await onPlatform('darwin', movable), true);
      assert.equal(await onPlatform('linux', movable), true);
      assert.equal(await onWindows(movable), false);

      // Selecting it, and Move here sent anyway, both get the walk-through.
      await onWindows(() =>
        assert.rejects(c.connect('claude', app, { nativeId: id, configDir: dir }), {
          message: PROJECT_WORDS.windows
        })
      );
      await onWindows(() =>
        assert.rejects(c.connect('claude', app, { nativeId: id, configDir: dir, move: true }), {
          message: PROJECT_WORDS.windows
        })
      );
      assert.ok(!interrupted(session.pid) && alive(session));

      const dropped = once(session, 'exit').then(() => agents(dir, []));
      const s = await onPlatform('linux', async () => {
        const moved = await c.connect('claude', app, { nativeId: id, configDir: dir, move: true });
        await dropped;
        await c.terminal(moved.id);
        return moved;
      });
      assert.ok(interrupted(session.pid));
      assert.deepEqual(lastTerminal().args, ['attach', id.slice(0, 8)]);
      assert.equal(s.nativeId, id);
    } finally {
      session.kill();
    }
  }
);

test(
  'Move here reads the status again just before the signal: a reply or a question since refuses with no signal, and a session gone since counts as ended',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-reread');
    const id = randomUUID();
    save(dir, id);
    const session = terminalSession();
    try {
      agents(dir, [inTerminal(id, session.pid!, 'idle')]);
      for (const [status, words] of [
        ['busy', PROJECT_WORDS.busy],
        ['waiting', PROJECT_WORDS.waiting]
      ]) {
        agentsNow(dir, [inTerminal(id, session.pid!, status)]);
        await assert.rejects(
          c.connect('claude', app, { nativeId: id, configDir: dir, move: true }),
          { message: words }
        );
        assert.ok(!interrupted(session.pid) && alive(session), status);
      }
    } finally {
      session.kill();
    }

    // Listed idle by connect's read, and gone by the second: nothing to signal.
    const gone = await endedSession();
    agents(dir, [inTerminal(id, gone, 'idle')]);
    agentsNow(dir, []);
    await c.connect('claude', app, { nativeId: id, configDir: dir, move: true });
    assert.ok(!interrupted(gone));

    // Listed idle by both reads, yet gone before the signal: the signal finds
    // no process, which counts as ended too.
    const exited = await endedSession();
    agents(dir, [inTerminal(id, exited, 'idle')]);
    agentsNow(dir, [inTerminal(id, exited, 'idle')]);
    await c.connect('claude', app, { nativeId: id, configDir: dir, move: true });
    assert.ok(interrupted(exited));
  }
);

test(
  'Move here waits for the terminal session to exit, and says the terminal is still closing when it outlives the wait',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-slow');
    const id = randomUUID();
    const exiting = join(dir, 'exiting');
    const row = (pid: number) => ({ id, pid, status: 'idle', liveIn: dir });

    const slow = await slowSession('exit after a second', exiting);
    try {
      agents(dir, [inTerminal(id, slow.pid!, 'idle')]);
      await endTerminalSession(app, row(slow.pid!));
      assert.ok(interrupted(slow.pid) && existsSync(exiting));
    } finally {
      slow.kill('SIGKILL');
    }

    const stuck = await slowSession('ignore', exiting);
    try {
      agents(dir, [inTerminal(id, stuck.pid!, 'idle')]);
      await assert.rejects(endTerminalSession(app, row(stuck.pid!)), {
        message: PROJECT_WORDS.closeSlow
      });
      assert.ok(interrupted(stuck.pid) && alive(stuck));
    } finally {
      stuck.kill('SIGKILL');
    }
  }
);

test(
  "Move here on a session stored in one Claude folder, while a terminal runs the conversation under another, continues in the terminal's folder and stores it",
  SHELL_STAND_IN,
  async () => {
    const a = join(homedir(), '.claude-stored-a');
    const b = join(homedir(), '.claude-terminal-b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    L.setClaudeFolders([a, b]);
    const moveIn = async (configDir: string | undefined) => {
      const id = randomUUID();
      save(a, id, -3600);
      save(b, id);
      const known = await L.connectProject('claude', id, app, 'Work', a);
      const session = terminalSession();
      try {
        agents(b, [inTerminal(id, session.pid!, 'idle')]);
        const dropped = once(session, 'exit').then(() => agents(b, []));
        const s = await c.connect('claude', app, { nativeId: id, configDir, move: true });
        await dropped;
        await c.terminal(s.id);
        assert.equal(s.id, known.id);
        assert.ok(interrupted(session.pid));
        assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, b);
        assert.equal((await L.connection(s.id))?.configDir, b);
        return c.view(s.id)?.folderNotice;
      } finally {
        session.kill();
      }
    };
    // Reconnect sends the stored folder.
    assert.equal(
      await moveIn(a),
      'The terminal was using ~/.claude-terminal-b · signed out, so this session now uses it too.'
    );
    // The list's row names the folder of the copy that runs.
    assert.equal(await moveIn(b), null);
  }
);

test(
  'Move here on a session stored with no Claude folder, while a terminal runs the conversation under one, continues in that folder and stores it',
  SHELL_STAND_IN,
  async () => {
    const b = join(homedir(), '.claude-terminal-only-b');
    mkdirSync(b, { recursive: true });
    L.setClaudeFolders([b]);
    const moveIn = async (configDir: string | undefined) => {
      const id = randomUUID();
      save(b, id);
      const known = await L.connectProject('claude', id, app, 'Work');
      assert.equal(known.configDir, null);
      const session = terminalSession();
      try {
        agents(b, [inTerminal(id, session.pid!, 'idle')]);
        const dropped = once(session, 'exit').then(() => agents(b, []));
        const s = await c.connect('claude', app, { nativeId: id, configDir, move: true });
        await dropped;
        await c.terminal(s.id);
        assert.equal(s.id, known.id);
        assert.ok(interrupted(session.pid));
        assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, b);
        assert.equal((await L.connection(s.id))?.configDir, b);
        return c.view(s.id)?.folderNotice;
      } finally {
        session.kill();
      }
    };
    // Reconnect sends no folder: the session takes the terminal's, and says so.
    assert.match((await moveIn(undefined)) ?? '', /~\/\.claude-terminal-only-b/);
    // The list's row names the folder of the copy that runs.
    assert.equal(await moveIn(b), null);
  }
);

test('Opening the terminal again clears the note that it closed', SHELL_STAND_IN, async () => {
  const dir = claudeFolder('.claude-reopen');
  writeFileSync(join(dir, 'start-id'), randomUUID());
  const s = await c.connect('claude', app, { configDir: dir, title: 'Work' });
  (await c.terminal(s.id)).close();
  assert.equal(c.view(s.id)?.note, 'Terminal closed. You can reopen the conversation.');
  await c.terminal(s.id);
  assert.equal(c.view(s.id)?.note, 'Connected');
});

test(
  'A size from the page resizes the terminal once, and a redraw holds it one column wider for 30 ms, unless a newer size comes first',
  SHELL_STAND_IN,
  async (t) => {
    const dir = claudeFolder('.claude-size');
    writeFileSync(join(dir, 'start-id'), randomUUID());
    const s = await c.connect('claude', app, { configDir: dir, title: 'Work' });
    const terminal = await c.terminal(s.id);
    const view = randomUUID();
    const post = async (body: object) => {
      const answer = await request('/api/project-sessions', 'POST', {
        body: { id: s.id, view, ...body }
      });
      assert.ok(answer.ok, await answer.text());
    };
    await post({ action: 'control' });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    /** Each size set since the last call, after `ms` more of the clock. */
    const sizes = (ms = 0) => {
      t.mock.timers.tick(ms);
      return resized.splice(0);
    };
    sizes();
    await post({ action: 'size', cols: 100, rows: 30 });
    assert.deepEqual(sizes(1000), [[100, 30]]);

    await post({ action: 'size', cols: 100, rows: 30, redraw: true });
    assert.deepEqual(sizes(29), [[101, 30]]);
    assert.deepEqual(sizes(1), [[100, 30]]);

    terminal.redraw(100, 30);
    terminal.redraw(100, 30);
    assert.deepEqual(sizes(1000), [
      [101, 30],
      [101, 30],
      [100, 30]
    ]);

    terminal.redraw(100, 30);
    terminal.resize(120, 40);
    assert.deepEqual(sizes(1000), [
      [101, 30],
      [120, 40]
    ]);

    terminal.redraw(100, 30);
    terminal.close();
    assert.deepEqual(sizes(1000), [[101, 30]]);
  }
);

test(
  'Below Claude Code 2.1.285, or with background sessions turned off, Projects refuses in plain words before anything starts',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-version');
    const opened = spawned.length;
    try {
      version('2.1.284 (Claude Code)');
      await assert.rejects(c.connect('claude', app, { configDir: dir }), {
        message: PROJECT_WORDS.update
      });
      assert.ok(!logged().some((line) => line.startsWith('--bg')), logged().join('\n'));
      assert.equal(spawned.length, opened, 'a terminal opened');

      version('2.1.285 (Claude Code)');
      const s = await c.connect('claude', app, { configDir: dir });
      assert.ok(
        logged().includes(`--bg -n New Claude Code session --plugin-dir ${pluginOf(s.id)}`)
      );

      writeFileSync(join(dir, 'bg.out'), "'--bg' is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW.\n");
      await assert.rejects(c.connect('claude', app, { configDir: dir }), {
        message: PROJECT_WORDS.backgroundOff
      });
    } finally {
      version(NEWEST);
    }
  }
);

test(
  "Start in a folder Claude Code was never told to trust opens Claude Code's trust question in a setup terminal, and Start again closes it",
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-trust');
    const untrusted = join(dir, 'bg.out');
    writeFileSync(untrusted, NOT_TRUSTED);
    const plugins = () =>
      existsSync(L.home('project-sessions')) ? readdirSync(L.home('project-sessions')).sort() : [];
    const before = plugins();
    const opened = spawned.length;

    const refused = await c.connect('claude', '~/app', { configDir: dir }).then(
      () => assert.fail('Start went ahead in a folder Claude Code does not trust'),
      (e: unknown) => e
    );
    assert.ok(refused instanceof ClaudeNeedsTrust);
    assert.equal(refused.message, PROJECT_WORDS.trustLine);
    const setup = refused.setup;
    assert.ok(setup);
    assert.equal(spawned.length, opened + 1);
    assert.deepEqual(lastTerminal().args, []);
    assert.equal(lastTerminal().cwd, app);
    assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, dir);
    assert.ok(c.openTerminal(setup).running);
    assert.deepEqual(plugins(), before, 'a plugin folder was left under the unused key');

    // Start again, once the owner answered: the setup terminal closes before the start.
    rmSync(untrusted);
    await c.connect('claude', app, { configDir: dir });
    const log = logged();
    const closed = log.indexOf('terminal closed []');
    assert.ok(closed >= 0, log.join('\n'));
    assert.ok(closed < log.findLastIndex((line) => line.startsWith('--bg -n')), log.join('\n'));
    assert.throws(() => c.openTerminal(setup));

    // The page's Start through the route gets the terminal to show.
    writeFileSync(untrusted, NOT_TRUSTED);
    const answer = await request('/api/project-sessions', 'POST', {
      body: { action: 'connect', agent: 'claude', folder: app, configDir: dir }
    });
    assert.equal(answer.status, 200);
    const shown = (await answer.json()) as { setup?: string };
    assert.equal(typeof shown.setup, 'string');
    await c.disconnect(shown.setup!);
  }
);

test(
  "Move here reads the status again in the Claude folder that listed the terminal's process, even when another folder holds the newest file",
  SHELL_STAND_IN,
  async () => {
    const a = join(homedir(), '.claude-newest-a');
    const b = join(homedir(), '.claude-listed-b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    L.setClaudeFolders([a, b]);
    /** A conversation stored in `a`, whose newest file is in `a`, open in a terminal only `b` lists. */
    const listedInB = async (pid: number) => {
      const id = randomUUID();
      save(a, id);
      save(b, id, -3600);
      await L.connectProject('claude', id, app, 'Work', a);
      agents(b, [inTerminal(id, pid, 'idle')]);
      rmSync(join(b, 'agents-now.json'), { force: true });
      return id;
    };

    // Idle at both reads: the signal goes, and the session continues in b.
    const session = terminalSession();
    try {
      const id = await listedInB(session.pid!);
      const dropped = once(session, 'exit').then(() => agents(b, []));
      const s = await c.connect('claude', app, { nativeId: id, configDir: a, move: true });
      await dropped;
      await c.terminal(s.id);
      assert.ok(interrupted(session.pid));
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, b);
      assert.equal((await L.connection(s.id))?.configDir, b);
      assert.equal(
        c.view(s.id)?.folderNotice,
        'The terminal was using ~/.claude-listed-b · signed out, so this session now uses it too.'
      );
    } finally {
      session.kill();
    }

    // Busy by the second read in b: refused in the busy words, with no signal.
    const busy = terminalSession();
    try {
      const id = await listedInB(busy.pid!);
      agentsNow(b, [inTerminal(id, busy.pid!, 'busy')]);
      await assert.rejects(c.connect('claude', app, { nativeId: id, configDir: a, move: true }), {
        message: PROJECT_WORDS.busy
      });
      assert.ok(!interrupted(busy.pid) && alive(busy));
    } finally {
      busy.kill();
    }

    // Gone by the second read in b: counts as ended, with no signal.
    const gone = await endedSession();
    const id = await listedInB(gone);
    agentsNow(b, []);
    await c.connect('claude', app, { nativeId: id, configDir: a, move: true });
    assert.ok(!interrupted(gone));
  }
);
