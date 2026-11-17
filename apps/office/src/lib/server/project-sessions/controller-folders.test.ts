// A project session's Claude folder, and Remove, through the controller the
// project route drives. A stand-in claude answers in the folder Claude Code
// would read, and the terminal library is a stand-in that keeps what each
// terminal was opened with.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, mock, test } from 'node:test';
import { app, save } from './controller-under-test.ts';
import type { ProjectSession } from '@oddboro/ledger';

/** Each terminal opened: its arguments and the environment it got. */
const spawned: { args: string[]; env: Record<string, string> }[] = [];
mock.module('@oddboro/ledger/project-terminal', {
  namedExports: {
    openProjectTerminal: async (
      _file: string,
      args: string[],
      options: { env: Record<string, string> }
    ) => {
      spawned.push({ args, env: options.env });
      let exited: ((e: { exitCode: number }) => void) | undefined;
      return {
        onData: () => {},
        onExit: (done: typeof exited) => void (exited = done),
        write: () => {},
        resize: () => {},
        kill: () => exited?.({ exitCode: 0 })
      };
    }
  }
});
const { L, chatOf, folder, plain, refusal, request, withEnv } =
  await import('../office-under-test.ts');
const { projectController } = await import('./controller.ts');
const { FOLDER_NOTICE, PICK_LACKS_IT } = await import('./controller-claude.ts');
const { PROJECT_WORDS } = await import('../../project-words.ts');
const { devReads } = await import('../sandbox.ts');
// The office's own stand-ins, before this file's claude goes first: an Odd's chat runs on them.
const officePath = process.env.PATH ?? '';

// The stand-in claude: it reads `$HOME/.claude` when CLAUDE_CONFIG_DIR is
// unset, as Claude Code does, and logs each call with the folder it got. What
// runs in a folder is that folder's `agents.json`, else nothing. A background
// resume answers with the conversation's short id, its first 8 characters, as
// Claude Code does for a conversation no background session holds. A
// background start adds its session to `agents.json` and answers likewise.
const calls = join(folder, 'folder-calls.log');
const bin = join(folder, 'folder-bin');
mkdirSync(bin);
const startedBy = join(bin, 'start-in-background.mjs');
writeFileSync(
  startedBy,
  `import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
const file = dir + '/agents.json';
const sessionId = randomUUID();
const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
list.push({ sessionId, id: sessionId.slice(0, 8), kind: 'background', pid: process.pid, status: 'idle', cwd: process.cwd() });
writeFileSync(file, JSON.stringify(list));
console.log('backgrounded · ' + sessionId.slice(0, 8));
`
);
writeFileSync(
  join(bin, 'claude'),
  `#!/bin/sh
dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
echo "\${CLAUDE_CONFIG_DIR:-default} $1 $2" >> "${calls}"
case "$1 $2" in
  "--version ") echo '2.1.325 (Claude Code)' ;;
  "auth status") cat "$dir/auth.json" 2>/dev/null || echo '{"loggedIn":false}' ;;
  "agents --json") cat "$dir/agents.json" 2>/dev/null || echo '[]' ;;
  "--bg --resume") echo "backgrounded · \${3%%-*}" ;;
  "--bg -n") "${process.execPath}" "${startedBy}" "$dir" ;;
esac
`
);
chmodSync(join(bin, 'claude'), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;
const logged = () => (existsSync(calls) ? readFileSync(calls, 'utf8') : '');

const own = join(homedir(), '.claude');
/**
 * A process standing in for a Claude terminal session's, so a connect that
 * wrongly ended one would interrupt it and fail its test, never the test run.
 * The caller kills it.
 */
const terminalProcess = () => spawn('sleep', ['600'], { stdio: 'ignore' });
const named = (name: string) => {
  const dir = join(homedir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const c = projectController();
/**
 * The controller's own maps and its release, reached through one cast:
 * TypeScript's `private` is compile-time only. No public method can leave a
 * runtime connecting, or kept with `connected` false after its Codex server
 * closed, on demand, or release every runtime the controller holds.
 */
type Inside = {
  sessions: Map<
    string,
    { session: ProjectSession; connected: boolean; turn?: string; questions: Map<string, unknown> }
  >;
  creating: Map<string, Promise<unknown>>;
  release(runtime: unknown): Promise<void>;
};
const inside = c as unknown as Inside;
// A test that fails before its own clean-up leaves a runtime holding a watch
// or a timer, which keeps the file running past its failure: every one goes.
afterEach(async () => {
  for (const runtime of [...inside.sessions.values()]) await inside.release(runtime);
});
const lastTerminal = () => spawned.at(-1)!;
/**
 * Reconnect `s` and return what it told the owner about its folder, checked
 * against the view it emitted last. `configDir` is the folder sent with it:
 * the page's Reconnect sends the session's stored one, the route may send none.
 */
async function folderNoticeOf(s: ProjectSession, configDir?: string) {
  let emitted: unknown = 'nothing emitted';
  const hear = (v: { folderNotice: string | null }) => (emitted = v.folderNotice);
  c.events.on(s.id, hear);
  try {
    await c.connect('claude', app, { nativeId: s.nativeId, configDir });
  } finally {
    c.events.off(s.id, hear);
  }
  assert.equal(emitted, c.view(s.id).folderNotice);
  return c.view(s.id).folderNotice;
}

test(
  'a session resumes in its own folder, and connecting one with no folder yet finds it and keeps it',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const b = named('.claude-b');
    L.setClaudeFolders([b]);
    const opened: string[] = [];
    try {
      const inB = randomUUID();
      save(b, inB);
      const one = await c.connect('claude', app, { nativeId: inB });
      opened.push(one.id);
      assert.equal(one.configDir, b);
      await c.terminal(one.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', inB.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, b);

      // ~/.claude runs with no CLAUDE_CONFIG_DIR, even when the office has one.
      const inOwn = randomUUID();
      save(own, inOwn);
      await withEnv({ CLAUDE_CONFIG_DIR: b }, async () => {
        const two = await c.connect('claude', app, { nativeId: inOwn });
        opened.push(two.id);
        assert.equal(two.configDir, own);
        await c.terminal(two.id);
      });
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', inOwn.slice(0, 8)]);
      assert.ok(
        !('CLAUDE_CONFIG_DIR' in lastTerminal().env),
        'CLAUDE_CONFIG_DIR reached ~/.claude'
      );

      // Connected before its folder was known, then found there on the next connect.
      const late = randomUUID();
      await L.connectProject('claude', late, app, 'Before folders');
      const first = await c.connect('claude', app, { nativeId: late });
      opened.push(first.id);
      assert.equal(first.configDir, null);
      save(b, late);
      const again = await c.connect('claude', app, { nativeId: late });
      assert.equal(again.configDir, b);
      assert.equal((await L.connection(first.id)).configDir, b);
      await c.terminal(again.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', late.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, b);

      // A new conversation is not in its folder yet.
      const fresh = await c.connect('claude', app, { configDir: b });
      opened.push(fresh.id);
      await c.terminal(fresh.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', fresh.nativeId.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, b);
    } finally {
      for (const id of opened) await c.disconnect(id);
      L.setClaudeFolders([]);
    }
  }
);

test(
  "a session with no folder runs in the office's default folder: CLAUDE_CONFIG_DIR's when set, else ~/.claude",
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    // Not named in Setup: the office's own CLAUDE_CONFIG_DIR is not a known folder.
    const env = named('.claude-env');
    const before = (id: string) => L.connectProject('claude', id, app, 'Before folders');
    const opened: string[] = [];
    try {
      // Set: Reconnect finds it there and keeps no folder, and the terminal resumes there.
      const inEnv = randomUUID();
      save(env, inEnv);
      await before(inEnv);
      await withEnv({ CLAUDE_CONFIG_DIR: env }, async () => {
        const s = await c.connect('claude', app, { nativeId: inEnv });
        opened.push(s.id);
        assert.equal(s.configDir, null);
        await c.terminal(s.id);
      });
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', inEnv.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, env);

      // Set, with an older copy in ~/.claude: it still resumes in the office's folder.
      const both = randomUUID();
      save(own, both);
      save(env, both);
      await before(both);
      await withEnv({ CLAUDE_CONFIG_DIR: env }, async () => {
        const s = await c.connect('claude', app, { nativeId: both });
        opened.push(s.id);
        assert.equal(s.configDir, null);
        assert.equal((await L.connection(s.id)).configDir, null);
        await c.terminal(s.id);
      });
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', both.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, env);

      // Unset: it resumes in ~/.claude, which runs with no CLAUDE_CONFIG_DIR.
      const inOwn = randomUUID();
      save(own, inOwn);
      await before(inOwn);
      const t = await c.connect('claude', app, { nativeId: inOwn });
      opened.push(t.id);
      assert.equal(t.configDir, null);
      await c.terminal(t.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', inOwn.slice(0, 8)]);
      assert.ok(
        !('CLAUDE_CONFIG_DIR' in lastTerminal().env),
        'CLAUDE_CONFIG_DIR reached ~/.claude'
      );

      // Set to a folder that is gone: refused, and never made again.
      for (const id of opened.splice(0)) await c.disconnect(id);
      const gone = join(homedir(), '.claude-gone');
      const since = logged().length;
      await withEnv({ CLAUDE_CONFIG_DIR: gone }, () =>
        assert.rejects(c.connect('claude', app, { nativeId: inEnv }), {
          message: 'That Claude folder is not found.'
        })
      );
      assert.ok(!existsSync(gone), 'the missing folder was made');
      assert.ok(!logged().slice(since).includes(gone), logged());
    } finally {
      for (const id of opened) await c.disconnect(id);
    }
  }
);

test(
  'picking a copy in another folder moves the session there, and Reconnect keeps it in its own',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const p = named('.claude-p');
    const q = named('.claude-q');
    L.setClaudeFolders([p, q]);
    const opened: string[] = [];
    try {
      const id = randomUUID();
      save(p, id, -120);
      save(q, id, -60);
      const s = await c.connect('claude', app, { nativeId: id, configDir: p });
      opened.push(s.id);
      assert.equal(s.configDir, p);
      const first = await c.terminal(s.id);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, p);

      // Connected, its terminal running: the move leaves that terminal running.
      const count = spawned.length;
      const moved = await c.connect('claude', app, { nativeId: id, configDir: q });
      assert.equal(moved.id, s.id);
      assert.equal((await L.connection(s.id)).configDir, q);
      assert.equal(spawned.length, count, 'the running terminal was opened again');
      assert.equal(await c.terminal(s.id), first);
      assert.ok(first.running);
      // Its next terminal opens in the new folder.
      first.close();
      await c.terminal(s.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', id.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, q);

      // Reconnect, with no copy picked, stays in its own folder, a newer copy elsewhere or not.
      await c.disconnect(s.id);
      save(p, id, 0);
      const again = await c.connect('claude', app, { nativeId: id });
      assert.equal(again.configDir, q);
      await c.terminal(s.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', id.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, q);

      // A folder not in Setup is refused, and the session stays where it was.
      await c.disconnect(s.id);
      const r = named('.claude-r');
      await assert.rejects(c.connect('claude', app, { nativeId: id, configDir: r }), {
        message: 'That Claude folder is not in Setup.'
      });
      assert.equal((await L.connection(s.id)).configDir, q);
    } finally {
      for (const id of opened) await c.disconnect(id);
      L.setClaudeFolders([]);
    }
  }
);

test(
  'Reconnect opens its own copy and tells the owner of a newer one in another folder',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const p = named('.claude-mine');
    const q = named('.claude-newer');
    L.setClaudeFolders([p, q]);
    const notice = (mark: string) =>
      `A newer copy of this conversation is in ${mark}. To switch to it, choose it under Continue an earlier one.`;
    const opened: string[] = [];
    const reconnect = async (s: ProjectSession, configDir?: string) => {
      const told = await folderNoticeOf(s, configDir);
      opened.push(s.id);
      return told;
    };
    const stored = (id: string) => L.connectProject('claude', id, app, 'Work', p);
    const term = terminalProcess();
    /** Claude Code lists `id` as running in `dir`: in a terminal, or as the background job `job`. */
    const running = (dir: string, id: string, job?: string) =>
      writeFileSync(
        join(dir, 'agents.json'),
        JSON.stringify([
          {
            sessionId: id,
            id: job,
            kind: job ? 'background' : 'interactive',
            pid: term.pid,
            status: 'idle',
            cwd: app
          }
        ])
      );
    try {
      // The newest copy is in its own folder, an older one elsewhere: no notice.
      const mine = randomUUID();
      save(q, mine, -120);
      save(p, mine, -60);
      assert.equal(await reconnect(await stored(mine)), null);

      // A newer copy elsewhere: the notice, and the terminal still resumes its own copy.
      const elsewhere = randomUUID();
      save(p, elsewhere, -120);
      save(q, elsewhere, -60);
      const s = await stored(elsewhere);
      assert.equal(await reconnect(s), notice('~/.claude-newer · signed out'));
      assert.equal((await L.connection(s.id)).configDir, p);
      await c.terminal(s.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', elsewhere.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, p);
      // The page's Reconnect sends its own folder back: the same notice, and it stays.
      assert.equal(await reconnect(s, p), notice('~/.claude-newer · signed out'));
      assert.equal((await L.connection(s.id)).configDir, p);
      // Once its own copy is the newest again, the next Reconnect clears it.
      save(p, elsewhere, 0);
      assert.equal(await reconnect(s), null);

      // A newer copy elsewhere open in a Claude terminal: refused, no notice.
      const live = randomUUID();
      save(p, live, -120);
      save(q, live, -60);
      running(q, live);
      const t = await stored(live);
      await assert.rejects(reconnect(t), { message: PROJECT_WORDS.useMove });
      assert.equal(c.view(t.id).folderNotice, null);

      // The same copy running as a background job: the notice.
      running(q, live, 'job-1');
      assert.equal(await reconnect(t), notice('~/.claude-newer · signed out'));
      rmSync(join(q, 'agents.json'));

      // No stored folder, the office's CLAUDE_CONFIG_DIR holding it: an older
      // copy in ~/.claude gives no notice, a newer one does.
      const office = named('.claude-office');
      const unstored = randomUUID();
      save(office, unstored, -60);
      save(own, unstored, -120);
      const u = await L.connectProject('claude', unstored, app, 'Work');
      await withEnv({ CLAUDE_CONFIG_DIR: office }, async () => {
        assert.equal(await reconnect(u), null);
        save(own, unstored, 0);
        assert.equal(await reconnect(u), notice('~/.claude · signed out'));
        assert.equal((await L.connection(u.id)).configDir, null);
        await c.terminal(u.id);
      });
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', unstored.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, office);
    } finally {
      term.kill();
      for (const id of opened) await c.disconnect(id);
      L.setClaudeFolders([]);
    }
  }
);

/** The moved notice, checked to name the folder the session left and the one it went to. */
function moved(marks: { from: string; to: string }) {
  const notice = FOLDER_NOTICE.moved(marks);
  assert.ok(notice.includes(marks.from), `${notice} names no ${marks.from}`);
  assert.ok(notice.includes(marks.to), `${notice} names no ${marks.to}`);
  return notice;
}

test(
  'Reconnect moves a session whose folder lost the conversation to the folder holding it, and says so',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const p = named('.claude-lost');
    const q = named('.claude-holds');
    const r = named('.claude-picked');
    L.setClaudeFolders([p, q, r]);
    const opened: string[] = [];
    try {
      const id = randomUUID();
      save(q, id);
      const s = await L.connectProject('claude', id, app, 'Work', p);
      opened.push(s.id);
      assert.equal(
        await folderNoticeOf(s),
        moved({ from: '~/.claude-lost · signed out', to: '~/.claude-holds · signed out' })
      );
      assert.equal((await L.connection(s.id)).configDir, q);
      await c.terminal(s.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', id.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, q);
      // Its folder holds it now: the next Reconnect stays there and clears it.
      assert.equal(await folderNoticeOf(s), null);

      // A folder picked in the continue path's list is where it goes, so nothing moved by
      // itself. It holds the newest copy, so no newer copy is named either.
      await c.disconnect(s.id);
      save(q, id, -120);
      save(r, id, -60);
      await c.connect('claude', app, { nativeId: id, configDir: r });
      assert.equal((await L.connection(s.id)).configDir, r);
      assert.equal(c.view(s.id).folderNotice, null);

      // A conversation connected for the first time had no folder to lose.
      const first = randomUUID();
      save(q, first);
      const f = await c.connect('claude', app, { nativeId: first });
      opened.push(f.id);
      assert.equal(f.configDir, q);
      assert.equal(c.view(f.id).folderNotice, null);
    } finally {
      for (const id of opened) await c.disconnect(id);
      L.setClaudeFolders([]);
    }
  }
);

test(
  'Reconnect moves a session whose folder lost the conversation to the folder with its newest copy',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const p = named('.claude-gone-from');
    const q = named('.claude-older-copy');
    const r = named('.claude-newest-copy');
    L.setClaudeFolders([p, q, r]);
    let s: ProjectSession | undefined;
    try {
      const id = randomUUID();
      save(q, id, -120);
      save(r, id, -60);
      s = await L.connectProject('claude', id, app, 'Work', p);
      assert.equal(
        await folderNoticeOf(s),
        moved({
          from: '~/.claude-gone-from · signed out',
          to: '~/.claude-newest-copy · signed out'
        })
      );
      assert.equal((await L.connection(s.id)).configDir, r);
    } finally {
      if (s) await c.disconnect(s.id);
      L.setClaudeFolders([]);
    }
  }
);

test(
  'Reconnect moves a session with no folder, whose default folder lacks the conversation, to the named folder holding it, and says so',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const q = named('.claude-named-holds');
    L.setClaudeFolders([q]);
    let s: ProjectSession | undefined;
    try {
      // Only the named folder has it: the office's default folder, `~/.claude`
      // here, never saw this conversation.
      const id = randomUUID();
      save(q, id);
      s = await L.connectProject('claude', id, app, 'Work');
      assert.equal(
        await folderNoticeOf(s),
        moved({ from: '~/.claude · signed out', to: '~/.claude-named-holds · signed out' })
      );
      assert.equal((await L.connection(s.id)).configDir, q);
      await c.terminal(s.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', id.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, q);
    } finally {
      if (s) await c.disconnect(s.id);
      L.setClaudeFolders([]);
    }
  }
);

test(
  "Reconnect from the page, which sends the session's own folder, moves one whose folder lost the conversation, and says so",
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const b = named('.claude-sent-back');
    const a = named('.claude-has-it');
    L.setClaudeFolders([a, b]);
    const opened: string[] = [];
    const term = terminalProcess();
    try {
      const id = randomUUID();
      save(a, id);
      const s = await L.connectProject('claude', id, app, 'Work', b);
      opened.push(s.id);
      assert.equal(
        await folderNoticeOf(s, b),
        moved({ from: '~/.claude-sent-back · signed out', to: '~/.claude-has-it · signed out' })
      );
      assert.equal((await L.connection(s.id)).configDir, a);
      await c.terminal(s.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', id.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, a);
      // The page now holds the moved row and sends its new folder: it stays, told nothing.
      assert.equal(await folderNoticeOf(s, a), null);
      assert.equal((await L.connection(s.id)).configDir, a);

      // Its copy open in a Claude terminal: refused, no notice, no move.
      const live = randomUUID();
      save(a, live);
      writeFileSync(
        join(a, 'agents.json'),
        JSON.stringify([
          { sessionId: live, kind: 'interactive', pid: term.pid, status: 'idle', cwd: app }
        ])
      );
      const t = await L.connectProject('claude', live, app, 'Work', b);
      await assert.rejects(folderNoticeOf(t, b), { message: PROJECT_WORDS.useMove });
      assert.equal(c.view(t.id).folderNotice, null);
      assert.equal((await L.connection(t.id)).configDir, b);
      rmSync(join(a, 'agents.json'));

      // No folder has it: nowhere to move, so it stays and resumes that id there.
      const nowhere = randomUUID();
      const n = await L.connectProject('claude', nowhere, app, 'Work', b);
      opened.push(n.id);
      assert.equal(await folderNoticeOf(n, b), null);
      assert.equal((await L.connection(n.id)).configDir, b);
      await c.terminal(n.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', nowhere.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, b);
    } finally {
      term.kill();
      for (const id of opened) await c.disconnect(id);
      L.setClaudeFolders([]);
    }
  }
);

test(
  'a folder picked from a stale list that lacks the conversation is refused, pointing to Refresh list, and the session stays where it was',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const p = named('.claude-stale-has');
    const q = named('.claude-stale-lacks');
    L.setClaudeFolders([p, q]);
    let s: ProjectSession | undefined;
    try {
      const id = randomUUID();
      save(p, id);
      s = await c.connect('claude', app, { nativeId: id, configDir: p });
      await c.disconnect(s.id);
      const count = spawned.length;
      await assert.rejects(c.connect('claude', app, { nativeId: id, configDir: q }), {
        message:
          'That conversation is no longer in ~/.claude-stale-lacks · signed out. Choose Refresh list to see where it is now.'
      });
      assert.equal((await L.connection(s.id)).configDir, p);
      assert.equal(spawned.length, count);
      assert.ok(!inside.sessions.has(s.id), 'the refused connect kept a runtime');
    } finally {
      if (s) await c.disconnect(s.id);
      L.setClaudeFolders([]);
    }
  }
);

test(
  "the continue path's list, through the route, refuses a new conversation picked in a folder that lacks it, and stores nothing",
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    // The route answers only with advanced mode on, which needs an owner.
    await L.setOwnerName('Tester');
    await L.setAdvancedMode(true);
    const p = named('.claude-listed-has');
    const q = named('.claude-listed-lacks');
    L.setClaudeFolders([p, q]);
    try {
      const id = randomUUID();
      save(p, id);
      assert.deepEqual(
        await refusal(
          request('/api/project-sessions', 'POST', {
            body: { action: 'connect', agent: 'claude', folder: app, nativeId: id, configDir: q }
          })
        ),
        { status: 409, message: PICK_LACKS_IT('~/.claude-listed-lacks · signed out') }
      );
      assert.ok(!(await L.projectConnections()).some((row) => row.nativeId === id));
    } finally {
      L.setClaudeFolders([]);
    }
  }
);

test(
  'a folder picked for a conversation no folder holds is not refused: a new id is not found, and a known one resumes in the pick',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const p = named('.claude-none-stored');
    const q = named('.claude-none-picked');
    L.setClaudeFolders([p, q]);
    let s: ProjectSession | undefined;
    try {
      await assert.rejects(c.connect('claude', app, { nativeId: randomUUID(), configDir: q }), {
        message: 'That conversation was not found in this project.'
      });

      const id = randomUUID();
      s = await L.connectProject('claude', id, app, 'Work', p);
      await c.connect('claude', app, { nativeId: id, configDir: q });
      assert.equal((await L.connection(s.id)).configDir, q);
      assert.equal(c.view(s.id).folderNotice, null);
      await c.terminal(s.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', id.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, q);
    } finally {
      if (s) await c.disconnect(s.id);
      L.setClaudeFolders([]);
    }
  }
);

test(
  "a copy picked in the continue path's list is stored when the session's own folder left Setup, and when the session had none",
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    const x = named('.claude-left-setup');
    const y = named('.claude-still-in');
    L.setClaudeFolders([y]);
    const opened: string[] = [];
    try {
      const id = randomUUID();
      save(y, id);
      const s = await L.connectProject('claude', id, app, 'Work', x);
      opened.push(s.id);
      await c.connect('claude', app, { nativeId: id, configDir: y });
      assert.equal((await L.connection(s.id)).configDir, y);
      assert.equal(c.view(s.id).folderNotice, null);
      await c.terminal(s.id);
      assert.deepEqual(lastTerminal().args.slice(-2), ['attach', id.slice(0, 8)]);
      assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, y);

      // The office's default folder, picked for a session with no folder, is stored.
      const unstored = randomUUID();
      save(own, unstored);
      const u = await L.connectProject('claude', unstored, app, 'Work');
      opened.push(u.id);
      await c.connect('claude', app, { nativeId: unstored, configDir: own });
      assert.equal((await L.connection(u.id)).configDir, own);
      assert.equal(c.view(u.id).folderNotice, null);
    } finally {
      for (const id of opened) await c.disconnect(id);
      L.setClaudeFolders([]);
    }
  }
);

test(
  'a folder taken out of Setup, or missing on disk, is never run in',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    // The route answers only with advanced mode on, which needs an owner.
    await L.setOwnerName('Tester');
    await L.setAdvancedMode(true);
    // A connected session keeps a folder watch open, so a failed check that
    // skipped its disconnect would leave the file running instead of failing.
    const opened: string[] = [];
    try {
      const x = named('.claude-x');
      L.setClaudeFolders([x]);
      const id = randomUUID();
      save(x, id);
      const s = await c.connect('claude', app, { nativeId: id });
      opened.push(s.id);
      assert.equal(s.configDir, x);
      L.setClaudeFolders([]);
      const since = logged().length;
      const notInSetup = { message: 'That Claude folder is not in Setup.' };
      await assert.rejects(c.terminal(s.id), notInSetup);
      await c.disconnect(s.id);
      await assert.rejects(c.connect('claude', app, { nativeId: id, configDir: x }), notInSetup);
      await assert.rejects(c.connect('claude', app, { nativeId: id }), notInSetup);
      assert.equal((await L.connection(s.id)).configDir, x);
      const view = (await (
        await request('/api/project-sessions', 'POST', { body: { action: 'connections' } })
      ).json()) as { id: string; mark: string | null }[];
      assert.match(view.find((v) => v.id === s.id)?.mark ?? '', /· not in Setup$/);
      assert.ok(!logged().slice(since).includes(x), logged());

      const y = named('.claude-y');
      L.setClaudeFolders([y]);
      const gone = randomUUID();
      save(y, gone);
      const t = await c.connect('claude', app, { nativeId: gone });
      opened.push(t.id);
      assert.equal(t.configDir, y);
      rmSync(y, { recursive: true });
      const after = logged().length;
      const notFound = { message: 'That Claude folder is not found.' };
      await assert.rejects(c.terminal(t.id), notFound);
      await c.disconnect(t.id);
      await assert.rejects(c.connect('claude', app, { nativeId: gone }), notFound);
      await assert.rejects(c.connect('claude', app, { nativeId: gone, configDir: y }), notFound);
      assert.ok(!existsSync(y), 'the missing folder was made again');
      assert.ok(!logged().slice(after).includes(y), logged());
    } finally {
      for (const id of opened) await c.disconnect(id);
      L.setClaudeFolders([]);
    }
  }
);

test('Remove refuses a connected or connecting session, and releases one whose server closed', async () => {
  const codex = () => L.connectProject('codex', randomUUID(), app, 'Codex work');
  const kept = (session: ProjectSession, connected: boolean, turn?: string) =>
    inside.sessions.set(session.id, { session, connected, turn, questions: new Map() });
  const listed = async (id: string) => (await L.projectOverview()).some((s) => s.id === id);
  const refused = { message: 'Disconnect it first.' };

  const connected = await codex();
  kept(connected, true);
  await assert.rejects(c.remove(connected.id), refused);
  assert.ok(await listed(connected.id));
  inside.sessions.delete(connected.id);

  const connecting = await codex();
  inside.creating.set(connecting.id, new Promise(() => {}));
  await assert.rejects(c.remove(connecting.id), refused);
  assert.ok(await listed(connecting.id));
  inside.creating.delete(connecting.id);

  for (const turn of [undefined, 'turn-1']) {
    const closed = await codex();
    kept(closed, false, turn);
    await c.remove(closed.id);
    assert.ok(!inside.sessions.has(closed.id), `turn ${turn}`);
    assert.ok(!(await listed(closed.id)), `turn ${turn}`);
  }
});

test(
  'each Claude folder guard refuses its case',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async (t) => {
    // The route answers only with advanced mode on, which needs an owner.
    await L.setOwnerName('Tester');
    await L.setAdvancedMode(true);
    const guards: [string, () => Promise<void>][] = [
      [
        'a named folder gone from the disk is marked not found, and no claude runs in it',
        async () => {
          const gone = named('.claude-gone-mark');
          L.setClaudeFolders([gone]);
          const s = await L.connectProject('claude', randomUUID(), app, 'Work', gone);
          rmSync(gone, { recursive: true });
          const since = logged().length;
          const view = (await (
            await request('/api/project-sessions', 'POST', { body: { action: 'connections' } })
          ).json()) as { id: string; mark: string | null }[];
          assert.equal(view.find((v) => v.id === s.id)?.mark, '~/.claude-gone-mark · not found');
          assert.ok(!logged().slice(since).includes(gone), logged());
        }
      ],
      [
        'a folder the page sends that is not in Setup is refused before claude runs in it',
        async () => {
          const outside = named('.claude-outside');
          const id = randomUUID();
          save(outside, id);
          const s = await L.connectProject('claude', id, app, 'Work');
          const since = logged().length;
          await assert.rejects(c.connect('claude', app, { nativeId: id, configDir: outside }), {
            message: 'That Claude folder is not in Setup.'
          });
          assert.equal((await L.connection(s.id)).configDir, null);
          assert.ok(!logged().slice(since).includes(outside), logged());
        }
      ],
      [
        "a named folder is shut to an Odd's reads",
        async () => {
          L.setClaudeFolders([named('.claude-deny')]);
          const run = await withEnv({ PATH: officePath }, () => chatOf('sam'));
          const denied = plain(run.claudeSettings?.permissions.deny ?? []);
          assert.ok(denied.includes('Read(/~/.ssh)'), 'the run got no deny list');
          assert.ok(
            denied.includes('Read(/~/.claude-deny)') && denied.includes('Read(/~/.claude-deny/**)'),
            denied.join('\n')
          );
        }
      ],
      [
        "a named folder is shut to an Odd's commands, through a link in ~/.local/bin too",
        async () => {
          const dev = named('.claude-dev');
          const tools = named('tools');
          const local = join(homedir(), '.local');
          const bin = join(local, 'bin');
          mkdirSync(bin, { recursive: true });
          writeFileSync(join(dev, 'tool'), '');
          writeFileSync(join(tools, 'tool'), '');
          symlinkSync(join(dev, 'tool'), join(bin, 'in-claude'));
          symlinkSync(join(tools, 'tool'), join(bin, 'elsewhere'));
          L.setClaudeFolders([dev]);
          try {
            const { reads } = devReads();
            // The link to a file outside every Claude folder is read, so the links were looked at.
            assert.ok(reads.includes(realpathSync(join(tools, 'tool'))), reads.join('\n'));
            assert.ok(!reads.includes(realpathSync(join(dev, 'tool'))), reads.join('\n'));
          } finally {
            rmSync(local, { recursive: true });
          }
        }
      ]
    ];
    try {
      for (const [name, check] of guards) await t.test(name, check);
    } finally {
      L.setClaudeFolders([]);
    }
  }
);

test(
  'Starting a new conversation through the route stores and runs the Claude folder picked, and ~/.claude when none is',
  { skip: process.platform === 'win32' && 'the stand-in is a shell script' },
  async () => {
    // The route answers only with advanced mode on, which needs an owner.
    await L.setOwnerName('Tester');
    await L.setAdvancedMode(true);
    const x = named('.claude-start');
    L.setClaudeFolders([x]);
    const opened: string[] = [];
    try {
      for (const [picked, stored] of [
        [x, x],
        [own, own],
        [undefined, own]
      ] as const) {
        const answer = await request('/api/project-sessions', 'POST', {
          body: { action: 'connect', agent: 'claude', folder: app, configDir: picked }
        });
        assert.equal(answer.status, 200, `picked ${picked}`);
        const s = (await answer.json()) as ProjectSession;
        opened.push(s.id);
        assert.equal((await L.connection(s.id)).configDir, stored, `picked ${picked}`);
        // Its terminal attaches to the background session Start began, with no resume.
        const since = logged().length;
        await c.terminal(s.id);
        assert.deepEqual(lastTerminal().args.slice(-2), ['attach', s.nativeId.slice(0, 8)]);
        assert.ok(!logged().slice(since).includes('--bg --resume'), logged());
        // ~/.claude runs with no CLAUDE_CONFIG_DIR.
        assert.equal(lastTerminal().env.CLAUDE_CONFIG_DIR, stored === own ? undefined : stored);
      }
    } finally {
      for (const id of opened) await c.disconnect(id);
      L.setClaudeFolders([]);
    }
  }
);
