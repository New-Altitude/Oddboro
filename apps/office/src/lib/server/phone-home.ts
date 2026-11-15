// What the phone's Home shows that the office state does not carry: each
// Odd's next job, and the goals with work handed on or back today. Read only,
// from the ledger's own readers, for `GET /api/phone/home`.
import { goalsWindow, handOffsFor, jobsFor, roster, type HandOffLine } from '@oddboro/ledger';
import { officeDay } from '@oddboro/ledger/time';

/** A goal with work handed on or back today, and the latest of it. */
export type Happening = {
  goalId: number;
  title: string;
  /** The latest step today, in words. */
  line: string;
  /** When that step was. */
  at: string;
  /** The Odds who took part today, newest first, three at most. */
  faces: string[];
};

export type PhoneHome = {
  /** Each Odd's soonest job run, by its id, for an Odd with one set. */
  next: Record<string, string>;
  /** Newest first. */
  happening: Happening[];
};

/** The soonest run of the enabled jobs given, if any. */
export function soonest(jobs: { enabled: boolean; nextRunAt: Date | null }[]): string | undefined {
  const times = jobs.flatMap((j) => (j.enabled && j.nextRunAt ? [j.nextRunAt.getTime()] : []));
  return times.length ? new Date(Math.min(...times)).toISOString() : undefined;
}

/**
 * The goals with a step today, in the office's time zone: work handed to a
 * colleague, or a colleague's result going back. A hand-back that only
 * carries the owner's own answer is no news, as on the floor.
 */
export function happeningToday(
  goals: { id: number; title: string; threads: { id: number }[] }[],
  lines: HandOffLine[],
  now = new Date()
): Happening[] {
  const today = officeDay(now);
  const goalOf = new Map(goals.flatMap((g) => g.threads.map((t) => [t.id, g] as const)));
  type Step = { goal: (typeof goals)[number]; at: Date; line: string; by: string; with: string };
  const steps: Step[] = [];
  const seen = new Set<number>();
  for (const h of lines) {
    if (seen.has(h.id) || h.threadId === null) continue;
    seen.add(h.id);
    const goal = goalOf.get(h.threadId);
    if (!goal) continue;
    const at = new Date(h.at);
    if (officeDay(at) === today)
      steps.push({
        goal,
        at,
        line: `${h.from} handed work to ${h.to}: ${h.title}`,
        by: h.fromId,
        with: h.toId
      });
    for (const b of h.backs) {
      const back = new Date(b.at);
      if (b.answered || officeDay(back) !== today) continue;
      steps.push({
        goal,
        at: back,
        line: `${h.to} handed back to ${h.from}: ${h.title}`,
        by: h.toId,
        with: h.fromId
      });
    }
  }
  steps.sort((a, b) => b.at.getTime() - a.at.getTime());
  const out = new Map<number, Happening>();
  for (const s of steps) {
    const h = out.get(s.goal.id);
    if (!h) {
      out.set(s.goal.id, {
        goalId: s.goal.id,
        title: s.goal.title,
        line: s.line,
        at: s.at.toISOString(),
        faces: [s.by, s.with]
      });
      continue;
    }
    for (const id of [s.by, s.with])
      if (h.faces.length < 3 && !h.faces.includes(id)) h.faces.push(id);
  }
  return [...out.values()];
}

export async function phoneHome(): Promise<PhoneHome> {
  const [staff, window] = await Promise.all([roster(), goalsWindow()]);
  const [jobs, lines] = await Promise.all([
    Promise.all(staff.map((s) => jobsFor(s.id))),
    Promise.all(staff.map((s) => handOffsFor(s.id)))
  ]);
  const next: Record<string, string> = {};
  staff.forEach((s, i) => {
    const at = soonest(jobs[i]);
    if (at) next[s.id] = at;
  });
  return { next, happening: happeningToday(window.goals, lines.flat()) };
}
