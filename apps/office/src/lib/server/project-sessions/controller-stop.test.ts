// Stop and Remove end a Claude session's background job, in the Claude folder
// the session runs in, before they let it go. The stand-in claude and terminal
// library are in controller-background-under-test.ts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ProjectSession } from '@oddboro/ledger';
import {
  agents,
  alive,
  c,
  claudeFolder,
  inTerminal,
  interrupted,
  L,
  logged,
  NEWEST,
  PROJECT_WORDS,
  request,
  SHELL_STAND_IN,
  terminalSession,
  version,
  withEnv
} from './controller-background-under-test.ts';
import { app } from './controller-under-test.ts';
const { CLAUDE_LIST_FAILED } = await import('./claude-project.ts');

/** Claude Code's row for the background job of the conversation `id`, running. */
const job = (id: string) => ({
  sessionId: id,
  id: id.slice(0, 8),
  kind: 'background',
  status: 'idle',
  cwd: app
});
/** A disconnected Claude session in the project, stored in `stored`, or none when undefined. */
const disconnected = (stored?: string) =>
  L.connectProject('claude', randomUUID(), app, 'Work', stored);
/** A Claude session started in `dir` with its terminal open, so its job runs and is listed there. */
async function connected(dir: string) {
  const s = await c.connect('claude', app, { configDir: dir, title: 'Work' });
  await c.terminal(s.id);
  return s;
}
/** The line the stand-in logs when `claude stop` ends the job of `s` under the Claude folder `dir`. */
const stopLine = (s: ProjectSession, dir: string) =>
  `stop ${s.nativeId.slice(0, 8)} in ${app} under ${dir}`;
const stops = () => logged().filter((line) => line.startsWith('stop '));
const listed = async (id: string) => (await L.projectOverview()).some((s) => s.id === id);
const fail = (dir: string, command: 'agents' | 'stop') =>
  writeFileSync(join(dir, `${command}.fail`), '');
/** Holds `claude stop` in `dir` once it has begun, until `letGo`. */
const hold = (dir: string) => writeFileSync(join(dir, 'stop.hold'), '');
const letGo = (dir: string) => rmSync(join(dir, 'stop.hold'));
/** Polls until `fn` holds, since the stand-in and the filesystem answer in their own time. */
async function until(fn: () => boolean | Promise<boolean>, what: string) {
  const end = performance.now() + 5000;
  while (performance.now() < end) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(what);
}
const stopBegun = (s: ProjectSession, dir: string) =>
  until(() => stops().includes(stopLine(s, dir)), 'claude stop never began');
/** Reconnect as the page sends it: the session's own conversation and Claude folder. */
const reconnect = (s: ProjectSession, dir: string) =>
  c.connect('claude', app, { nativeId: s.nativeId, configDir: dir });
const queue = (s: ProjectSession) =>
  L.requestProject({ id: randomUUID(), sessionId: s.id, prompt: 'Work on this.' });
const stateOf = async (s: ProjectSession) => (await L.projectWork(s.id))[0].state;
/** The readiness check's probe in the inbox of `s`, which its plugin's receivers answer. */
const probe = (s: ProjectSession) => join(L.home('project-sessions', s.id, 'inbox'), 'probe.json');
/** Answers the readiness check waiting for `s`, as both of its plugin's receivers do. */
async function answerProbe(s: ProjectSession) {
  await until(() => existsSync(probe(s)), 'no readiness check began');
  const { key } = JSON.parse(readFileSync(probe(s), 'utf8')) as { key: string };
  for (const receiver of L.PROJECT_RECEIVERS)
    writeFileSync(join(probe(s), '..', `${key}.${receiver}`), '');
}
/** The office's runtimes, where a test puts active work: no public method starts a turn. */
const runtimes = (c as unknown as { sessions: Map<string, { request?: unknown; turn?: string }> })
  .sessions;

test(
  'Remove stops the background job of a session with no Claude folder in ~/.claude when CLAUDE_CONFIG_DIR is unset, then hides it',
  SHELL_STAND_IN,
  async () => {
    const own = join(homedir(), '.claude');
    mkdirSync(own, { recursive: true });
    const s = await disconnected();
    agents(own, [job(s.nativeId)]);
    await c.remove(s.id);
    assert.deepEqual(stops(), [`stop ${s.nativeId.slice(0, 8)}`, stopLine(s, own)]);
    assert.ok(!(await listed(s.id)));
  }
);

test(
  "Remove stops the background job of a session with no Claude folder in the office's CLAUDE_CONFIG_DIR folder, not ~/.claude, then hides it",
  SHELL_STAND_IN,
  async () => {
    const own = join(homedir(), '.claude');
    const env = join(homedir(), '.claude-env-stop');
    mkdirSync(own, { recursive: true });
    mkdirSync(env, { recursive: true });
    const s = await disconnected();
    agents(env, [job(s.nativeId)]);
    agents(own, [job(s.nativeId)]);
    await withEnv({ CLAUDE_CONFIG_DIR: env }, () => c.remove(s.id));
    assert.deepEqual(stops(), [`stop ${s.nativeId.slice(0, 8)}`, stopLine(s, env)]);
    assert.ok(!(await listed(s.id)));
  }
);

test(
  'Remove stops the background job of a session in the Claude folder it is stored in, then hides it',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-stored');
    const s = await disconnected(dir);
    agents(dir, [job(s.nativeId)]);
    await c.remove(s.id);
    assert.ok(stops().includes(stopLine(s, dir)), logged().join('\n'));
    assert.ok(!(await listed(s.id)));
  }
);

test(
  'Remove stops the job once with a terminal window joined to it, and signals no terminal process',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-joined');
    const s = await disconnected(dir);
    const joined = terminalSession();
    try {
      agents(dir, [job(s.nativeId), inTerminal(s.nativeId, joined.pid!, 'idle')]);
      await c.remove(s.id);
      assert.deepEqual(stops(), [`stop ${s.nativeId.slice(0, 8)}`, stopLine(s, dir)]);
      assert.ok(!interrupted(joined.pid) && alive(joined));
      assert.ok(!(await listed(s.id)));
    } finally {
      joined.kill();
    }
  }
);

test(
  'Remove runs no claude for a session whose Claude folder left Setup or is gone, and still hides it',
  SHELL_STAND_IN,
  async () => {
    const out = claudeFolder('.claude-stop-out');
    const s = await disconnected(out);
    agents(out, [job(s.nativeId)]);
    L.setClaudeFolders([]);
    await c.remove(s.id);
    assert.deepEqual(logged().filter(Boolean), []);
    assert.ok(!(await listed(s.id)));

    const gone = claudeFolder('.claude-stop-gone');
    const t = await disconnected(gone);
    agents(gone, [job(t.nativeId)]);
    rmSync(gone, { recursive: true });
    await c.remove(t.id);
    assert.deepEqual(logged().filter(Boolean), []);
    assert.ok(!(await listed(t.id)));
  }
);

test(
  'Stop refuses with the folder words, and leaves the session connected, once its Claude folder left Setup or is gone',
  SHELL_STAND_IN,
  async () => {
    const out = claudeFolder('.claude-stop-end-out');
    const s = await connected(out);
    L.setClaudeFolders([]);
    await assert.rejects(c.end(s.id), { message: 'That Claude folder is not in Setup.' });
    assert.ok(c.view(s.id).connected);
    assert.deepEqual(stops(), []);
    await c.disconnect(s.id);

    const gone = claudeFolder('.claude-stop-end-gone');
    const t = await connected(gone);
    rmSync(gone, { recursive: true });
    await assert.rejects(c.end(t.id), { message: 'That Claude folder is not found.' });
    assert.ok(c.view(t.id).connected);
    assert.deepEqual(stops(), []);
  }
);

test(
  'With Claude Code not installed, Remove runs nothing but its version check and hides the session, and Stop refuses with the not-installed words',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-missing');
    const s = await disconnected(dir);
    agents(dir, [job(s.nativeId)]);
    const t = await connected(dir);
    const since = logged().filter(Boolean).length;
    version('not a version');
    try {
      await c.remove(s.id);
      assert.deepEqual(logged().filter(Boolean).slice(since), ['--version']);
      assert.ok(!(await listed(s.id)));
      await assert.rejects(c.end(t.id), { message: CLAUDE_LIST_FAILED.missing() });
      assert.ok(c.view(t.id).connected);
      assert.deepEqual(stops(), []);
    } finally {
      version(NEWEST);
    }
  }
);

test(
  'When claude agents fails, Remove and Stop refuse with the stop-failed words and change nothing',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-agents-fail');
    const s = await disconnected(dir);
    const t = await connected(dir);
    fail(dir, 'agents');
    await assert.rejects(c.remove(s.id), { message: PROJECT_WORDS.stopFailed });
    assert.ok(await listed(s.id));
    await assert.rejects(c.end(t.id), { message: PROJECT_WORDS.stopFailed });
    assert.ok(c.view(t.id).connected);
    assert.deepEqual(stops(), []);
  }
);

test(
  'When claude stop fails, Remove and Stop refuse with the stop-failed words and change nothing',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-fail');
    const t = await connected(dir);
    const s = await disconnected(dir);
    agents(dir, [job(t.nativeId), job(s.nativeId)]);
    fail(dir, 'stop');
    await assert.rejects(c.remove(s.id), { message: PROJECT_WORDS.stopFailed });
    assert.ok(stops().includes(stopLine(s, dir)), logged().join('\n'));
    assert.ok(await listed(s.id));
    await assert.rejects(c.end(t.id), { message: PROJECT_WORDS.stopFailed });
    assert.ok(stops().includes(stopLine(t, dir)), logged().join('\n'));
    assert.ok(c.view(t.id).connected);
  }
);

test(
  'With no running background job listed, Remove hides the session and Stop lets its view go, and neither runs claude stop',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-none');
    const none = await disconnected(dir);
    agents(dir, []);
    await c.remove(none.id);
    assert.ok(!(await listed(none.id)));

    const stopped = await disconnected(dir);
    agents(dir, [{ ...job(stopped.nativeId), state: 'stopped' }]);
    await c.remove(stopped.id);
    assert.ok(!(await listed(stopped.id)));

    // A conversation open in a plain terminal is not the office's to end.
    const plain = await disconnected(dir);
    const session = terminalSession();
    try {
      agents(dir, [inTerminal(plain.nativeId, session.pid!, 'idle')]);
      await c.remove(plain.id);
      assert.ok(!interrupted(session.pid) && alive(session));
      assert.ok(!(await listed(plain.id)));
    } finally {
      session.kill();
    }

    const t = await connected(dir);
    agents(dir, []);
    await c.end(t.id);
    assert.equal(c.view(t.id).connected, false);
    assert.deepEqual(stops(), []);
  }
);

test(
  "Stop ends a connected session's background job, then closes the office's terminal and lets its view go, also through the route",
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-end');
    const s = await connected(dir);
    await c.end(s.id);
    const log = logged();
    const stopped = log.indexOf(stopLine(s, dir));
    const closed = log.indexOf(
      `terminal closed ${JSON.stringify(['attach', s.nativeId.slice(0, 8)])}`
    );
    assert.ok(stopped >= 0 && closed > stopped, log.join('\n'));
    assert.equal(c.view(s.id).connected, false);
    assert.ok(await listed(s.id), 'Stop hid the session');

    const t = await connected(dir);
    const answer = await request('/api/project-sessions', 'POST', {
      body: { action: 'end', id: t.id }
    });
    assert.equal(answer.status, 200);
    assert.ok(stops().includes(stopLine(t, dir)), logged().join('\n'));
    assert.equal(c.view(t.id).connected, false);
  }
);

test(
  'Stop with an assignment or a turn active is refused with the busy words and stops nothing',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-busy');
    const s = await connected(dir);
    const runtime = runtimes.get(s.id)!;
    runtime.request = { id: randomUUID() };
    await assert.rejects(c.end(s.id), { message: PROJECT_WORDS.stopBusy });
    runtime.request = undefined;
    runtime.turn = 'turn-1';
    await assert.rejects(c.end(s.id), { message: PROJECT_WORDS.stopBusy });
    runtime.turn = undefined;
    assert.ok(c.view(s.id).connected);
    assert.deepEqual(stops(), []);
  }
);

test('Disconnect stops no background job', SHELL_STAND_IN, async () => {
  const dir = claudeFolder('.claude-stop-disconnect');
  const s = await connected(dir);
  await c.disconnect(s.id);
  assert.equal(c.view(s.id).connected, false);
  assert.deepEqual(stops(), []);
});

test('Remove refuses a connected Claude session and stops nothing', SHELL_STAND_IN, async () => {
  const dir = claudeFolder('.claude-stop-connected');
  const s = await connected(dir);
  await assert.rejects(c.remove(s.id), { message: 'Disconnect it first.' });
  assert.ok(await listed(s.id));
  assert.deepEqual(stops(), []);
});

test('Remove hides a Codex session and runs no claude', async () => {
  const s = await L.connectProject('codex', randomUUID(), app, 'Codex work');
  await c.remove(s.id);
  assert.ok(!(await listed(s.id)));
  assert.deepEqual(logged().filter(Boolean), []);
});

test(
  'While Stop is stopping a session, a Reconnect and a second Stop are refused with the stopping words, and once it has stopped a Reconnect connects',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-held');
    const s = await connected(dir);
    hold(dir);
    const ending = c.end(s.id);
    await stopBegun(s, dir);
    await assert.rejects(reconnect(s, dir), { message: PROJECT_WORDS.stopping });
    await assert.rejects(c.end(s.id), { message: PROJECT_WORDS.stopping });
    letGo(dir);
    await ending;
    assert.equal(c.view(s.id).connected, false);
    await reconnect(s, dir);
    assert.ok(c.view(s.id).connected);
  }
);

test(
  'While Remove is stopping a session, a Reconnect and a second Remove are refused with the stopping words, and once it is removed a Reconnect brings it back',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-remove-held');
    const s = await disconnected(dir);
    agents(dir, [job(s.nativeId)]);
    hold(dir);
    const removing = c.remove(s.id);
    await stopBegun(s, dir);
    await assert.rejects(reconnect(s, dir), { message: PROJECT_WORDS.stopping });
    await assert.rejects(c.remove(s.id), { message: PROJECT_WORDS.stopping });
    letGo(dir);
    await removing;
    assert.equal(c.view(s.id).connected, false);
    assert.ok(!(await listed(s.id)));
    await reconnect(s, dir);
    assert.ok(c.view(s.id).connected && (await listed(s.id)));
  }
);

test(
  'Work queued while Stop is stopping a session is not claimed, and goes ahead once the stop fails and leaves the session connected',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-queued');
    const s = await connected(dir);
    fail(dir, 'stop');
    hold(dir);
    const ending = c.end(s.id);
    await stopBegun(s, dir);
    await queue(s);
    // A readiness check would hold work open for up to 30 seconds; during the stop it starts none.
    let returned = false;
    void c.work(s.id).finally(() => (returned = true));
    await until(() => returned, 'work during the stop began a readiness check');
    assert.equal(await stateOf(s), 'queued');
    assert.ok(!existsSync(probe(s)), 'a readiness check began during the stop');
    letGo(dir);
    await assert.rejects(ending, { message: PROJECT_WORDS.stopFailed });
    assert.ok(c.view(s.id).connected);
    await answerProbe(s);
    await until(async () => (await stateOf(s)) === 'sending', 'the held work never went ahead');
  }
);

test(
  'A readiness check under way when Stop is pressed claims nothing once it passes, and puts the earlier note back',
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-stop-dispatch');
    const s = await connected(dir);
    const before = c.view(s.id).note;
    await queue(s);
    const sending = c.work(s.id);
    await until(() => existsSync(probe(s)), 'no readiness check began');
    hold(dir);
    const ending = c.end(s.id);
    await stopBegun(s, dir);
    await answerProbe(s);
    await sending;
    assert.equal(await stateOf(s), 'queued');
    assert.equal(c.view(s.id).note, before);
    letGo(dir);
    await ending;
    assert.equal(c.view(s.id).connected, false);
    assert.equal(await stateOf(s), 'queued');
  }
);
