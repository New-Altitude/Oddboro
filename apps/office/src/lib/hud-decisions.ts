import { AGENT_NAMES } from '@oddboro/ledger/agents';
import type { workspace } from './server/workspace.ts';
import type { AgentNotice } from './server/agent-attention.ts';

type Workspace = Awaited<ReturnType<typeof workspace>>;
type ProjectWork = Pick<
  Workspace['desk']['projectWork'][number],
  'id' | 'sessionId' | 'title' | 'prompt' | 'staffId'
>;
type Office = {
  desk: {
    asks: Pick<
      Workspace['desk']['asks'][number],
      'id' | 'staffId' | 'title' | 'why' | 'ifApproved'
    >[];
    projectWork: ProjectWork[];
  };
  uncertain: ProjectWork[];
  staff: Pick<Workspace['staff'][number], 'id' | 'name'>[];
  sessions: Pick<
    Workspace['sessions'][number],
    'id' | 'nativeId' | 'terminalPid' | 'agent' | 'questions' | 'title'
  >[];
};
export type Decision = {
  id: string;
  group: 'office' | 'codex' | 'claude';
  source: string;
  title: string;
  reason: string;
  consequence?: string;
  target: { desk: string } | { project: string; item?: string } | { native: AgentNotice };
};

// Standalone tools report one waiting flag per chat. Only the owner of a request
// can tell how many decisions that flag represents.
export function isWaitingChat(d: Decision) {
  return 'native' in d.target || ('project' in d.target && !d.target.item);
}

/** Count actionable records, never their session's aggregate waiting status. */
export function hudDecisions(office: Office, notices: AgentNotice[]): Decision[] {
  const decisions = new Map<string, Decision>();
  const who = (staffId: string | null) =>
    (office.staff.find((s) => s.id === staffId)?.name ?? 'Office') + ' · Oddboro';
  for (const a of office.desk.asks) {
    const id = 'ask-' + a.id;
    decisions.set(id, {
      id,
      group: 'office',
      source: who(a.staffId),
      title: a.title,
      reason: a.why,
      consequence: a.ifApproved,
      target: { desk: id }
    });
  }
  function addWork(work: ProjectWork, kind: 'proposal' | 'uncertain') {
    const id = kind + '-' + work.id;
    decisions.set(id, {
      id,
      group: 'office',
      source: who(work.staffId),
      title: work.prompt,
      reason: (kind === 'uncertain' ? 'Check delivery in ' : 'Proposed for ') + work.title,
      target: { project: work.sessionId, item: id }
    });
  }
  for (const work of office.desk.projectWork) addWork(work, 'proposal');
  for (const work of office.uncertain) addWork(work, 'uncertain');
  for (const s of office.sessions) {
    for (const question of s.questions) {
      const id = 'question-' + question.key;
      decisions.set(id, {
        id,
        group: s.agent,
        source: AGENT_NAMES[s.agent],
        title: question.label,
        reason: s.title,
        target: { project: s.id, item: id }
      });
    }
  }
  for (const r of notices) {
    if (r.state !== 'waiting' || !r.id) continue;
    const session = office.sessions.find(
      (s) =>
        s.agent === r.agent && (s.nativeId === r.id || (r.pid != null && r.pid === s.terminalPid))
    );
    if (session?.questions.length) continue; // The thread flag describes the questions already listed.
    const id = r.agent + '-' + (session?.nativeId ?? r.id);
    decisions.set(id, {
      id,
      group: r.agent,
      source: AGENT_NAMES[r.agent],
      title: r.title,
      reason: r.reason,
      target: session ? { project: session.id } : { native: r }
    });
  }
  return [...decisions.values()];
}
