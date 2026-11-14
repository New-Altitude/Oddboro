// An Odd's home: the rooms and seats the page lists, the home it suggests for
// a hire, and the seat check the routes make. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlacedSpot } from '@oddboro/world';
import { homeRooms, seatProblem, suggestHome } from './home.ts';

const spot = (id: string, room: string, x: number, activity = 'work', prop = 'desk') =>
  ({ id, room, prop, activity, tile: [x, 2] }) as unknown as PlacedSpot;
const SPOTS = [
  spot('workspace#0/desk#1/seat', 'workspace#0', 4),
  spot('workspace#0/desk#0/seat', 'workspace#0', 2),
  spot('library#0/library-table#0/seat', 'library#0', 9, 'read', 'library-table'),
  spot('mail-room#0/mail-sort-table#0/seat', 'mail-room#0', 12, 'intake', 'mail-sort-table'),
  spot('kitchen#0/kitchen-table#0/seat-0', 'kitchen#0', 15, 'eat', 'kitchen-table')
];
const WORLD = {
  rooms: [
    { id: 'workspace#0', name: 'Studio' },
    { id: 'library#0', name: 'Library' },
    { id: 'mail-room#0', name: 'Mail room' },
    { id: 'kitchen#0', name: 'Kitchen' }
  ]
} as Parameters<typeof homeRooms>[0];

test('a room lists its seats left to right, numbered, with whose each is', () => {
  const staff = [{ id: 'ivy', name: 'Ivy', room: 'workspace', seat: 'workspace#0/desk#1/seat' }];
  const rooms = homeRooms(WORLD, SPOTS, staff);
  assert.deepEqual(
    rooms.map((r) => r.id),
    ['workspace', 'library', 'mail-room'],
    'a kitchen has no seat to live at'
  );
  assert.deepEqual(rooms[0], {
    id: 'workspace',
    place: 'workspace#0',
    name: 'Studio',
    seats: [
      { id: 'workspace#0/desk#0/seat', label: 'Desk 1' },
      { id: 'workspace#0/desk#1/seat', label: 'Desk 2', owner: { id: 'ivy', name: 'Ivy' } }
    ]
  });
});

test('a hire lives where its role belongs, at a free seat, with why', () => {
  const staff = [{ id: 'ivy', name: 'Ivy', room: 'workspace', seat: 'workspace#0/desk#0/seat' }];
  const rooms = homeRooms(WORLD, SPOTS, staff);
  assert.deepEqual(suggestHome({ role: 'Inbox triage' }, rooms, staff), {
    room: 'mail-room',
    seat: 'mail-room#0/mail-sort-table#0/seat',
    why: 'A room for sorting what comes in.'
  });
  assert.equal(suggestHome({ role: 'Research assistant' }, rooms, staff)?.room, 'library');
  assert.deepEqual(suggestHome({ role: 'Product designer' }, rooms, staff), {
    room: 'workspace',
    seat: 'workspace#0/desk#1/seat',
    why: 'A workspace, with desks to work at. Sits with Ivy.'
  });
});

test('an Odd already living in a room is never its own roommate', () => {
  const staff = [
    { id: 'ivy', name: 'Ivy', room: 'library', seat: 'library#0/library-table#0/seat' }
  ];
  const s = suggestHome({ id: 'ivy', role: 'Researcher' }, homeRooms(WORLD, SPOTS, staff), staff);
  assert.equal(s?.room, 'library');
  assert.equal(s?.seat, 'library#0/library-table#0/seat');
  assert.equal(s?.why, 'A room for research and reading.');
});

test('a role whose room is full goes to a workspace, and says so', () => {
  const staff = [
    { id: 'max', name: 'Max', room: 'mail-room', seat: 'mail-room#0/mail-sort-table#0/seat' }
  ];
  const s = suggestHome({ role: 'Mail clerk' }, homeRooms(WORLD, SPOTS, staff), staff);
  assert.equal(s?.room, 'workspace');
  assert.equal(s?.why, 'No room for sorting what comes in has a free seat, so a workspace.');
});

test('a seat is a home only in its own room, and only when nobody else has it', () => {
  const staff = [{ id: 'ivy', name: 'Ivy', room: 'workspace', seat: 'workspace#0/desk#0/seat' }];
  assert.equal(seatProblem(SPOTS, 'workspace', 'workspace#0/desk#1/seat', staff), undefined);
  assert.equal(
    seatProblem(SPOTS, 'workspace', 'workspace#0/desk#0/seat', staff),
    "That is Ivy's seat"
  );
  assert.equal(seatProblem(SPOTS, 'workspace', 'workspace#0/desk#0/seat', staff, 'ivy'), undefined);
  assert.equal(
    seatProblem(SPOTS, 'library', 'workspace#0/desk#1/seat', staff),
    'Pick a seat in that room'
  );
  assert.equal(
    seatProblem(SPOTS, 'kitchen', 'kitchen#0/kitchen-table#0/seat-0', staff),
    'Pick a seat in that room'
  );
});
