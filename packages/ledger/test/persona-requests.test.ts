// A populated office changes only the Odd the owner explicitly mapped.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { db } from './pglite.ts';
import {
  staff,
  goals,
  staffGoals,
  threads,
  tasks,
  followUps,
  jobs,
  grants,
  connectors,
  personaRevisions
} from '../src/schema.ts';
const {
  requestPersona,
  mapPersonaRequest,
  completePersonaRequest,
  cancelPersonaRequest,
  personaRequest
} = await import('../src/persona-requests.ts');
const { convertPersona } = await import('../src/personas.ts');
import type { OddPackage } from '../src/personas.ts';
const { withIdleStaff, reserveRun, releaseRun } = await import('../src/run-registry.ts');
const { MANAGERS } = await import('../src/managers.ts');
const ordinary = (id: string) => ({
  id,
  name: 'Pat',
  role: 'Reviewer',
  remit: 'Old remit',
  desk: 'Preserve these instructions.',
  variant: 'a',
  portrait: 'a',
  permission: 'act' as const,
  commands: true,
  web: true,
  folders: [{ path: '/work', write: true }]
});
await db.insert(staff).values([ordinary('manager'), ordinary('original'), ordinary('same-name')]);
const [goal] = await db
  .insert(goals)
  .values({ title: 'Existing review goal', why: 'Keep the prior decision.' })
  .returning();
await db.insert(staffGoals).values({ staffId: 'original', goalId: goal.id, part: 'Review it' });
const [work] = await db
  .insert(threads)
  .values({ title: 'The existing work', goalId: goal.id, hubId: 'manager', holderId: 'manager' })
  .returning();
const [oldTask] = await db
  .insert(tasks)
  .values({
    staffId: 'manager',
    threadId: work.id,
    title: 'Find a service address',
    why: 'Old checklist',
    steps: []
  })
  .returning();
const [job] = await db
  .insert(jobs)
  .values({
    staffId: 'original',
    name: 'Existing job',
    instructions: 'Kept',
    schedule: { every: 'day', at: '06:30' }
  })
  .returning();
await db.insert(connectors).values({
  id: 'old',
  name: 'Old tool',
  description: 'Prior access',
  kind: 'http',
  config: { url: 'https://example.invalid' }
});
await db.insert(grants).values({ staffId: 'original', connectorId: 'old', level: 'act' });
const pkg: OddPackage = {
  format: 1,
  version: 1,
  name: 'Authentic Pat',
  role: 'Persona',
  remit: 'Gives a judgment',
  hello: 'Hello',
  look: MANAGERS.find((m) => m.look)!.look!,
  portraitPx: 'test',
  parts: []
};
const input = {
  slug: 'pat',
  pkg,
  disclosure: 'Pat is an AI persona.',
  displayName: 'Pat Example',
  requestId: 'r1'
};

test('no name match converts an Odd; the owner maps one and retains its history and old access in a revision', async () => {
  await requestPersona({
    id: 'r1',
    requesterId: 'manager',
    identity: 'Pat Example',
    continuation: 'Review the existing draft.',
    goalId: goal.id,
    taskId: oldTask.id,
    threadId: work.id
  });
  await assert.rejects(convertPersona('original', input), /no longer approved/);
  await mapPersonaRequest('r1', 'pat', 'original', [oldTask.id]);
  const active = reserveRun({ staffId: 'original', kind: 'chat' });
  await assert.rejects(
    withIdleStaff('original', () => convertPersona('original', input)),
    /finish or stop/
  );
  releaseRun(active);
  await withIdleStaff('original', async () => {
    assert.throws(
      () => reserveRun({ staffId: 'original', kind: 'chat' }),
      /changing to its persona/
    );
    await convertPersona('original', input);
  });
  const [after] = await db.select().from(staff).where(eq(staff.id, 'original'));
  assert.equal(after.id, 'original');
  assert.equal(after.package?.slug, 'pat');
  assert.equal(after.commands, false);
  assert.equal(after.web, false);
  assert.deepEqual(after.folders, []);
  assert.equal((await db.select().from(grants)).length, 0);
  assert.equal((await db.select().from(jobs))[0].id, job.id);
  assert.equal((await db.select().from(jobs))[0].enabled, false);
  assert.equal((await db.select().from(staffGoals))[0].goalId, goal.id);
  assert.equal(
    (await db.select().from(staff).where(eq(staff.id, 'same-name')))[0].desk,
    'Preserve these instructions.'
  );
  const revision = (await db.select().from(personaRevisions))[0].previous;
  assert.equal((revision.staff as { desk: string }).desk, 'Preserve these instructions.');
  assert.equal((revision.grants as unknown[]).length, 1);
});

test('two callbacks and a later restart reconciliation resume the saved request once and withdraw only reviewed tasks', async () => {
  const results = await Promise.all([
    completePersonaRequest('r1', 'original'),
    completePersonaRequest('r1', 'original')
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(await completePersonaRequest('r1', 'original'), false);
  assert.equal((await db.select().from(followUps)).filter((f) => f.kind === 'resume').length, 1);
  assert.equal(
    (await db.select().from(tasks).where(eq(tasks.id, oldTask.id)))[0].status,
    'dropped'
  );
  assert.equal((await personaRequest('r1'))?.state, 'connected');
  await cancelPersonaRequest('r1');
  assert.equal((await personaRequest('r1'))?.state, 'connected');
});

test('an unavailable identity stays pending; a cancelled mapping cannot convert or resume', async () => {
  await requestPersona({
    id: 'unavailable',
    requesterId: 'manager',
    identity: 'Unavailable author',
    continuation: 'Wait for an actual offer.'
  });
  assert.equal((await personaRequest('unavailable'))?.state, 'pending');
  await requestPersona({
    id: 'cancel',
    requesterId: 'manager',
    identity: 'Another persona',
    continuation: 'Review later.'
  });
  await mapPersonaRequest('cancel', 'other', 'same-name', []);
  await cancelPersonaRequest('cancel');
  await assert.rejects(
    convertPersona('same-name', { ...input, slug: 'other', requestId: 'cancel' }),
    /no longer approved/
  );
  assert.equal(await completePersonaRequest('cancel', 'original'), false);
  assert.equal((await db.select().from(staff).where(eq(staff.id, 'same-name')))[0].package, null);
});

test('connection after the owner ends the work records the result without a pickup', async () => {
  await requestPersona({
    id: 'ended',
    requesterId: 'manager',
    identity: 'Pat',
    continuation: 'Review again.',
    threadId: work.id
  });
  await mapPersonaRequest('ended', 'pat', null, []);
  await db
    .update(threads)
    .set({ status: 'stopped', endedAt: new Date() })
    .where(eq(threads.id, work.id));
  const count = (await db.select().from(followUps)).length;
  assert.equal(await completePersonaRequest('ended', 'original'), true);
  assert.equal((await personaRequest('ended'))?.resumedAt, null);
  assert.equal((await db.select().from(followUps)).length, count);
});
