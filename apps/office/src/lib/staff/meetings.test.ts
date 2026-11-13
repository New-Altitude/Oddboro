// Odds on one piece of work at once meet in a meeting room, and only then.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlacedSpot } from '@oddboro/world';
import { meetingRooms } from './meetings.ts';

const seats = (room: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${room}/t/seat-${i}`, room, activity: 'meet' })).map(
    (s) => s as unknown as PlacedSpot
  );
const ROOMS = [...seats('meeting-room#0', 2), ...seats('meeting-room#1', 4)];
const thread = (hubId: string, holderId: string) => ({ title: `${hubId}'s work`, hubId, holderId });
const all = { spots: ROOMS, working: () => true, waits: () => false };

test('a lead and the colleague running its work meet in the first room that seats them', () => {
  assert.deepEqual(meetingRooms([thread('rowan', 'ivy')], all), {
    rowan: 'meeting-room#0',
    ivy: 'meeting-room#0'
  });
});

test('a second meeting takes the next room, never the same table', () => {
  const m = meetingRooms([thread('rowan', 'ivy'), thread('max', 'paige')], all);
  assert.equal(m.max, 'meeting-room#1');
  assert.equal(m.paige, 'meeting-room#1');
});

test('nobody meets while the colleague is not running, or one of them waits on the owner', () => {
  assert.deepEqual(meetingRooms([thread('rowan', 'ivy')], { ...all, working: () => false }), {});
  assert.deepEqual(
    meetingRooms([thread('rowan', 'ivy')], { ...all, waits: (id) => id === 'rowan' }),
    {}
  );
});

test('an office with no meeting room holds no meetings', () => {
  assert.deepEqual(meetingRooms([thread('rowan', 'ivy')], { ...all, spots: [] }), {});
});

test('an Odd sits in one meeting at a time', () => {
  const m = meetingRooms([thread('rowan', 'ivy'), thread('rowan', 'paige')], all);
  assert.deepEqual(Object.keys(m).sort(), ['ivy', 'rowan']);
});
