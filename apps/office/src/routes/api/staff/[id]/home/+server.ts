// The owner gives an Odd a new home: a room on the floor, and a seat there or
// none for any free one. The ledger records the move.
import { error, json } from '@sveltejs/kit';
import { roomNamesFor, roster, setHome } from '@oddboro/ledger';
import { currentOffice } from '#lib/server/space.ts';
import { homeRooms, seatProblem } from '#lib/staff/home.ts';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request }) => {
  const b = (await request.json().catch(() => ({}))) as { room?: unknown; seat?: unknown };
  if (typeof b.room !== 'string') error(400, 'Pick a room');
  const seat = typeof b.seat === 'string' && b.seat ? b.seat : null;
  const office = await currentOffice();
  const staff = await roster();
  if (!staff.some((p) => p.id === params.id)) error(404, 'No such Odd');
  // The names the owner gave the rooms, as the floor shows them.
  const names = await roomNamesFor(office.id);
  const rooms = office.world.rooms.map((r) => ({ ...r, name: names[r.id] ?? r.name }));
  const room = homeRooms({ rooms }, office.world.spots, staff).find((r) => r.id === b.room);
  if (!room) error(400, 'Pick a room with a place to work');
  const wrong = seat && seatProblem(office.world.spots, room.id, seat, staff, params.id);
  if (wrong) error(400, wrong);
  const label = room.seats.find((s) => s.id === seat)?.label;
  await setHome(
    params.id,
    { room: room.id, seat },
    { room: room.name, ...(label ? { seat: label } : {}) }
  );
  return json({ ok: true });
};
