// A service's stored tools kept in step with what it lists now: the tool list,
// what Read only reaches, what each tool does, each standing yes to a tool
// the service dropped or redescribed, and Ask first carried to the tools that
// may replace one.
import { and, eq } from 'drizzle-orm';
import { db } from './db.ts';
import { connectors, grants } from './schema.ts';
import { GRANT_LABEL, LEVEL_LABEL, POSTAL_ID, settingsTab } from './access-words.ts';
import { staffer } from './office-staff.ts';
import { record } from './office-ledger.ts';

/** Each tool's description, by name, from a tools/list. */
export const notesOf = (tools: { name: string; description?: string }[]): Record<string, string> =>
  Object.fromEntries(tools.map((t) => [t.name, t.description?.trim() ?? '']));

/** A tool as its service lists it now, and whether a Read only grant reaches it (`readsOnly`, or the service's role). */
export type ListedTool = { name: string; description?: string; readOnly: boolean };

/** What a refresh changed in a connector's stored tools (`refreshTools`). */
export type ToolChanges = {
  added: string[];
  gone: string[];
  /** Tools a Read only grant reaches now, and ones it no longer does. */
  read: string[];
  unread: string[];
  /** Whether any tool's description changed. */
  notes: boolean;
  /**
   * Each Odd that lost a standing yes, with those tools, and why: the service
   * dropped them, or changed what it says they do.
   */
  standing: { staffId: string; tools: string[]; why: 'gone' | 'changed' }[];
  /**
   * Each Odd with an Ask first tool the service dropped (`from`) while it added
   * tools that change something (`to`), which now ask first too.
   */
  askFirst: { staffId: string; from: string[]; to: string[] }[];
};

/** Whether a refresh changed anything the owner sees. */
export const toolsChanged = (ch: ToolChanges): boolean =>
  !!(ch.added.length || ch.gone.length || ch.read.length || ch.unread.length || ch.notes);

/** A refresh's changes in a few words for the owner, or that nothing changed. */
export function changesSaid(ch: ToolChanges): string {
  const said = [
    ch.added.length && `${ch.added.length} new`,
    ch.gone.length && `${ch.gone.length} gone`,
    (ch.read.length || ch.unread.length) && `${GRANT_LABEL.read} changed`,
    ch.notes && !ch.added.length && 'descriptions changed'
  ].filter(Boolean);
  return said.length ? `Tools updated: ${said.join(', ')}.` : 'Up to date.';
}

const sameNotes = (a: Record<string, string>, b: Record<string, string>): boolean =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([k, v]) => b[k] === v);

const NONE: ToolChanges = {
  added: [],
  gone: [],
  read: [],
  unread: [],
  notes: false,
  standing: [],
  askFirst: []
};

/**
 * Bring a connector's stored tools up to date with what its service lists
 * now: the tool list, what Read only reaches (the same rule as connecting,
 * both ways), and what each tool does. A tool the service dropped leaves each
 * Odd's standing yes, so a new tool by that name waits for the owner's yes,
 * and so does one whose description changed, since the owner said yes to what
 * it did. A dropped tool stays on Ask first, and since a service that renames
 * a tool drops one name and adds another, the tools it added that change
 * something ask first too: a rename never lets a high-risk tool through.
 * Writes, and says so in the Ledger, only when something changed. Each run
 * that lists the tools calls it, and so do the owner's Refresh and their
 * opening its actions on the Settings tab (the office's access.ts), never a
 * timer: a service no run uses changes nothing the office does. Physical mail keeps
 * the three reads the office picked at setup (`bindPostalMailbox`).
 */
export async function refreshTools(id: string, listed: ListedTool[]): Promise<ToolChanges> {
  if (id === POSTAL_ID) return NONE;
  const names = listed.map((t) => t.name);
  const reads = listed.filter((t) => t.readOnly).map((t) => t.name);
  const notes = notesOf(listed);
  const done = await db.transaction(async (tx) => {
    // Locked, so two runs that start at once record a change once.
    const [c] = await tx.select().from(connectors).where(eq(connectors.id, id)).for('update');
    if (!c) return undefined;
    const ch: ToolChanges = {
      added: names.filter((t) => !c.tools.includes(t)),
      gone: c.tools.filter((t) => !names.includes(t)),
      read: reads.filter((t) => !c.readTools.includes(t)),
      unread: c.readTools.filter((t) => !reads.includes(t)),
      notes: !sameNotes(notes, c.toolNotes),
      standing: [],
      askFirst: []
    };
    const addedChanges = ch.added.filter((t) => !reads.includes(t));
    // A description stored before, now different; a first one is no change of mind.
    const redescribed = names.filter((t) => t in c.toolNotes && c.toolNotes[t] !== notes[t]);
    if (!ch.added.length && !ch.gone.length && !ch.read.length && !ch.unread.length && !ch.notes)
      return { c, ch };
    await tx
      .update(connectors)
      .set({ tools: names, readTools: reads, toolNotes: notes })
      .where(eq(connectors.id, id));
    if (ch.gone.length || redescribed.length)
      for (const g of await tx.select().from(grants).where(eq(grants.connectorId, id))) {
        const gone = g.standing.filter((t) => ch.gone.includes(t));
        const changed = g.standing.filter((t) => redescribed.includes(t));
        const lost = [...gone, ...changed];
        const firm = g.askFirst.filter((t) => ch.gone.includes(t));
        const to = firm.length ? addedChanges.filter((t) => !g.askFirst.includes(t)) : [];
        if (!lost.length && !to.length) continue;
        await tx
          .update(grants)
          .set({
            standing: g.standing.filter((t) => !lost.includes(t)),
            askFirst: [...g.askFirst, ...to]
          })
          .where(and(eq(grants.staffId, g.staffId), eq(grants.connectorId, id)));
        if (gone.length) ch.standing.push({ staffId: g.staffId, tools: gone, why: 'gone' });
        if (changed.length)
          ch.standing.push({ staffId: g.staffId, tools: changed, why: 'changed' });
        if (to.length) ch.askFirst.push({ staffId: g.staffId, from: firm, to });
      }
    return { c, ch };
  });
  if (!done) return NONE;
  const { c, ch } = done;
  const them = (n: string[]) => (n.length === 1 ? 'it' : 'them');
  if (ch.added.length || ch.gone.length)
    await record({
      kind: 'access',
      actor: 'office',
      title: [
        ch.added.length && `${c.name} added ${ch.added.join(', ')}`,
        ch.gone.length &&
          `${ch.added.length ? 'dropped' : `${c.name} dropped`} ${ch.gone.join(', ')}`
      ]
        .filter(Boolean)
        .join(', and '),
      body: `The office reads ${c.name}'s tools on each run that uses it, when you open its actions on the Settings tab, and on your Refresh. ${GRANT_LABEL.act} reaches a new tool at once.`
    });
  // A tool the service dropped leaves Read only with it; only a mark that changed is news.
  const unread = ch.unread.filter((t) => !ch.gone.includes(t));
  if (unread.length)
    await record({
      kind: 'access',
      actor: 'office',
      title: `${GRANT_LABEL.read} for ${c.name} no longer reaches ${unread.join(', ')}`,
      body: `${c.name} does not mark ${them(unread)} as only reading, or the name says ${unread.length === 1 ? 'it changes' : 'they change'} something. ${GRANT_LABEL.act} reaches ${them(unread)}: at ${LEVEL_LABEL.draft} each use waits for your yes, and at ${LEVEL_LABEL.act} it goes.`
    });
  if (ch.read.length)
    await record({
      kind: 'access',
      actor: 'office',
      title: `${GRANT_LABEL.read} for ${c.name} now reaches ${ch.read.join(', ')}`,
      body: `${c.name} marks ${them(ch.read)} as only reading, and the name says no change.`
    });
  for (const s of ch.standing) {
    const who = (await staffer(s.staffId))?.name ?? s.staffId;
    const one = s.tools.length === 1;
    await record({
      kind: 'access',
      actor: 'office',
      title: `${who} asks again before using ${s.tools.join(', ')} in ${c.name}`,
      body:
        s.why === 'gone'
          ? `${c.name} no longer lists ${them(s.tools)}, so a tool that comes back by that name waits for your yes.`
          : `${c.name} changed what it says ${one ? 'it does' : 'they do'}, so each call waits for your yes again. If ${one ? 'it still only prepares' : 'they still only prepare'} a change, let ${who} use ${them(s.tools)} without asking again on ${settingsTab(`${who}'s`)}, under Services.`
    });
  }
  for (const m of ch.askFirst) {
    const who = (await staffer(m.staffId))?.name ?? m.staffId;
    await record({
      kind: 'access',
      actor: 'office',
      title: `Moved ${who}'s Ask first in ${c.name} to ${m.to.join(', ')}`,
      body: `${c.name} no longer lists ${m.from.join(', ')}, which you set to ask first, and added ${m.to.join(', ')}. It may be the same tool under a new name, so ${m.to.length === 1 ? 'it asks' : 'they ask'} first too. Change it on ${settingsTab(`${who}'s`)}, under Services.`
    });
  }
  return ch;
}
