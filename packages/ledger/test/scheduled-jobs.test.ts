// Due times, completed runs and old files survive retries without duplicate work.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db, sql } from './pglite.ts';
import { staff } from '../src/schema.ts';

process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const O = await import('../src/office.ts');
await db.insert(staff).values({
  id: 'writer',
  name: 'Writer',
  role: 'Editor',
  remit: 'Prepare an edition.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'Prepare the edition.'
});

test('two clocks claim one due time and a repeated finish keeps one result', async () => {
  const job = await O.addJob({
    staffId: 'writer',
    name: 'Edition',
    instructions: 'Write it.',
    schedule: { every: 'minutes', n: 15 },
    report: true
  });
  await O.setNextRun(job.id, new Date(Date.now() - 1000));
  const due = (await O.job(job.id))!;
  const claims = (
    await Promise.all([O.claimScheduledRun(due, new Date()), O.claimScheduledRun(due, new Date())])
  ).filter((r) => !!r);
  assert.equal(claims.length, 1);
  await O.finishRun(claims[0], due, true, 'The first result.');
  await O.finishRun(claims[0], due, false, 'A late failure.');
  const [saved] = await sql<{
    status: string;
    summary: string;
  }>`select status, summary from runs where id = ${claims[0].id}`;
  assert.equal(saved.status, 'done');
  assert.equal(saved.summary, 'The first result.');
  const reports =
    await sql`select id from reports where title = 'Edition' and body = 'The first result.'`;
  assert.equal(reports.length, 1);
  assert.equal((await sql`select id from ledger where run_id = ${claims[0].id}`).length, 1);
});

test('an edited job cannot be claimed from an older clock view', async () => {
  const job = await O.addJob({
    staffId: 'writer',
    name: 'Wire',
    instructions: 'Write it.',
    schedule: { every: 'minutes', n: 15 }
  });
  await O.setNextRun(job.id, new Date(Date.now() - 1000));
  const due = (await O.job(job.id))!;
  await sql`update jobs set instructions = 'Changed by owner', changed_at = changed_at + interval '1 second' where id = ${job.id}`;
  assert.equal(await O.claimScheduledRun(due, new Date()), undefined);
  assert.equal((await O.job(job.id))!.instructions, 'Changed by owner');
  assert.equal((await sql`select id from runs where job_id = ${job.id}`).length, 0);
});
