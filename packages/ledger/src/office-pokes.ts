// Pokes the Odds set for later, the props the owner switches off, and the names
// the owner gives the rooms.
import { and, asc, eq, lte } from 'drizzle-orm';
import { db } from './db.ts';
import { fixedError } from './errors.ts';
import { pokes, roomNames, roomWings, switchedOff } from './schema.ts';
import type { PokeRow } from './office.ts';
import { ofWorkingOdd } from './office-staff.ts';
import { record } from './office-ledger.ts';

// Pokes

/** A poke can be set this far ahead at most. */
const POKE_HORIZON_MS = 7 * 24 * 3_600_000;

/**
 * Set a poke. One per staffer per minute: a new one at the same minute
 * replaces the message, so a job that runs twice does not poke twice.
 */
export async function schedulePoke(staffId: string, at: Date, message: string): Promise<PokeRow> {
  const minute = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
  // The minute under way still counts: a poke for it goes out right away.
  if (minute.getTime() + 60_000 <= Date.now()) throw fixedError('That time has passed.');
  if (minute.getTime() > Date.now() + POKE_HORIZON_MS)
    throw fixedError('A poke can be at most 7 days ahead.');
  const [same] = await db
    .select()
    .from(pokes)
    .where(and(eq(pokes.staffId, staffId), eq(pokes.at, minute), eq(pokes.status, 'waiting')));
  if (same) {
    const [row] = await db.update(pokes).set({ message }).where(eq(pokes.id, same.id)).returning();
    return row;
  }
  const [row] = await db.insert(pokes).values({ staffId, at: minute, message }).returning();
  return row;
}

/** A staffer's pokes still to come, soonest first. */
export async function waitingPokes(staffId?: string): Promise<PokeRow[]> {
  return db
    .select()
    .from(pokes)
    .where(
      and(
        eq(pokes.status, 'waiting'),
        staffId ? eq(pokes.staffId, staffId) : undefined,
        ofWorkingOdd(pokes.staffId)
      )
    )
    .orderBy(asc(pokes.at));
}

/** Pokes that landed and the owner has not read yet, counted by staffer. */
export async function unreadPokes(): Promise<Record<string, number>> {
  const rows = await db.select().from(pokes).where(eq(pokes.status, 'sent'));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.staffId] = (out[r.staffId] ?? 0) + 1;
  return out;
}

/** The owner opened a staffer's chat: their pokes that landed are read. */
export async function readPokes(staffId: string): Promise<number> {
  const unread = await db
    .select({ id: pokes.id })
    .from(pokes)
    .where(and(eq(pokes.staffId, staffId), eq(pokes.status, 'sent')));
  // Nothing to mark: no write, so no change event goes out to every page.
  if (!unread.length) return 0;
  await db
    .update(pokes)
    .set({ status: 'read' })
    .where(and(eq(pokes.staffId, staffId), eq(pokes.status, 'sent')));
  return unread.length;
}

/** Cancel a waiting poke; with `staffId`, only one of that staffer's own. */
export async function cancelPoke(id: number, staffId?: string): Promise<boolean> {
  const rows = await db
    .update(pokes)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(pokes.id, id),
        eq(pokes.status, 'waiting'),
        staffId ? eq(pokes.staffId, staffId) : undefined
      )
    )
    .returning();
  return rows.length > 0;
}

/** The owner wants a waiting poke now: it comes due, and the office clock delivers it. */
export async function pokeNow(id: number): Promise<boolean> {
  const rows = await db
    .update(pokes)
    .set({ at: new Date() })
    .where(and(eq(pokes.id, id), eq(pokes.status, 'waiting')))
    .returning();
  return rows.length > 0;
}

/**
 * Claim a due poke for delivery: sent, or missed when it is too late to be
 * worth saying (the Mac slept through it). Only one caller wins a poke.
 */
export async function claimPoke(id: number, late: boolean): Promise<PokeRow | undefined> {
  const [row] = await db
    .update(pokes)
    .set({ status: late ? 'missed' : 'sent', sentAt: new Date() })
    .where(and(eq(pokes.id, id), eq(pokes.status, 'waiting'), lte(pokes.at, new Date())))
    .returning();
  return row;
}

/** The props the owner switched off in an office. */
export async function switchedOffIn(office: string): Promise<string[]> {
  const rows = await db.select().from(switchedOff).where(eq(switchedOff.office, office));
  return rows.map((r) => r.obj);
}

/** Switch a prop on or off. Switching it to the state it is in changes nothing. */
export async function setSwitch(office: string, obj: string, on: boolean): Promise<void> {
  if (on)
    await db
      .delete(switchedOff)
      .where(and(eq(switchedOff.office, office), eq(switchedOff.obj, obj)));
  else await db.insert(switchedOff).values({ office, obj }).onConflictDoNothing();
}

/** The wing each room of an office is in, by room id. A room with none is common space. */
export async function roomWingsFor(office: string): Promise<Record<string, string>> {
  const rows = await db.select().from(roomWings).where(eq(roomWings.office, office));
  return Object.fromEntries(rows.map((r) => [r.room, r.wing]));
}

/**
 * Put a room in a wing the owner names, or none (a blank wing) to make it
 * common space again. `room` is the room's name, for the ledger line.
 */
export async function setRoomWing(
  office: string,
  roomId: string,
  wing: string,
  room: string
): Promise<string> {
  const next = wing.trim().replace(/\s+/g, ' ');
  if (next.length > 24) throw fixedError('Keep a wing name to 24 characters');
  const [was] = await db
    .select()
    .from(roomWings)
    .where(and(eq(roomWings.office, office), eq(roomWings.room, roomId)));
  if ((was?.wing ?? '') === next) return next;
  if (!next)
    await db.delete(roomWings).where(and(eq(roomWings.office, office), eq(roomWings.room, roomId)));
  else
    await db
      .insert(roomWings)
      .values({ office, room: roomId, wing: next })
      .onConflictDoUpdate({
        target: [roomWings.office, roomWings.room],
        set: { wing: next, updatedAt: new Date() }
      });
  await record({
    kind: 'work',
    actor: 'owner',
    title: next ? `Put ${room} in the ${next} wing` : `Made ${room} common space`
  });
  return next;
}

/**
 * Carry wings over to a layout that names its rooms anew, by room id there.
 * Part of the move, whose ledger line covers it.
 */
export async function carryWings(office: string, wings: Record<string, string>): Promise<void> {
  const rows = Object.entries(wings).map(([room, wing]) => ({ office, room, wing }));
  if (rows.length) await db.insert(roomWings).values(rows).onConflictDoNothing();
}

/** The names the owner gave an office's rooms, by room id. */
export async function roomNamesFor(office: string): Promise<Record<string, string>> {
  const rows = await db.select().from(roomNames).where(eq(roomNames.office, office));
  return Object.fromEntries(rows.map((r) => [r.room, r.name]));
}

/**
 * Rename a room. `was` is the name it shows now and `start` the name its floor
 * plan gives it; a blank name, or the plan's own, goes back to the start.
 */
export async function renameRoom(
  office: string,
  room: string,
  name: string,
  names: { was: string; start: string }
): Promise<string> {
  const next = name.trim().replace(/\s+/g, ' ') || names.start;
  if (next.length > 40) throw fixedError('Keep a room name to 40 characters');
  if (next === names.was) return next;
  if (next === names.start)
    await db.delete(roomNames).where(and(eq(roomNames.office, office), eq(roomNames.room, room)));
  else
    await db
      .insert(roomNames)
      .values({ office, room, name: next })
      .onConflictDoUpdate({
        target: [roomNames.office, roomNames.room],
        set: { name: next, updatedAt: new Date() }
      });
  await record({ kind: 'work', actor: 'owner', title: `Renamed ${names.was} to ${next}` });
  return next;
}
