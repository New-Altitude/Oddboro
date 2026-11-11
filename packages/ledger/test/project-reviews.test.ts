import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { db } from './pglite.ts';
import { staff, goals } from '../src/schema.ts';
const R = await import('../src/project-reviews.ts');
const P = await import('../src/project-sessions.ts');

async function fixture(agent: 'claude' | 'codex', permission: 'act' | 'draft' | 'read' = 'act') {
  const staffId = randomUUID();
  await db.insert(staff).values({
    id: staffId,
    name: 'Pat',
    role: 'Reviewer',
    remit: 'Review this work',
    variant: 'a',
    portrait: 'a',
    permission,
    desk: 'Office'
  });
  const s = await P.connectProject(agent, randomUUID(), '/same-project', 'Existing project');
  const other = await P.connectProject(agent, randomUUID(), '/same-project', 'Untouched');
  await P.shareProject(s.id, staffId);
  const [goal] = await db.insert(goals).values({ title: 'Keep this project going' }).returning();
  await R.linkProjectGoal(s.id, goal.id);
  const r = await R.saveProjectReview({
    id: randomUUID(),
    sessionId: s.id,
    staffId,
    personaId: staffId,
    slug: 'pat',
    question: 'Does this fit?',
    message: 'Approved text',
    source: {
      file: 'plan.md',
      sha256: 'abc',
      start: 2,
      end: 3,
      omitted: 30,
      excerpt: 'unique project fact and project-only skill'
    }
  });
  return { r, s, other };
}
for (const agent of ['codex', 'claude'] as const)
  test(`${agent}: one full review goes back to the original conversation, preserving another in the folder`, async () => {
    const { r, s, other } = await fixture(agent);
    assert.ok(await R.claimProjectReview(r.id));
    assert.equal(
      await R.claimProjectReview(r.id),
      undefined,
      'an interrupted call is not automatically repeated'
    );
    const answer =
      'Authentic judgment\n[Evidence](https://example.test/source)\n' +
      'complete answer '.repeat(6000);
    await R.finishProjectReview(r.id, answer, 'answered');
    const [a, b] = await Promise.all([
      R.returnProjectReview(r.id, 'Consider a smaller scope.'),
      R.returnProjectReview(r.id, 'Consider a smaller scope.')
    ]);
    assert.equal(a.id, b.id);
    assert.ok(a.prompt.includes(answer), 'full answer including citations');
    assert.ok(a.prompt.includes('Separate office recommendation'));
    assert.equal((await P.connection(s.id))?.nativeId, s.nativeId);
    assert.equal((await P.projectWork(other.id)).length, 0);
    assert.equal((await P.claimProject(s.id))?.id, r.id);
    await P.changeProjectRequest(r.id, s.id, ['sending'], 'uncertain');
    assert.equal(await P.claimProject(s.id), undefined, 'unknown delivery blocks resending');
    await assert.rejects(R.cancelProjectReview(r.id), /already left/);
    const cards = await P.projectGoalSummaries();
    assert.equal(cards.find((x) => x.id === s.id)?.pending?.state, 'uncertain');
  });

test('Draft waits; changing a recommendation, revoked access and cancellation cannot resend', async () => {
  const { r, s } = await fixture('codex', 'draft');
  await R.claimProjectReview(r.id);
  await R.finishProjectReview(r.id, 'Answer', 'answered');
  assert.equal((await R.returnProjectReview(r.id, 'Keep it')).state, 'proposed');
  assert.equal(await P.claimProject(s.id), undefined);
  await assert.rejects(R.returnProjectReview(r.id, 'Different advice'), /different work/);
  await R.cancelProjectReview(r.id);
  await assert.rejects(R.returnProjectReview(r.id, 'Keep it'), /authentic answer/);
  assert.equal(await P.claimProject(s.id), undefined);
  const next = await fixture('claude');
  await R.claimProjectReview(next.r.id);
  await R.finishProjectReview(next.r.id, 'Answer', 'answered');
  await P.shareProject(next.s.id, null);
  await assert.rejects(R.returnProjectReview(next.r.id, ''), /access changed/);
});

test('Read access refuses a return and a known failure allows one deliberate retry', async () => {
  const { r } = await fixture('codex', 'read');
  await R.claimProjectReview(r.id);
  await R.finishProjectReview(r.id, null, 'Rate limited');
  assert.equal((await R.projectReview(r.id))?.state, 'unanswered');
  assert.ok(await R.claimProjectReview(r.id));
  await R.finishProjectReview(r.id, 'Answer', 'answered');
  await assert.rejects(R.returnProjectReview(r.id, ''), /Draft or Act/);
  await db.update(staff).set({ permission: 'act' }).where(eq(staff.id, r.staffId));
  await R.returnProjectReview(r.id, '');
  await R.cancelProjectReview(r.id);
  assert.equal(await P.claimProject(r.sessionId), undefined);
});

test('the return prompt separates the source, authentic answer and office recommendation', async (t) => {
  const { r } = await fixture('codex');
  await R.claimProjectReview(r.id);
  await R.finishProjectReview(
    r.id,
    'The claim needs evidence. [Source](https://example.test/one)',
    'answered'
  );
  const request = await R.returnProjectReview(r.id, 'Ask for the missing evidence.');
  t.assert.snapshot(request.prompt);
});
