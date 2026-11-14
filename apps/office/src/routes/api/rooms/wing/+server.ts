// The owner puts a room in a wing they name, like Work or School, or takes it
// out (a blank wing) to make it common space. The ledger records the change.
import { error, json } from '@sveltejs/kit';
import { roomNamesFor, setRoomWing } from '@oddboro/ledger';
import { currentOffice } from '#lib/server/space.ts';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { room?: unknown; wing?: unknown };
  if (typeof b.room !== 'string' || typeof b.wing !== 'string') error(400, 'Nothing to save');
  const office = await currentOffice();
  const room = office.world.rooms.find((r) => r.id === b.room);
  if (!room || room.sign === false) error(404, 'No such room');
  const name = (await roomNamesFor(office.id))[room.id] ?? room.name;
  try {
    return json({ wing: await setRoomWing(office.id, room.id, b.wing, name) });
  } catch (e) {
    error(400, e instanceof Error ? e.message : String(e));
  }
};
