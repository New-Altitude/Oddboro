// Homes for the Odds. POST asks the office where Odds should live, from their
// roles and remits: every Odd, or the one hire being made (`hire`). It keeps
// nothing. PUT moves the Odds the owner accepted, all at once, so two can
// swap seats; the ledger records the moves.
import { error, json } from '@sveltejs/kit';
import { roomNamesFor, roomWingsFor, roster, setHomes } from '@oddboro/ledger';
import { recommendHomes, type Placing } from '#lib/server/homes.ts';
import { currentOffice } from '#lib/server/space.ts';
import { homeRooms, seatProblem } from '#lib/staff/home.ts';
import type { RequestHandler } from './$types';

/** Every room an Odd can live in, by the names the owner gave them. */
async function rooms() {
  const office = await currentOffice();
  const staff = await roster();
  const names = await roomNamesFor(office.id);
  const wings = await roomWingsFor(office.id);
  const named = office.world.rooms.map((r) => ({
    ...r,
    name: names[r.id] ?? r.name,
    wing: wings[r.id]
  }));
  return { office, staff, homes: homeRooms({ rooms: named }, office.world.spots, staff) };
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { hire?: Record<string, unknown> };
  const { staff, homes } = await rooms();
  const odds: Placing[] = b.hire
    ? [
        {
          id: 'new',
          name: text(b.hire.name, 40) || 'The new hire',
          role: text(b.hire.role, 60),
          remit: text(b.hire.remit, 200)
        }
      ]
    : staff.map((p) => ({ id: p.id, name: p.name, role: p.role, remit: p.remit }));
  if (b.hire && !odds[0].role) error(400, 'Give the hire a role first');
  return json(await recommendHomes(odds, homes, staff));
};

export const PUT: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { homes?: unknown };
  if (!Array.isArray(b.homes) || !b.homes.length) error(400, 'Nothing to move');
  const { office, staff, homes } = await rooms();
  const moves = (b.homes as Record<string, unknown>[]).map((h) => ({
    id: text(h.id, 80),
    room: text(h.room, 80),
    seat: text(h.seat, 200) || null
  }));
  // The seats every Odd holds once all of these have moved.
  const after = staff.map((p) => {
    const m = moves.find((x) => x.id === p.id);
    return m ? { ...p, room: m.room, seat: m.seat } : p;
  });
  const words: string[] = [];
  for (const m of moves) {
    if (!staff.some((p) => p.id === m.id)) error(404, 'No such Odd');
    const room = homes.find((r) => r.id === m.room);
    if (!room) error(400, 'Pick a room with a place to work');
    const wrong = m.seat && seatProblem(office.world.spots, room.id, m.seat, after, m.id);
    if (wrong) error(400, wrong);
    const label = room.seats.find((s) => s.id === m.seat)?.label;
    words.push(label ? `${label} in ${room.name}` : room.name);
  }
  await setHomes(moves.map((m, i) => ({ ...m, words: words[i] })));
  return json({ ok: true });
};
