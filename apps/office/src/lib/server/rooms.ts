// Adding a workspace to the office, at once and with no drawing. A described
// office takes it in its spec. Main Street, the sample, is a hand-drawn plan
// with no spec, so it becomes the owner's own office first: the same rooms,
// names and desk counts, built by the office's own rules. Either way every Odd
// keeps its home, matched by room name and seat label, since a rebuilt floor
// names its rooms and seats anew.
import {
  activeOffice,
  carryHomes,
  carryWings,
  roomNamesFor,
  roomWingsFor,
  roster,
  type OfficeRow
} from '@oddboro/ledger';
import type { OfficeSpec, RoomSpec, World } from '@oddboro/world';
import { moveInto } from './move-in.ts';
import { currentOffice } from './space.ts';
import { homeRooms } from '../staff/home.ts';

/** The kind of each Main Street room, by its template. Any `workspace…` is a workspace. */
const SAMPLE_KIND: Record<string, RoomSpec['kind']> = {
  'owner-office': 'office',
  lobby: 'lobby',
  'mail-room': 'mail',
  'break-room': 'break',
  kitchen: 'kitchen',
  library: 'library',
  gym: 'gym'
};

/** Main Street as a spec: its rooms in order, by the names the owner gave them. */
export function sampleSpec(name: string, world: World, names: Record<string, string>): OfficeSpec {
  const rooms: RoomSpec[] = [];
  for (const r of world.rooms) {
    if (r.sign === false) continue;
    const t = r.id.split('#')[0];
    const kind = t.startsWith('workspace') ? 'workspace' : SAMPLE_KIND[t];
    if (!kind) continue;
    const desks = world.spots.filter((s) => s.room === r.id && s.activity === 'work').length;
    rooms.push({
      kind,
      name: names[r.id] ?? r.name,
      ...(kind === 'workspace' ? { seats: desks } : {})
    });
  }
  return { name, wall: 'plaster', floor: 'oak', grounds: 'park', rooms };
}

/** Every room an Odd can live in, by the names the owner sees. */
async function homesNow() {
  const office = await currentOffice();
  const names = await roomNamesFor(office.id);
  const wings = await roomWingsFor(office.id);
  const rooms = office.world.rooms.map((r) => ({
    ...r,
    name: names[r.id] ?? r.name,
    wing: wings[r.id]
  }));
  return { office, names, rooms, homes: homeRooms({ rooms }, office.world.spots, await roster()) };
}

/** Where the owner wants a new room: an end of the building, a row, both or neither. */
export type Placement = Pick<RoomSpec, 'side' | 'row'>;

/** The kinds of room the owner adds at once: a workspace with desks, or a meeting room. */
export const ADDABLE = ['workspace', 'meeting'] as const;
export type Addable = (typeof ADDABLE)[number];

/**
 * Add a workspace named `name` with `seats` desks, where the owner placed it.
 * Returns its room id once moved in.
 */
export function addWorkspace(name: string, seats: number, at: Placement = {}) {
  return addRoom('workspace', name, at, seats);
}

/**
 * Add a room of `kind` named `name` where the owner placed it: a workspace
 * with `seats` desks, or a meeting room. Returns its room id once moved in.
 */
export async function addRoom(
  kind: Addable,
  name: string,
  at: Placement = {},
  seats = 4
): Promise<string | undefined> {
  const active: OfficeRow | undefined = await activeOffice();
  const before = await homesNow();
  if (before.homes.some((r) => r.name.toLowerCase() === name.toLowerCase()))
    throw new Error('A room already has that name');
  const staff = await roster();
  // Where each Odd lives now, in words that survive a rebuild.
  const was = staff.map((p) => {
    const room = before.homes.find((r) => r.id === p.room);
    return { id: p.id, room: room?.name, seat: room?.seats.find((s) => s.id === p.seat)?.label };
  });
  const base = active?.spec ?? sampleSpec(before.office.name, before.office.world, before.names);
  const room: RoomSpec = { kind, name, ...(kind === 'workspace' ? { seats } : {}), ...at };
  const spec = { ...base, rooms: [...base.rooms, room] };
  const said = active?.description ?? `${before.office.name}, as it was.`;
  const what =
    kind === 'workspace' ? `a workspace, ${name}, with ${seats} desks` : `a meeting room, ${name}`;
  await moveInto(spec, [], `${said}\nThen: add ${what}.`);
  const after = await homesNow();
  // Each room keeps its wing, found again by its name.
  const wings: Record<string, string> = {};
  for (const r of before.rooms) {
    const there = r.wing && after.rooms.find((x) => x.name === r.name);
    if (there && !there.wing) wings[there.id] = r.wing!;
  }
  await carryWings(after.office.id, wings);
  const now = await roster();
  const back = was.flatMap((w) => {
    const room = after.homes.find((r) => r.name === w.room);
    if (!room) return [];
    const seat = room.seats.find((s) => s.label === w.seat)?.id ?? null;
    const p = now.find((x) => x.id === w.id);
    return p && (p.room !== room.id || p.seat !== seat) ? [{ id: w.id, room: room.id, seat }] : [];
  });
  if (back.length) await carryHomes(back);
  return after.rooms.find((r) => r.name === name)?.id.split('#')[0];
}
