// The app's update row: the owner's window, the version the shell has ready,
// when it installs, and when the app last went down for one and came back.
// The office server is the only writer. When it installs is decided in
// update-window.ts.
import { eq } from 'drizzle-orm';
import { db } from './db.ts';
import { appUpdate } from './schema.ts';

export type UpdateRow = typeof appUpdate.$inferSelect;

const ROW = eq(appUpdate.id, 'app');

/** The one row, made with the default window the first time. */
export async function updateRow(): Promise<UpdateRow> {
  const [row] = await db.select().from(appUpdate).where(ROW);
  if (row) return row;
  const [made] = await db.insert(appUpdate).values({}).onConflictDoNothing().returning();
  return made ?? (await db.select().from(appUpdate).where(ROW))[0];
}

async function change(set: Partial<UpdateRow>): Promise<UpdateRow> {
  await updateRow();
  const [row] = await db
    .update(appUpdate)
    .set({ ...set, updatedAt: new Date() })
    .where(ROW)
    .returning();
  return row;
}

/** The owner's window, as "HH:MM" in office time. */
export function setUpdateWindow(start: string, end: string): Promise<UpdateRow> {
  return change({ windowStart: start, windowEnd: end });
}

/**
 * The shell has a version downloaded and checked. It installs at `installAt`,
 * or, while that is null, waits for the owner to say when.
 */
export function setReadyUpdate(
  version: string,
  notes: string,
  installAt: Date | null
): Promise<UpdateRow> {
  return change({ readyVersion: version, readyNotes: notes, readyAt: new Date(), installAt });
}

/** When the owner said to install, or null when they said wait. */
export function setInstallAt(installAt: Date | null): Promise<UpdateRow> {
  return change({ installAt });
}

/** The shell was told to install: the app goes down now. */
export function markDown(): Promise<UpdateRow> {
  return change({ downAt: new Date(), upAt: null });
}

/**
 * The server started. Whatever was ready is forgotten: the shell checked again
 * as it opened, and tells the server again if it still has one. A server that
 * comes back after going down for an update records when.
 */
export async function markUp(): Promise<UpdateRow> {
  const row = await updateRow();
  return change({
    readyVersion: null,
    readyNotes: null,
    readyAt: null,
    installAt: null,
    ...(row.downAt && !row.upAt ? { upAt: new Date() } : {})
  });
}
