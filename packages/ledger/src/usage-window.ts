// The usage guard. Every Odd on Claude Code runs on the owner's one Claude
// plan, so they share its 5-hour window, which each run reports as it goes
// (`notePlan` in the office app keeps it in plan_limits). Past the guard of
// it, the office holds new hand-offs to those Odds: a hand-off (`handedOff` in
// work/hand-offs.ts) parks its thread until the window resets, and the office
// raises one `window` ask for the whole office, filed under its manager, who
// runs the floor. A hand-off to an Odd on another tool goes, since its run
// spends nothing of the window. A yes lets hand-offs run until the reset and
// wakes the held threads now. A no, or no answer, leaves them held, and the
// office clock wakes them at the reset, as it wakes a thread parked with
// resume_at. A run already going is never stopped: only a new hand-off waits.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from './db.ts';
import { asks, threads } from './schema.ts';
import { answerThread, type Tx } from './threads.ts';

/** What a held thread's hub is told when the clock wakes it at the reset. */
export const WINDOW_RESET =
  'The usage window has reset, so hand-offs run again. Hand on the work the office held.';

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
