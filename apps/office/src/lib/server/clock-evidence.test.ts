// Drive the existing clock through a failed read and its next successful check.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, mock, test } from 'node:test';
import { runtimeSummary } from '../../../../../packages/ledger/src/runtime.ts';
const bus = new EventEmitter();
let fail = true;
const runtime = await import('../../../../../packages/ledger/src/runtime.ts');
mock.module('@oddboro/ledger', {
  exports: {
    ...runtime,
    enabledJobs: async () => {
      if (fail) throw new Error('Fixture database offline');
      return [];
    },
    waitingPokes: async () => [],
    parkedThreads: async () => [],
    closeStaleRuns: async () => {},
    claimScheduledRun: async () => undefined,
    finishRun: async () => {},
    job: async () => undefined,
    nextRun: () => new Date(),
    setNextRun: async () => {},
    startRun: async () => undefined,
    wakeThread: async () => {}
  }
});
mock.module(new URL('./events.ts', import.meta.url).href, { exports: { bus, listen: () => {} } });
mock.module(new URL('./staff.ts', import.meta.url).href, {
  exports: { deliverPoke: async () => {}, runJob: async () => {} }
});
mock.module(new URL('./update.ts', import.meta.url).href, { exports: { held: () => false } });
const { startClock } = await import('./jobs.ts');
after(() => {
  mock.timers.reset();
});

test('a failed clock read leaves one retry and records the next successful check', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  const stop = startClock();
  // Drain async reads without advancing the scheduled retry.
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(runtimeSummary().clockState, 'failed');
  fail = false;
  mock.timers.tick(30_000);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(runtimeSummary().clockState, 'checked');
  assert.equal(runtimeSummary().clock?.checkedAt, 130_000);
  stop();
  assert.equal(runtimeSummary().clockState, 'stopped');
});
