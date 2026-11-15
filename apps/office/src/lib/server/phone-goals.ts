// What the phone's Goals tab and a goal's page show: each active goal with its
// lead, its team, what of it waits on the owner and how far along it is, and a
// goal's work as one conversation. Read only, from the ledger's own readers,
// for `GET /api/phone/goals` and `GET /api/phone/goals/[id]`.
//
// The goals table has no lead and counts no parts, so the phone works both out
// from the goal's threads: the lead is the hub of its newest open thread, else
// the Office Manager, and progress is its threads done out of all of them,
// with the latest health an Odd logged.
import {
  goalsWindow,
  goalWhen,
  handOffsFor,
  manager,
  roster,
  threadsFor,
  type GoalHealth,
  type GoalThread,
  type GoalWithThreads,
  type HandOffLine,
  type Outcome,
  type ThreadLine,
  type ThreadWaiting
} from '@oddboro/ledger';

/** How far a goal is: its threads done out of all, and the latest health an Odd logged. */
export type GoalProgress = {
  done: number;
  total: number;
  health?: GoalHealth;
  /** That Odd's note with it. */
  note?: string;
};

/** A goal as the phone's Goals tab lists it. */
export type PhoneGoalCard = {
  id: number;
  area: string;
  title: string;
  /** "This quarter", or "By Jan 15" for a date. */
  when: string;
  /** Who leads it, if anyone can. */
  leadId?: string;
  /** The Odds serving it, the lead first. */
  faces: string[];
  /** How many of its items wait on the owner's desk. */
  waiting: number;
  progress: GoalProgress;
  createdAt: string;
};

/** One step of a goal's work, as its page shows it. */
export type GoalEntry = {
  key: string;
  at: string;
  /** The Odd who said it. */
  by: string;
  name: string;
  /** Handed work on, a result going back, the lead's next step, or another run of the lead's. */
  kind: 'handed' | 'back' | 'next' | 'run';
  text: string;
  /** For a hand-off or a result: the work's title and the colleague on the other side. */
  work?: { title: string; to: string; outcome?: Outcome };
};

/** A goal's page. */
export type PhoneGoal = PhoneGoalCard & {
  why: string | null;
  doneWhen: string | null;
  /** Its work, oldest first. */
  entries: GoalEntry[];
  /** What its threads put on the owner's desk that is still open, oldest first. */
  open: ThreadWaiting[];
};

const OPEN_STAGES = new Set<GoalThread['stage']>(['under_way', 'waiting_on_you']);

/**
 * The goal's lead: the hub of its newest open thread, else the Office
 * Manager, who plans every goal. Threads come newest first. An Odd who left
 * the office leads nothing.
 */
export function leadOf(
  threads: Pick<GoalThread, 'hubId' | 'stage'>[],
  managerId: string | undefined,
  here: Set<string>
): string | undefined {
  const open = threads.find((t) => OPEN_STAGES.has(t.stage) && here.has(t.hubId));
  return open?.hubId ?? (managerId && here.has(managerId) ? managerId : undefined);
}

/** Threads done out of all of them, and the newest progress line's health. Progress comes newest first. */
export function progressOf(
  threads: Pick<GoalThread, 'stage'>[],
  progress: { health: GoalHealth; note: string }[]
): GoalProgress {
  const latest = progress[0];
  return {
    done: threads.filter((t) => t.stage === 'done').length,
    total: threads.length,
    ...(latest && { health: latest.health, note: latest.note })
  };
}

export function goalCard(
  g: GoalWithThreads,
  managerId: string | undefined,
  here: Set<string>
): PhoneGoalCard {
  const leadId = leadOf(g.threads, managerId, here);
  const team = g.staff.map((s) => s.staffId).filter((id) => here.has(id));
  return {
    id: g.id,
    area: g.area,
    title: g.title,
    when: goalWhen(g),
    leadId,
    faces: leadId ? [leadId, ...team.filter((id) => id !== leadId)] : team,
    waiting: g.threads.reduce((n, t) => n + t.waiting.length, 0),
    progress: progressOf(g.threads, g.progress),
    createdAt: new Date(g.createdAt).toISOString()
  };
}

/** The active goals, newest first. */
export function goalCards(
  goals: GoalWithThreads[],
  managerId: string | undefined,
  here: Set<string>
): PhoneGoalCard[] {
  return goals
    .filter((g) => g.status === 'active')
    .map((g) => goalCard(g, managerId, here))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
}

/**
 * A goal's work as one conversation, oldest first: each hand-off with its
 * brief, each result going back, the lead's step after it, and the lead's
 * other runs on the goal's threads. Every line is the Odd's own words. A
 * hand-back that only carries the owner's own answer is left out, since the
 * owner said it. A hand-off read from two Odds' lines shows once.
 */
export function goalConversation(
  threadIds: Set<number>,
  hubs: Map<number, { id: string; name: string }>,
  handOffs: HandOffLine[],
  threadLines: ThreadLine[]
): GoalEntry[] {
  const out: GoalEntry[] = [];
  const seen = new Set<number>();
  const iso = (d: Date | string) => new Date(d).toISOString();
  for (const h of handOffs) {
    if (h.threadId === null || !threadIds.has(h.threadId) || seen.has(h.id)) continue;
    seen.add(h.id);
    out.push({
      key: `handed-${h.id}`,
      at: iso(h.at),
      by: h.fromId,
      name: h.from,
      kind: 'handed',
      text: h.brief,
      work: { title: h.title, to: h.to }
    });
    h.backs.forEach((b, n) => {
      if (b.answered) return;
      out.push({
        key: `back-${h.id}-${n}`,
        at: iso(b.at),
        by: h.toId,
        name: h.to,
        kind: 'back',
        text: b.text,
        work: { title: h.title, to: h.from, outcome: b.outcome }
      });
      if (b.pickUp.status === 'done' && b.pickUp.text)
        out.push({
          key: `next-${h.id}-${n}`,
          at: iso(b.pickUp.at ?? b.at),
          by: h.fromId,
          name: h.from,
          kind: 'next',
          text: b.pickUp.text
        });
    });
  }
  for (const t of threadLines) {
    const hub = hubs.get(t.id);
    if (!hub || !threadIds.has(t.id)) continue;
    t.runs.forEach((r, n) => {
      if (r.text)
        out.push({
          key: `run-${t.id}-${n}`,
          at: iso(r.at),
          by: hub.id,
          name: hub.name,
          kind: 'run',
          text: r.text
        });
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Who is in the office now, and the manager. */
async function office() {
  const [staff, m] = await Promise.all([roster(), manager()]);
  return { here: new Set(staff.map((s) => s.id)), managerId: m?.id };
}

export async function phoneGoals(): Promise<PhoneGoalCard[]> {
  const [{ goals }, { here, managerId }] = await Promise.all([goalsWindow(), office()]);
  return goalCards(goals, managerId, here);
}

/** Enough of each lead's lines to reach back over a goal's whole story. */
const LINES = 200;

export async function phoneGoal(id: number): Promise<PhoneGoal | undefined> {
  const [{ goals }, { here, managerId }] = await Promise.all([goalsWindow(), office()]);
  const g = goals.find((x) => x.id === id);
  if (!g) return undefined;
  // Only a thread's hub hands on there, so each hub's lines hold the goal's hand-offs.
  const hubIds = [...new Set(g.threads.map((t) => t.hubId))];
  const [handOffs, threadLines] = await Promise.all([
    Promise.all(hubIds.map((h) => handOffsFor(h, LINES))),
    Promise.all(hubIds.map((h) => threadsFor(h, LINES)))
  ]);
  const lines = threadLines.flat();
  const hubs = new Map(
    g.threads.map((t) => [
      t.id,
      { id: t.hubId, name: lines.find((l) => l.id === t.id)?.hub ?? t.hubId }
    ])
  );
  return {
    ...goalCard(g, managerId, here),
    why: g.why,
    doneWhen: g.doneWhen,
    entries: goalConversation(new Set(g.threads.map((t) => t.id)), hubs, handOffs.flat(), lines),
    open: g.threads.flatMap((t) => t.waiting)
  };
}
