// An Odd's home on the floor: the room it works in and its own seat there.
// The page lists every room an Odd can live in with its seats, and suggests
// a home for a new hire from its role, with one line of why. Plain rules, no
// run: the same words always suggest the same room.
import type { PlacedSpot, World } from '@oddboro/world';
import { propLabel } from './places.ts';

/** The spot activities an Odd works at, so a seat it can call home. */
const SEAT_ACTIVITIES = new Set(['work', 'intake', 'read']);

export type HomeSeat = {
  /** The floor's spot id, kept as `staff.seat`. */
  id: string;
  /** "Desk 2": the prop's name and its number in the room, front row first. */
  label: string;
  /** The Odd whose home seat it is, if any. */
  owner?: { id: string; name: string };
};

export type HomeRoom = {
  /** The room template id, kept as `staff.room`. */
  id: string;
  name: string;
  seats: HomeSeat[];
};

type Who = { id: string; name: string; room: string; seat?: string | null };

/** The template a placed room comes from: `workspace#0` is `workspace`. */
export const templateOf = (room: string) => room.split('#')[0];

/**
 * Every room an Odd can live in, with its seats in reading order. `world`
 * carries the names the owner gave the rooms; `spots` are the office's own.
 */
export function homeRooms(world: Pick<World, 'rooms'>, spots: PlacedSpot[], staff: Who[]) {
  const out = new Map<string, HomeRoom>();
  const seats = spots
    .filter((s) => SEAT_ACTIVITIES.has(s.activity))
    .sort((a, b) => a.tile[1] - b.tile[1] || a.tile[0] - b.tile[0]);
  for (const s of seats) {
    const id = templateOf(s.room);
    const room = out.get(id) ?? {
      id,
      name: world.rooms.find((r) => r.id === s.room)?.name ?? id,
      seats: []
    };
    out.set(id, room);
    const label = propLabel(s.prop);
    const n = room.seats.filter((x) => x.label.startsWith(`${label} `)).length + 1;
    const owner = staff.find((p) => p.seat === s.id);
    room.seats.push({
      id: s.id,
      label: `${label} ${n}`,
      ...(owner ? { owner: { id: owner.id, name: owner.name } } : {})
    });
  }
  return [...out.values()];
}

/**
 * What kind of work each room kind is home to, by the words in a role. The
 * first rule that matches wins; anything else lives in a workspace.
 */
const RULES: { kind: string; words: RegExp; why: string }[] = [
  {
    kind: 'mail',
    words: /\b(mail|inbox|intake|triage|post|bookkeep\w*|admin\w*|schedul\w*|calendar)\b/i,
    why: 'sorting what comes in'
  },
  {
    kind: 'library',
    words: /\b(research\w*|read\w*|tutor\w*|study|school|course\w*|learn\w*|teach\w*)\b/i,
    why: 'research and reading'
  },
  {
    kind: 'lobby',
    words: /\b(reception\w*|front desk|greet\w*|concierge)\b/i,
    why: 'meeting people at the front'
  }
];

/** The kind a room template is, by its id: `mail-room` is mail, `workspace-east` a workspace. */
const kindOf = (room: string) => room.split('-')[0];

export type Suggestion = { room: string; seat?: string; why: string };

/**
 * A home for a new hire: the room its role belongs in, the emptiest of that
 * kind, and its first free seat, with one line of why. Undefined when no
 * room has a seat at all.
 */
export function suggestHome(
  hire: { role: string; remit?: string },
  rooms: HomeRoom[],
  staff: Who[]
): Suggestion | undefined {
  const words = `${hire.role} ${hire.remit ?? ''}`;
  const rule = RULES.find((r) => r.words.test(words));
  const free = (r: HomeRoom) => r.seats.filter((s) => !s.owner).length;
  const live = (r: HomeRoom) => staff.filter((p) => p.room === r.id).length;
  const emptiest = (list: HomeRoom[]) =>
    [...list].sort((a, b) => free(b) - free(a) || live(a) - live(b))[0];
  const fits = rule ? rooms.filter((r) => kindOf(r.id) === rule.kind && free(r) > 0) : [];
  const workspaces = rooms.filter((r) => kindOf(r.id) === 'workspace' && free(r) > 0);
  const room = emptiest(fits) ?? emptiest(workspaces) ?? emptiest(rooms.filter((r) => free(r)));
  if (!room) return undefined;
  const seat = room.seats.find((s) => !s.owner);
  const mates = staff.filter((p) => p.room === room.id).map((p) => p.name);
  const reason = fits.includes(room)
    ? `A room for ${rule!.why}.`
    : rule
      ? `No room for ${rule.why} has a free seat, so a workspace.`
      : 'A workspace, with desks to work at.';
  const company = mates.length
    ? ` Sits with ${mates.slice(0, 2).join(' and ')}${mates.length > 2 ? ` and ${mates.length - 2} more` : ''}.`
    : '';
  return { room: room.id, ...(seat ? { seat: seat.id } : {}), why: reason + company };
}

/**
 * Why a seat cannot be an Odd's home in `room`, or undefined when it can: a
 * seat Odds work at, in that room, and nobody else's home. The hire route and
 * the home route both ask, so the page's lists are never the only check.
 */
export function seatProblem(
  spots: PlacedSpot[],
  room: string,
  seat: string,
  staff: Who[],
  self?: string
): string | undefined {
  const spot = spots.find((s) => s.id === seat);
  if (!spot || !SEAT_ACTIVITIES.has(spot.activity) || templateOf(spot.room) !== room)
    return 'Pick a seat in that room';
  const owner = staff.find((p) => p.seat === seat && p.id !== self);
  if (owner) return `That is ${owner.name}'s seat`;
  return undefined;
}
