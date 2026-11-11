import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { db } from './pglite.ts';
import { eq } from 'drizzle-orm';
import { reports, staff, threads, followUps } from '../src/schema.ts';
const {
  connectProject,
  shareProject,
  requestProject,
  claimProject,
  finishProject,
  changeProjectRequest
} = await import('../src/project-sessions.ts');

async function fixture(permission: 'act' | 'draft' | 'read') {
  const id = randomUUID();
  await db.insert(staff).values({
    id,
    name: 'Office tester',
    role: 'Tester',
    remit: 'Test project work.',
    variant: 'a',
    portrait: 'a',
    permission,
    desk: 'Test office'
  });
  const s = await connectProject('codex', randomUUID(), '/project', 'Example');
  await shareProject(s.id, id);
  return { id: randomUUID(), staffId: id, sessionId: s.id, prompt: 'Read the project note.' };
}

test('one native ID has one project and a retried instruction has one delivery', async () => {
  const work = await fixture('act');
  const [a, b] = await Promise.all([requestProject(work), requestProject(work)]);
  assert.equal(a.id, b.id);
  await assert.rejects(requestProject({ ...work, prompt: 'Different work.' }), /different work/);
  const claims = await Promise.all([claimProject(work.sessionId), claimProject(work.sessionId)]);
  assert.equal(claims.filter(Boolean).length, 1);
  await changeProjectRequest(work.id, work.sessionId, ['sending'], 'uncertain');
  assert.equal(await claimProject(work.sessionId), undefined);
  const uuid = randomUUID();
  const s = await connectProject('claude', uuid, '/one', 'One');
  assert.equal((await connectProject('claude', uuid, '/one', 'Again')).id, s.id);
  await assert.rejects(connectProject('claude', uuid, '/two', 'Two'), /different project/);
});

test('sharing, a run ceiling, a later downgrade and owner takeover govern dispatch', async () => {
  const work = await fixture('act');
  await assert.rejects(requestProject({ ...work, staffId: 'another' }), /not been shared/);
  assert.equal((await requestProject({ ...work, draft: true })).state, 'proposed');
  assert.equal(await claimProject(work.sessionId), undefined);
  await changeProjectRequest(work.id, work.sessionId, ['proposed'], 'authorized');
  assert.equal((await claimProject(work.sessionId))?.id, work.id);
  const later = await fixture('act');
  await requestProject(later);
  await db.update(staff).set({ permission: 'draft' }).where(eq(staff.id, later.staffId));
  assert.equal(await claimProject(later.sessionId), undefined);
  assert.ok(await changeProjectRequest(later.id, later.sessionId, ['proposed'], 'authorized'));
  await shareProject(later.sessionId, null);
  assert.equal(await claimProject(later.sessionId), undefined);
  await assert.rejects(requestProject({ ...later, id: randomUUID() }), /not been shared/);
  await assert.rejects(requestProject(await fixture('read')), /Draft or Act/);
});

test('a repeated provider callback delivers one report and one pickup on the assigning thread', async () => {
  const work = await fixture('act');
  const [thread] = await db
    .insert(threads)
    .values({ title: 'Project review', hubId: work.staffId, holderId: work.staffId })
    .returning();
  await requestProject({ ...work, threadId: thread.id });
  await claimProject(work.sessionId);
  await finishProject(work.id, randomUUID(), 'Wrong conversation');
  await Promise.all([
    finishProject(work.id, work.sessionId, 'See notes.md'),
    finishProject(work.id, work.sessionId, 'See notes.md')
  ]);
  const deliveries = await db.select().from(reports).where(eq(reports.staffId, work.staffId));
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0].body, /notes\.md/);
  const pickups = await db.select().from(followUps).where(eq(followUps.threadId, thread.id));
  assert.equal(pickups.length, 1);
  assert.equal(pickups[0].staffId, work.staffId);
});

test('a result from earlier work stays readable after the owner ends its thread', async () => {
  const work = await fixture('act');
  const [thread] = await db
    .insert(threads)
    .values({
      title: 'Ended project',
      hubId: work.staffId,
      holderId: work.staffId,
      status: 'stopped',
      endedAt: new Date()
    })
    .returning();
  await requestProject({ ...work, threadId: thread.id });
  await claimProject(work.sessionId);
  await finishProject(work.id, work.sessionId, 'The saved result.');
  assert.equal(
    (await db.select().from(followUps).where(eq(followUps.threadId, thread.id))).length,
    0
  );
  assert.equal(
    (await db.select().from(reports).where(eq(reports.staffId, work.staffId))).length,
    1
  );
  assert.equal(
    (await db.select().from(threads).where(eq(threads.id, thread.id)))[0].status,
    'stopped'
  );
});
