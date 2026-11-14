// Office layouts. The owner describes an office, the office draws it, and
// moving in makes it the one everybody works in. Earlier layouts stay, so
// the owner can move back.
import { desc, eq, isNull } from 'drizzle-orm';
import type { DrawnArt } from '@oddboro/sprites/art';
import type { FloorPlan, OfficeSpec, RoomKind, RoomTemplate } from '@oddboro/world';
import { db } from './db.ts';
import { record } from './office.ts';
import { art, officeRooms, offices, staff } from './schema.ts';

export type OfficeRow = typeof offices.$inferSelect;

/** The office everybody works in, or undefined while the install still uses the sample. */
export async function activeOffice(): Promise<OfficeRow | undefined> {
  const [row] = await db.select().from(offices).where(eq(offices.active, true)).limit(1);
  return row;
}

/** Every layout, newest first, without the heavy plan. */
export async function officeLayouts() {
  return db
    .select({
      id: offices.id,
      name: offices.name,
      description: offices.description,
      active: offices.active,
      createdAt: offices.createdAt,
      movedInAt: offices.movedInAt
    })
    .from(offices)
    .orderBy(desc(offices.createdAt));
}

/** Keep a drawn layout. It is not the office until the owner moves in. */
export async function saveOffice(o: {
  description: string;
  spec: OfficeSpec;
  plan: FloorPlan;
  templates: Record<string, RoomTemplate>;
  kinds: Record<string, RoomKind>;
}): Promise<OfficeRow> {
  const [row] = await db
    .insert(offices)
    .values({ ...o, name: o.plan.name })
    .returning();
  return row;
}

/** Everything the office has drawn for itself, oldest first. */
export async function drawnArt(): Promise<DrawnArt[]> {
  const rows = await db.select().from(art).orderBy(art.createdAt);
  return rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    about: r.about,
    px: r.px,
    ...(r.place ? { place: r.place } : {}),
    ...(r.replaces ? { replaces: r.replaces } : {}),
    ...(r.ramp ? { ramp: r.ramp } : {})
  }));
}

const ART_WORDS: Record<DrawnArt['kind'], string> = {
  prop: 'a new prop',
  'wall-prop': 'something new for the walls',
  'desk-prop': 'something new for the desks',
  floor: 'a new floor',
  wall: 'a new wall style'
};

/** Keep the art a layout asked for. The ledger notes each new piece. */
export async function saveArt(list: DrawnArt[], drawnFor: number): Promise<void> {
  for (const a of list) {
    const [kept] = await db
      .insert(art)
      .values({
        ...a,
        place: a.place ?? null,
        replaces: a.replaces ?? null,
        ramp: a.ramp ?? null,
        drawnFor
      })
      .onConflictDoNothing()
      .returning({ name: art.name });
    if (kept)
      await record({
        kind: 'work',
        actor: 'office',
        title: `Drew ${ART_WORDS[a.kind]}: ${a.name.replaceAll('-', ' ')}`,
        body: a.px
      });
  }
}

export async function officeLayout(id: number): Promise<OfficeRow | undefined> {
  const [row] = await db.select().from(offices).where(eq(offices.id, id));
  return row;
}

/** Where the office moves to: a layout, or the sample plan when `id` is null. */
export type Destination = {
  id: number | null;
  /** The key the office's room names and rooms are kept under. */
  key: string;
  name: string;
  /** Room template id to the room's name and whether it is a workspace. */
  rooms: Record<string, { name: string; desks: boolean }>;
  /** Work seats in each room. */
  seats: Record<string, number>;
  /** Every seat an Odd can call home there, by spot id. */
  spots: string[];
};

/**
 * Make a layout the office, or go back to the sample. Staff whose room is not
 * in it, or has no seat left, move to the work room with the most free seats.
 * Returns who moved where.
 */
export async function moveIn(
  from: string,
  to: Destination
): Promise<{ moved: { name: string; room: string }[] }> {
  const { seats } = to;
  const moved: { name: string; room: string }[] = [];
  await db.transaction(async (tx) => {
    await tx.update(offices).set({ active: false }).where(eq(offices.active, true));
    if (to.id !== null)
      await tx
        .update(offices)
        .set({ active: true, movedInAt: new Date() })
        .where(eq(offices.id, to.id));
    const people = await tx.select().from(staff).where(isNull(staff.leftAt));
    const now = Object.fromEntries(people.map((p) => [p.id, p.room]));
    await tx
      .insert(officeRooms)
      .values({ office: from, rooms: now })
      .onConflictDoUpdate({
        target: officeRooms.office,
        set: { rooms: now, updatedAt: new Date() }
      });
    // Everybody works in the one office, and the card says which.
    await tx.update(staff).set({ office: to.name }).where(isNull(staff.leftAt));
    // Moving back: everybody starts where they worked last time.
    const [before] = await tx.select().from(officeRooms).where(eq(officeRooms.office, to.key));
    for (const p of people) {
      const was = before?.rooms[p.id];
      if (was && to.seats[was] && was !== p.room) {
        await tx.update(staff).set({ room: was }).where(eq(staff.id, p.id));
        p.room = was;
      }
    }
    // Everybody keeps their room while it has a seat for them; the rest move.
    const taken: Record<string, number> = {};
    const movers = people.filter((p) => {
      if ((taken[p.room] ?? 0) >= (seats[p.room] ?? 0)) return true;
      taken[p.room] = (taken[p.room] ?? 0) + 1;
      return false;
    });
    const free = (r: string) => seats[r] - (taken[r] ?? 0);
    const desks = (r: string) => Number(!!to.rooms[r]?.desks);
    for (const p of movers) {
      // A desk first, then any room with a seat, the emptiest first. With
      // every seat full, the biggest workspace takes one more.
      const room = Object.keys(seats).sort(
        (a, b) =>
          Number(free(b) > 0) - Number(free(a) > 0) || desks(b) - desks(a) || free(b) - free(a)
      )[0];
      if (!room) break;
      taken[room] = (taken[room] ?? 0) + 1;
      if (room === p.room) continue;
      await tx.update(staff).set({ room }).where(eq(staff.id, p.id));
      p.room = room;
      moved.push({ name: p.name, room: to.rooms[room]?.name ?? room });
    }
    // A home seat stays only where the new floor still has it, in the room
    // its Odd works in now: adding a room keeps everyone's seat.
    const stays = new Set(to.spots);
    for (const p of people)
      if (p.seat && (!stays.has(p.seat) || p.seat.split('#')[0] !== p.room))
        await tx.update(staff).set({ seat: null }).where(eq(staff.id, p.id));
  });
  await record({
    kind: 'work',
    actor: 'owner',
    title: `Moved the office into ${to.name}`,
    ...(moved.length
      ? { body: moved.map((m) => `${m.name} now works in ${m.room}.`).join('\n') }
      : {})
  });
  return { moved };
}
