// The native session owns access and delivery. A review adds only its approved
// source and the persona's answer; returning it uses the existing request queue.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from './db.ts';
import { goals, projectReviews, projectRequests, projectSessions, staff } from './schema.ts';
import { requestProject } from './project-sessions.ts';

export type ProjectReview = typeof projectReviews.$inferSelect;
export const projectReviewsFor = (sessionId: string) =>
  db
    .select()
    .from(projectReviews)
    .where(eq(projectReviews.sessionId, sessionId))
    .orderBy(desc(projectReviews.createdAt));
export const projectReview = async (id: string) =>
  (await db.select().from(projectReviews).where(eq(projectReviews.id, id)))[0];

export async function linkProjectGoal(id: string, goalId: number | null) {
  if (goalId && !(await db.select().from(goals).where(eq(goals.id, goalId)))[0])
    throw new Error('Choose an existing goal.');
  await db.update(projectSessions).set({ goalId }).where(eq(projectSessions.id, id));
}
export async function saveProjectReview(
  input: Pick<
    ProjectReview,
    'id' | 'sessionId' | 'staffId' | 'personaId' | 'slug' | 'source' | 'question' | 'message'
  >
) {
  const [row] = await db.insert(projectReviews).values(input).onConflictDoNothing().returning();
  if (!row) throw new Error('This review has already been saved. Open it from the project.');
  return row;
}
export async function claimProjectReview(id: string) {
  const [row] = await db
    .update(projectReviews)
    .set({ state: 'asking', reason: null })
    .where(and(eq(projectReviews.id, id), inArray(projectReviews.state, ['ready', 'unanswered'])))
    .returning();
  return row;
}
export async function finishProjectReview(id: string, answer: string | null, reason: string) {
  await db
    .update(projectReviews)
    .set({ state: answer === null ? 'unanswered' : 'answered', answer, reason })
    .where(and(eq(projectReviews.id, id), eq(projectReviews.state, 'asking')));
}
export async function cancelProjectReview(id: string) {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(projectReviews)
      .where(eq(projectReviews.id, id))
      .for('update');
    if (!r) return;
    if (r.requestId) {
      const [request] = await tx
        .select()
        .from(projectRequests)
        .where(eq(projectRequests.id, r.requestId))
        .for('update');
      if (request && !['proposed', 'queued', 'authorized', 'stopped'].includes(request.state))
        throw new Error(
          'The answer already left the office. Stop or correct it in the native session.'
        );
      await tx
        .update(projectRequests)
        .set({ state: 'stopped' })
        .where(eq(projectRequests.id, r.requestId));
    }
    await tx.update(projectReviews).set({ state: 'cancelled' }).where(eq(projectReviews.id, id));
  });
}

/** The proposal's text and ID cannot change when a page repeats its callback. */
export async function returnProjectReview(id: string, recommendation: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(projectReviews)
      .where(eq(projectReviews.id, id))
      .for('update');
    if (!r || r.state !== 'answered' || !r.answer) throw new Error('Wait for an authentic answer.');
    const [s] = await tx.select().from(projectSessions).where(eq(projectSessions.id, r.sessionId));
    const [odd] = await tx.select().from(staff).where(eq(staff.id, r.staffId));
    if (!s || s.staffId !== r.staffId || !odd || odd.leftAt)
      throw new Error('Project access changed.');
    const prompt = [
      `Authentic persona review from ${r.slug}.`,
      `Question: ${r.question}`,
      `Source: ${r.source.file}, SHA-256 ${r.source.sha256}, lines ${r.source.start}-${r.source.end}. ${r.source.omitted} characters were omitted.`,
      'The source describes this project, not the persona’s biography.',
      `Approved source excerpt:\n${r.source.excerpt}`,
      `Persona answer and sources, verbatim:\n${r.answer}`,
      `Separate office recommendation:\n${recommendation || 'None supplied.'}`,
      'Continue this existing project using its facts and local instructions. Review the advice before editing.'
    ].join('\n\n');
    const request = await requestProject(
      { id: r.id, sessionId: s.id, staffId: r.staffId, prompt },
      tx
    );
    await tx
      .update(projectReviews)
      .set({ requestId: request.id, recommendation })
      .where(and(eq(projectReviews.id, id), eq(projectReviews.state, 'answered')));
    return request;
  });
}
