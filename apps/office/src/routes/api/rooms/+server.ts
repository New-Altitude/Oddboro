// The owner's rooms. PUT renames one from the floor: a blank name puts back
// the one the floor plan starts it with. POST adds a workspace or a meeting
// room at once, with no drawing, and every Odd keeps its home (`addRoom`). The ledger
// records each change.
import { error, json } from '@sveltejs/kit';
import { renameRoom, roomNamesFor } from '@oddboro/ledger';
import { LIMITS } from '@oddboro/world';
import { ADDABLE, addRoom } from '#lib/server/rooms.ts';
import { currentOffice } from '#lib/server/space.ts';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { room?: unknown; name?: unknown };
  if (typeof b.room !== 'string' || typeof b.name !== 'string') error(400, 'Nothing to save');
  const office = await currentOffice();
  const room = office.world.rooms.find((r) => r.id === b.room);
  if (!room || room.sign === false) error(404, 'No such room');
  const was = (await roomNamesFor(office.id))[room.id] ?? room.name;
  try {
    return json({ name: await renameRoom(office.id, room.id, b.name, { was, start: room.name }) });
  } catch (e) {
    error(400, e instanceof Error ? e.message : String(e));
  }
};

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    seats?: unknown;
    side?: unknown;
    row?: unknown;
    kind?: unknown;
  };
  const kind = ADDABLE.find((k) => k === b.kind) ?? 'workspace';
  const side = b.side === 'west' || b.side === 'east' ? b.side : undefined;
  const row = b.row === 'back' || b.row === 'front' ? b.row : undefined;
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  const seats = typeof b.seats === 'number' ? Math.round(b.seats) : 0;
  if (!name) error(400, 'Name the room');
  if (name.length > LIMITS.roomName) error(400, `Keep the name to ${LIMITS.roomName} characters`);
  if (kind === 'workspace' && (seats < 1 || seats > LIMITS.seatsPerRoom))
    error(400, `Give it 1 to ${LIMITS.seatsPerRoom} desks`);
  try {
    return json({ room: await addRoom(kind, name, { side, row }, seats) });
  } catch (e) {
    error(400, e instanceof Error ? e.message : String(e));
  }
};
