// The owner's schedule limits, as the page's schedule reaches the server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEDULE_RULE } from '@oddboro/ledger/time';
import { parseSchedule } from './schedule.ts';

const { ownerMinMinutes: least, ownerMaxMinutes: most } = SCHEDULE_RULE;
const every = (n: number) => parseSchedule({ every: 'minutes', n });

test('the owner cannot set a job more often than the owner minimum or less often than the owner maximum, or at a time that is not on the clock', () => {
  assert.equal(every(least - 1), null);
  assert.deepEqual(every(least), { every: 'minutes', n: least });
  assert.deepEqual(every(most), { every: 'minutes', n: most });
  assert.equal(every(most + 1), null);
  assert.deepEqual(parseSchedule({ every: 'day', at: '23:59' }), { every: 'day', at: '23:59' });
  for (const at of ['24:00', '7:00', '07:60', 'noon'])
    assert.equal(parseSchedule({ every: 'day', at }), null, at);
});
