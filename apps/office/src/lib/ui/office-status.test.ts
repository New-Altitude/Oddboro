import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oddStatus } from './office-status.ts';
import { officeLink } from './office-link.ts';

test('the strip and floor keep the same status priority for moving, messages, waiting, colleagues and work', () => {
  const busy = {
    waiting: true,
    message: 1,
    working: 'Writing the brief',
    thread: { text: 'Waiting on Wren' }
  };
  assert.equal(
    oddStatus({ ...busy, floor: { activity: 'work', heading: 'Library' } }),
    '→ Library'
  );
  assert.equal(oddStatus(busy), 'Has a message for you');
  assert.equal(oddStatus({ ...busy, message: 0 }), 'Waiting on you');
  assert.equal(oddStatus({ ...busy, message: 0, waiting: false }), 'Waiting on Wren');
  assert.equal(oddStatus({ waiting: false, working: busy.working }), 'Writing the brief');
  assert.equal(oddStatus({ waiting: false, floor: { activity: 'rest' } }), 'Taking a break');
  assert.equal(oddStatus({ waiting: false }), 'Available');
});

test('a native strip event accepts only an Odd id or Waiting', () => {
  assert.deepEqual(officeLink({ odd: 'robin-2' }), { odd: 'robin-2' });
  assert.deepEqual(officeLink({ desk: true }), { desk: true });
  for (const input of [
    null,
    '',
    {},
    { odd: '../file' },
    { odd: 'x'.repeat(81) },
    { odd: 4 },
    { desk: 1 }
  ])
    assert.equal(officeLink(input), undefined);
});
