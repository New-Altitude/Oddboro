// A setup request is proposed by an Odd and mapped to an actual offer by the owner.
// Its continuation is kept with the request, so a callback can resume it once.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from './db.ts';
import { addFollowUp, answerThread } from './threads.ts';
import { record, staffer, withdrawTask } from './office.ts';
import { goals, personaRequests, staff, tasks, threads } from './schema.ts';

export type PersonaRequest = typeof personaRequests.$inferSelect;
export const personaRequestsFrom = (requesterId?: string) =>
  db
    .select()
    .from(personaRequests)
    .where(requesterId ? eq(personaRequests.requesterId, requesterId) : undefined)
    .orderBy(desc(personaRequests.createdAt));
export const personaRequest = async (id: string) =>
  (await db.select().from(personaRequests).where(eq(personaRequests.id, id)))[0];

export async function requestPersona(
  p: Pick<PersonaRequest, 'id' | 'requesterId' | 'identity' | 'continuation'> & {
    goalId?: number;
    threadId?: number;
    taskId?: number;
  }
) {
  if (!(await staffer(p.requesterId))) throw new Error('No such Odd.');
  if (p.threadId) {
    const [t] = await db.select().from(threads).where(eq(threads.id, p.threadId));
    if (!t || t.hubId !== p.requesterId || t.endedAt || (p.goalId && t.goalId !== p.goalId))
      throw new Error('Choose open work led by this Odd.');
  }
  if (p.taskId) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, p.taskId));
    if (!t || t.staffId !== p.requesterId || t.status !== 'open')
      throw new Error('Choose an open task from this Odd.');
  }
  const [r] = await db.insert(personaRequests).values(p).onConflictDoNothing().returning();
  const previous = r ?? (await personaRequest(p.id));
  if (
    !previous ||
    previous.requesterId !== p.requesterId ||
    previous.identity !== p.identity ||
    previous.continuation !== p.continuation ||
    previous.goalId !== (p.goalId ?? null) ||
    previous.threadId !== (p.threadId ?? null) ||
    previous.taskId !== (p.taskId ?? null)
  )
    throw new Error('This request already has different instructions.');
  return previous;
}

/** Only an owner route calls this, after reading the current offers. No name matching. */
export async function mapPersonaRequest(
  id: string,
  slug: string,
  staffId: string | null,
  supersededTasks: number[]
) {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(personaRequests)
      .where(eq(personaRequests.id, id))
      .for('update');
    if (!r || r.state === 'cancelled' || r.state === 'connected')
      throw new Error('This request is no longer waiting.');
    if (staffId) {
      const [s] = await tx.select().from(staff).where(eq(staff.id, staffId));
      if (!s || s.leftAt || s.package)
        throw new Error('Choose an ordinary Odd still in the office.');
    }
    for (const taskId of supersededTasks) {
      const [t] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      if (!t || t.status !== 'open' || t.staffId !== r.requesterId)
        throw new Error('Only open tasks from this conversation can be replaced.');
    }
    // One approved conversion owns a persona and an ordinary Odd until it finishes or is cancelled.
    const approved = await tx
      .select()
      .from(personaRequests)
      .where(eq(personaRequests.state, 'approved'));
    if (
      approved.some((a) => a.id !== id && (a.slug === slug || (staffId && a.staffId === staffId)))
    )
      throw new Error('Another pending request already connects this persona or Odd.');
    await tx
      .update(personaRequests)
      .set({ slug, staffId, supersededTasks, state: 'approved' })
      .where(eq(personaRequests.id, id));
    await record(
      {
        kind: 'work',
        actor: 'owner',
        title: `Approved connection to ${slug}`,
        body: `Request ${id}. ${staffId ? `Keep Odd ${staffId}; save its previous instructions and remove its grants.` : 'Use the installed persona or add its offered Odd.'}`
      },
      tx
    );
  });
}

export const approvedPersonaRequest = async (slug: string) =>
  (
    await db
      .select()
      .from(personaRequests)
      .where(and(eq(personaRequests.slug, slug), eq(personaRequests.state, 'approved')))
  )[0];
export async function cancelPersonaRequest(id: string) {
  const [r] = await db
    .update(personaRequests)
    .set({ state: 'cancelled' })
    .where(and(eq(personaRequests.id, id), inArray(personaRequests.state, ['pending', 'approved'])))
    .returning();
  if (r)
    await record({
      kind: 'work',
      actor: 'owner',
      title: `Cancelled connection request for ${r.identity}`
    });
}

/** The installed package and consent must be verified by the server before this call. */
export async function completePersonaRequest(id: string, installedId: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(personaRequests)
      .where(eq(personaRequests.id, id))
      .for('update');
    if (!r || r.state !== 'approved' || r.resumedAt) return false;
    const [who] = await tx.select().from(staff).where(eq(staff.id, installedId));
    if (who?.package?.slug !== r.slug || who.package.quiet) return false;
    if (r.staffId && r.staffId !== installedId)
      throw new Error(
        'The approved Odd was not converted. Keep the original and choose the installed persona instead.'
      );
    const [thread] = r.threadId
      ? await tx.select().from(threads).where(eq(threads.id, r.threadId))
      : [];
    const [goal] = r.goalId ? await tx.select().from(goals).where(eq(goals.id, r.goalId)) : [];
    const [requester] = await tx.select().from(staff).where(eq(staff.id, r.requesterId));
    const resume =
      !!requester &&
      !requester.leftAt &&
      (!r.threadId || (thread && !thread.endedAt)) &&
      (!r.goalId || goal?.status === 'active');
    await tx
      .update(personaRequests)
      .set({
        state: 'connected',
        installedId,
        resumedAt: resume ? new Date() : null
      })
      .where(eq(personaRequests.id, id));
    for (const taskId of resume ? r.supersededTasks : [])
      await withdrawTask(
        taskId,
        `Replaced by verified connection request ${r.id}. The old checklist was withdrawn, not completed.`,
        tx
      );
    // Keep the connection result even if its original work ended while the browser was open.
    if (resume) {
      const note = `New Altitude connection verified: ${r.slug}, Odd ${installedId}. Continue the saved request: ${r.continuation}`;
      if (r.threadId) await answerThread(r.threadId, note, undefined, tx);
      else
        await addFollowUp(tx, { staffId: r.requesterId, kind: 'resume', goalId: r.goalId, note });
    }
    await record(
      {
        kind: 'work',
        actor: 'office',
        title: `Connected ${r.slug}`,
        body: `Request ${id}. ${resume ? 'The original request resumes once.' : 'The original work is no longer active; no new run started.'}`
      },
      tx
    );
    return true;
  });
}
