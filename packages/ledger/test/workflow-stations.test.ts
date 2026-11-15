// Stations add routing to ordinary work. The office's hand-off limits, retries
// and the owner's answers still apply, on the same migrated database as the office.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { and, eq, isNull } from 'drizzle-orm';
import { asks, followUps, planLimits, staff } from '../src/schema.ts';
import { db } from './pglite.ts';

process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { saveWorkflow, startWorkflow, continueStations, workflowBoard } =
  await import('../src/workflow-stations.ts');
const { startFollowUp, finishFollowUp } = await import('../src/office-follow-ups.ts');
const { decideAsk } = await import('../src/office.ts');
await db.insert(staff).values(
  ['lead', 'maker', 'reviewer'].map((id) => ({
    id,
    name: id,
    role: id === 'lead' ? 'Office Manager' : 'Tester',
    web: id !== 'reviewer',
    permission: 'draft' as const,
    desk: id,
    remit: id,
    variant: 'a',
    portrait: 'a'
  }))
);
const route = [
  { name: 'Production', odd: 'maker', doneWhen: 'There is a draft.' },
  { name: 'QA', odd: 'reviewer', doneWhen: 'The draft passes.', reviseTo: 0 }
];
async function queued(thread: number) {
  return db
    .select()
    .from(followUps)
    .where(and(eq(followUps.threadId, thread), isNull(followUps.startedAt)));
}
test('a retry starts one job, and an edited template leaves its station conditions intact', async () => {
  const template = await saveWorkflow('Editorial', route);
  const key = randomUUID();
  await Promise.all([
    startWorkflow(template.id, 'Write', key),
    startWorkflow(template.id, 'Write', key)
  ]);
  await assert.rejects(startWorkflow(template.id, 'Different job', key));
  await saveWorkflow(
    'Edited',
    [route[0], { ...route[1], doneWhen: 'A different rule.' }],
    template.id
  );
  const { jobs } = await workflowBoard();
  const job = jobs.find((j) => j.workflowId === template.id)!;
  assert.equal(jobs.filter((j) => j.workflowId === template.id).length, 1);
  assert.equal(job.stations[1].doneWhen, route[1].doneWhen);
  const [first] = await queued(job.thread.id);
  assert.equal(first.handOff?.station, 0);
  assert.deepEqual(first.handOff?.kept, ['the web']);
  const doing = await startFollowUp(first.id);
  assert.ok(doing);
  await finishFollowUp(doing, 'Production', 'done', 'Saved the draft.');
  const [result] = await queued(job.thread.id);
  const pickup = await startFollowUp(result.id);
  assert.ok(pickup);
  assert.equal((await continueStations(pickup))?.outcome, 'done');
  await continueStations(pickup);
  const [qa, ...extra] = await queued(job.thread.id);
  assert.equal(extra.length, 0);
  assert.equal(qa.staffId, 'reviewer');
  assert.equal(qa.handOff?.station, 1);
  assert.match(qa.handOff!.brief, /The draft passes/);
});

test('the ordinary usage hold resumes the same first station once', async () => {
  await db.insert(planLimits).values({
    id: 'claude',
    fiveHour: 0.94,
    sevenDay: 0,
    fiveHourResetsAt: new Date(Date.now() + 3600000)
  });
  const template = await saveWorkflow('Held', route);
  await startWorkflow(template.id, 'Held job', randomUUID());
  const job = (await workflowBoard()).jobs.find((j) => j.workflowId === template.id)!;
  assert.equal(job.thread.held, true);
  assert.equal((await queued(job.thread.id)).length, 0);
  const [window] = await db.select().from(asks).where(eq(asks.kind, 'window'));
  await decideAsk(window.id, 'approve', null);
  const [wake] = await queued(job.thread.id);
  assert.equal(wake.kind, 'resume');
  const resume = await startFollowUp(wake.id);
  assert.ok(resume);
  const result = await continueStations(resume);
  assert.equal(result?.outcome, 'done');
  await finishFollowUp(resume, 'resume', result!.outcome, result!.text);
  const [first, ...extra] = await queued(job.thread.id);
  assert.equal(extra.length, 0);
  assert.equal(first.handOff?.station, 0);
  assert.equal(first.staffId, 'maker');
});
