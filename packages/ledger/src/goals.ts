// Goals: what the owner wants more of. The owner sets one, or approves one the
// Office Manager heard in chat, and the manager plans it: one ask holding the
// hires and the work staff already here take on. A staffer serves the goals it
// is linked to, sees only those, and says how each is going.
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db.ts';
import { fixedError } from './errors.ts';
import {
  addJob,
  approveAsk,
  ask,
  editOwnJob,
  giveTask,
  ownerName,
  raiseAsk,
  record,
  roster,
  staffer,
  type AskRow,
  type StaffRow
} from './office.ts';
import {
  goalProgress,
  goals,
  jobs,
  staff,
  staffGoals,
  type GoalDraft,
  type GoalHealth,
  type GoalPlanItem,
  type GoalStatus
} from './schema.ts';
import { MANAGER_ROLE, goalReview } from './managers.ts';
import { HORIZONS } from './goal-words.ts';
import { addFollowUp, goalThread, goalThreads, type Db, type GoalThread } from './threads.ts';

export type GoalRow = typeof goals.$inferSelect;
export type ProgressRow = typeof goalProgress.$inferSelect;
export type GoalView = GoalRow & {
  staff: { staffId: string; name: string; part: string }[];
  /** Newest first. */
  progress: (ProgressRow & { name: string })[];
};

const REVIEW_JOB = 'Weekly goal review';

/** A goal as written, cleaned, or why it is not one. */
export function goalDraft(v: Partial<Record<keyof GoalDraft, unknown>>): GoalDraft | string {
  const text = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
  const title = text(v.title, 140);
  if (!title) return 'Say what the goal is';
  const horizon = HORIZONS.find((h) => h.id === v.horizon)?.id ?? 'ongoing';
  const due = text(v.due, 10);
  if (horizon === 'date' && !/^\d{4}-\d\d-\d\d$/.test(due)) return 'Pick the date it is for';
  return {
    title,
    why: text(v.why, 1000) || undefined,
    doneWhen: text(v.doneWhen, 1000) || undefined,
    horizon,
    due: horizon === 'date' ? due : undefined,
    area: text(v.area, 40).toLowerCase() || 'work'
  };
}

export async function goal(id: number, q: Db = db): Promise<GoalRow | undefined> {
  const [row] = await q.select().from(goals).where(eq(goals.id, id));
  return row;
}

/** Goals with who serves each and the newest progress, active first. */
async function views(rows: GoalRow[], progressPerGoal = 6): Promise<GoalView[]> {
  if (!rows.length) return [];
  const ids = rows.map((g) => g.id);
  const names = new Map((await roster()).map((s) => [s.id, s.name]));
  const links = await db.select().from(staffGoals).where(inArray(staffGoals.goalId, ids));
  const lines = await db
    .select()
    .from(goalProgress)
    .where(inArray(goalProgress.goalId, ids))
    .orderBy(desc(goalProgress.createdAt));
  const order: Record<GoalStatus, number> = { active: 0, paused: 1, met: 2, dropped: 3 };
  return rows
    .map((g) => ({
      ...g,
      staff: links
        .filter((l) => l.goalId === g.id && names.has(l.staffId))
        .map((l) => ({ staffId: l.staffId, name: names.get(l.staffId)!, part: l.part })),
      progress: lines
        .filter((p) => p.goalId === g.id)
        .slice(0, progressPerGoal)
        .map((p) => ({ ...p, name: names.get(p.staffId) ?? p.staffId }))
    }))
    .sort((a, b) => order[a.status] - order[b.status] || a.id - b.id);
}

/** Every goal, for the owner and the Office Manager. */
export async function allGoals(): Promise<GoalView[]> {
  return views(await db.select().from(goals));
}

/** A goal as the owner's Goals window shows it, with its threads, newest first. */
export type GoalWithThreads = GoalView & { threads: GoalThread[] };

/**
 * The owner's Goals window: every goal with its threads, and other work, the
 * threads for no goal that are still under way or waiting on the owner, so
 * all work in flight shows in one place.
 */
export type GoalsWindow = { goals: GoalWithThreads[]; other: GoalThread[] };

/**
 * The Goals window, for the owner only: an Odd's goals (`goalsFor`) leave the
 * threads out, so its runs never pay for them.
 */
export async function goalsWindow(): Promise<GoalsWindow> {
  const [rows, all] = await Promise.all([allGoals(), goalThreads()]);
  return {
    goals: rows.map((g) => ({ ...g, threads: all.filter((t) => t.goalId === g.id) })),
    other: all.filter(
      (t) => t.goalId === null && (t.stage === 'under_way' || t.stage === 'waiting_on_you')
    )
  };
}

/** The goals one staffer serves, and only those. */
export async function goalsFor(staffId: string): Promise<(GoalView & { part: string })[]> {
  const links = await db.select().from(staffGoals).where(eq(staffGoals.staffId, staffId));
  if (!links.length) return [];
  const rows = await db
    .select()
    .from(goals)
    .where(
      inArray(
        goals.id,
        links.map((l) => l.goalId)
      )
    );
  return (await views(rows)).map((g) => ({
    ...g,
    part: links.find((l) => l.goalId === g.id)!.part
  }));
}

/** The office's manager, if it has one. `q` reads it inside a transaction. */
export async function manager(q: Db = db): Promise<StaffRow | undefined> {
  const [m] = await q
    .select()
    .from(staff)
    .where(and(eq(staff.role, MANAGER_ROLE), isNull(staff.leftAt)))
    .orderBy(asc(staff.hiredAt))
    .limit(1);
  return m;
}

/**
 * Set a goal: the owner wrote it, or approved one the manager proposed. The
 * manager then plans it, and reviews every goal once a week from the first one.
 */
export async function addGoal(d: GoalDraft, askId?: number): Promise<GoalRow> {
  const [row] = await db.insert(goals).values(d).returning();
  await record({
    kind: 'decision',
    actor: 'owner',
    title: `Set a goal: ${d.title}`,
    body: [d.why && `Why: ${d.why}`, d.doneWhen && `Done when: ${d.doneWhen}`]
      .filter(Boolean)
      .join('\n'),
    askId
  });
  const m = await manager();
  if (m) {
    await ensureReview(m);
    // Planned on a thread for the goal, so what the plan raises files under it.
    await db.transaction(async (tx) =>
      addFollowUp(tx, {
        staffId: m.id,
        kind: 'goal',
        goalId: row.id,
        threadId: await goalThread(tx, row.id, m.id)
      })
    );
  }
  return row;
}

/** The manager's weekly review, made with the first goal so an office with none runs nothing. */
async function ensureReview(m: StaffRow): Promise<void> {
  const [has] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.staffId, m.id), eq(jobs.name, REVIEW_JOB)));
  if (has) return;
  await addJob({
    staffId: m.id,
    name: REVIEW_JOB,
    instructions: goalReview(await ownerName()),
    schedule: { every: 'week', day: 'Fri', at: '16:00' }
  });
}

/** The owner changes a goal: its words, when it is for, or where it stands. */
export async function updateGoal(
  id: number,
  patch: Partial<GoalDraft> & { status?: GoalStatus },
  by: { owner: true } | { staffId: string; askId?: number }
): Promise<GoalRow | undefined> {
  const [row] = await db
    .update(goals)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(goals.id, id))
    .returning();
  if (!row) return undefined;
  const what = patch.status
    ? `${patch.status === 'active' ? 'Picked up' : `Marked ${patch.status}`}: ${row.title}`
    : `Changed the goal: ${row.title}`;
  await record({
    kind: 'owner' in by ? 'decision' : 'work',
    actor: 'owner' in by ? 'owner' : by.staffId,
    title: what,
    body: JSON.stringify(patch),
    askId: 'askId' in by ? by.askId : undefined
  });
  return row;
}

/** Link a staffer to a goal, with its part in it. A staffer sees only goals it serves. */
export async function serveGoal(
  staffId: string,
  goalId: number,
  part: string,
  q: Db = db
): Promise<void> {
  const who = await staffer(staffId, q);
  const g = await goal(goalId, q);
  if (!who || !g) throw fixedError('No such Odd or goal');
  const words = part.trim().slice(0, 400);
  if (!words) throw new Error(`Say what ${who.name} does for it`);
  await q
    .insert(staffGoals)
    .values({ staffId, goalId, part: words })
    .onConflictDoUpdate({ target: [staffGoals.staffId, staffGoals.goalId], set: { part: words } });
  await record(
    {
      kind: 'decision',
      actor: 'owner',
      title: `${who.name} serves the goal: ${g.title}`,
      body: words
    },
    q
  );
}

/**
 * The owner hired from a proposed hire. The hire serves the goal it was
 * proposed for in the transaction that approves the ask, since the answer
 * wakes the goal's lead to hand the hire its first piece. If the link fails,
 * the ask stays open and nobody is woken.
 */
export async function approveHire(askId: number, staffId: string): Promise<void> {
  const approved = await approveAsk(askId, null, {
    link: async (a, tx) => {
      if (a.kind !== 'hire') throw new Error('That is not a proposed hire');
      if (a.hire?.goal) await serveGoal(staffId, a.hire.goal.id, a.hire.goal.part, tx);
    }
  });
  if (!approved) throw new Error('That proposal is no longer open');
}

export async function stopServing(staffId: string, goalId: number): Promise<void> {
  const [who, g] = await Promise.all([staffer(staffId), goal(goalId)]);
  const gone = await db
    .delete(staffGoals)
    .where(and(eq(staffGoals.staffId, staffId), eq(staffGoals.goalId, goalId)))
    .returning();
  if (gone.length && who && g)
    await record({
      kind: 'decision',
      actor: 'owner',
      title: `${who.name} no longer serves the goal: ${g.title}`
    });
}

/** A staffer's word on a goal it serves. */
export async function logProgress(
  staffId: string,
  goalId: number,
  health: GoalHealth,
  note: string
): Promise<ProgressRow | string> {
  const [link] = await db
    .select()
    .from(staffGoals)
    .where(and(eq(staffGoals.staffId, staffId), eq(staffGoals.goalId, goalId)));
  if (!link) return `You do not serve goal #${goalId}. my_goals lists the ones you do.`;
  const [row] = await db
    .insert(goalProgress)
    .values({ goalId, staffId, health, note: note.trim().slice(0, 500) })
    .returning();
  return row;
}

/** A goal ask approved: the goal is set, and the manager plans it. */
export async function approveGoal(askId: number, reason: string | null): Promise<GoalRow> {
  const a = await ask(askId);
  if (a?.kind !== 'goal' || !a.goal || a.status !== 'open')
    throw fixedError('That goal is no longer open');
  const draft = a.goal;
  let set: GoalRow | undefined;
  await approveAsk(askId, reason, {
    carryOut: async () => {
      set = await addGoal(draft, askId);
    }
  });
  if (!set) throw fixedError('That goal is no longer open');
  return set;
}

const itemLabel = (i: GoalPlanItem) =>
  i.kind === 'hire' ? `hire ${i.hire.name}, ${i.hire.role}` : `${i.staff}: ${i.part}`;

/**
 * A plan ask approved, with the parts the owner ticked. Staff already here take
 * on their part at once. Each hire becomes a hire ask on the plan's thread,
 * which the page opens in the hire window, and the owner's own steps a task on
 * their desk. Only then does the answer bring the plan's Odd back to the goal's
 * thread to lead the work, so its run finds all of it. Hiring one of the plan's
 * hires answers its ask, and that brings the Odd back there again.
 */
export async function approvePlan(
  askId: number,
  picks: number[],
  reason: string | null
): Promise<{ hires: AskRow[] }> {
  const a = await ask(askId);
  if (a?.kind !== 'plan' || !a.plan || a.status !== 'open')
    throw fixedError('That plan is no longer open');
  const g = await goal(a.plan.goalId);
  if (!g) throw fixedError('The goal this plan is for is gone');
  const { plan } = a;
  const picked = plan.items.filter((_, i) => picks.includes(i));
  if (!picked.length) throw fixedError('Tick at least one part of the plan, or deny it');
  const left = plan.items.filter((_, i) => !picks.includes(i));
  const note =
    [reason, left.length && `Left out: ${left.map(itemLabel).join('; ')}.`]
      .filter(Boolean)
      .join('\n') || null;

  const hires: AskRow[] = [];
  const approved = await approveAsk(askId, note, {
    carryOut: async () => {
      for (const item of picked) {
        if (item.kind === 'assign') {
          await serveGoal(item.staff, g.id, item.part);
          if (item.job) await addJob({ staffId: item.staff, ...item.job });
          if (item.editJob)
            await editOwnJob(
              item.staff,
              item.editJob.name,
              { instructions: item.editJob.instructions, schedule: item.editJob.schedule },
              { askId }
            );
        } else {
          const { ask: h } = await raiseAsk(a.staffId, {
            title: `Hire ${item.hire.name}, ${item.hire.role}`,
            why: `For the goal "${g.title}": ${item.part}`,
            ifApproved: 'The hire window opens with this filled in. You hire from there.',
            hire: { ...item.hire, goal: { id: g.id, part: item.part } },
            threadId: a.threadId ?? undefined
          });
          hires.push(h);
        }
      }
      if (plan.ownerSteps?.length)
        await giveTask(a.staffId, {
          title: `For "${g.title}": yours to do`,
          why: 'The part of the plan only you can do.',
          steps: plan.ownerSteps,
          byOffice: true
        });
    }
  });
  if (!approved) throw fixedError('That plan is no longer open');
  return { hires };
}
