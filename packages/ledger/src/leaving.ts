// An Odd leaving the office, and coming back. Leaving is soft: the row and all
// its history stay, and `staff.left_at` takes it off the floor. Every lookup of
// a working Odd (`staffer`, `roster`) skips it, so it runs nothing, gets no
// hand-off and shows nowhere. Bringing it back clears the mark, and it returns
// as it was: its job description, tools, folders, lessons, files and chat.
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { db } from './db.ts';
import { lookSignature } from '@oddboro/sprites/look';
import {
  asks,
  followUps,
  jobs,
  pokes,
  publicationFollows,
  staff,
  tasks,
  threads,
  type AskKind
} from './schema.ts';
import {
  anyStaffer,
  finishFollowUp,
  pokeUnreturned,
  record,
  recordUnreturned,
  roster,
  staffer,
  withdrawAsk,
  withdrawTask,
  workTitle,
  type Unreturned
} from './office.ts';
import { flat } from './desk-answers.ts';
import { MANAGER_ROLE } from './managers.ts';
import { nextRun } from './time.ts';

/** What the owner's yes to letting an Odd go does, on the ask. */
export const leavesLine = (name: string): string =>
  `${name} leaves the office at once: off the floor, its jobs off, and anything it has open on your desk withdrawn. Its history stays, and your ${MANAGER_ROLE} can bring it back.`;

/** Who let the Odd go or brought it back: the owner's yes to an ask, or the owner from its card. */
export type LeaveBy = { askId?: number };

/**
 * Why the owner's yes to a remove or bring_back ask cannot be carried out now,
 * or undefined when it can. The tools check the same before they raise one.
 */
export async function leavingRefused(
  kind: Extract<AskKind, 'remove' | 'bring_back'>,
  odd: string | null
): Promise<string | undefined> {
  const who = odd ? await anyStaffer(odd) : undefined;
  if (!who) return 'No Odd by that name ever worked here.';
  if (kind === 'remove') {
    if (who.leftAt) return `${who.name} already left the office.`;
    if (who.role === MANAGER_ROLE)
      return `${who.name} is the ${MANAGER_ROLE}, and every office keeps one.`;
    return undefined;
  }
  if (!who.leftAt) return `${who.name} still works here.`;
  const twin = who.look && (await lookTwin(who.id, lookSignature(who.look)));
  if (twin)
    return `${twin} looks exactly like ${who.name} now. Redraw ${twin}'s look first, then bring ${who.name} back.`;
  return undefined;
}

/** A working Odd hired since with the same look, by name. */
async function lookTwin(id: string, sig: string): Promise<string | undefined> {
  return (await roster()).find((p) => p.id !== id && p.look && lookSignature(p.look) === sig)?.name;
}

/**
 * Callbacks the office registers to stop an Odd's runs the moment it leaves.
 * The ledger cannot reach a run; the office's process holds them.
 */
const onLeave = new Set<(id: string) => void>();
export function whenOddLeaves(fn: (id: string) => void): () => void {
  onLeave.add(fn);
  return () => onLeave.delete(fn);
}

/**
 * Let an Odd go. In one transaction it leaves the floor, its jobs turn off
 * (and are remembered, to turn on again if it comes back), its waiting pokes
 * are cancelled, and every thread it leads stops, waiting on nothing. Then its
 * open work closes: each open ask is withdrawn and each open task dropped,
 * with the line going back to whoever waits on it, and each follow-up it has
 * yet to start fails, so a lead that handed it work hears at once. Any run
 * going now stops. Returns the refusal, or undefined once it left.
 */
export async function removeOdd(
  id: string,
  by: LeaveBy = {}
): Promise<{ refused: string } | undefined> {
  const refused = await leavingRefused('remove', id);
  if (refused) return { refused };
  const who = (await staffer(id))!;
  const left = await db.transaction(async (tx) => {
    const on = await tx
      .update(jobs)
      .set({ enabled: false, nextRunAt: null })
      .where(and(eq(jobs.staffId, id), eq(jobs.enabled, true)))
      .returning({ id: jobs.id });
    const [row] = await tx
      .update(staff)
      .set({ leftAt: new Date(), jobsOff: on.map((j) => j.id) })
      .where(and(eq(staff.id, id), isNull(staff.leftAt)))
      .returning({ id: staff.id });
    if (!row) return undefined;
    if (who.package) await tx.delete(publicationFollows).where(eq(publicationFollows.staffId, id));
    await tx
      .update(pokes)
      .set({ status: 'cancelled' })
      .where(and(eq(pokes.staffId, id), eq(pokes.status, 'waiting')));
    // Nothing it waited on wakes it: a task, a time, or the usage window's hold.
    await tx
      .update(threads)
      .set({
        status: 'stopped',
        endedAt: new Date(),
        resumeOnTask: null,
        resumeAt: null,
        heldBy: null
      })
      .where(and(eq(threads.hubId, id), ne(threads.status, 'stopped')));
    return on.length;
  });
  // Someone else let it go a moment ago.
  if (left === undefined) return undefined;
  for (const stop of onLeave) stop(id);
  const line = `${who.name} left the office, so this will not go ahead.`;
  // Its own asks, and any other ask about it, such as the manager's to let it go.
  const open = await db
    .select({ id: asks.id, staffId: asks.staffId })
    .from(asks)
    .where(and(eq(asks.status, 'open'), or(eq(asks.staffId, id), eq(asks.odd, id))));
  for (const a of open)
    await withdrawAsk(a.id, a.staffId === id ? line : `${who.name} left the office already.`);
  const given = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.staffId, id), eq(tasks.status, 'open')));
  for (const t of given) await withdrawTask(t.id, line);
  // Last, so nothing written for it as it left is missed. A run on work it led
  // ends with no report, since the owner let it go and the work stopped with
  // it. A colleague's result waiting there goes to no one: that colleague
  // tells the owner (`Unreturned`).
  const waiting = await db
    .select()
    .from(followUps)
    .where(and(eq(followUps.staffId, id), isNull(followUps.startedAt)));
  const led = new Set(
    (await db.select({ id: threads.id }).from(threads).where(eq(threads.hubId, id))).map(
      (t) => t.id
    )
  );
  for (const f of waiting) {
    const stopped = f.threadId !== null && led.has(f.threadId);
    await finishFollowUp(
      f,
      await workTitle(f),
      'failed',
      `${who.name} left the office before starting this.`,
      { stopped }
    );
    const h = f.handOff;
    // Not the owner's own answer going back: the colleague did nothing after it.
    if (
      !stopped ||
      f.kind !== 'handed_back' ||
      !h?.outcome ||
      h.outcome === 'waiting' ||
      h.answered
    )
      continue;
    const u: Unreturned = {
      colleague: { id: h.from, name: (await anyStaffer(h.from))?.name ?? h.from },
      lead: who.name,
      title: flat(h.title),
      outcome: h.outcome
    };
    await pokeUnreturned(db, u);
    await recordUnreturned(u);
  }
  await record({
    kind: 'hire',
    actor: 'owner',
    title: `Let ${who.name} go from the office`,
    body: `${who.name}, ${who.role}, is off the floor and runs nothing.${left ? ` ${jobsWord(left)} off.` : ''} Its history stays, and the ${MANAGER_ROLE} can bring it back.`,
    askId: by.askId
  });
  return undefined;
}

const jobsWord = (n: number) => (n === 1 ? 'Its job is' : `Its ${n} jobs are`);

/**
 * Bring back an Odd that left, as it was: back on the floor, with the jobs that
 * were on when it left turned on again from now. What it had open when it left
 * stays closed. Returns the refusal, or undefined once it is back.
 */
export async function bringBack(
  id: string,
  by: LeaveBy = {}
): Promise<{ refused: string } | undefined> {
  const refused = await leavingRefused('bring_back', id);
  if (refused) return { refused };
  const who = (await anyStaffer(id))!;
  const back = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(staff)
      .set({ leftAt: null, jobsOff: null })
      .where(eq(staff.id, id))
      .returning({ id: staff.id });
    if (!row || !who.jobsOff?.length) return !!row;
    const off = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.staffId, id), inArray(jobs.id, who.jobsOff)));
    const now = new Date();
    for (const j of off)
      await tx
        .update(jobs)
        .set({ enabled: true, nextRunAt: nextRun(j.schedule, now) })
        .where(eq(jobs.id, j.id));
    return true;
  });
  if (!back) return undefined;
  // Another ask to bring it back has nothing left to do.
  const twins = await db
    .select({ id: asks.id })
    .from(asks)
    .where(and(eq(asks.status, 'open'), eq(asks.odd, id), eq(asks.kind, 'bring_back')));
  for (const a of twins) await withdrawAsk(a.id, `${who.name} is back in the office already.`);
  await record({
    kind: 'hire',
    actor: 'owner',
    title: `Brought ${who.name} back to the office`,
    body: `${who.name}, ${who.role}, is back as it was.${who.jobsOff?.length ? ` ${jobsWord(who.jobsOff.length)} on again.` : ''}`,
    askId: by.askId
  });
  return undefined;
}
