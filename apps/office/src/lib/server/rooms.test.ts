// Adding a workspace at once, with no drawing: on Main Street, which becomes
// the owner's own office with the same rooms and names, and then on that
// office. Every Odd keeps its room and seat by name. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { L, currentOffice } from './office-under-test.ts';

const { addRoom, addWorkspace } = await import('./rooms.ts');
const { homeRooms } = await import('../staff/home.ts');

/** Every Odd's home, as room name and seat label. */
async function homesInWords() {
  const office = await currentOffice();
  const staff = await L.roster();
  const rooms = homeRooms(office.world, office.world.spots, staff);
  return Object.fromEntries(
    staff.map((p) => {
      const room = rooms.find((r) => r.id === p.room);
      return [p.id, `${room?.name}, ${room?.seats.find((s) => s.id === p.seat)?.label ?? 'any'}`];
    })
  );
}

test('Main Street takes a new workspace and every Odd keeps its home', async () => {
  const office = await currentOffice();
  assert.equal(office.id, 'main-street');
  // Sam lives at the lobby's reception; the rest anywhere in their rooms.
  const reception = office.world.spots.find((s) => s.prop === 'lobby-reception')!;
  await L.pg`update staff set room = 'lobby', seat = ${reception.id} where id = 'sam'`;
  const before = await homesInWords();
  const room = await addWorkspace('Product team', 3);
  const now = await currentOffice();
  assert.notEqual(now.id, 'main-street', 'Main Street became a layout of its own');
  const added = now.world.rooms.find((r) => r.name === 'Product team');
  assert.equal(room, added?.id.split('#')[0]);
  assert.equal(
    now.world.spots.filter((s) => s.room === added?.id && s.activity === 'work').length,
    3
  );
  assert.deepEqual(await homesInWords(), before);
});

test('a described office takes another where the owner placed it, and refuses a name a room has', async () => {
  const before = await homesInWords();
  const room = await addWorkspace('Studio', 2, { side: 'west', row: 'front' });
  assert.deepEqual(await homesInWords(), before);
  const office = await currentOffice();
  const placed = office.world.rooms.find((r) => r.id.split('#')[0] === room)!;
  const rooms = office.world.rooms.filter((r) => r.sign !== false);
  const row = rooms.filter((r) => r.y === placed.y);
  assert.equal(Math.min(...row.map((r) => r.x)), placed.x, 'the westmost of its row');
  assert.ok(placed.y > Math.min(...rooms.map((r) => r.y)), 'in the front row, not the back');
  await assert.rejects(addWorkspace('studio', 2), /already has that name/);
});

test('a meeting room goes in at once, with seats to meet at, and no one moves', async () => {
  const before = await homesInWords();
  const room = await addRoom('meeting', 'Huddle', { row: 'front' });
  const office = await currentOffice();
  const placed = office.world.rooms.find((r) => r.id.split('#')[0] === room)!;
  assert.equal(placed.name, 'Huddle');
  assert.equal(
    office.world.spots.filter((s) => s.room === placed.id && s.activity === 'meet').length,
    4
  );
  assert.deepEqual(await homesInWords(), before);
});
