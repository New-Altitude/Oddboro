// The owner connects a native conversation and can give one Odd access to it.
// Claims, revocations and replies serialize on the same session row.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { addFollowUp } from './threads.ts';
import { db } from './db.ts';
import {
  projectRequests,
  projectSessions,
  reports,
  staff,
  threads,
  type ProjectRequestState
} from './schema.ts';

export type ProjectSession = typeof projectSessions.$inferSelect;
export type ProjectRequest = typeof projectRequests.$inferSelect;
export type ProjectAgent = ProjectSession['agent'];
export const projectConnections = (staffId?: string) =>
  db
    .select()
    .from(projectSessions)
    .where(staffId ? eq(projectSessions.staffId, staffId) : undefined)
    .orderBy(desc(projectSessions.createdAt));
export async function connection(id: string) {
  return (await db.select().from(projectSessions).where(eq(projectSessions.id, id)))[0];
}
export async function connectProject(
  agent: ProjectAgent,
  nativeId: string,
  folder: string,
  title: string
) {
  const [session] = await db
    .insert(projectSessions)
    .values({ id: randomUUID(), agent, nativeId, folder, title })
    .onConflictDoNothing()
    .returning();
  if (session) return session;
  const [existing] = await db
    .select()
    .from(projectSessions)
    .where(and(eq(projectSessions.agent, agent), eq(projectSessions.nativeId, nativeId)));
  if (!existing || existing.folder !== folder)
    throw new Error('This conversation belongs to a different project.');
  return existing;
}
export async function shareProject(id: string, staffId: string | null) {
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(projectSessions)
      .where(eq(projectSessions.id, id))
      .for('update');
    if (!previous) throw new Error('Session not found.');
    if (previous.staffId === staffId) return;
    if (previous.staffId)
      await tx
        .update(projectRequests)
        .set({ state: 'stopped', answer: 'The owner removed access before delivery.' })
        .where(
          and(
            eq(projectRequests.sessionId, id),
            eq(projectRequests.staffId, previous.staffId),
            inArray(projectRequests.state, ['proposed', 'queued', 'authorized'])
          )
        );
    await tx.update(projectSessions).set({ staffId }).where(eq(projectSessions.id, id));
  });
}
export const projectWork = (id: string) =>
  db
    .select()
    .from(projectRequests)
    .where(eq(projectRequests.sessionId, id))
    .orderBy(desc(projectRequests.createdAt))
    .limit(100);

export async function requestProject(input: {
  id: string;
  sessionId: string;
  prompt: string;
  file?: string;
  staffId?: string;
  threadId?: number;
  draft?: boolean;
}) {
  return db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(projectSessions)
      .where(eq(projectSessions.id, input.sessionId))
      .for('update');
    if (!s || (input.staffId && s.staffId !== input.staffId))
      throw new Error('This session has not been shared with you.');
    let state: ProjectRequestState = 'queued';
    if (input.staffId) {
      const [odd] = await tx.select().from(staff).where(eq(staff.id, input.staffId));
      if (!odd || odd.leftAt || odd.permission === 'read')
        throw new Error('Sending work needs Draft or Act access.');
      if (odd.permission !== 'act' || input.draft) state = 'proposed';
    }
    const [previous] = await tx
      .select()
      .from(projectRequests)
      .where(eq(projectRequests.id, input.id));
    if (previous) {
      if (
        previous.sessionId !== s.id ||
        previous.staffId !== (input.staffId ?? null) ||
        previous.prompt !== input.prompt ||
        previous.file !== (input.file ?? null) ||
        previous.threadId !== (input.threadId ?? null)
      )
        throw new Error('That request ID already belongs to different work.');
      return previous;
    }
    const [row] = await tx
      .insert(projectRequests)
      .values({
        id: input.id,
        sessionId: s.id,
        prompt: input.prompt,
        file: input.file,
        staffId: input.staffId,
        threadId: input.threadId,
        state
      })
      .returning();
    return row;
  });
}

/** A claim is durable before the prompt leaves. A crash never replays a sent request. */
export async function claimProject(id: string) {
  return db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(projectSessions)
      .where(eq(projectSessions.id, id))
      .for('update');
    if (!s) return;
    const busy = await tx
      .select({ id: projectRequests.id })
      .from(projectRequests)
      .where(
        and(
          eq(projectRequests.sessionId, id),
          inArray(projectRequests.state, ['sending', 'working', 'uncertain'])
        )
      )
      .limit(1);
    if (busy.length) return;
    const [next] = await tx
      .select()
      .from(projectRequests)
      .where(
        and(
          eq(projectRequests.sessionId, id),
          inArray(projectRequests.state, ['queued', 'authorized'])
        )
      )
      .orderBy(asc(projectRequests.createdAt), asc(projectRequests.id))
      .limit(1);
    if (!next) return;
    if (next.staffId) {
      const [odd] = await tx.select().from(staff).where(eq(staff.id, next.staffId)).for('share');
      if (next.staffId !== s.staffId || !odd || odd.leftAt || odd.permission === 'read') {
        await tx
          .update(projectRequests)
          .set({ state: 'stopped', answer: 'Access was removed before delivery.' })
          .where(eq(projectRequests.id, next.id));
        return;
      }
      if (next.state !== 'authorized' && odd.permission !== 'act') {
        await tx
          .update(projectRequests)
          .set({ state: 'proposed' })
          .where(eq(projectRequests.id, next.id));
        return;
      }
    }
    const [row] = await tx
      .update(projectRequests)
      .set({ state: 'sending' })
      .where(eq(projectRequests.id, next.id))
      .returning();
    return row;
  });
}
export async function changeProjectRequest(
  id: string,
  sessionId: string,
  from: ProjectRequestState[],
  state: ProjectRequestState,
  detail: { turn?: string; answer?: string } = {}
) {
  const [row] = await db
    .update(projectRequests)
    .set({ state, ...detail })
    .where(
      and(
        eq(projectRequests.id, id),
        eq(projectRequests.sessionId, sessionId),
        inArray(projectRequests.state, from)
      )
    )
    .returning();
  return row;
}
/** Posting the result and creating its Desk/chat delivery succeed together, even on a repeated callback. */
export async function finishProject(id: string, sessionId: string, answer: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(projectRequests)
      .set({ state: 'done', answer })
      .where(
        and(
          eq(projectRequests.id, id),
          eq(projectRequests.sessionId, sessionId),
          inArray(projectRequests.state, ['sending', 'working', 'uncertain'])
        )
      )
      .returning();
    if (row?.staffId) {
      const [session] = await tx
        .select()
        .from(projectSessions)
        .where(eq(projectSessions.id, sessionId));
      const [work] = row.threadId
        ? await tx
            .select({ endedAt: threads.endedAt })
            .from(threads)
            .where(eq(threads.id, row.threadId))
            .for('update')
        : [];
      if (row.threadId && work && !work.endedAt)
        await addFollowUp(tx, {
          kind: 'resume',
          staffId: row.staffId,
          threadId: row.threadId,
          note:
            'Result from ' + session.title + ' for your assignment "' + row.prompt + '":\n' + answer
        });
      await tx.insert(reports).values({
        staffId: row.staffId,
        title: 'Project session: ' + session.title,
        body:
          row.prompt + '\n\n' + answer + (row.threadId ? '\n\nOffice work #' + row.threadId : '')
      });
    }
    return row;
  });
}

/** History shown in the window is paged separately from the active delivery. */
export async function activeProjectRequest(id: string) {
  const [row] = await db
    .select()
    .from(projectRequests)
    .where(
      and(
        eq(projectRequests.sessionId, id),
        inArray(projectRequests.state, ['sending', 'working', 'uncertain'])
      )
    )
    .limit(1);
  return row;
}

export const proposedProjectWork = () =>
  db
    .select({
      id: projectRequests.id,
      sessionId: projectSessions.id,
      title: projectSessions.title,
      prompt: projectRequests.prompt,
      staffId: projectRequests.staffId,
      at: projectRequests.createdAt
    })
    .from(projectRequests)
    .innerJoin(projectSessions, eq(projectRequests.sessionId, projectSessions.id))
    .where(eq(projectRequests.state, 'proposed'))
    .orderBy(asc(projectRequests.createdAt));
