import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { plan } from '@oddboro/ledger';
import { activeClaude } from './project-sessions/claude-project.ts';
import { joinCodex, startCodex, type CodexRpc } from './project-sessions/codex-rpc.ts';
import { UUID } from './project-sessions/native.ts';

export type AgentNotice = {
  agent: 'claude' | 'codex';
  id: string;
  title: string;
  reason: string;
  state: 'waiting' | 'working' | 'review';
  job?: string;
  pid?: number;
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
        pid: r.pid,
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

type Limit = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
type Bucket = { primary?: Limit | null; secondary?: Limit | null };
type LimitsReply = { rateLimits: Bucket; rateLimitsByLimitId?: Record<string, Bucket> | null };
export type Allowance = { left: number; resets: number };
export type Allowances = { session: Allowance | null; week: Allowance | null };

function allowance(used: number | undefined, resets: number, now: number): Allowance | null {
  if (
    used == null ||
    !Number.isFinite(used) ||
    used < 0 ||
    used > 100 ||
    !Number.isFinite(resets) ||
    resets <= now
  )
    return null;
  return { left: Math.round(100 - used), resets };
}

export function codexAllowances(reply: LimitsReply, now = Date.now()): Allowances {
  const bucket = reply.rateLimitsByLimitId?.codex ?? reply.rateLimits;
  const windows = [bucket.primary, bucket.secondary];
  function window(minutes: number) {
    const w = windows.find((w) => w?.windowDurationMins === minutes);
    return allowance(w?.usedPercent, Number(w?.resetsAt) * 1000, now);
  }
  return { session: window(300), week: window(10080) };
}

async function claudeAllowances(): Promise<Allowances | null> {
  const p = await plan();
  if (!p) return null;
  const now = Date.now();
  return {
    session: allowance(p.fiveHour * 100, Number(p.fiveHourResetsAt), now),
    week: allowance(p.sevenDay * 100, Number(p.sevenDayResetsAt), now)
  };
}

async function codexActivity(folder: string) {
  const ignore = () => {};
  // An account-only client can read the plan on installations without a shared daemon.
  // Its own empty thread list says nothing about the owner's other clients.
  const existing = await joinCodex(
    join(folder, 'app-server-control', 'app-server-control.sock'),
    ignore,
    ignore
  ).catch(() => null);
  const rpc = existing ?? (await startCodex(ignore, ignore));
  const timer = setTimeout(() => rpc.close(), 5500);
  try {
    const [live, limits] = await Promise.all([
      existing ? loadedNotices(rpc).catch(() => null) : null,
      rpc
        .request<LimitsReply>('account/rateLimits/read')
        .then((reply) => codexAllowances(reply))
        .catch(() => null)
    ]);
    return { live, limits };
  } finally {
    clearTimeout(timer);
    rpc.close();
  }
}

export async function agentAttention() {
  const folder = process.env.CODEX_HOME || join(homedir(), '.codex');
  const [claude, codex, unread, claudePlan] = await Promise.all([
    activeClaude()
      .then(claudeNotices)
      .catch(() => null),
    codexActivity(folder).catch(() => null),
    Promise.resolve()
      .then(() => unreadCodex(folder))
      .catch(() => null),
    claudeAllowances().catch(() => null)
  ]);
  return {
    measured: new Date().toISOString(),
    claude: claude !== null,
    codex: codex?.live?.complete ?? false,
    receipts: unread !== null,
    plans: { claude: claudePlan, codex: codex?.limits ?? null },
    items: [...(claude ?? []), ...(codex?.live?.items ?? []), ...(unread ?? [])]
  };
}
