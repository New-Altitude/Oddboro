// The usage guard. Every Odd on Claude Code runs on the owner's one Claude
// plan, so they share its 5-hour window, which each run reports as it goes
// (`notePlan` in the office app keeps it in plan_limits). Past WINDOW_GUARD of
// it, the office holds new hand-offs to those Odds: `takeHandOff` refuses each
// one and parks its thread until the window resets, and the office raises one
// `window` ask for the whole office, filed under its manager, who runs the
// floor. A hand-off to an Odd on another tool goes, since its run spends
// nothing of the window. A yes lets hand-offs run until the reset and wakes the
// held threads now. A no, or no answer, leaves them held, and the office clock
// wakes them at the reset, as it wakes a thread parked with resume_at. A run
// already going is never stopped: only a new hand-off waits.
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AGENT_NAMES } from './agents.ts';
import { db } from './db.ts';
import { manager } from './goals.ts';
import { asks, planLimits, staff, threads } from './schema.ts';
import { toolNames } from './sharing.ts';
import { answerThread, settleThread, type ThreadRow, type Tx } from './threads.ts';
import { clockTime } from './time.ts';

/** The share of the 5-hour window past which the office holds new hand-offs. */
const WINDOW_GUARD = 0.85;
/** A window that resets at a time began this long before it. */
const WINDOW_MS = 5 * 3_600_000;

/** What a held thread's hub is told when the clock wakes it at the reset. */
export const WINDOW_RESET =
  'The usage window has reset, so hand-offs run again. Hand on the work the office held.';

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Whether a new hand-off to `to` on this thread waits for the window, and why.
 * It goes (undefined) when `to` runs on another tool than Claude Code, when no
 * window is reported yet, when the window has no
 * reset time (nothing could wait it out) or has already reset, when it is
 * under the guard, or when the owner let hand-offs run in it. Otherwise the
 * thread is parked until the reset, held by this window's one ask, raised now
 * if it is not yet. A finished thread being continued opens again for a new
 * round, so the hub's pick-up starts it afresh. The plan's row is
 * locked, so two hand-offs at once raise one ask between them.
 */
export async function holdForWindow(
  tx: Tx,
  t: ThreadRow,
  to: string
): Promise<{ problem: string } | undefined> {
  const [receiver] = await tx.select({ agent: staff.agent }).from(staff).where(eq(staff.id, to));
  if (receiver?.agent !== 'claude') return undefined;
  const [w] = await tx.select().from(planLimits).where(eq(planLimits.id, 'claude')).for('update');
  const now = new Date();
  const resets = w?.fiveHourResetsAt;
  if (!w || !resets || resets <= now || w.fiveHour < WINDOW_GUARD) return undefined;
  const [asked] = await tx
    .select({ id: asks.id, status: asks.status })
    .from(asks)
    .where(and(eq(asks.kind, 'window'), gt(asks.createdAt, new Date(resets.getTime() - WINDOW_MS))))
    .orderBy(desc(asks.id))
    .limit(1);
  if (asked?.status === 'approved') return undefined;
  const at = clockTime(resets, now);
  const heldBy = asked?.id ?? (await raiseWindowAsk(tx, t.hubId, w.fiveHour, at));
  await tx
    .update(threads)
    .set({
      resumeAt: resets,
      heldBy,
      ...(t.endedAt ? { endedAt: null, handOffsUsed: 0 } : {})
    })
    .where(eq(threads.id, t.id));
  await settleThread(tx, t.id);
  return {
    problem: `The office holds new hand-offs: the Claude plan's usage window is at ${percent(w.fiveHour)}. Work ${t.id} picks back up when the window resets at ${at}, or sooner if the owner lets hand-offs run. Say so, and finish this run.`
  };
}

/**
 * The office's one ask for this window. It is office-wide, so it is filed
 * under the manager, who runs the floor; an ask needs a staffer, so with no
 * manager it goes under the hub that hit the guard. Its why names the Odds on
 * Claude Code when the office has Odds on other tools, whose work goes on.
 */
async function raiseWindowAsk(tx: Tx, hubId: string, share: number, at: string): Promise<number> {
  const odds = await tx
    .select({ name: staff.name, agent: staff.agent })
    .from(staff)
    .where(isNull(staff.leftAt))
    .orderBy(asc(staff.name));
  const onClaude = odds.filter((o) => o.agent === 'claude').map((o) => o.name);
  const guard = `Past ${percent(WINDOW_GUARD)} of it, the office pauses work`;
  const why =
    onClaude.length === odds.length
      ? `Every Odd runs on your Claude plan, so they all share its 5-hour window. ${guard} Odds pass to each other so the window lasts. Runs already going carry on.`
      : `The Odds on ${AGENT_NAMES.claude} share your Claude plan's 5-hour window: ${toolNames(onClaude)}. ${guard} handed to them so the window lasts. Work for Odds on other tools, and runs already going, carry on.`;
  const [ask] = await tx
    .insert(asks)
    .values({
      staffId: (await manager(tx))?.id ?? hubId,
      kind: 'window',
      title: `Your Claude plan's 5-hour window is ${percent(share)} used. Pause work Odds pass to each other until it resets at ${at}, or let it carry on?`,
      why,
      ifApproved: `Work on hold picks back up now, and Odds pass work on until the window resets at ${at}. If you say no, it stays on hold and picks back up when it resets.`
    })
    .returning({ id: asks.id });
  return ask.id;
}

/**
 * The owner answered the window ask. A yes wakes every thread it still holds,
 * with `answer`; later hand-offs in this window go, since the ask is
 * approved. A no leaves them for the clock to wake at the reset.
 */
export async function answerWindow(
  askId: number,
  approved: boolean,
  answer: string
): Promise<void> {
  if (!approved) return;
  const freed = await db
    .update(threads)
    .set({ heldBy: null, resumeAt: null })
    .where(and(eq(threads.heldBy, askId), isNull(threads.endedAt)))
    .returning({ id: threads.id });
  for (const t of freed) await answerThread(t.id, answer, askId);
}

/**
 * The clock woke a thread the window held. Once it holds no other, an ask the
 * owner never answered leaves the desk, since the reset settled it the way a
 * no would have.
 */
export async function windowWoke(tx: Tx, askId: number): Promise<void> {
  await tx
    .update(asks)
    .set({ status: 'denied', reason: 'The window reset before an answer.', decidedAt: new Date() })
    .where(
      and(
        eq(asks.id, askId),
        eq(asks.status, 'open'),
        sql`not exists (select 1 from ${threads} where ${threads.heldBy} = ${askId})`
      )
    );
}
