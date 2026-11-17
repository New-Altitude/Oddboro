// A project's Claude Code conversations run in Claude Code's background
// service, through the controller the project route drives. The stand-in
// claude and terminal library are in controller-background-under-test.ts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  agents,
  agentsNow,
  alive,
  c,
  ClaudeNeedsTrust,
  claudeFolder,
  endedSession,
  endTerminalSession,
  inTerminal,
  interrupted,
  L,
  lastTerminal,
  logged,
  NEWEST,
  NOT_TRUSTED,
  onPlatform,
  onWindows,
  pluginOf,
  PROJECT_WORDS,
  request,
  SHELL_STAND_IN,
  slowSession,
  spawned,
  terminalSession,
  version
} from './controller-background-under-test.ts';
import { app, save } from './controller-under-test.ts';

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
      // The terminal ran under the folder the session already uses: no notice.
      assert.equal(c.view(s.id)?.folderNotice, null);
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
  'Move here on a terminal no longer showing the conversation since the first read refuses at once, with no signal',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-switched');
    const id = randomUUID();
    save(dir, id);
    const session = terminalSession();
    try {
      agents(dir, [inTerminal(id, session.pid!, 'idle')]);
      // As after /clear or /resume there: the process is alive, and listed
      // under another conversation or not at all.
      for (const now of [[inTerminal(randomUUID(), session.pid!, 'idle')], []]) {
        agentsNow(dir, now);
        const started = Date.now();
        await assert.rejects(
          c.connect('claude', app, { nativeId: id, configDir: dir, move: true }),
          {
            message:
              'That terminal is no longer showing this conversation, so nothing was closed. Try again.'
          }
        );
        // At once: not after the wait for a closing terminal.
        assert.ok(Date.now() - started < 1000, `answered after ${Date.now() - started} ms`);
        assert.ok(!interrupted(session.pid) && alive(session));
      }
    } finally {
      session.kill();
    }
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

/**
 * Move here on a conversation a terminal runs under the Claude folder `live`,
 * for a session stored in `stored` (none when undefined), with `sent` the
 * folder connect gets: Reconnect sends the stored one, a list row its own.
 * A stored folder that is not `live` holds an older copy. What the owner
 * reads, and the Claude folder the session then runs in and stores.
 */
async function moveIn({ live, stored, sent }: { live: string; stored?: string; sent?: string }) {
  const id = randomUUID();
  if (stored !== undefined && stored !== live) save(stored, id, -3600);
  save(live, id);
  const known = await L.connectProject('claude', id, app, 'Work', stored);
  const session = terminalSession();
  try {
    agents(live, [inTerminal(id, session.pid!, 'idle')]);
    const dropped = once(session, 'exit').then(() => agents(live, []));
    const s = await c.connect('claude', app, { nativeId: id, configDir: sent, move: true });
    await dropped;
    await c.terminal(s.id);
    assert.equal(s.id, known.id);
    assert.ok(interrupted(session.pid));
    return {
      notice: c.view(s.id)?.folderNotice,
      runsIn: lastTerminal().env.CLAUDE_CONFIG_DIR,
      stored: (await L.connection(s.id))?.configDir
    };
  } finally {
    session.kill();
  }
}

test(
  'Move here in the Claude folder the session is stored in shows no folder notice and keeps that folder',
  SHELL_STAND_IN,
  async () => {
    const a = claudeFolder('.claude-own-a');
    // A row of that folder sends it, as Reconnect does.
    assert.deepEqual(await moveIn({ live: a, stored: a, sent: a }), {
      notice: null,
      runsIn: a,
      stored: a
    });
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
    assert.deepEqual(await moveIn({ live: b, stored: a, sent: a }), {
      notice:
        'The terminal was using ~/.claude-terminal-b · signed out, so this session now uses it too.',
      runsIn: b,
      stored: b
    });
    // The list's row names the folder of the copy that runs.
    assert.deepEqual(await moveIn({ live: b, stored: a, sent: b }), {
      notice: null,
      runsIn: b,
      stored: b
    });
  }
);

test(
  "Move here on a session stored with no Claude folder, while a terminal runs the conversation under another than the default, continues in the terminal's folder, stores it and says so",
  SHELL_STAND_IN,
  async () => {
    const b = claudeFolder('.claude-terminal-only-b');
    // Reconnect sends no folder, so the session would run in the default one.
    // That folder lacks the conversation, so the session would move to B's
    // newest copy anyway: storing B here needs only one of that move and the
    // terminal's. The stored-in-A test above needs the terminal's, and the
    // Reconnect tests in controller-folders.test.ts need the move.
    assert.deepEqual(await moveIn({ live: b }), {
      notice:
        'The terminal was using ~/.claude-terminal-only-b · signed out, so this session now uses it too.',
      runsIn: b,
      stored: b
    });
    // The list's row names the folder of the copy that runs.
    assert.deepEqual(await moveIn({ live: b, sent: b }), { notice: null, runsIn: b, stored: b });
  }
);

test(
  'Move here on a session stored with no Claude folder, while a terminal runs the conversation under the default one, shows no folder notice and stores none',
  SHELL_STAND_IN,
  async () => {
    // The default folder runs with no CLAUDE_CONFIG_DIR.
    assert.deepEqual(await moveIn({ live: L.defaultClaudeFolder() }), {
      notice: null,
      runsIn: undefined,
      stored: null
    });
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
  "Start in a folder Claude Code was never told to trust opens Claude Code's trust question in a setup terminal that ends itself once answered",
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
    assert.deepEqual(lastTerminal().args, ['/exit']);
    assert.equal(lastTerminal().cwd, app);
    assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, dir);
    assert.ok(c.openTerminal(setup).running);
    assert.deepEqual(plugins(), before, 'a plugin folder was left under the unused key');

    // Start once the trust question ended: the setup terminal closes before the start.
    rmSync(untrusted);
    await c.connect('claude', app, { configDir: dir });
    const log = logged();
    const closed = log.indexOf(`terminal closed ${JSON.stringify(['/exit'])}`);
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
