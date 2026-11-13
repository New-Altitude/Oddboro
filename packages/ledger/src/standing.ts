// A standing yes: tools of one service an Odd uses without asking. The Odd's
// level is what it gets by default, and at Draft each call that changes
// something waits on the owner's desk. A standing yes lets calls to a few
// named tools through instead, such as one that only stages a change another
// call then makes real. Only the owner gives one: on the Settings tab
// (`setStanding`), or by saying yes to the Odd's `ask_for_standing_yes`
// (`giveStanding`). It lives on the grant (`grants.standing`), so revoking the
// grant or lowering it to read only ends it. Its mirror at Act, a tool the
// owner approves each call to first (`grants.askFirst`, `setAskFirst`), is set
// here too; an Odd never asks for that one.
import { and, eq } from 'drizzle-orm';
import { db } from './db.ts';
import { asks, grants, type StandingRequest } from './schema.ts';
import type { AskRow, GrantRow } from './office.ts';
import { connector } from './office-access.ts';
import { record } from './office-ledger.ts';
import { staffer } from './office-staff.ts';
import { fixedError } from './errors.ts';
import { LEVEL_NAME } from './access-words.ts';
import type { Tx } from './threads.ts';

/** Tools of a service in words: "add_event in Reclaim". */
export const standingSaid = (tools: string[], service: string): string =>
  `${tools.join(', ')} in ${service}`;

/**
 * The ask's title, the line the desk card shows: each tool by the name the
 * service lists and the service's name, never the Odd's words for them.
 */
export const standingTitle = (tools: string[], service: string): string =>
  `Allow ${standingSaid(tools, service)} without asking`;

async function grantOf(staffId: string, connectorId: string, tx: Tx | typeof db = db) {
  const [g] = await tx
    .select()
    .from(grants)
    .where(and(eq(grants.staffId, staffId), eq(grants.connectorId, connectorId)));
  return g as GrantRow | undefined;
}

/**
 * Why an Odd may not ask for this standing yes, or the tools it may ask for:
 * those it does not use without asking already. Refused to an Odd not at
 * Draft, the only level a standing yes changes anything at, for a service it
 * does not hold to read and write, a tool the service does not list, one that
 * only reads, and any tool the owner already said no to for this Odd, since a
 * no stands.
 */
export async function standingAsked(
  staffId: string,
  req: StandingRequest,
  owner: string
): Promise<{ problem: string } | { tools: string[]; service: string }> {
  const g = await grantOf(staffId, req.connector);
  const c = await connector(req.connector);
  if (!g || !c)
    return { problem: `You hold no tool with the id ${req.connector}. my_access lists yours.` };
  if (g.level !== 'act')
    return {
      problem: `You hold ${c.name} read only, so nothing of it waits for ${owner}. Ask for read and write with ask_for_access first, if the work needs it.`
    };
  const who = await staffer(staffId);
  if (who?.permission === 'act')
    return {
      problem: `You are at ${LEVEL_NAME.act}, so your calls to ${c.name} already go through without asking, except the tools ${owner} set to ask first, and those keep waiting for their yes. A standing yes is only for an Odd at ${LEVEL_NAME.draft}.`
    };
  const unknown = req.tools.filter((t) => !c.tools.includes(t));
  if (unknown.length) return { problem: `${c.name} lists no tool named ${unknown.join(', ')}.` };
  const reads = req.tools.filter((t) => c.readTools.includes(t));
  if (reads.length)
    return {
      problem: `${reads.join(', ')} only read, so a call to them never waits for ${owner}.`
    };
  const firm = req.tools.filter((t) => g.askFirst.includes(t));
  if (firm.length)
    return {
      problem: `${owner} set ${standingSaid(firm, c.name)} to ask first even at Act, so each call keeps waiting for their yes.`
    };
  const tools = req.tools.filter((t) => !g.standing.includes(t));
  if (!tools.length)
    return { problem: `You already use ${standingSaid(req.tools, c.name)} without asking.` };
  const denied = await db
    .select()
    .from(asks)
    .where(and(eq(asks.staffId, staffId), eq(asks.kind, 'standing'), eq(asks.status, 'denied')));
  const no = denied.find(
    (d) =>
      d.standing?.connector === req.connector && tools.some((t) => d.standing!.tools.includes(t))
  );
  if (no)
    return {
      problem: `${owner} said no to ask #${no.id}, which asked for this. A no stands: keep asking for each call.`
    };
  return { tools, service: c.name };
}

/**
 * Give the tools a standing ask asked for, in `tx`, with the yes, or neither
 * happens. Refused, and the ask left open, when the Odd no longer holds the
 * service to read and write. Returns the tools added.
 */
export async function giveStanding(tx: Tx, a: AskRow): Promise<string[]> {
  if (!a.standing) return [];
  const g = await grantOf(a.staffId, a.standing.connector, tx);
  if (!g || g.level !== 'act')
    throw fixedError(
      'This Odd no longer holds that service to read and write. Give it read and write on its Settings tab first'
    );
  const add = a.standing.tools.filter((t) => !g.standing.includes(t));
  if (add.length)
    await tx
      .update(grants)
      .set({ standing: [...g.standing, ...add] })
      .where(and(eq(grants.staffId, a.staffId), eq(grants.connectorId, a.standing.connector)));
  return add;
}

/**
 * The owner's change on the Settings tab: `tool` of `connectorId` goes
 * through without asking at Draft (`on`), or waits for their yes again. Only
 * on a write grant, and only for a tool the service lists that does not only
 * read. One ledger line per change.
 */
export const setStanding = (staffId: string, connectorId: string, tool: string, on: boolean) =>
  setException('standing', staffId, connectorId, tool, on);

/**
 * The owner's change on the Settings tab: each call to `tool` of
 * `connectorId` waits for their yes even at Act (`on`), or goes through
 * without asking again. The same checks and ledger line as `setStanding`.
 */
export const setAskFirst = (staffId: string, connectorId: string, tool: string, on: boolean) =>
  setException('askFirst', staffId, connectorId, tool, on);

/** One tool on or off one of a write grant's two exceptions to its level. */
async function setException(
  list: 'standing' | 'askFirst',
  staffId: string,
  connectorId: string,
  tool: string,
  on: boolean
): Promise<void> {
  const who = await staffer(staffId);
  const c = await connector(connectorId);
  if (!who || !c) throw new Error('No such Odd or tool');
  const g = await grantOf(staffId, connectorId);
  if (!g || g.level !== 'act')
    throw fixedError('Only a service given to read and write has tools that wait for your yes');
  if (on && !c.tools.includes(tool)) throw new Error(`${c.name} lists no tool named ${tool}`);
  if (on && c.readTools.includes(tool))
    throw fixedError('That tool only reads, so it never waits for your yes');
  const had = g[list];
  const next = on ? [...new Set([...had, tool])] : had.filter((t) => t !== tool);
  if (next.length === had.length) return;
  await db
    .update(grants)
    .set({ [list]: next })
    .where(and(eq(grants.staffId, staffId), eq(grants.connectorId, connectorId)));
  const said = standingSaid([tool], c.name);
  await record({
    kind: 'access',
    actor: 'owner',
    title:
      list === 'standing'
        ? on
          ? `Let ${who.name} use ${said} without asking`
          : `${who.name} asks again before using ${said}`
        : on
          ? `${who.name} asks first before using ${said}, even at Act`
          : `${who.name} uses ${said} without asking again, at Act`
  });
}
