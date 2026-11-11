// A result on existing jobs, shared by its delivery and owner-action checks.
import type { ResultDestination } from '@oddboro/ledger';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { L, gave } from './office-under-test.ts';
export async function resultFixture(
  destination: ResultDestination = { kind: 'desk' },
  stage = true
) {
  const { thread } = await gave('lead', 'paige', { title: 'Synthetic daily result' });
  const producer = await L.addJob({
    staffId: 'lead',
    name: 'Write source',
    instructions: 'Write source.',
    schedule: { every: 'day', at: '01:00' },
    files: { thread, output: 'source.md' }
  });
  const reviewer = await L.addJob({
    staffId: 'paige',
    name: 'Review source',
    instructions: 'Review source.',
    schedule: { every: 'day', at: '02:00' },
    files: { thread, input: 'lead/source.md', output: 'edition.md' }
  });
  const input = {
    producerId: producer.id,
    reviewerId: reviewer.id,
    responsibleId: 'paige',
    title: 'Daily edition',
    deadline: '23:59',
    zone: 'UTC',
    repairs: 2,
    destination
  };
  const plan = await L.saveScheduledResult(input);
  await L.ensureEditions(plan, new Date());
  const path = join(L.threadPart(thread, 'paige'), 'edition.md');
  const source = join(L.threadPart(thread, 'lead'), 'source.md');
  const text = 'Verified synthetic edition.\n';
  const sha = createHash('sha256').update(text).digest('hex');
  for (const f of [path, source]) {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  const future = new Date(Date.now() + 3600000);
  await L.setNextRun(producer.id, future);
  await L.setNextRun(reviewer.id, future);
  const produce = async (ok = true) => {
    const r = await L.startRun(producer, 'schedule');
    await L.finishRun(
      r,
      producer,
      ok,
      ok ? 'Written' : 'Failed',
      ok ? { output: 'lead/source.md', sha256: sha } : undefined
    );
    return r;
  };
  const review = async (run: number, ok = true) => {
    const r = await L.startRun(reviewer, 'schedule');
    await L.finishRun(
      r,
      reviewer,
      ok,
      ok ? 'Reviewed' : 'Review failed',
      ok
        ? { input: 'lead/source.md', inputRun: run, output: 'paige/edition.md', sha256: sha }
        : undefined
    );
    return r;
  };
  if (stage) {
    const p = await produce();
    await review(p.id);
  }
  const edition = async () => (await L.editionsFor(plan.id))[0];
  return { plan, input, producer, reviewer, path, source, text, sha, produce, review, edition };
}
