// A move in saves over the layout the owner is in, so a Claude that sends the
// office again (with new art, say) never makes a twin. `new: true` adds another
// layout, and a move in from the sample always adds one, since the sample is
// never written over. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLOORS, GROUNDS, WALLS, type OfficeSpec } from '@oddboro/world';
import { L, request } from './office-under-test.ts';

const spec = (name: string): OfficeSpec => ({
  name,
  wall: WALLS[0],
  floor: FLOORS[0],
  grounds: GROUNDS[0],
  rooms: [
    { kind: 'lobby', name: 'Lobby' },
    { kind: 'office', name: 'Owner' },
    { kind: 'workspace', name: 'Desks', seats: 4 },
    { kind: 'kitchen', name: 'Kitchen' }
  ]
});

const moveIn = async (body: Record<string, unknown>) => {
  const res = await request('/api/office/move-in', 'POST', {
    body: { description: 'An office.', ...body }
  });
  assert.equal(res.status, 200, await res.clone().text());
};
const layouts = async () =>
  (await L.officeLayouts())
    .map((l) => [l.name, l.active])
    .sort((a, b) => `${a}`.localeCompare(`${b}`));

test('a move in from the sample adds a layout, and the sample stays', async () => {
  await moveIn({ spec: spec('Station') });
  assert.deepEqual(await layouts(), [['Station', true]]);
});

test('a move in that names no layout saves over the one the owner is in', async () => {
  const [was] = await L.pg<{ id: number }[]>`select id from offices where active`;
  await moveIn({ spec: spec('Station, with art') });
  assert.deepEqual(await layouts(), [['Station, with art', true]]);
  const [now] = await L.pg<{ id: number }[]>`select id from offices where active`;
  assert.equal(now.id, was.id, 'the same layout, not a twin');
  assert.equal(
    (await L.pg`select 1 from ledger where title = 'Changed Station, with art'`).length,
    1,
    'the ledger says the layout changed'
  );
});

test('new: true adds another layout and moves into it', async () => {
  await moveIn({ spec: spec('Annex'), new: true });
  assert.deepEqual(await layouts(), [
    ['Annex', true],
    ['Station, with art', false]
  ]);
});
