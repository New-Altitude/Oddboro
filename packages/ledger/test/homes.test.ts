// An Odd's home seat: moving several at once lets two swap, and a move into
// another layout keeps each seat that layout still has, in the room the Odd
// works in, and drops the rest. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { db } from './pglite.ts';

const { staff } = await import('../src/schema.ts');
const O = await import('../src/office.ts');
const { moveIn } = await import('../src/offices.ts');

const odd = (name: string, seat: string) => ({
  name,
  role: 'Writer',
  remit: 'Writing.',
  variant: 'a',
  portrait: 'a',
  desk: `You are ${name}.`,
  room: 'workspace',
  seat
});
const seatOf = async (id: string) =>
  (await db.select().from(staff).where(eq(staff.id, id)))[0].seat;

test('two Odds swap seats in one move, with one ledger line', async () => {
  const a = await O.hire(odd('Ada', 'workspace#0/desk#0/seat'));
  const b = await O.hire(odd('Bo', 'workspace#0/desk#1/seat'));
  await O.setHomes([
    { id: a.id, room: 'workspace', seat: 'workspace#0/desk#1/seat', words: 'Desk 2 in Studio' },
    { id: b.id, room: 'workspace', seat: 'workspace#0/desk#0/seat', words: 'Desk 1 in Studio' }
  ]);
  assert.equal(await seatOf(a.id), 'workspace#0/desk#1/seat');
  assert.equal(await seatOf(b.id), 'workspace#0/desk#0/seat');
});

test('a new layout keeps the seats it still has and drops the rest', async () => {
  const keep = await O.hire(odd('Cy', 'workspace#0/desk#5/seat'));
  const gone = await O.hire(odd('Di', 'workspace#0/desk#9/seat'));
  await moveIn('main-street', {
    id: null,
    key: 'main-street',
    name: 'Main Street',
    rooms: { workspace: { name: 'Studio', desks: true } },
    seats: { workspace: 12 },
    spots: ['workspace#0/desk#5/seat']
  });
  assert.equal(await seatOf(keep.id), 'workspace#0/desk#5/seat');
  assert.equal(await seatOf(gone.id), null);
});

test('a room goes in a wing the owner names, and back to common space', async () => {
  assert.equal(await O.setRoomWing('office-1', 'workspace#0', '  Work ', 'Studio'), 'Work');
  assert.deepEqual(await O.roomWingsFor('office-1'), { 'workspace#0': 'Work' });
  assert.equal(await O.setRoomWing('office-1', 'workspace#0', '', 'Studio'), '');
  assert.deepEqual(await O.roomWingsFor('office-1'), {});
  await assert.rejects(O.setRoomWing('office-1', 'workspace#0', 'x'.repeat(25), 'Studio'));
});

test('wings carry over to a rebuilt layout, without replacing ones it has', async () => {
  await O.setRoomWing('office-2', 'library#3', 'School', 'Library');
  await O.carryWings('office-2', { 'library#3': 'Hobbies', 'workspace#1': 'Work' });
  assert.deepEqual(await O.roomWingsFor('office-2'), {
    'library#3': 'School',
    'workspace#1': 'Work'
  });
});
