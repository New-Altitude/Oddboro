// Dates an Odd reads, such as a goal's progress, fall on the office's day,
// not the UTC one. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { officeDay, setZone } from '../src/time.ts';

test('an evening in New York is still that day, though it is tomorrow in UTC', () => {
  setZone('America/New_York');
  // 8:30 PM ET on Nov 3 is 01:30 UTC on Nov 4.
  assert.equal(officeDay(new Date('2026-11-04T01:30:00Z')), '2026-11-03');
});

test('a morning in Tokyo is already that day, though it is yesterday in UTC', () => {
  setZone('Asia/Tokyo');
  assert.equal(officeDay(new Date('2026-11-03T20:00:00Z')), '2026-11-04');
});
