// What Home says about each Odd under Who's around. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setZone } from '@oddboro/ledger/time';
import type { Work } from '#lib/staff/work.ts';
import { aroundLine } from './phone-home.ts';

setZone('America/New_York');
const now = new Date('2026-11-13T19:41:00Z');
const work = (w: Partial<Work>): Work => ({
  id: 1,
  kind: 'job',
  label: 'Planning the Q1 goal',
  detail: '',
  since: '2026-11-13T19:37:00Z',
  queued: false,
  steps: 0,
  ...w
});

test('an Odd at work shows what and for how long', () => {
  assert.deepEqual(aroundLine({ work: [work({})], waiting: true }, now), {
    presence: 'working',
    line: 'Planning the Q1 goal · 4 min'
  });
});

test('work still waiting for a slot does not count as working', () => {
  assert.deepEqual(aroundLine({ work: [work({ queued: true })], waiting: true }, now), {
    presence: 'waiting',
    line: 'Waiting on you'
  });
});

test('a chat the floor says it runs counts as working', () => {
  assert.deepEqual(aroundLine({ working: 'Chatting', waiting: false }, now), {
    presence: 'working',
    line: 'Chatting'
  });
});

test('a free Odd names its next job, or just says free', () => {
  assert.deepEqual(aroundLine({ waiting: false, next: '2026-11-13T22:00:00Z' }, now), {
    presence: 'free',
    line: 'Free · next job today at 5:00 PM'
  });
  assert.deepEqual(aroundLine({ waiting: false }, now), { presence: 'free', line: 'Free' });
});
