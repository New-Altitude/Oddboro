import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { activeClaude } from './project-sessions/claude-project.ts';
import { joinCodex, type CodexRpc } from './project-sessions/codex-rpc.ts';
import { UUID } from './project-sessions/native.ts';

export type AgentNotice = {
  agent: 'claude' | 'codex';
  id: string;
  title: string;
  reason: string;
  state: 'waiting' | 'working' | 'review';
  job?: string;
};
type Thread = {
  id: string;
  name?: string;
  cwd: string;
  status: { type: string; activeFlags?: string[] };
};

export function claudeNotices(rows: Awaited<ReturnType<typeof activeClaude>>): AgentNotice[] {
  return rows.flatMap((r): AgentNotice[] => {
    const waiting = r.status === 'waiting' || r.state === 'blocked';
    if (!waiting && r.status !== 'busy' && r.state !== 'working') return [];
    return [
      {
        agent: 'claude',
        id: r.sessionId || r.id || String(r.pid ?? ''),
        job: r.id,
        title: r.name || basename(r.cwd) || 'Claude session',
        state: waiting ? 'waiting' : 'working',
        reason: waiting
          ? ({
              'permission prompt': 'Needs permission',
              'input needed': 'Asked a question',
              'sandbox request': 'Needs a sandbox decision',
              'worker request': 'Needs a worker decision',
              'dialog open': 'Has a dialog to answer'
            }[r.waitingFor ?? ''] ?? 'Waiting for your input')
          : 'Working'
      }
    ];
  });
}

export function codexNotice(t: Thread): AgentNotice[] {
  if (t.status.type !== 'active') return [];
  const flags = t.status.activeFlags ?? [];
  const reason = flags.includes('waitingOnApproval')
    ? 'Needs approval'
    : flags.includes('waitingOnUserInput')
      ? 'Asked a question'
      : 'Working';
  return [
    {
      agent: 'codex',
      id: t.id,
      title: t.name || basename(t.cwd) || 'Codex chat',
      reason,
      state: reason === 'Working' ? 'working' : 'waiting'
    }
  ];
}

// Query only an already running server. Never start or resume a thread to inspect it.
export async function loadedNotices(rpc: Pick<CodexRpc, 'request'>) {
  const items: AgentNotice[] = [];
  let cursor: string | null = null;
  let complete = true;
  do {
    const page: { data: string[]; nextCursor?: string | null } = await rpc.request(
      'thread/loaded/list',
      { cursor, limit: 50 }
    );
    for (let i = 0; i < page.data.length; i += 8) {
      const rows = await Promise.allSettled(
        page.data
          .slice(i, i + 8)
          .map((threadId) =>
            rpc.request<{ thread: Thread }>('thread/read', { threadId, includeTurns: false })
          )
      );
      for (const row of rows) {
        if (row.status === 'fulfilled') items.push(...codexNotice(row.value.thread));
        else complete = false;
      }
    }
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return { items, complete };
}

export function unreadCodex(folder: string): AgentNotice[] {
  const db = new DatabaseSync(join(folder, 'state_5.sqlite'), { readOnly: true });
  try {
    // Only the title and unread marker are needed. Older installations can lack this table.
    const rows = db
      .prepare(
        `SELECT t.id, COALESCE(NULLIF(t.name, ''), t.title) AS title FROM thread_read_receipts r
      JOIN threads t ON t.id = r.thread_id WHERE r.first_unread_turn IS NOT NULL
      AND t.archived = 0 ORDER BY t.updated_at DESC`
      )
      .all();
    return rows.flatMap((r) =>
      typeof r.id === 'string' && UUID.test(r.id)
        ? [
            {
              agent: 'codex' as const,
              id: r.id,
              title: String(r.title || 'Codex chat').slice(0, 160),
              state: 'review' as const,
              reason: 'Unread reply'
            }
          ]
        : []
    );
  } finally {
    db.close();
  }
}

export async function agentAttention() {
  const folder = process.env.CODEX_HOME || join(homedir(), '.codex');
  const [claude, codex, unread] = await Promise.allSettled([
    activeClaude().then(claudeNotices),
    (async () => {
      const rpc = await joinCodex(
        join(folder, 'app-server-control', 'app-server-control.sock'),
        () => {},
        () => {}
      );
      const timer = setTimeout(() => rpc.close(), 4500);
      try {
        return await loadedNotices(rpc);
      } finally {
        clearTimeout(timer);
        rpc.close();
      }
    })(),
    Promise.resolve().then(() => unreadCodex(folder))
  ]);
  return {
    measured: new Date().toISOString(),
    claude: claude.status === 'fulfilled',
    codex: codex.status === 'fulfilled' && codex.value.complete,
    receipts: unread.status === 'fulfilled',
    items: [
      ...(claude.status === 'fulfilled' ? claude.value : []),
      ...(codex.status === 'fulfilled' ? codex.value.items : []),
      ...(unread.status === 'fulfilled' ? unread.value : [])
    ]
  };
}
