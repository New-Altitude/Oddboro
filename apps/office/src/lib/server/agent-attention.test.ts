import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openCodexTurns } from './activity-titles.ts';
import {
  codexAllowances,
  claudeNotices,
  codexNotice,
  loadedNotices,
  unreadCodex
} from './agent-attention.ts';

test('keeps a blocked background Claude job after its process exits and leaves idle sessions out', () => {
  const notice = (state: string, status: string, waitingFor?: string) => ({
    state,
    status,
    waitingFor,
    cwd: '/demo/work',
    kind: 'background',
    id: 'job'
  });
  const items = claudeNotices([
    notice('blocked', ''),
    notice('done', 'idle'),
    notice('working', 'busy'),
    notice('working', 'waiting', 'permission prompt')
  ]);
  assert.deepEqual(
    items.map((i) => [i.state, i.reason]),
    [
      ['waiting', 'Waiting for your input'],
      ['working', 'Working'],
      ['waiting', 'Needs permission']
    ]
  );
});

test('reads loaded Codex chats without their turns and distinguishes both requests from work', async () => {
  const thread = (id: string, type: string, activeFlags: string[]) => ({
    id,
    status: { type, activeFlags },
    cwd: '/demo'
  });
  assert.equal(codexNotice(thread('x', 'idle', [])).length, 0);
  const chats = [
    thread('a', 'active', ['waitingOnApproval']),
    thread('b', 'active', ['waitingOnUserInput']),
    thread('c', 'active', [])
  ];
  const result = await loadedNotices({
    async request<T>(method: string, params: Record<string, unknown> = {}) {
      if (method === 'thread/loaded/list')
        return (
          params.cursor ? { data: ['b', 'c', 'gone'] } : { data: ['a'], nextCursor: 'page2' }
        ) as T;
      assert.equal(method, 'thread/read');
      assert.equal(params.includeTurns, false);
      const t = chats.find((t) => t.id === params.threadId);
      if (!t) throw Error('gone');
      return { thread: t } as T;
    }
  });
  assert.deepEqual(
    result.items.map((i) => i.reason),
    ['Needs approval', 'Asked a question', 'Working']
  );
  assert.equal(result.complete, false);
});

test('opening and archiving a Codex chat remove its unread notice on the next read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oddboro-unread-'));
  const db = new DatabaseSync(join(dir, 'state_5.sqlite'));
  const id = '82000000-0000-4000-9000-000000000001';
  try {
    db.exec(
      'CREATE TABLE threads(id TEXT, title TEXT, name TEXT, archived INTEGER, updated_at INTEGER); CREATE TABLE thread_read_receipts(thread_id TEXT, first_unread_turn TEXT)'
    );
    db.prepare('INSERT INTO threads VALUES(?,?,?,0,0)').run(id, 'first message', 'Build index');
    db.prepare('INSERT INTO thread_read_receipts VALUES(?,?)').run(id, 'turn');
    assert.deepEqual(
      unreadCodex(dir).map((r) => [r.state, r.title]),
      [['review', 'Build index']]
    );
    db.exec('UPDATE threads SET archived=1');
    assert.deepEqual(unreadCodex(dir), []);
    db.exec(
      'UPDATE threads SET archived=0; UPDATE thread_read_receipts SET first_unread_turn=NULL'
    );
    assert.deepEqual(unreadCodex(dir), []);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('shows only the latest open Codex turn for chats held by a running process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oddboro-turn-'));
  const db = new DatabaseSync(join(dir, 'thread_history_1.sqlite'));
  try {
    db.exec(
      "CREATE TABLE thread_turns(thread_id TEXT, rollout_ordinal INTEGER, status TEXT); INSERT INTO thread_turns VALUES('finished',1,'inProgress'),('finished',2,'completed'),('live',1,'inProgress'),('closed-file',1,'inProgress')"
    );
    assert.deepEqual(openCodexTurns(new Set(['finished', 'live', 'unknown']), dir), ['live']);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('reads the Codex bucket by duration and leaves missing or expired windows unknown', () => {
  const now = 1_800_000_000_000,
    resetsAt = now / 1000 + 3600;
  const week = { usedPercent: 36, windowDurationMins: 10080, resetsAt };
  const session = { usedPercent: 19, windowDurationMins: 300, resetsAt };
  assert.deepEqual(
    codexAllowances(
      { rateLimits: {}, rateLimitsByLimitId: { codex: { primary: week, secondary: session } } },
      now
    ),
    {
      week: { left: 64, resets: resetsAt * 1000 },
      session: { left: 81, resets: resetsAt * 1000 }
    }
  );
  assert.deepEqual(
    codexAllowances(
      {
        rateLimits: {
          primary: { ...week, resetsAt: now / 1000 },
          secondary: { ...session, usedPercent: 101 }
        }
      },
      now
    ),
    { week: null, session: null }
  );
});
