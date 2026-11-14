// The Odds themselves: who works here, their level, AI tool, effort, model and
// switches, the network hold, their look, and hiring one.
import { and, asc, desc, eq, inArray, isNotNull, isNull, type AnyColumn } from 'drizzle-orm';
import { rmSync } from 'node:fs';
import { db } from './db.ts';
import { fixedError } from './errors.ts';
import { chatSession } from './home.ts';
import { type Db } from './threads.ts';
import { staff, parts } from './schema.ts';
import {
  AGENT_NAMES,
  commandsHow,
  commandsOnline,
  EFFORT_NAMES,
  EFFORT_ORDER,
  effortsOf,
  MANAGER_EFFORT_FLOOR,
  MODELS,
  officeAgentOf,
  type Agent,
  type Effort
} from './agents.ts';
// Read only inside functions, so the import cycle with managers.ts is safe.
import { MANAGER_ROLE } from './managers.ts';
import { currentPlatform } from './platform.ts';
import { levelAtMost, type Level, type OwnSwitch } from './access-words.ts';
import { isGrantable, OFFICE_TOOLS, ON_BY_DEFAULT } from './tools.ts';
import { HIRE_DEFAULTS } from './grantable.ts';
import { lookSignature, type DrawnPart, type LookSpec } from '@oddboro/sprites/look';
import type { PersonaLink } from './personas.ts';
import type { StaffRow } from './office.ts';
import { record } from './office-ledger.ts';

// Staff

/**
 * Rows of an Odd that still works here. One that left runs nothing and shows
 * nowhere (leaving.ts), even should a row of its slip past the closing there.
 */
const ofWorkingOdd = (col: AnyColumn) =>
  inArray(col, db.select({ id: staff.id }).from(staff).where(isNull(staff.leftAt)));

export async function roster(): Promise<StaffRow[]> {
  return db.select().from(staff).where(isNull(staff.leftAt)).orderBy(asc(staff.hiredAt));
}

/**
 * A working Odd. One that left the office is not found, so nothing runs it,
 * hands it work or changes it (`removeOdd` in leaving.ts).
 */
export async function staffer(id: string, q: Db = db): Promise<StaffRow | undefined> {
  const [row] = await q
    .select()
    .from(staff)
    .where(and(eq(staff.id, id), isNull(staff.leftAt)));
  return row;
}

/** Any Odd ever hired, one that left included: for a name in history, and a new hire's id. */
export async function anyStaffer(id: string, q: Db = db): Promise<StaffRow | undefined> {
  const [row] = await q.select().from(staff).where(eq(staff.id, id));
  return row;
}

/** The Odds that left the office, the latest to leave first. */
export async function formerStaff(): Promise<StaffRow[]> {
  return db.select().from(staff).where(isNotNull(staff.leftAt)).orderBy(desc(staff.leftAt));
}

/** Only the owner moves a staffer's level. Grants above the new level wait until it rises again. */
export async function setPermission(id: string, permission: Level): Promise<void> {
  const before = await staffer(id);
  if (!before || before.permission === permission) return;
  await db.update(staff).set({ permission }).where(eq(staff.id, id));
  const up = !levelAtMost(permission, before.permission);
  await record({
    kind: 'access',
    actor: 'owner',
    title: `${up ? 'Raised' : 'Lowered'} ${before.name} from ${before.permission} to ${permission}`
  });
}

/**
 * What an access line adds when the change opens or closes the internet to the
 * Odd's commands. `held` is the line the office records when it holds the
 * network (`holdNetwork`), and what a change that would open it says while held.
 */
export const NETWORK_NOTE = {
  on: 'Its commands can reach the internet now.',
  off: 'Its commands are off the internet now.',
  held: 'This version of Claude Code refuses to let commands reach the whole internet. Commands keep working, with no network. Restarting the office lifts this.'
} as const;

// Whether this office holds the network: a Claude Code that refuses the open
// network fails the run that met it, and from then on its runs' commands go
// with none. In the office's own memory, so a restart tries the open network
// once more and a refusal costs that one run again. A run's tool server is a
// process of its own, so the office tells it in its environment
// (`OFFICE_NETWORK_HELD`, which `heldReach`'s callers there read).
let held = false;

/** Whether this office has met that refusal since it started. Only the office's own process knows. */
export function networkHeld(): boolean {
  return held;
}

/** Called when a run meets the refusal. Records one Ledger line by the office, the first time. */
export async function holdNetwork(): Promise<void> {
  if (held) return;
  // Held before the write, so two runs refused at once record one line, and
  // a failed write still keeps commands off the internet.
  held = true;
  await record({
    kind: 'access',
    actor: 'office',
    title: "Kept Odds' commands off the internet",
    body: NETWORK_NOTE.held
  });
}

/** For tests only: forgets a refusal, so the next run tries the open network again. */
export function resetHeldNetwork(): void {
  held = false;
}

/**
 * What an Odd on `agent` reaches while the office holds the network or not
 * (`officeHeld`): `own` with its network taken away while held. Only a Claude
 * Code Odd's network is held, since the refusal is Claude Code's. `held` says
 * the hold applies to this Odd, whether or not it had a network to lose. The
 * one rule every reader of an Odd's reach goes through: runs, the prompt,
 * my_access, office_report, the page and the Ledger line of a switch.
 */
export function heldReach<T extends { network: boolean }>(
  agent: Agent,
  own: T,
  officeHeld: boolean
): T & { held: boolean } {
  const isHeld = agent === 'claude' && officeHeld;
  return { ...own, network: own.network && !isHeld, held: isHeld };
}

/**
 * The body for a change from `before` to `after`: whether its commands reach
 * the internet changed, so the owner sees the reach a switch or a move opened
 * or closed, not only the switch. The two sides are compared without the hold,
 * which would make them equal; a change that opens the network while the
 * office holds it says the hold's words instead.
 */
function networkNote(before: StaffRow, after: StaffRow): { body?: string } {
  const [was, is] = [before, after].map((s) => commandsOnline(s.agent, currentPlatform(), s));
  if (was === is) return {};
  if (!is) return { body: NETWORK_NOTE.off };
  const opened = heldReach(after.agent, { network: is }, networkHeld()).network;
  return { body: opened ? NETWORK_NOTE.on : NETWORK_NOTE.held };
}

/** The tool the office runs on, from `.env` as it stands now (`officeAgentOf`). */
export const officeAgent = (): Agent => officeAgentOf(process.env.OFFICE_AGENT, currentPlatform());

/**
 * Why Run commands cannot be stored for `agent` on this system, or nothing
 * when its tool follows the switch. A stored yes must be the owner's own
 * choice, or it would turn commands on unasked after a later move to a tool
 * that follows it.
 */
function commandsRefused(agent: Agent): { refused: string } | undefined {
  const how = commandsHow(agent, currentPlatform());
  return how.state === 'switch' ? undefined : { refused: how.why };
}

/**
 * Only the owner moves a staffer to another coding tool. Its chat session
 * belongs to the tool it left, which could not resume it, so the next chat
 * starts a fresh one. With `commands`, the move also sets Run commands (the
 * one click the Settings tab offers under a switch the Odd's own tool cannot
 * follow), refused before anything changes when the new tool does not follow
 * it, so the Odd never moves without the commands it was moved for.
 */
export async function setAgent(
  id: string,
  agent: Agent,
  commands?: boolean
): Promise<{ refused: string } | undefined> {
  const before = await staffer(id);
  if (!before) return;
  if (commands !== undefined) {
    const refused = commandsRefused(agent);
    if (refused) return refused;
  }
  if (before.agent !== agent) {
    // An account belongs to one tool, so the Odd starts the new one on its Office account.
    await db.update(staff).set({ agent, account: null }).where(eq(staff.id, id));
    rmSync(chatSession(id), { force: true });
    await record({
      kind: 'access',
      actor: 'owner',
      title: `Moved ${before.name} from ${AGENT_NAMES[before.agent]} to ${AGENT_NAMES[agent]}`,
      ...networkNote(before, { ...before, agent })
    });
  }
  if (commands !== undefined) return setOwnTool(id, 'commands', commands);
}

/** Only the owner grants or removes an office tool. Takes effect on the staffer's next run. */
export async function setTool(id: string, tool: string, on: boolean): Promise<void> {
  const found = OFFICE_TOOLS.find((t) => t.id === tool);
  if (!found || !isGrantable(tool)) throw new Error(`${tool} is not an office tool you grant`);
  const before = await staffer(id);
  if (!before || before.tools.includes(tool) === on) return;
  const tools = on ? [...before.tools, tool] : before.tools.filter((t) => t !== tool);
  await db.update(staff).set({ tools }).where(eq(staff.id, id));
  await record({
    kind: 'access',
    actor: 'owner',
    title: on ? `Gave ${before.name} ${found.name}` : `Took ${found.name} from ${before.name}`,
    body: found.does
  });
}

/**
 * Set how hard an Odd's runs think, from the levels its tool takes
 * (`EFFORTS`). The Office Manager never goes below Medium. Takes effect on its
 * next run.
 */
export async function setEffort(
  id: string,
  effort: Effort
): Promise<{ refused: string } | undefined> {
  const before = await staffer(id);
  if (!before) return { refused: 'No such Odd' };
  const menu = effortsOf(before.agent, before.model);
  if (!menu.includes(effort))
    return {
      refused: menu.length
        ? `${AGENT_NAMES[before.agent]} takes ${menu.map((e) => EFFORT_NAMES[e]).join(', ')}`
        : `${AGENT_NAMES[before.agent]} has no thinking levels to pick`
    };
  if (
    before.role === MANAGER_ROLE &&
    EFFORT_ORDER.indexOf(effort) < EFFORT_ORDER.indexOf(MANAGER_EFFORT_FLOOR)
  )
    return {
      refused: `The ${MANAGER_ROLE} thinks at ${EFFORT_NAMES[MANAGER_EFFORT_FLOOR]} or more`
    };
  if (before.effort === effort) return;
  await db.update(staff).set({ effort }).where(eq(staff.id, id));
  await record({
    kind: 'access',
    actor: 'owner',
    title: `Set ${before.name} to think at ${EFFORT_NAMES[effort]}`
  });
}

/**
 * Set the model an Odd's runs use on its tool, from the ones it offers
 * (`MODELS`), or null for the office's. Takes effect on its next run.
 */
export async function setModel(
  id: string,
  model: string | null
): Promise<{ refused: string } | undefined> {
  const before = await staffer(id);
  if (!before) return { refused: 'No such Odd' };
  const menu = MODELS[before.agent];
  const picked = model === null ? undefined : menu.find((m) => m.id === model);
  if (model !== null && !picked)
    return {
      refused: menu.length
        ? `${AGENT_NAMES[before.agent]} runs ${menu.map((m) => m.name).join(', ')}`
        : `${AGENT_NAMES[before.agent]} has no models to pick`
    };
  if (before.model === model) return;
  await db.update(staff).set({ model }).where(eq(staff.id, id));
  await record({
    kind: 'access',
    actor: 'owner',
    title: picked
      ? `Set ${before.name} to run on ${picked.name}`
      : `Set ${before.name} to run on the office's model`
  });
}

/**
 * Only the owner switches Run commands or Browse the web. Takes effect on the
 * staffer's next run. Run commands, on or off, is refused for a tool that does
 * not follow the switch on this system, a repeat included.
 */
export async function setOwnTool(
  id: string,
  which: OwnSwitch,
  on: boolean
): Promise<{ refused: string } | undefined> {
  const changed = await changeOwnTools(db, id, { which: [which], on });
  if (!changed || 'refused' in changed) return changed;
  if (!changed.on.length) return;
  const n = changed.before.name;
  const title =
    which === 'commands'
      ? on
        ? `Let ${n} run commands`
        : `Stopped ${n} running commands`
      : on
        ? `Let ${n} browse the web`
        : `Stopped ${n} browsing the web`;
  await record({
    kind: 'access',
    actor: 'owner',
    title,
    ...networkNote(changed.before, changed.after)
  });
}

/**
 * Set a working Odd's own switches in `which` to `on`, in `q`, the one change
 * both the Settings tab (`setOwnTool`) and a switch ask's yes make. Ones
 * already set stay as they are, and `on` names those that changed. Run
 * commands in `which` is refused for a tool that does not follow the switch
 * on this system, before anything changes. The caller writes the ledger line.
 */
export async function changeOwnTools(
  q: Db,
  id: string,
  { which, on }: { which: readonly OwnSwitch[]; on: boolean }
): Promise<
  { before: StaffRow; after: StaffRow; on: OwnSwitch[] } | { refused: string } | undefined
> {
  const before = await staffer(id, q);
  if (!before) return;
  if (which.includes('commands')) {
    const refused = commandsRefused(before.agent);
    if (refused) return refused;
  }
  const changing = which.filter((s) => before[s] !== on);
  if (!changing.length) return { before, after: before, on: changing };
  const [after] = await q
    .update(staff)
    .set(Object.fromEntries(changing.map((s) => [s, on])))
    .where(eq(staff.id, id))
    .returning();
  return after && { before, after, on: changing };
}

export type Hire = Pick<
  StaffRow,
  'name' | 'role' | 'variant' | 'portrait' | 'room' | 'remit' | 'desk'
> & {
  /** Its level; `HIRE_DEFAULTS` when left out. */
  permission?: Level;
  /** The office they work in, by name. */
  office?: string;
  sprite?: string;
  tools?: string[];
  look?: LookSpec;
  portraitPx?: string;
  /** Parts drawn for this look, saved to the library once the hire happens. */
  newParts?: DrawnPart[];
  /** The coding tool its runs go through, stored before its first run. Claude Code when left out. */
  agent?: Agent;
  /** The account it signs in with on that tool, its model, and how hard it thinks. The office's when left out. */
  account?: string | null;
  model?: string | null;
  effort?: Effort | null;
  /** The New Altitude persona it was installed from. */
  package?: PersonaLink;
};

/** Current staff whose generated look matches this one, other than `except`. */
export async function lookTaken(look: LookSpec, except?: string): Promise<StaffRow | undefined> {
  const sig = lookSignature(look);
  return (await roster()).find((p) => p.id !== except && p.look && lookSignature(p.look) === sig);
}

/** Every generated look on the floor, to tell a new one to differ from. */
export async function lookCatalogue(except?: string): Promise<{ name: string; look: LookSpec }[]> {
  return (await roster())
    .filter((p) => p.look && p.id !== except)
    .map((p) => ({ name: p.name, look: p.look! }));
}

export async function drawnParts(): Promise<DrawnPart[]> {
  return db.select({ kind: parts.kind, name: parts.name, px: parts.px }).from(parts);
}

async function saveParts(list: DrawnPart[] | undefined, drawnFor: string): Promise<void> {
  for (const p of list ?? []) {
    await db
      .insert(parts)
      .values({ ...p, drawnFor })
      .onConflictDoNothing();
    await record({
      kind: 'work',
      actor: 'office',
      title: `Drew a new ${p.kind}: ${p.name}`,
      body: p.px
    });
  }
}

/** Redraw a staffer's look. The ledger keeps the change. */
export async function setLook(
  id: string,
  look: LookSpec,
  portraitPx: string,
  newParts?: DrawnPart[]
): Promise<void> {
  const who = await staffer(id);
  if (!who) throw fixedError('No such Odd');
  if (who.package)
    throw new Error(`${who.name}'s look comes from New Altitude and cannot be redrawn.`);
  const twin = await lookTaken(look, id);
  if (twin) throw new Error(`${twin.name} already looks exactly like that`);
  await saveParts(newParts, id);
  await db.update(staff).set({ look, portraitPx }).where(eq(staff.id, id));
  await record({ kind: 'work', actor: 'owner', title: `Redrew ${who.name}'s look` });
}

export async function hire(h: Hire): Promise<StaffRow> {
  const base =
    h.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'staff';
  let id = base;
  // An Odd that left keeps its id, so it can come back as itself.
  for (let i = 2; await anyStaffer(id); i++) id = `${base}-${i}`;
  // A hire that names its tools still starts with the ones on by default.
  const named = h.tools?.filter(isGrantable);
  const tools = named && [...new Set([...ON_BY_DEFAULT, ...named])];
  if (h.look) {
    const twin = await lookTaken(h.look);
    if (twin) throw new Error(`${twin.name} already looks exactly like that. Redraw first.`);
  }
  const { newParts, ...values } = h;
  const [row] = await db
    .insert(staff)
    // With no tool picked, the hire runs on the office's own.
    .values({
      ...values,
      agent: values.agent ?? officeAgent(),
      id,
      tools: tools ?? HIRE_DEFAULTS.staff.tools
    })
    .returning();
  await saveParts(newParts, id);
  await record({
    kind: 'hire',
    actor: 'owner',
    title: `Hired ${h.name}, ${h.role}`,
    body: h.remit
  });
  return row;
}

export { ofWorkingOdd, networkNote };
