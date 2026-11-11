// An Odd's own schedule limit, held to SCHEDULE_RULE: edit_my_job through the
// real tool server (tool-server.ts), in a chat where the owner asked for the
// change. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db, toolServer } from './tool-server.ts';

const { eq } = await import('drizzle-orm');
const { jobs, staff } = await import('../src/schema.ts');
const { SCHEDULE_RULE } = await import('../src/time.ts');

await db.insert(staff).values({
  id: 'sam',
  name: 'Sam',
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Sam.',
  tools: ['edit_my_job']
});
const daily = { every: 'day', at: '09:00' } as const;
await db
  .insert(jobs)
  .values({ staffId: 'sam', name: 'Tidy', instructions: 'Tidy up.', schedule: daily });

test('an Odd cannot set a job to run more often than the Odd minimum', async () => {
  const c = await toolServer('sam', { RUN_KEY: 'k-sam', OWNER_SAID: 'Sam, run Tidy more often.' });
  const every = (n: number) =>
    c.callTool({
      name: 'edit_my_job',
      arguments: { job: 'Tidy', schedule: { every: 'minutes', n } }
    });
  const schedule = async () =>
    (await db.select().from(jobs).where(eq(jobs.staffId, 'sam')))[0].schedule;

  const tooOften = await every(SCHEDULE_RULE.oddMinMinutes - 1);
  assert.equal(tooOften.isError, true);
  assert.deepEqual(await schedule(), daily);

  const atTheMinimum = await every(SCHEDULE_RULE.oddMinMinutes);
  assert.equal(atTheMinimum.isError, undefined);
  assert.deepEqual(await schedule(), { every: 'minutes', n: SCHEDULE_RULE.oddMinMinutes });
});
