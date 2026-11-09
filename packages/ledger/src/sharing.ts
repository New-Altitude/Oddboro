// What an Odd sees through a thread is no wider than its own access, unless
// the owner says yes. The office cannot see where a brief's words or a
// folder's files came from, so it compares access both ways whenever work is
// handed on a thread, against every Odd on it (`lacking`). Reading: the
// colleague is told which tools others on the thread have and it lacks, so it
// does not expect their contents; a giver whose work needs them puts that to
// the owner with raise_ask first, and hands off after the yes. Writing: the
// colleague is told which of its own tools someone on the thread lacks, never
// to write their contents into its part or its reply, and to ask the owner if
// the work needs them. Tools here are outside tools, the web, and each folder
// the owner gave an Odd: all three bring in content the others may not see.
import { and, eq, inArray } from 'drizzle-orm';
import { accessOf, ownTools } from './capabilities.ts';
import { db } from './db.ts';
import { shownFolder, within } from './office.ts';
import {
  connectors,
  followUps,
  grants,
  staff,
  staffGoals,
  type HandOff,
  type HeldHandOff
} from './schema.ts';
import type { Db } from './threads.ts';

export type Tool = { id: string; name: string };
/** One tool an Odd holds, and whether its runs get it now. */
export type Held = Tool & { staffId: string; inForce: boolean };

/** A folder's id among held tools: its real path, after this. */
export const FOLDER = 'folder:';
/** The web's id among held tools. */
export const WEB = 'web';

/**
 * Every grant the given Odds hold, in force or not, then the web and each
 * folder the owner gave them. A grant is in force when `accessOf` holds
 * nothing back, the rule `capabilities` loads a run's tools by; the web and a
 * folder when `ownTools` gives a run them, so a folder deleted from the disk
 * is held but not in force.
 */
export async function heldTools(staffIds: string[], q: Db = db): Promise<Held[]> {
  const rows = await q
    .select({ grant: grants, connector: connectors, permission: staff.permission })
    .from(grants)
    .innerJoin(connectors, eq(grants.connectorId, connectors.id))
    .innerJoin(staff, eq(grants.staffId, staff.id))
    .where(inArray(grants.staffId, staffIds))
    .orderBy(connectors.name);
  const odds = await q.select().from(staff).where(inArray(staff.id, staffIds));
  return [
    ...rows.map(({ grant, connector, permission }) => ({
      staffId: grant.staffId,
      id: connector.id,
      name: connector.name,
      inForce: !accessOf({ ...grant, connector }, permission).heldBack
    })),
    ...odds.flatMap((o) => {
      const own = ownTools(o, process.platform);
      return [
        ...(o.web ? [{ staffId: o.id, id: WEB, name: 'the web', inForce: own.web }] : []),
        ...o.folders.map((f) => ({
          staffId: o.id,
          id: FOLDER + f.path,
          name: shownFolder(f.path),
          inForce: own.granted.some((g) => g.path === f.path)
        }))
      ];
    })
  ];
}

/**
 * What `reader` lacks of what the Odds in `from` hold: their tools its runs
 * do not get now. Every tool they hold counts, in force or not, since what
 * they read while a grant was in force can still be in their notes; only
 * what the reader's runs get now counts as its own. A folder the reader has
 * covers the same folder and every folder inside it.
 */
export function lacking(rows: Held[], reader: string, from: string[]): Tool[] {
  const own = rows.filter((r) => r.staffId === reader && r.inForce).map((r) => r.id);
  const covered = (id: string) =>
    own.some(
      (o) =>
        o === id ||
        (o.startsWith(FOLDER) &&
          id.startsWith(FOLDER) &&
          within(id.slice(FOLDER.length), o.slice(FOLDER.length)))
    );
  const lacks = new Map<string, Tool>();
  for (const r of rows)
    if (from.includes(r.staffId) && !covered(r.id)) lacks.set(r.id, { id: r.id, name: r.name });
  return [...lacks.values()];
}

/** The Odds on the thread a hand-off goes on: the giver, its hub, and each colleague handed work there. */
async function onThread(q: Db, from: string, threadId: number): Promise<string[]> {
  const rows = await q
    .select({ id: followUps.staffId })
    .from(followUps)
    .where(and(eq(followUps.threadId, threadId), eq(followUps.kind, 'hand_off')));
  return [...new Set([from, ...rows.map((r) => r.id)])];
}

/** Every Odd who can see files on this work, including goal assignments
 * which have not had a hand-off yet. Former hand-offs still count as readers. */
export async function fileReaders(t: { id: number; hubId: string; goalId: number | null }) {
  const on = await onThread(db, t.hubId, t.id);
  const assigned = t.goalId
    ? await db
        .select({ id: staffGoals.staffId })
        .from(staffGoals)
        .where(eq(staffGoals.goalId, t.goalId))
    : [];
  return {
    readers: new Set([...on, ...assigned.map((p) => p.id)]),
    assigned: new Set([t.hubId, ...assigned.map((p) => p.id)])
  };
}

/**
 * The hand-off from `from` to `to` on a thread as it goes now: the work, and
 * what it carries, compared with every other Odd on the thread: the tools they
 * hold and the colleague lacks (`withheld`), and the colleague's own tools
 * someone on the thread lacks (`kept`), whose contents it must not write where
 * the others read. Worked out as the hand-off starts, so a held one carries
 * access as it is at the owner's yes, not as it was when it was held.
 */
export async function sharing(q: Db, h: HeldHandOff & { threadId: number }): Promise<HandOff> {
  const others = (await onThread(q, h.from, h.threadId)).filter((id) => id !== h.to);
  const rows = await heldTools([...others, h.to], q);
  const withheld = lacking(rows, h.to, others).map((t) => t.name);
  const kept = new Map(others.flatMap((o) => lacking(rows, o, [h.to])).map((t) => [t.id, t.name]));
  return {
    from: h.from,
    title: h.title,
    brief: h.brief,
    ...(withheld.length ? { withheld } : {}),
    ...(kept.size ? { kept: [...kept.values()] } : {})
  };
}

const list = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
/** Tool names as a sentence says them: "Gmail, Slack, and Drive". */
export const toolNames = (names: string[]): string => list.format(names);
