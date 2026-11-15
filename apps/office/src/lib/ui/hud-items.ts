import { hudDecisions, isWaitingChat, type Decision } from '../hud-decisions.ts';
import { AGENT_NAMES } from '@oddboro/ledger/agents';
import type { workspace } from '#lib/server/workspace.ts';
import type { ComputerActivity } from '#lib/server/computer-activity.ts';
import type { AgentNotice } from '#lib/server/agent-attention.ts';

export type HudOffice = Pick<
  Awaited<ReturnType<typeof workspace>>,
  'staff' | 'sessions' | 'desk' | 'uncertain' | 'unread' | 'inProgress'
>;
export type HudLinks = {
  ondesk: (key: string) => void;
  onstaff: (id: string) => void;
  onproject: (id: string, item?: string) => void;
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
  waitingChat?: boolean;
  open?: () => void;
  url?: string;
  hint?: string;
};
export const codexChatUrl = (id: string) => 'codex://threads/' + encodeURIComponent(id);

export function nativeAction(r: AgentNotice) {
  if (r.agent === 'codex') return { action: 'Open chat', url: codexChatUrl(r.id) };
  return {
    action: 'Find session',
    hint:
      r.job && /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(r.job)
        ? 'In your terminal: claude attach ' + r.job
        : 'Select this conversation in claude agents.'
  };
}

export function decisionItem(d: Decision, links: HudLinks): HudItem {
  const t = d.target;
  if ('desk' in t) return { ...d, action: 'Review decision', open: () => links.ondesk(t.desk) };
  if ('project' in t)
    return {
      ...d,
      waitingChat: isWaitingChat(d),
      action: 'Review in project',
      open: () => links.onproject(t.project, t.item)
    };
  return { ...d, waitingChat: true, ...nativeAction(t.native) };
}

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
    return { ...item, ...nativeAction(r) };
  }
  const needs: HudItem[] = hudDecisions(office, notices).map((d) => decisionItem(d, links));
  for (const r of native) {
    const item = external(r);
    if (r.state === 'waiting') continue;
    else if (r.state === 'working') live.set(item.id, item);
    else review.push(item);
  }
  for (const s of sessions) {
    if (s.status !== 'working') continue;
    const id = s.agent + '-' + s.nativeId;
    if (officeIds.has(s.nativeId) || needs.some((n) => n.id === id)) continue;
    const item = {
      id,
      group: s.agent,
      source: AGENT_NAMES[s.agent],
      title: s.title,
      reason: 'Working',
      action: 'Open project',
      open: () => links.onproject(s.id)
    };
    if (!live.has(id)) live.set(id, item);
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
  const messages: HudItem[] = [];
  for (const t of desk.tasks)
    messages.push({
      id: 'task-' + t.id,
      group: 'office',
      source: who(t.staffId) + ' · Oddboro',
      title: t.title,
      reason: t.why || 'Assigned to you',
      action: 'View task',
      open: () => links.ondesk('task-' + t.id)
    });
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
