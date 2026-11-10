// The first visit's cards. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEPS, TITLE } from './steps.ts';

test('the first visit runs six cards and asks nothing about error reports or a New Altitude sign-in', () => {
  assert.deepEqual(STEPS, ['mac', 'you', 'ai', 'manager', 'space', 'go']);
  for (const title of ['Help improve Oddboro', 'New Altitude'])
    assert.ok(!Object.values(TITLE).includes(title), title);
});
