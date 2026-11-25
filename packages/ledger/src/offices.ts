// Office layouts. The owner describes an office, the office draws it, and
// moving in makes it the one everybody works in. A change to a layout saves
// over it and keeps the version before, so the owner can undo it. Other
// layouts stay, to move back to, until the owner removes them.
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DrawnArt } from '@oddboro/sprites/art';
import type { FloorPlan, OfficeSpec, RoomKind, RoomTemplate } from '@oddboro/world';
import { db } from './db.ts';
import { record } from './office.ts';
import { art, officeRooms, offices, roomNames, staff, type OfficeVersion } from './schema.ts';

export type OfficeRow = typeof offices.$inferSelect;

/** What a layout's room names and seats are kept under. The sample uses its plan id. */
export const layoutKey = (id: number) => `office-${id}`;

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
      movedInAt: offices.movedInAt,
      canUndo: sql<boolean>`${offices.previous} is not null`
    })
    .from(offices)
    .orderBy(desc(offices.createdAt));
}

const versionOf = (o: OfficeRow): OfficeVersion => ({
  name: o.name,
  description: o.description,
  spec: o.spec,
  plan: o.plan,
  templates: o.templates,
  kinds: o.kinds
});

/**
 * Keep a drawn layout. It is not the office until the owner moves in. With
 * `id`, the drawing is a change to that layout and saves over it, so its room
 * names and where everybody sat stay with it, and the version before is kept
 * to undo the change. A layout removed meanwhile is kept as a new one.
 */
export async function saveOffice(
  o: {
    description: string;
    spec: OfficeSpec;
    plan: FloorPlan;
    templates: Record<string, RoomTemplate>;
    kinds: Record<string, RoomKind>;
  },
  id?: number
): Promise<OfficeRow> {
  const values = { ...o, name: o.plan.name };
  if (id !== undefined) {
    const was = await officeLayout(id);
    if (was) {
      const [row] = await db
        .update(offices)
        .set({ ...values, previous: versionOf(was) })
        .where(eq(offices.id, id))
        .returning();
      return row;
    }
  }
  const [row] = await db.insert(offices).values(values).returning();
  return row;
}

/**
 * Undo a layout's last change: the version before comes back, and the one it
 * replaces is kept, so undoing again redoes the change. Returns the layout as
 * it is now, or undefined when there is nothing to undo.
 */
export async function undoOffice(id: number): Promise<OfficeRow | undefined> {
  const was = await officeLayout(id);
  if (!was?.previous) return undefined;
  const [row] = await db
    .update(offices)
    .set({ ...was.previous, previous: versionOf(was) })
    .where(eq(offices.id, id))
    .returning();
  return row;
}

/**
 * Remove a layout the owner is not in, with its room names and seats. Art
 * drawn for it stays in the library. Returns its name, or undefined when
 * there is no such layout or the owner is in it.
 */
export async function removeOffice(id: number): Promise<string | undefined> {
  const key = layoutKey(id);
  const name = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(offices)
      .where(and(eq(offices.id, id), eq(offices.active, false)))
      .returning({ name: offices.name });
    if (!row) return undefined;
    await tx.delete(officeRooms).where(eq(officeRooms.office, key));
    await tx.delete(roomNames).where(eq(roomNames.office, key));
    return row.name;
  });
  if (name) await record({ kind: 'work', actor: 'owner', title: `Removed the layout ${name}` });
  return name;
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
};

/**
 * Make a layout the office, or go back to the sample. `title` is the ledger's
 * line for it when moving in is not the news, like a change or an undo. Staff whose room is not
 * in it, or has no seat left, move to the work room with the most free seats.
 * Returns who moved where.
 */
export async function moveIn(
  from: string,
  to: Destination,
  title = `Moved the office into ${to.name}`
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
      moved.push({ name: p.name, room: to.rooms[room]?.name ?? room });
    }
  });
  await record({
    kind: 'work',
    actor: 'owner',
    title,
    ...(moved.length
      ? { body: moved.map((m) => `${m.name} now works in ${m.room}.`).join('\n') }
      : {})
  });
  return { moved };
}
