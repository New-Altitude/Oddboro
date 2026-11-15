import { AGENT_NAMES } from '@oddboro/ledger/agents';
import type { workspace } from '#lib/server/workspace.ts';
import type { ComputerActivity } from '#lib/server/computer-activity.ts';
import type { AgentNotice } from '#lib/server/agent-attention.ts';

export type HudOffice = Pick<
  Awaited<ReturnType<typeof workspace>>,
  'staff' | 'sessions' | 'desk' | 'unread' | 'inProgress'
>;
export type HudLinks = {
  ondesk: (key: string) => void;
  onstaff: (id: string) => void;
  onproject: (id: string) => void;
  onreport: (id: number, person: string, title: string) => void;
};
export type HudItem = {
  id: string;
  group: 'claude' | 'codex' | 'office';
  source: string;
  title: string;
  reason: string;
  consequence?: string;
  action: string;
  open?: () => void;
  url?: string;
  hint?: string;
};
export const codexChatUrl = (id: string) => 'codex://threads/' + encodeURIComponent(id);

export function hudItems(
  office: HudOffice,
  sample: ComputerActivity | undefined,
  notices: AgentNotice[],
  links: HudLinks
) {
  const { staff, sessions, desk } = office;
  const who = (id: string | null) => staff.find((s) => s.id === id)?.name ?? 'Office';
  const officeRuns = sample?.runs.filter((r) => r.staffId) ?? [];
  const officeIds = new Set(officeRuns.flatMap((r) => r.sessions));
  const native = notices.filter(
    (r) => !officeIds.has(r.id) && !officeRuns.some((p) => p.agent === r.agent && p.pid === r.pid)
  );
  const live = new Map<string, HudItem>(),
    needs: HudItem[] = [],
    review: HudItem[] = [];
  function external(r: AgentNotice): HudItem {
    const session = sessions.find((s) => s.agent === r.agent && s.nativeId === r.id);
    const item = {
      id: r.agent + '-' + r.id,
      group: r.agent,
      source: AGENT_NAMES[r.agent],
      title: r.title,
      reason: r.reason
    };
    if (session)
      return { ...item, action: 'Open project', open: () => links.onproject(session.id) };
    if (r.agent === 'codex') return { ...item, action: 'Open chat', url: codexChatUrl(r.id) };
    return {
      ...item,
      action: 'Find session',
      hint:
        r.job && /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(r.job)
          ? 'In your terminal: claude attach ' + r.job
          : 'Select this conversation in claude agents.'
    };
  }
  for (const a of desk.asks)
    needs.push({
      id: 'ask-' + a.id,
      group: 'office',
      source: who(a.staffId) + ' · Oddboro',
      title: a.title,
      reason: a.why,
      consequence: a.ifApproved,
      action: 'Review decision',
      open: () => links.ondesk('ask-' + a.id)
    });
  for (const r of native) {
    const item = external(r);
    if (r.state === 'waiting') needs.push(item);
    else if (r.state === 'working') live.set(item.id, item);
    else review.push(item);
  }
  for (const s of sessions) {
    if (s.status !== 'waiting' && s.status !== 'working') continue;
    const id = s.agent + '-' + s.nativeId;
    if (officeIds.has(s.nativeId) || needs.some((n) => n.id === id)) continue;
    const item = {
      id,
      group: s.agent,
      source: AGENT_NAMES[s.agent],
      title: s.title,
      reason: s.status === 'waiting' ? 'This project needs your answer.' : 'Working',
      action: 'Open project',
      open: () => links.onproject(s.id)
    };
    if (s.status === 'waiting') {
      live.delete(id);
      needs.push(item);
    } else if (!live.has(id)) live.set(id, item);
  }
  const waits = new Set(needs.map((n) => n.id));
  for (const id of sample?.openTurns ?? []) {
    const key = 'codex-' + id;
    if (officeIds.has(id) || waits.has(key) || live.has(key)) continue;
    live.set(
      key,
      external({
        agent: 'codex',
        id,
        title: sample?.titles[id] ?? 'Chat ' + id.slice(-8),
        reason: 'Turn in progress. Open the chat to check for private requests.',
        state: 'working'
      })
    );
  }
  for (const [id, jobs] of Object.entries(office.inProgress))
    for (const w of jobs) {
      if (w.queued) continue;
      const key = 'work-' + id + '-' + w.id;
      live.set(key, {
        id: key,
        group: 'office',
        source: who(id) + ' · Oddboro',
        title: w.label,
        reason: w.detail || 'Working',
        action: 'Open chat',
        open: () => links.onstaff(id)
      });
    }
  for (const t of desk.tasks)
    needs.push({
      id: 'task-' + t.id,
      group: 'office',
      source: who(t.staffId) + ' · Oddboro',
      title: t.title,
      reason: t.why || 'Assigned to you',
      action: 'View task',
      open: () => links.ondesk('task-' + t.id)
    });
  for (const p of desk.projectWork)
    needs.push({
      id: 'proposal-' + p.id,
      group: 'office',
      source: who(p.staffId) + ' · Oddboro',
      title: p.title,
      reason: 'An Odd proposed work in this project.',
      action: 'Review proposal',
      open: () => links.onproject(p.sessionId)
    });
  const messages: HudItem[] = [];
  for (const s of staff)
    if (office.unread[s.id])
      messages.push({
        id: 'chat-' + s.id,
        group: 'office',
        source: 'Oddboro',
        title: s.name,
        reason:
          office.unread[s.id] === 1
            ? 'Left you a message'
            : office.unread[s.id] + ' unread messages',
        action: 'Read message',
        open: () => links.onstaff(s.id)
      });
  for (const r of desk.reports)
    messages.push({
      id: 'report-' + r.id,
      group: 'office',
      source: who(r.staffId) + ' · Oddboro',
      title: r.title,
      reason: 'New report',
      action: 'Read report',
      open: () => links.onreport(r.id, r.staffId, r.title)
    });
  return { needs, running: [...live.values()], review: [...messages, ...review] };
}
