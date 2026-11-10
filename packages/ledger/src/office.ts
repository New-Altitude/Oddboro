// What the office does with its tables. The office app and the staff tool
// server both call these, so a rule lives in one place: an ask is decided only
// here, a task is finished only here, and each writes its ledger row.
import {
  and,
  arrayOverlaps,
  asc,
  cosineDistance,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  or,
  sql,
  type SQL
} from 'drizzle-orm';
import { existsSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { alias } from 'drizzle-orm/pg-core';
import { db, sql as pg } from './db.ts';
import { deleteSecret, getSecret } from './secrets.ts';
import { embed } from './embed.ts';
import { fixedError } from './errors.ts';
import { chatSession, CODE, home } from './home.ts';
import {
  answeredAll,
  handBack,
  handBackLater,
  servesHandOff,
  servesNoThread
} from './hand-offs.ts';
import { answerWindow } from './usage-window.ts';
import {
  addFollowUp,
  answerHandOffs,
  answerThread,
  goalThread,
  keepRun,
  raisedOn,
  settleThread,
  startHeld,
  type Db,
  type Tx
} from './threads.ts';
import {
  asks,
  attachments,
  pokes,
  roomNames,
  switchedOff,
  connectors,
  grants,
  jobs,
  ledger,
  owner,
  planLimits,
  reports,
  runs,
  staff,
  parts,
  tasks,
  threads,
  usage,
  followUps,
  goals,
  type AccessRequest,
  type AskKind,
  type FolderRequest,
  type FollowUpKind,
  type GoalDraft,
  type GoalPlan,
  type GoogleProduct,
  type HireProposal,
  type Outcome,
  type HeldCall,
  type ReplyDraft,
  type LedgerKind,
  type RunTrigger,
  type Schedule,
  type Step,
  type UsageKind
} from './schema.ts';
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
  type Effort,
  type GrantedFolder
} from './agents.ts';
// Read only inside functions, so the import cycle with managers.ts is safe.
import { MANAGER_ROLE } from './managers.ts';
import {
  grantWorks,
  levelAtMost,
  SWITCH_NAMES,
  switchesSaid,
  type FolderAccess,
  type Level,
  type OwnSwitch
} from './access-words.ts';
import { filterWords, sameCriteria, type GmailFilter } from './filter-words.ts';
import { nextRun, zone } from './time.ts';
import { isGrantable, OFFICE_TOOLS, STARTER_TOOLS, tickable, yesOrNo } from './tools.ts';
import { lookSignature, type DrawnPart, type LookSpec } from '@oddboro/sprites/look';

export type StaffRow = typeof staff.$inferSelect;
export type AskRow = typeof asks.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type PokeRow = typeof pokes.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type GrantRow = typeof grants.$inferSelect;
export type ConnectorRow = typeof connectors.$inferSelect;
export type LedgerRow = Omit<typeof ledger.$inferSelect, 'embedding'>;

// Staff

export async function roster(): Promise<StaffRow[]> {
  return db.select().from(staff).where(isNull(staff.leftAt)).orderBy(asc(staff.hiredAt));
}

export async function staffer(id: string, q: Db = db): Promise<StaffRow | undefined> {
  const [row] = await q.select().from(staff).where(eq(staff.id, id));
  return row;
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
  const [was, is] = [before, after].map((s) => commandsOnline(s.agent, process.platform, s));
  if (was === is) return {};
  if (!is) return { body: NETWORK_NOTE.off };
  const opened = heldReach(after.agent, { network: is }, networkHeld()).network;
  return { body: opened ? NETWORK_NOTE.on : NETWORK_NOTE.held };
}

/** The tool the office runs on, from `.env` as it stands now (`officeAgentOf`). */
export const officeAgent = (): Agent => officeAgentOf(process.env.OFFICE_AGENT, process.platform);

/**
 * Only the owner moves a staffer to another coding tool. Its chat session
 * belongs to the tool it left, which could not resume it, so the next chat
 * starts a fresh one.
 */
export async function setAgent(id: string, agent: Agent): Promise<void> {
  const before = await staffer(id);
  if (!before || before.agent === agent) return;
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

/** Only the owner switches Run commands or Browse the web. Takes effect on the staffer's next run. */
export async function setOwnTool(
  id: string,
  which: 'commands' | 'web',
  on: boolean
): Promise<void> {
  const before = await staffer(id);
  if (!before || before[which] === on) return;
  await db
    .update(staff)
    .set({ [which]: on })
    .where(eq(staff.id, id));
  const n = before.name;
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
    ...networkNote(before, { ...before, [which]: on })
  });
}

/**
 * Only the owner gives an Odd a folder outside the office, to read or to read
 * and change, or takes it back (`access` null). `path` is the real path
 * `checkFolder` gave, or, to take one back, the path as stored, so a folder
 * deleted from the disk can still be taken back. A folder is the same one
 * when its real path is (`real`), so a level change replaces it, even one
 * stored in another case. A new folder inside or holding one the Odd already
 * has is refused (`FOLDER_REFUSED.nested`): one would carry two levels.
 * Takes effect on the next run.
 */
export async function setFolder(
  id: string,
  path: string,
  access: FolderAccess | null
): Promise<{ refused: string } | undefined> {
  const done = await changeFolder(db, id, path, access);
  if (!done || 'refused' in done) return done;
  await record({ kind: 'access', actor: 'owner', title: done.title });
}

/**
 * The change `setFolder` makes, in `q`, with the ledger title it is written
 * under. Nothing when the Odd is gone or already has the folder so.
 */
async function changeFolder(
  q: Db,
  id: string,
  path: string,
  access: FolderAccess | null
): Promise<{ refused: string } | { title: string } | undefined> {
  const before = await staffer(id, q);
  if (!before) return;
  const at = real(path);
  const same = (f: { path: string }) => real(f.path) === at;
  const had = before.folders.find(same);
  const write = access === 'write';
  if (access === null ? !had : had?.write === write) return;
  const rest = before.folders.filter((f) => !same(f));
  if (access !== null && rest.some((f) => within(at, real(f.path)) || within(real(f.path), at)))
    return { refused: FOLDER_REFUSED.nested };
  const folders = access === null ? rest : [...rest, { path, write }];
  await q.update(staff).set({ folders }).where(eq(staff.id, id));
  return {
    title:
      access === null
        ? `Took ${shownFolder(path)} from ${before.name}`
        : gaveFolder(before.name, path, access)
  };
}

/** The ledger's words for giving a folder: "Let Theo read ~/Taxes". */
const gaveFolder = (name: string, path: string, access: FolderAccess) =>
  `Let ${name} ${access === 'write' ? 'read and change' : 'read'} ${shownFolder(path)}`;

/**
 * Why an Odd may not ask for `path` (a real path from `checkFolder`) at
 * `level`, or nothing when it may: it has that folder, or one holding it,
 * at that level or above; or the owner could not give it, since it sits
 * inside or holds another folder the Odd has (`setFolder`).
 */
export function folderAskRefused(
  who: Pick<StaffRow, 'folders'>,
  path: string,
  level: FolderAccess
): string | undefined {
  const at = real(path);
  const covers = who.folders.find((f) => within(at, real(f.path)) && (f.write || level === 'read'));
  if (covers)
    return `You already have ${shownFolder(covers.path)} (${covers.write ? 'read and change' : 'read only'}), which covers it.`;
  const other = (f: { path: string }) => real(f.path) !== at;
  if (who.folders.some((f) => other(f) && (within(at, real(f.path)) || within(real(f.path), at))))
    return FOLDER_REFUSED.nested;
}

/**
 * Why an Odd may not ask for `wanted`, or nothing when it may: each is on
 * already, or its tool on this system never runs commands (`commandsHow`), in
 * the Settings tab's words. One already on is left out of the ask
 * (`switchesOff`), so only all of them on refuses.
 */
export function switchAskRefused(
  who: Pick<StaffRow, 'agent' | 'commands' | 'web'>,
  wanted: readonly OwnSwitch[]
): string | undefined {
  const how = commandsHow(who.agent, process.platform);
  if (wanted.includes('commands') && how.state === 'never')
    return `${SWITCH_NAMES.commands} is not open to an Odd on ${AGENT_NAMES[who.agent]} here: ${how.why}`;
  if (!switchesOff(who, wanted).length) return `You already have ${switchesSaid(wanted)} on.`;
}

/** The switches in `wanted` that are off for this Odd. */
export const switchesOff = (
  who: Pick<StaffRow, 'commands' | 'web'>,
  wanted: readonly OwnSwitch[]
): OwnSwitch[] => wanted.filter((s) => !who[s]);

/** The ledger's words for turning switches on: "Let Theo run commands and browse the web". */
const turnedOn = (name: string, on: readonly OwnSwitch[]) =>
  `Let ${name} ${switchesSaid(on).toLowerCase()}`;

/**
 * Secret stores in the home folder, by name: keys, sign-ins and settings,
 * including those other apps on this computer keep there, like the Google
 * Workspace MCP server's, and each coding tool's own home. AppData is where
 * Windows apps keep theirs. No run reads them (`unreadable` in the office's
 * staff.ts), and no folder given to an Odd holds or sits in one (`checkFolder`).
 */
export const SECRET_STORES: string[] = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.config',
  'Library',
  'AppData',
  '.claude',
  '.claude.json',
  '.google_workspace_mcp',
  '.grok',
  '.codex',
  '.gemini'
];

/** What the owner reads when a folder cannot be given to an Odd. */
export const FOLDER_REFUSED = {
  missing: 'No such folder.',
  home: 'Pick a folder inside your home, not the whole home.',
  secrets: 'That folder holds your keys or sign-ins.',
  code: "That folder holds Oddboro's own code.",
  nested: 'That folder is inside one this Odd already has, or holds one.',
  /** What an Odd reads when it asks for a whole drive or system files: only the owner may give one. */
  broad: 'That folder is a whole drive or holds system files. Ask for a narrower one.',
  glob: (char: string) => `That folder's path has a character an Odd's tool can't take: ${char}`
} as const;

/**
 * What the owner reads before giving a whole drive or system files
 * (`broadFolder`), with Accept and Cancel. Only their Accept gives it.
 */
export const FOLDER_WARNING =
  "This folder is a whole drive or holds system files, so an Odd could reach everything inside it. We don't recommend giving it.";

/**
 * Secret stores found by what they hold, for a folder outside the home, where
 * no store sits at a known place: by name, and for a coding tool's home, a
 * file only its sign-in or history leaves, since a project keeps its own
 * `.claude` or `.codex` of settings. An empty list means the name alone.
 */
const STORE_MARKS: Record<string, string[]> = {
  '.ssh': [],
  '.aws': [],
  '.gnupg': [],
  '.google_workspace_mcp': [],
  '.claude': ['.credentials.json', 'history.jsonl', 'projects'],
  '.codex': ['auth.json', 'sessions'],
  '.grok': ['auth.json', 'sessions'],
  '.gemini': ['oauth_creds.json', 'google_accounts.json']
};

/** Whether `p` is a secret store by `STORE_MARKS`. */
function marksStore(p: string): boolean {
  const marks = STORE_MARKS[basename(p).toLowerCase()];
  return !!marks && existsSync(p) && (!marks.length || marks.some((m) => existsSync(join(p, m))));
}

/**
 * Whether `p`, outside the home, is in a secret store or holds one at its
 * top (`STORE_MARKS`). Deeper folders are not looked at, so giving one is
 * never a walk of a whole drive.
 */
function holdsStoreOutside(p: string): boolean {
  for (let at = p; dirname(at) !== at; at = dirname(at)) if (marksStore(at)) return true;
  return Object.keys(STORE_MARKS).some((name) => marksStore(join(p, name)));
}

/** The system's own folders on each system, by real path where one exists. */
function systemFolders(): string[] {
  const env = process.env;
  const list =
    process.platform === 'win32'
      ? [
          env.SystemRoot ?? 'C:\\Windows',
          env.ProgramFiles ?? 'C:\\Program Files',
          env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
          env.ProgramData ?? 'C:\\ProgramData'
        ]
      : process.platform === 'darwin'
        ? ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/private', '/dev']
        : [
            ...['/etc', '/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/boot'],
            ...['/var', '/proc', '/sys', '/dev', '/run', '/root', '/tmp']
          ];
  return list.map(real);
}

/**
 * Whether `p` (a real path) is a whole drive or volume, or is in or holds the
 * system's own folders: what the owner is warned about before giving
 * (`FOLDER_WARNING`), and an Odd may not ask for. A folder in the home is
 * never one, wherever the home sits.
 */
export function broadFolder(p: string): boolean {
  if (within(p, real(homedir()))) return false;
  const up = dirname(p);
  const root =
    up === p ||
    ['/Volumes', '/mnt', '/media'].includes(up) ||
    ['/media', '/run/media'].includes(dirname(up));
  return root || systemFolders().some((s) => within(p, s) || within(s, p));
}

/**
 * The characters Codex 0.166 refuses in a folder's path, since it reads them
 * as a glob and takes a glob only to deny; it refuses both ways of escaping
 * one too (`\\[` and `[[]`), so no Odd's run could start with such a folder.
 * Refused for every Odd, since an Odd can move to Codex later. `{` and `}`
 * stay allowed: Codex 0.166 takes them (measured twice), and Claude Code's
 * sandbox reads `{` as a plain character.
 */
export const GLOB = /[*?[\]]/;

/**
 * A path by its real one when it exists, so it compares with a real path. The
 * system's own realpath spells each name as the disk keeps it, so on a Mac's
 * disk, which ignores case, `~/.SSH` and `~/.ssh` come out the same.
 */
const real = (p: string): string => (existsSync(p) ? realpathSync.native(p) : p);

/** Whether `p` is `parent` or sits inside it. A Windows disk ignores case. */
export function within(p: string, parent: string): boolean {
  const [a, b] =
    process.platform === 'win32' ? [p.toLowerCase(), parent.toLowerCase()] : [p, parent];
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

/** A path as the owner reads it, the home folder written `~`. */
export function shownFolder(path: string): string {
  for (const h of new Set([homedir(), real(homedir())]))
    if (within(path, h)) return `~${path.slice(h.length)}`;
  return path;
}

/**
 * Whether `path`, as the owner typed it, may be given to an Odd, and its real
 * path when it may. Any folder on the computer but the home itself, and one
 * that holds or sits in a secret store (`SECRET_STORES` in the home, and
 * outside it `holdsStoreOutside`), the office's own home or Oddboro's code:
 * those would let an Odd past the office's walls, so no Accept gives them. A
 * deny inside a folder a run reads is not held by every tool, so a folder
 * that holds one is refused at the door. A real path with a character Codex
 * cannot take (`GLOB`) is refused too, by the real path, since that is what a
 * run is given. A whole drive or system files (`broadFolder`) comes back as
 * a `warning` until the owner accepts it (`accept`). Only the folder routes
 * call this, so a folder given before a rule is not checked again.
 */
export function checkFolder(
  path: string,
  accept = false
): { real: string } | { refused: string } | { warning: string } {
  const typed = path.trim();
  const expanded = /^~(?=$|[\\/])/.test(typed) ? join(homedir(), typed.slice(1)) : typed;
  if (!isAbsolute(expanded) || !existsSync(expanded)) return { refused: FOLDER_REFUSED.missing };
  const p = real(expanded);
  if (!statSync(p).isDirectory()) return { refused: FOLDER_REFUSED.missing };
  const h = real(homedir());
  if (p === h) return { refused: FOLDER_REFUSED.home };
  const either = (q: string) => within(p, q) || within(q, p);
  if ([...SECRET_STORES.map((s) => real(join(h, s))), real(home())].some(either))
    return { refused: FOLDER_REFUSED.secrets };
  if (!within(p, h) && holdsStoreOutside(p)) return { refused: FOLDER_REFUSED.secrets };
  if (either(real(CODE))) return { refused: FOLDER_REFUSED.code };
  const glob = GLOB.exec(p)?.[0];
  if (glob) return { refused: FOLDER_REFUSED.glob(glob) };
  if (!accept && broadFolder(p)) return { warning: FOLDER_WARNING };
  return { real: p };
}

export type Hire = Pick<
  StaffRow,
  'name' | 'role' | 'variant' | 'portrait' | 'room' | 'permission' | 'remit' | 'desk'
> & {
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
  for (let i = 2; await staffer(id); i++) id = `${base}-${i}`;
  const tools = h.tools?.filter(isGrantable);
  if (h.look) {
    const twin = await lookTaken(h.look);
    if (twin) throw new Error(`${twin.name} already looks exactly like that. Redraw first.`);
  }
  const { newParts, ...values } = h;
  const [row] = await db
    .insert(staff)
    // With no tool picked, the hire runs on the office's own.
    .values({ ...values, agent: values.agent ?? officeAgent(), id, tools: tools ?? STARTER_TOOLS })
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

// The ledger

/** Write one ledger row, embedded on the way in. */
export async function record(
  e: {
    kind: LedgerKind;
    actor: string;
    title: string;
    body?: string;
    reason?: string | null;
    askId?: number;
    taskId?: number;
    runId?: number;
  },
  q: Db = db
): Promise<void> {
  const text = [e.title, e.body, e.reason].filter(Boolean).join('\n');
  await q.insert(ledger).values({ ...e, embedding: await embed(text, 'document') });
}

const ledgerColumns = {
  id: ledger.id,
  kind: ledger.kind,
  actor: ledger.actor,
  title: ledger.title,
  body: ledger.body,
  reason: ledger.reason,
  askId: ledger.askId,
  taskId: ledger.taskId,
  runId: ledger.runId,
  createdAt: ledger.createdAt
};

/** Search by meaning when Ollama is up, by words when it is not. Newest first with no query. */
export async function searchLedger(
  query: string,
  opts: { kind?: LedgerKind; actor?: string; limit?: number } = {}
): Promise<LedgerRow[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const filters = [
    opts.kind ? eq(ledger.kind, opts.kind) : undefined,
    opts.actor ? eq(ledger.actor, opts.actor) : undefined
  ];
  if (!query.trim())
    return db
      .select(ledgerColumns)
      .from(ledger)
      .where(and(...filters))
      .orderBy(desc(ledger.createdAt))
      .limit(limit);
  const v = await embed(query, 'query');
  if (v)
    return db
      .select(ledgerColumns)
      .from(ledger)
      .where(and(...filters, sql`${ledger.embedding} is not null`))
      .orderBy(cosineDistance(ledger.embedding, v))
      .limit(limit);
  return db
    .select(ledgerColumns)
    .from(ledger)
    .where(
      and(
        ...filters,
        sql`to_tsvector('english', ${ledger.title} || ' ' || ${ledger.body} || ' ' || coalesce(${ledger.reason}, '')) @@ websearch_to_tsquery('english', ${query})`
      )
    )
    .orderBy(desc(ledger.createdAt))
    .limit(limit);
}

/** The owner's past decisions closest to this text. */
export async function precedent(text: string, limit = 3): Promise<LedgerRow[]> {
  const v = await embed(text, 'query');
  if (!v) return searchLedger(text, { kind: 'decision', limit });
  return db
    .select(ledgerColumns)
    .from(ledger)
    .where(
      and(
        eq(ledger.kind, 'decision'),
        sql`${ledger.embedding} is not null`,
        sql`${cosineDistance(ledger.embedding, v)} < 0.35`
      )
    )
    .orderBy(cosineDistance(ledger.embedding, v))
    .limit(limit);
}

// Asks

/**
 * Something an Odd tried to put on the owner's desk that is there already, or
 * an email that already has its reply. The tool server returns the message as
 * a tool error the Odd reads.
 */
export class AlreadyOnDesk extends Error {}

/** Two titles as the desk compares them: case and spacing ignored. */
const sameTitle = (a: string, b: string) => {
  const plain = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  return plain(a) === plain(b);
};

/**
 * Lines up an Odd's raises until this transaction ends. Each run has its own
 * tool server process, so two runs raising the same thing at once would both
 * find the desk clear; with the lock the second sees the first.
 */
async function lockDesk(tx: Tx, staffId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`desk:${staffId}`}))`);
}

/**
 * Refuses an item whose title matches an ask or task the Odd already has open.
 * The ask it `revises` does not count: that is how an Odd changes one.
 */
async function refuseRepeat(
  tx: Tx,
  staffId: string,
  title: string,
  revises?: number
): Promise<void> {
  const mine = and(eq(asks.staffId, staffId), eq(asks.status, 'open'));
  const openAsks = await tx.select({ id: asks.id, title: asks.title }).from(asks).where(mine);
  const ask = openAsks.find((a) => a.id !== revises && sameTitle(a.title, title));
  if (ask)
    throw new AlreadyOnDesk(
      `Your ask #${ask.id}, "${ask.title}", is already there. To change it, raise it again with revises: ${ask.id}. Never raise the same thing twice.`
    );
  const openTasks = await tx
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.staffId, staffId), eq(tasks.status, 'open')));
  const task = openTasks.find((t) => sameTitle(t.title, title));
  if (task)
    throw new AlreadyOnDesk(
      `Your task #${task.id}, "${task.title}", is already there. Never give the same thing twice.`
    );
}

/**
 * Whether two replies or filters go through the same Gmail account. Thread
 * and message ids are each mailbox's own, so one in another account is
 * another email.
 */
const sameMailbox = (a: { connector?: string }, b: { connector?: string }) =>
  (a.connector ?? null) === (b.connector ?? null);

/** Whether two replies answer the same email: the same account, and the same Gmail thread, or with none, the same people and subject. */
function sameEmail(a: ReplyDraft, b: ReplyDraft): boolean {
  if (!sameMailbox(a, b)) return false;
  if (a.gmailThreadId || b.gmailThreadId) return a.gmailThreadId === b.gmailThreadId;
  const people = (r: ReplyDraft) =>
    r.to
      .map((t) => t.toLowerCase().trim())
      .sort()
      .join(',');
  return people(a) === people(b) && sameTitle(a.subject, b.subject);
}

/**
 * Refuses a second reply to one email: one still open (unless this revises
 * it), or one the owner already sent or saved for the same message.
 */
async function refuseSecondReply(
  tx: Tx,
  staffId: string,
  reply: ReplyDraft,
  revises?: number
): Promise<void> {
  const replies = await tx
    .select()
    .from(asks)
    .where(
      and(
        eq(asks.staffId, staffId),
        eq(asks.kind, 'reply'),
        inArray(asks.status, ['open', 'approved'])
      )
    );
  const open = replies.find(
    (r) => r.status === 'open' && r.id !== revises && r.reply && sameEmail(r.reply, reply)
  );
  if (open)
    throw new AlreadyOnDesk(
      `Your reply #${open.id} to this email is already there. To change it, call propose_reply again with revises: ${open.id}.`
    );
  const done =
    reply.inReplyTo &&
    replies.find(
      (r) => r.reply?.sent && r.reply.inReplyTo === reply.inReplyTo && sameMailbox(r.reply, reply)
    );
  if (done)
    throw new AlreadyOnDesk(
      `That email already has a reply: your reply #${done.id} was ${done.reply?.sent?.action === 'draft' ? 'saved to Gmail drafts' : 'sent'}. Do not propose another.`
    );
}

/**
 * Refuses a second filter for the same mail: one still open (unless this
 * revises it), or one the owner already created from this Odd.
 */
async function refuseSecondFilter(
  tx: Tx,
  staffId: string,
  filter: GmailFilter,
  revises?: number
): Promise<void> {
  const filters = await tx
    .select()
    .from(asks)
    .where(
      and(
        eq(asks.staffId, staffId),
        eq(asks.kind, 'filter'),
        inArray(asks.status, ['open', 'approved'])
      )
    );
  const same = (r: AskRow) =>
    !!r.filter && sameMailbox(r.filter, filter) && sameCriteria(r.filter.criteria, filter.criteria);
  const open = filters.find((r) => r.status === 'open' && r.id !== revises && same(r));
  if (open)
    throw new AlreadyOnDesk(
      `Your filter #${open.id} for this mail is already there. To change it, call propose_filter again with revises: ${open.id}.`
    );
  const made = filters.find((r) => r.filter?.created && same(r));
  if (made)
    throw new AlreadyOnDesk(
      `That filter already exists: your filter #${made.id} was created in Gmail. Do not propose it again.`
    );
}

/** Where an ask's answer goes back to: its hand-off, its thread, or neither. */
const samePlace = (
  a: { handOffId?: number | null; threadId?: number | null },
  b: { handOffId?: number | null; threadId?: number | null }
) =>
  (a.handOffId ?? null) === (b.handOffId ?? null) && (a.threadId ?? null) === (b.threadId ?? null);

/**
 * Refuses a folder ask that repeats one this Odd has open for the same place:
 * the same folder, at the same level or higher (unless this revises it). One
 * from another place, such as a hand-off, is its twin instead (`asksNoMore`),
 * so the owner's answer goes back to both.
 */
async function refuseSecondFolder(
  tx: Tx,
  staffId: string,
  ask: {
    folder: FolderRequest;
    handOffId?: number;
    threadId?: number;
    revises?: number;
  }
): Promise<void> {
  const open = await tx
    .select()
    .from(asks)
    .where(and(eq(asks.staffId, staffId), eq(asks.kind, 'folder'), eq(asks.status, 'open')));
  const same = open.find(
    (r) =>
      r.id !== ask.revises &&
      !!r.folder &&
      r.folder.path === ask.folder.path &&
      (r.folder.level === 'write' || ask.folder.level === 'read') &&
      samePlace(r, ask)
  );
  if (same)
    throw new AlreadyOnDesk(
      `Your ask #${same.id} for this folder is already there. To change it, call ask_for_folder again with revises: ${same.id}.`
    );
}

/** A switch ask from the same place as an open one that covers it: the open one is the ask. */
async function refuseSecondSwitch(
  tx: Tx,
  staffId: string,
  ask: { switches: OwnSwitch[]; handOffId?: number; threadId?: number; revises?: number }
): Promise<void> {
  const open = await tx
    .select()
    .from(asks)
    .where(and(eq(asks.staffId, staffId), eq(asks.kind, 'switch'), eq(asks.status, 'open')));
  const same = open.find(
    (r) =>
      r.id !== ask.revises &&
      ask.switches.every((s) => r.switches?.includes(s)) &&
      samePlace(r, ask)
  );
  if (same)
    throw new AlreadyOnDesk(
      `Your ask #${same.id} for ${switchesSaid(same.switches ?? [])} is already there. To change it, call ask_for_switch again with revises: ${same.id}.`
    );
}

/** The asks an Odd raises in its own words, which may not repeat one already open. Access asks have twins instead (`asksNoMore`). */
const ONCE_ONLY: AskKind[] = ['approval', 'goal'];

export async function raiseAsk(
  staffId: string,
  a: {
    title: string;
    why: string;
    ifApproved: string;
    access?: AccessRequest;
    hire?: HireProposal;
    goal?: GoalDraft;
    plan?: GoalPlan;
    /** A reply ask's email (`propose_reply`). */
    reply?: ReplyDraft;
    /** A filter ask's Gmail filter (`propose_filter`). */
    filter?: GmailFilter;
    /** A folder ask's folder (`ask_for_folder`). */
    folder?: FolderRequest;
    /** A switch ask's switches (`ask_for_switch`). */
    switches?: OwnSwitch[];
    /** A call ask's held call, from the gateway (`holdCall` in the office's gateway.ts). */
    call?: HeldCall;
    /** `goal`, `plan`, `reply`, `filter`, `folder`, `switch` and `call` say so; the rest follow from access or hire. */
    kind?: 'goal' | 'plan' | 'reply' | 'filter' | 'folder' | 'switch' | 'call';
    revises?: number;
    /** The colleague whose handed-back work the lead raised this from (`VIA`). */
    via?: string;
    /** Raised while working on this hand-off: the owner's answer goes back to it. */
    handOffId?: number;
    /** Raised on this thread: the owner's answer moves it on. A plan ignores it. */
    threadId?: number;
    /** Files that go with it: paths in the staffer's folder, or names in a thread's folder (`workPath`). */
    attach?: string[];
    /**
     * The key of the run raising it (`runsGoing`), which its thread keeps: a
     * plan's, or a lead's that named a thread from a run on none. A run on the
     * thread passes none, since its own follow-up already holds the hub.
     */
    run?: string;
  }
): Promise<{ ask: AskRow; precedent: LedgerRow[] }> {
  const { attach, run, ...fields } = a;
  const kind = a.kind ?? (a.access ? 'access' : a.hire ? 'hire' : 'approval');
  const ask = await db.transaction(async (tx) => {
    // An Odd's own ask may not repeat one on the desk, a reply may not
    // answer an email twice, and a filter may not file the same mail twice.
    // A folder or switch ask may not repeat one from the same place.
    // Office-raised kinds and access twins are left alone.
    if (ONCE_ONLY.includes(kind) || a.reply || a.filter || a.folder || a.switches) {
      await lockDesk(tx, staffId);
      if (a.reply) await refuseSecondReply(tx, staffId, a.reply, a.revises);
      else if (a.filter) await refuseSecondFilter(tx, staffId, a.filter, a.revises);
      else if (a.folder) await refuseSecondFolder(tx, staffId, { ...a, folder: a.folder });
      else if (a.switches) await refuseSecondSwitch(tx, staffId, { ...a, switches: a.switches });
      else await refuseRepeat(tx, staffId, a.title, a.revises);
    }
    // A plan goes on its goal's one thread, whatever run raised it: a chat,
    // the weekly review, or the goal's own planning run. So approving it
    // always brings the goal's lead back there to lead the work.
    const on = a.plan
      ? { handOffId: undefined, threadId: await goalThread(tx, a.plan.goalId, staffId) }
      : {};
    const [row] = await tx
      .insert(asks)
      .values({
        staffId,
        ...fields,
        kind,
        ...on
      })
      .returning();
    // A new version the Odd made of its own ask, still open, takes its place
    // on the desk: the old one closes as replaced, so the owner sees one.
    if (a.revises)
      await tx
        .update(asks)
        .set({ status: 'revise', reason: 'Replaced by a new version.', decidedAt: new Date() })
        .where(and(eq(asks.id, a.revises), eq(asks.staffId, staffId), eq(asks.status, 'open')));
    if (row.threadId) {
      // The thread keeps the run's key, so the owner's answer cannot start the
      // hub there while the run that raised it, such as a chat, still goes.
      await keepRun(tx, row.threadId, { key: run, by: staffId });
      await raisedOn(tx, row.threadId, { plan: !!a.plan });
    }
    if (attach?.length)
      await tx
        .insert(attachments)
        .values(
          attach.map((path) => ({ staffId, path, mediaType: mediaTypeOf(path), askId: row.id }))
        );
    return row;
  });
  return { ask, precedent: await precedent(`${a.title}\n${a.why}`) };
}

export async function ask(id: number): Promise<AskRow | undefined> {
  const [row] = await db.select().from(asks).where(eq(asks.id, id));
  return row;
}

export async function asksFor(staffId: string): Promise<AskRow[]> {
  return db
    .select()
    .from(asks)
    .where(eq(asks.staffId, staffId))
    .orderBy(desc(asks.createdAt))
    .limit(30);
}

export type Decision = 'approve' | 'deny' | 'iterate';

/** The kinds of ask that have twins (`asksNoMore`): an outside tool, a folder, and switches. */
const TWINNED: AskKind[] = ['access', 'folder', 'switch'];

/**
 * Whether `later` asks for nothing `first` does not: the same Odd, the same
 * tool or folder, at the same level or lower. Asks for another Google account
 * of one product are the same tool. Two runs of one Odd can each find a tool
 * or a folder missing at once (a hire's first day and its lead's first
 * hand-off), and each raises its own ask. The owner sees the first alone
 * (`desk`), and their answer to it answers the twin too (`decide`), each back
 * where it came from.
 */
function asksNoMore(first: AskRow, later: AskRow): boolean {
  if (first.id === later.id || first.staffId !== later.staffId) return false;
  if (first.kind === 'access' && later.kind === 'access' && first.access && later.access)
    return (
      first.access.another === later.access.another &&
      (!!first.access.another || first.access.connector === later.access.connector) &&
      levelAtMost(later.access.level, first.access.level)
    );
  if (first.kind === 'folder' && later.kind === 'folder' && first.folder && later.folder)
    return (
      first.folder.path === later.folder.path &&
      (first.folder.level === 'write' || later.folder.level === 'read')
    );
  if (first.kind === 'switch' && later.kind === 'switch')
    return (later.switches ?? []).every((s) => first.switches?.includes(s));
  return false;
}

/** Whether two asks of one kind ask for the same tool or folder, whatever the level. */
const sameWanted = (a: AskRow, b: AskRow) =>
  a.kind === 'folder'
    ? a.folder?.path === b.folder?.path
    : a.kind === 'switch'
      ? (b.switches ?? []).every((s) => a.switches?.includes(s))
      : a.access?.connector === b.access?.connector;

/**
 * The other access or folder asks the owner's one answer settled with `a`:
 * the same Odd and tool or folder, decided in the same moment, whichever of
 * them the owner saw.
 */
export async function answeredWith(a: AskRow): Promise<AskRow[]> {
  if (!TWINNED.includes(a.kind) || !a.decidedAt) return [];
  const rows = await db
    .select()
    .from(asks)
    .where(
      and(eq(asks.staffId, a.staffId), eq(asks.kind, a.kind), eq(asks.decidedAt, a.decidedAt))
    );
  return rows.filter((r) => r.id !== a.id && r.status === a.status && sameWanted(a, r));
}

/**
 * Which of the asks one answer settled start a `carry_out`: one for each place
 * a result must go back to, never one per ask. A hand-off's twin comes first,
 * then a thread's; a twin on neither starts a run only when no other does.
 * Two runs of one Odd once each did the same work after one answer, and the
 * owner got every email reply twice.
 */
function carriedOutBy(together: AskRow[]): AskRow[] {
  const rank = (a: AskRow) => (a.handOffId ? 0 : a.threadId ? 1 : 2);
  const places = new Set<string>();
  const runs: AskRow[] = [];
  for (const a of [...together].sort((x, y) => rank(x) - rank(y) || x.id - y.id)) {
    const place = a.handOffId
      ? `hand-off ${a.handOffId}`
      : a.threadId
        ? `thread ${a.threadId}`
        : '';
    if (places.has(place) || (place === '' && runs.length)) continue;
    places.add(place);
    runs.push(a);
  }
  return runs;
}

/** Start the carry-outs for asks one answer settled (`carriedOutBy`). */
async function carryOutTogether(together: AskRow[]): Promise<void> {
  for (const a of carriedOutBy(together))
    await followUp(a.staffId, 'carry_out', { askId: a.id, note: null });
}

/**
 * The twins the carry-out of `a` stands for: answered with it, starting no
 * run of their own. Only the first run told of them does their work, so it
 * is done once.
 */
export async function standsFor(a: AskRow): Promise<AskRow[]> {
  const together = [a, ...(await answeredWith(a))];
  const runs = carriedOutBy(together);
  if (runs[0]?.id !== a.id) return [];
  return together.filter((x) => !runs.some((r) => r.id === x.id));
}

/**
 * The owner's decision. Approving an access ask grants it and gives the owner the steps
 * to connect; approving any other ask but a hire sends the staffer to carry it
 * out. A hire is approved by hiring, from the hire window. Iterate sends it
 * back with what to change, and needs their words; an ask the office raised
 * itself takes a yes or a no only (`yesOrNo`).
 */
export async function decideAsk(
  id: number,
  decision: Decision,
  reason: string | null,
  reportWhenDone = false
): Promise<void> {
  await decide(id, decision, reason, { reportWhenDone });
}

/** What approving an ask means, done before the answer goes back. */
export type Approval = {
  /**
   * Done in the transaction that approves the ask: if it fails, the ask stays
   * open, and nothing is recorded or answered.
   */
  link?: (ask: AskRow, tx: Tx) => Promise<void>;
  /** Done once the ask is approved, so the run the answer starts finds it. */
  carryOut?: (ask: AskRow) => Promise<void>;
};

/**
 * Approve a goal, plan or hire ask, and do what approving it means before the
 * answer goes back, so the run the answer starts finds all of it: the goal
 * set, the plan's jobs, hire asks and owner task, or the hire serving its goal.
 * Nothing is done when the ask was no longer open, and that returns false.
 */
export async function approveAsk(
  id: number,
  reason: string | null,
  approval: Approval
): Promise<boolean> {
  return decide(id, 'approve', reason, approval);
}

/**
 * The owner sent a reply ask's email, or saved it to Gmail drafts, and Gmail
 * took it: keep their final version with what Gmail did (`reply.sent`), and
 * approve the ask, so the answer goes back where it came from. No run follows.
 * Returns false when the ask was no longer open.
 */
export async function approveReply(id: number, reply: ReplyDraft): Promise<boolean> {
  if (!reply.sent) throw new Error('A reply is approved only once Gmail took it');
  return decide(id, 'approve', null, { reply });
}

/**
 * The owner created a filter ask's Gmail filter, and Gmail took it: keep their
 * final version with what Gmail did (`filter.created`), and approve the ask,
 * so the answer goes back where it came from. No run follows. Returns false
 * when the ask was no longer open.
 */
export async function approveFilter(id: number, filter: GmailFilter): Promise<boolean> {
  if (!filter.created) throw new Error('A filter is approved only once Gmail made it');
  return decide(id, 'approve', null, { filter });
}

/**
 * The office made a call ask's held call on the owner's yes: keep what came
 * back (`call.result`) and approve the ask, which starts the Odd's carry-out
 * run with the result. Returns false when the ask was no longer open.
 */
export async function approveCall(id: number, call: HeldCall): Promise<boolean> {
  if (!call.result) throw new Error('A call is approved only once the office made it');
  return decide(id, 'approve', null, { call });
}

/** Where a held call lands: the run's Odd, and what its own asks carry. */
export type CallPlace = {
  staffId: string;
  /** The run's key, which a thread it is raised on keeps (`raiseAsk`). */
  run: string;
  handOffId?: number;
  threadId?: number;
  via?: string;
};

/**
 * An Odd at Draft called a tool that changes something: the gateway holds
 * the call and it goes on the desk as a `call` ask, showing the exact call.
 * The same call still open is not raised twice: the Odd hears the one there.
 */
export async function raiseCall(
  place: CallPlace,
  call: HeldCall,
  service: string
): Promise<{ ask: AskRow; already: boolean }> {
  const same = (r: AskRow) =>
    r.call?.connector === call.connector &&
    r.call.tool === call.tool &&
    JSON.stringify(r.call.arguments) === JSON.stringify(call.arguments);
  const open = await db
    .select()
    .from(asks)
    .where(and(eq(asks.staffId, place.staffId), eq(asks.kind, 'call'), eq(asks.status, 'open')));
  const there = open.find(same);
  if (there) return { ask: there, already: true };
  const { ask } = await raiseAsk(place.staffId, {
    kind: 'call',
    title: `Use ${call.tool} in ${service}`,
    why: `Called while working at Drafts for your yes, so the office held it for you.`,
    ifApproved: `The office makes this exact call to ${service}, and the work carries on with what it returns.`,
    call,
    handOffId: place.handOffId,
    threadId: place.threadId,
    via: place.via,
    run: place.run
  });
  return { ask, already: false };
}

/** What a made call returned, cut to fit a ledger line or a brief. */
export const callResultText = (r: NonNullable<HeldCall['result']>, max = 4000): string =>
  `${r.ok ? '' : 'The tool said it failed: '}${r.text.length > max ? `${r.text.slice(0, max)}…` : r.text}`;

/** Why the owner's Give access on a folder ask gave nothing, with the status the route answers. */
export type FolderNotGiven = { refused: string; status: 400 | 404 | 409 };

/** A folder `setFolder` refused while approving its ask: the approval rolls back. */
class FolderRefused extends Error {}

/**
 * Turn on the switches a switch ask asked for, in `tx`, with the yes, or
 * neither happens. Ones already on stay as they are. Refused when the Odd's
 * tool on this system never runs commands, as the staff PATCH refuses it,
 * since the Odd may have moved tools since it asked.
 */
async function turnOnSwitches(
  tx: Tx,
  a: AskRow
): Promise<{ before: StaffRow; after: StaffRow; on: OwnSwitch[] } | undefined> {
  const [before] = await tx.select().from(staff).where(eq(staff.id, a.staffId));
  if (!before) return;
  const on = switchesOff(before, a.switches ?? []);
  if (on.includes('commands') && commandsHow(before.agent, process.platform).state === 'never')
    throw fixedError(
      "This Odd's tool cannot run commands here. Move it to another tool on its Settings tab first"
    );
  if (!on.length) return { before, after: before, on };
  const [after] = await tx
    .update(staff)
    .set(Object.fromEntries(on.map((s) => [s, true])))
    .where(eq(staff.id, a.staffId))
    .returning();
  return { before, after, on };
}

/**
 * The owner gives the folder a folder ask asked for, or a narrower one, at
 * the level they pick: `path` as typed or picked, checked as the Settings tab
 * checks it (`checkFolder`). The folder is given (`changeFolder`, as
 * `setFolder` does) in the transaction that approves the ask, so a refusal
 * leaves the ask open and the folder as it was. One ledger line, in the
 * Settings tab's words, and the approval starts the run that carries the ask
 * out, which finds the folder in its reach. A plain approve is refused
 * (`decide`). A whole drive or system files, which the owner can type there,
 * comes back as a `warning` and changes nothing until they accept it.
 */
export async function giveFolder(
  id: number,
  path: string,
  level: FolderAccess,
  reason: string | null = null,
  accept = false
): Promise<
  { given: { path: string; level: FolderAccess } } | { warning: string } | FolderNotGiven
> {
  const a = await ask(id);
  if (!a || a.kind !== 'folder' || !a.folder)
    return { refused: 'No such folder ask.', status: 404 };
  if (a.status !== 'open') return { refused: 'You already answered this ask.', status: 409 };
  const checked = checkFolder(path, accept);
  if ('refused' in checked) return { refused: checked.refused, status: 400 };
  if ('warning' in checked) return checked;
  const given = { path: checked.real, level };
  try {
    const done = await decide(id, 'approve', reason, { folder: { ...a.folder, given } });
    if (!done) return { refused: 'You already answered this ask.', status: 409 };
  } catch (e) {
    if (e instanceof FolderRefused) return { refused: e.message, status: 400 };
    throw e;
  }
  return { given };
}

/** A created filter in one line, for its ledger line and the answer: what it does, and what was tidied. */
const filterDone = (f: GmailFilter) =>
  `${filterWords(f)}${f.created?.tidied ? `, and tidied ${f.created.tidied} ${f.created.tidied === 1 ? 'email' : 'emails'}` : ''}`;

/** What a reply ask's ledger line and answer say the owner did with it. */
const replyDone = (r: ReplyDraft) =>
  r.sent?.action === 'draft' ? 'Saved to Gmail drafts' : 'Sent';

async function decide(
  id: number,
  decision: Decision,
  reason: string | null,
  o: Approval & {
    reportWhenDone?: boolean;
    reply?: ReplyDraft;
    filter?: GmailFilter;
    call?: HeldCall;
    folder?: FolderRequest;
  }
): Promise<boolean> {
  if (decision === 'iterate' && !reason) throw fixedError('Say what to change');
  if (decision !== 'deny') {
    const [raised] = await db.select({ kind: asks.kind }).from(asks).where(eq(asks.id, id));
    if (decision === 'iterate' && yesOrNo(raised?.kind))
      throw new Error('Say yes or no: the office raised this, so nobody reworks it');
    // Only the office's send or save approves a reply, once Gmail took it.
    if (decision === 'approve' && raised?.kind === 'reply' && !o.reply)
      throw new Error('Send the reply, or save it to Gmail drafts');
    // Only the office's Create filter approves a filter, once Gmail made it.
    if (decision === 'approve' && raised?.kind === 'filter' && !o.filter)
      throw new Error('Create the filter from its card on the desk');
    // Only the office's own call approves a held call, once it made it.
    if (decision === 'approve' && raised?.kind === 'call' && !o.call)
      throw new Error('Approve the call from its card on the desk');
    // Only the office's Give access approves a folder ask, giving the folder with it.
    if (decision === 'approve' && raised?.kind === 'folder' && !o.folder?.given)
      throw new Error('Give the folder from its card on the desk');
  }
  const status = decision === 'approve' ? 'approved' : decision === 'deny' ? 'denied' : 'revise';
  const at = new Date();
  const { ask, twins, turned } = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(asks)
      .set({
        status,
        reason: reason || null,
        decidedAt: at,
        ...(o.reply ? { reply: o.reply } : {}),
        ...(o.filter ? { filter: o.filter } : {}),
        ...(o.call ? { call: o.call } : {}),
        ...(o.folder ? { folder: o.folder } : {})
      })
      .where(and(eq(asks.id, id), eq(asks.status, 'open')))
      .returning();
    if (claimed) await o.link?.(claimed, tx);
    if (claimed?.kind === 'hand_offs' && decision === 'approve') await startHeld(tx, claimed);
    // The folder goes to the Odd with the yes, or neither happens.
    const given = claimed?.kind === 'folder' && decision === 'approve' && o.folder?.given;
    if (claimed && given) {
      const changed = await changeFolder(tx, claimed.staffId, given.path, given.level);
      if (changed && 'refused' in changed) throw new FolderRefused(changed.refused);
    }
    // The switches turn on with the yes, or neither happens.
    const turned =
      claimed?.kind === 'switch' && decision === 'approve'
        ? await turnOnSwitches(tx, claimed)
        : undefined;
    // A yes or a no answers the twins too, at the same moment (`answeredWith`).
    // Sending one back leaves them waiting for the new version's answer.
    const open =
      claimed && TWINNED.includes(claimed.kind) && decision !== 'iterate'
        ? await tx
            .select()
            .from(asks)
            .where(
              and(
                eq(asks.staffId, claimed.staffId),
                eq(asks.kind, claimed.kind),
                eq(asks.status, 'open')
              )
            )
        : [];
    const ids = open.filter((r) => asksNoMore(claimed!, r)).map((r) => r.id);
    const answered = ids.length
      ? await tx
          .update(asks)
          .set({ status, reason: reason || null, decidedAt: at })
          .where(and(inArray(asks.id, ids), eq(asks.status, 'open')))
          .returning()
      : [];
    return { ask: claimed, twins: answered, turned };
  });
  if (!ask) return false;
  const sent = decision === 'approve' && ask.reply?.sent ? ask.reply : undefined;
  const made = decision === 'approve' && ask.filter?.created ? ask.filter : undefined;
  const called = decision === 'approve' && ask.call?.result ? ask.call.result : undefined;
  const gave = decision === 'approve' ? ask.folder?.given : undefined;
  const verb = sent
    ? replyDone(sent)
    : { approve: 'Approved', deny: 'Denied', iterate: 'Sent back' }[decision];
  await record({
    kind: 'decision',
    actor: 'owner',
    // A folder given or a switch turned on from its ask reads as the Settings tab's change does.
    title: made
      ? `Created a Gmail filter: ${filterDone(made)}`
      : gave
        ? gaveFolder((await staffer(ask.staffId))?.name ?? ask.staffId, gave.path, gave.level)
        : turned?.on.length
          ? turnedOn(turned.before.name, turned.on)
          : called
            ? `${called.ok ? 'Made' : 'Made, and it failed'}: ${ask.title}`
            : `${verb}: ${ask.title}`,
    body: `${sent ? `To ${sent.to.join(', ')}${sent.cc.length ? `, cc ${sent.cc.join(', ')}` : ''}. Subject: ${sent.subject}. ` : ''}${called ? `It returned: ${callResultText(called, 600)} ` : ''}${turned ? (networkNote(turned.before, turned.after).body ?? '') + ' ' : ''}Asked by ${ask.staffId}. ${ask.why}${
      twins.length
        ? ` This also answers ${twins.map((t) => `#${t.id}`).join(', ')}, the same ask from another of ${ask.staffId}'s runs.`
        : ''
    }`,
    reason: ask.reason,
    askId: ask.id
  });
  await o.carryOut?.(ask);
  if (decision === 'approve' && ask.access) {
    const { task, connector: granted } = await grantAccess(ask.staffId, ask.access, ask.id);
    // Another Google account is a new connector: the ask and its twins name
    // it from now on, so finishing the connect task finds them.
    if (ask.access.another)
      await db
        .update(asks)
        .set({ access: { ...ask.access, connector: granted } })
        .where(
          inArray(
            asks.id,
            [ask, ...twins].map((a) => a.id)
          )
        );
    // Connected already: the work that waited picks up now. Otherwise finishing
    // the connect task starts it (`finishTask`).
    if (!task) await carryOutTogether([ask, ...twins]);
  } else if (gave || turned)
    // The folder or the switches are the Odd's now: the work that waited on them picks up.
    await carryOutTogether([ask, ...twins]);
  else if (decision === 'approve' && (ask.kind === 'approval' || ask.kind === 'call'))
    await followUp(ask.staffId, 'carry_out', {
      askId: ask.id,
      note: ask.reason,
      reportWhenDone: o.reportWhenDone
    });
  else if (decision === 'iterate')
    await followUp(ask.staffId, 'rework', { askId: ask.id, note: ask.reason });
  // No run carries out a denial, or a hire, goal, plan or more hand-offs the owner
  // approved: the answer itself goes back to a hand-off the ask came from, or
  // to the thread's hub. A yes to more hand-offs started the hand-off it held
  // with the claim, and a no stops the thread. A yes to the usage window wakes the threads it held.
  else {
    const owner = await ownerName();
    const said = sent
      ? `${owner} ${sent.sent?.action === 'draft' ? 'saved to Gmail drafts' : 'sent'} "${ask.title}"`
      : made
        ? `${owner} created the Gmail filter "${ask.title}" as: ${filterDone(made)}`
        : `${owner} ${decision === 'deny' ? 'said no to' : 'approved'} "${ask.title}"`;
    const answer = ask.reason ? `${said}: ${ask.reason}` : `${said}.`;
    if (ask.kind === 'window') {
      // The title asks whether to pause the work or let it carry on, so "approved" would not say which.
      const ran = `${owner} let hand-offs run until the usage window resets. Hand on the work the office held.`;
      await answerWindow(
        ask.id,
        decision === 'approve',
        ask.reason ? `${ran} They said: ${ask.reason}` : ran
      );
    } else if (ask.kind === 'hand_offs' && ask.threadId)
      await answerHandOffs({ ...ask, threadId: ask.threadId }, decision === 'approve', answer);
    else
      for (const a of [ask, ...twins])
        await answerLater(
          { handOffId: a.handOffId, threadId: a.threadId, askId: a.id },
          decision === 'deny' ? 'failed' : 'done',
          answer
        );
    // A no with a reason may be a lesson: the Odd that asked reads it once. The
    // office raised a window ask, not the Odd named on it, so it has none to learn.
    if (decision === 'deny' && ask.reason && ask.kind !== 'window')
      await followUp(ask.staffId, 'denied', { askId: ask.id, note: ask.reason });
  }
  return true;
}

/**
 * The owner answered something raised on a hand-off or a thread, and no run
 * follows it: the answer itself goes back. A colleague's goes to the Odd that
 * handed it the work, and a hub's starts the hub's next run on its thread,
 * which knows the ask it answers, if it was one.
 */
async function answerLater(
  on: { handOffId: number | null; threadId: number | null; askId?: number },
  outcome: Outcome,
  answer: string
): Promise<void> {
  if (on.handOffId) await handBackLater(on.handOffId, outcome, answer);
  else if (on.threadId) await answerThread(on.threadId, answer, on.askId);
}

/**
 * The owner replied in chat about a report: it leaves their desk, and the ledger
 * keeps what they said, so the staff can find how they judged it later.
 */
export async function replyToReport(id: number, note: string): Promise<ReportRow> {
  const r = await report(id);
  if (!r) throw fixedError('No such report');
  if (!r.readAt) await readReport(id);
  await record({
    kind: 'decision',
    actor: 'owner',
    title: `Feedback on: ${r.title}`,
    reason: note
  });
  return r;
}

// Follow-ups: work a staffer owes once the owner answers it or finishes a task it
// gave them. The office starts each one as soon as it is written.

export type FollowUpRow = typeof followUps.$inferSelect;

async function followUp(
  staffId: string,
  kind: FollowUpKind,
  f: {
    askId?: number;
    reportId?: number;
    taskId?: number;
    note: string | null;
    reportWhenDone?: boolean;
  }
): Promise<void> {
  // The answer to something raised on a thread works on that thread.
  const [on] = servesNoThread(kind)
    ? []
    : f.askId
      ? await db.select({ threadId: asks.threadId }).from(asks).where(eq(asks.id, f.askId))
      : f.taskId
        ? await db.select({ threadId: tasks.threadId }).from(tasks).where(eq(tasks.id, f.taskId))
        : [];
  await addFollowUp(db, { staffId, kind, ...f, threadId: on?.threadId });
}

/**
 * A new hire's first day: right after it says hello, a hire with a job starts
 * its work. Its result goes on the owner's desk, so they see the first piece
 * of work. A hire with no job gets none (`firstDay` in the office decides): one
 * that serves a goal gets its first piece from the goal's lead, on the goal's
 * thread, and any other runs only when handed work.
 */
export async function startFirstDay(staffId: string): Promise<void> {
  await addFollowUp(db, { staffId, kind: 'first_day', note: null, reportWhenDone: true });
}

/**
 * Follow-ups ready to start, by id, with the ask, report, task, goal or thread
 * each is about. Not the rows: a run takes its row from the claim
 * (`startFollowUp`), with any answer that joined it since this list.
 */
export async function followUpsToDo(): Promise<
  {
    id: number;
    ask?: AskRow;
    report?: ReportRow;
    task?: TaskRow;
    goal?: typeof goals.$inferSelect;
  }[]
> {
  const rows = await db
    .select()
    .from(followUps)
    .where(and(isNull(followUps.startedAt), not(waitsOnOwnRun())))
    .orderBy(asc(followUps.createdAt));
  return Promise.all(
    rows.map(async (f) => {
      const a = f.askId ? await ask(f.askId) : undefined;
      // The owner's answer to a plan, or to a hire it proposed, is about the plan's goal.
      const goalId = f.goalId ?? a?.plan?.goalId ?? a?.hire?.goal?.id;
      return {
        id: f.id,
        ask: a,
        report: f.reportId
          ? (await db.select().from(reports).where(eq(reports.id, f.reportId)))[0]
          : undefined,
        task: f.taskId
          ? (await db.select().from(tasks).where(eq(tasks.id, f.taskId)))[0]
          : undefined,
        goal: goalId ? (await db.select().from(goals).where(eq(goals.id, goalId)))[0] : undefined
      };
    })
  );
}

/**
 * An Odd runs once at a time on a thread: a follow-up on one waits while a run
 * of the same Odd there has yet to end. So a hub never picks its thread up
 * twice at once, and a colleague's run on the owner's answer starts only once
 * the run that raised it ended. Answers that come meanwhile join the waiting
 * `resume` (`answerThread`), and results the waiting `handed_back`
 * (`resultsToJoin`); the run ending starts it. A hand-off is new work, not a
 * pick-up, so several may run side by side, even for one colleague. A run on
 * no thread, such as a chat, a job or a follow-up like a carry-out, counts on
 * each thread it put work on, a hand-off held or not or a goal's plan
 * (`threads.runs`, `keepRun`), while its key is in `runsGoing`.
 */
function waitsOnOwnRun(): SQL {
  const busy = alias(followUps, 'busy');
  const ownRun = db
    .select({ id: busy.id })
    .from(busy)
    .where(
      and(
        eq(busy.staffId, followUps.staffId),
        eq(busy.threadId, followUps.threadId),
        isNotNull(busy.startedAt),
        isNull(busy.outcome)
      )
    );
  // With no run going there is no key to look for, and drizzle refuses an empty list.
  const held = runsGoing.size
    ? or(
        exists(ownRun),
        exists(
          db
            .select({ id: threads.id })
            .from(threads)
            .where(
              and(
                eq(threads.id, followUps.threadId),
                eq(threads.hubId, followUps.staffId),
                arrayOverlaps(threads.runs, [...runsGoing])
              )
            )
        )
      )
    : exists(ownRun);
  // Bracketed, since callers negate it.
  return sql`(${ne(followUps.kind, 'hand_off')} and (${held}))`;
}

/**
 * The keys of the runs going in this process. The office gives every run one,
 * and a thread it takes a hand-off on keeps it (`threads.runs`), so while it
 * goes the hub's pick-ups there wait (`waitsOnOwnRun`). Kept in memory, not
 * the database: a restart ends every run, and so every hold, and nothing
 * waits forever.
 */
export const runsGoing = new Set<string>();

/**
 * Claim a follow-up, and return it as claimed: an answer that joined it after
 * it was listed is in its note (`answerThread`). Undefined when something else
 * already started it, or it waits (`waitsOnOwnRun`).
 */
export async function startFollowUp(id: number): Promise<FollowUpRow | undefined> {
  return db.transaction(async (tx) => {
    // The thread is locked, so two claims on it at once cannot each miss the
    // other's run starting, and both go.
    const [on] = await tx
      .select({ threadId: followUps.threadId })
      .from(followUps)
      .where(eq(followUps.id, id));
    if (on?.threadId)
      await tx
        .select({ id: threads.id })
        .from(threads)
        .where(eq(threads.id, on.threadId))
        .for('update');
    const [claimed] = await tx
      .update(followUps)
      .set({ startedAt: new Date() })
      .where(and(eq(followUps.id, id), isNull(followUps.startedAt), not(waitsOnOwnRun())))
      .returning();
    return claimed;
  });
}

/**
 * The ledger title of each follow-up as it ends, before what it was about. The
 * owner reads these in the Ledger window, so none names a thread or a hand-off.
 */
export const OUTCOME_TITLE: Record<FollowUpKind, Record<Outcome, string>> = {
  carry_out: { done: 'Did', failed: 'Failed', waiting: 'Waiting on {owner} for' },
  rework: { done: 'Reworked', failed: 'Could not rework', waiting: 'Reworked' },
  denied: {
    done: 'Took in the no on',
    failed: 'Could not take in the no on',
    waiting: 'Waiting on {owner} after the no on'
  },
  feedback: {
    done: 'Acted on feedback on',
    failed: 'Could not act on feedback on',
    waiting: 'Waiting on {owner} after feedback on'
  },
  task_done: {
    done: 'Picked up after',
    failed: 'Could not pick up after',
    waiting: 'Waiting on {owner} after'
  },
  first_day: {
    done: 'First day',
    failed: 'First day stalled',
    waiting: 'First day, waiting on {owner}'
  },
  goal: {
    done: 'Planned the goal',
    failed: 'Could not plan the goal',
    waiting: 'Brought {owner} the plan for the goal'
  },
  hand_off: {
    done: 'Did work a colleague handed over',
    failed: 'Could not do work a colleague handed over',
    waiting: 'Waiting on {owner} for work a colleague handed over'
  },
  handed_back: {
    done: 'Picked up what a colleague finished',
    failed: 'Could not pick up what a colleague finished',
    waiting: 'Waiting on {owner} after a colleague finished'
  },
  resume: {
    done: 'Picked back up',
    failed: 'Could not pick back up',
    waiting: 'Waiting on {owner} after picking back up'
  },
  edited: {
    done: "Read {owner}'s edit to",
    failed: "Could not read {owner}'s edit to",
    waiting: 'Waiting on {owner} after their edit to'
  }
};

/**
 * Record how a follow-up ended. Every outcome goes in the ledger. The owner's desk
 * gets a failure no lead is woken for, and a success only when the owner asked
 * for one. When the staffer is waiting, what it needs is already on their desk
 * as an ask or task. `joined` are the results this run picked up with its own
 * (`resultsToJoin`): they end with it.
 */
export async function finishFollowUp(
  f: FollowUpRow,
  about: string,
  outcome: Outcome,
  result: string,
  o: { joined?: number[] } = {}
): Promise<void> {
  const joined = o.joined ?? [];
  const title = `${OUTCOME_TITLE[f.kind][outcome].replace('{owner}', await ownerName())}: ${about}`;
  const origin = await servesHandOff(f);
  // Once only. The outcome, the owner's report and a hand-off's result going
  // back are written together or not at all, so a restart or a second call
  // never leaves the desk short or the staffer that handed it waiting.
  const finished = await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(followUps)
      .set({ outcome, result, doneAt: now })
      .where(and(eq(followUps.id, f.id), isNull(followUps.outcome)))
      .returning({ id: followUps.id });
    if (!row) return false;
    if (joined.length)
      await tx
        .update(followUps)
        .set({ startedAt: now, outcome, result, doneAt: now })
        .where(
          and(
            inArray(followUps.id, joined),
            eq(followUps.staffId, f.staffId),
            eq(followUps.kind, 'handed_back'),
            isNull(followUps.startedAt)
          )
        );
    // Work that serves a hand-off reports back to the Odd that handed it: the
    // hand-off's own run however it ended, a later run once it ended, since a
    // run left waiting has put what it needs on the desk, and the owner's
    // answer brings the next run. The hand-off's own run left waiting goes
    // back only while something it raised is still open: once the owner
    // answered all of it, that answer went back already (`handBackLater`) or
    // started a run whose result will, so "waiting" would be stale.
    const back =
      origin && (outcome !== 'waiting' || (f.kind === 'hand_off' && !(await answeredAll(tx, f.id))))
        ? handBack(origin, outcome, result)
        : undefined;
    // A failure that goes back to a lead goes to the lead only: the lead
    // picks it up at once and decides what comes next, so a desk item would
    // wait on the owner for work already moving. With no one to wake, the
    // owner hears.
    const reported = outcome === 'failed' ? !back : outcome === 'done' && f.reportWhenDone;
    if (reported) await tx.insert(reports).values({ staffId: f.staffId, title, body: result });
    // The hand-back moves the thread on; with none, the outcome may end it.
    if (back) await addFollowUp(tx, back);
    else if (f.threadId) await settleThread(tx, f.threadId);
    return true;
  });
  // The ledger row embeds its text first, which can take a while: outside the transaction.
  if (finished)
    await record({
      kind: 'work',
      actor: f.staffId,
      title,
      body: result,
      askId: f.askId ?? undefined
    });
}

/** The result of a run a restart cut off. */
export const CUT_OFF_RESULT =
  'The office restarted while this was running, so it may be half done. Check it, then ask the Odd to finish it.';

/** Follow-ups a restart cut off mid-run. They fail rather than run twice. */
export async function closeStaleFollowUps(): Promise<void> {
  const stale = await db
    .select()
    .from(followUps)
    .where(and(isNotNull(followUps.startedAt), isNull(followUps.outcome)));
  for (const f of stale) await finishFollowUp(f, await workTitle(f), 'failed', CUT_OFF_RESULT);
}

/**
 * What the Ledger names work when no title is left for it, such as an ask
 * since removed, or a first day. The owner reads it after each kind's
 * `OUTCOME_TITLE`, so it names no thread and no number (test/owner-tables.test.ts).
 */
export const CUT_OFF_WORK: Record<FollowUpKind, string> = {
  carry_out: 'an ask',
  rework: 'an ask',
  denied: 'an ask',
  feedback: 'a report',
  task_done: 'a task',
  first_day: 'getting started',
  goal: 'a goal',
  hand_off: 'the work',
  handed_back: 'the work',
  resume: 'the work',
  edited: 'a file'
};

/**
 * What the Ledger names the work a follow-up was about, whether it finished or
 * a restart cut it off: its ask's, hand-off's, file's, task's, goal's or
 * report's title. A lead picking a thread back up names its goal, or the
 * thread's own title when it serves none, never the thread itself. With no
 * title left, its kind's plain words (`CUT_OFF_WORK`).
 */
export async function workTitle(f: FollowUpRow): Promise<string> {
  return (await titleOf(f)) ?? CUT_OFF_WORK[f.kind];
}

async function titleOf(f: FollowUpRow): Promise<string | undefined> {
  if (f.askId) return (await ask(f.askId))?.title;
  if (f.handOff) return f.handOff.title;
  if (f.edit) return f.edit.path;
  if (f.taskId) return (await task(f.taskId))?.title;
  if (f.goalId)
    return (await db.select({ title: goals.title }).from(goals).where(eq(goals.id, f.goalId)))[0]
      ?.title;
  if (f.kind === 'resume' && f.threadId) {
    const [t] = await db
      .select({ goal: goals.title, title: threads.title })
      .from(threads)
      .leftJoin(goals, eq(goals.id, threads.goalId))
      .where(eq(threads.id, f.threadId));
    return t?.goal ?? t?.title;
  }
  if (f.reportId)
    return (
      await db.select({ title: reports.title }).from(reports).where(eq(reports.id, f.reportId))
    )[0]?.title;
  return undefined;
}

// Access

/**
 * Grant access, then give the owner whatever steps connecting it still needs.
 * Says whether that put a task on the desk (a tool already connected needs
 * none), and which connector it granted: with `another`, a new one for one
 * more Google account, made once the grant can go.
 */
export async function grantAccess(
  staffId: string,
  req: AccessRequest,
  askId?: number
): Promise<{ task: boolean; connector: string }> {
  const who = await staffer(staffId);
  const named = await connector(req.connector);
  if (!who || !named) throw fixedError('No such Odd or connector');
  if (req.level === 'draft')
    throw new Error(`${named.name} connects to read, or to read and write`);
  if (!grantWorks(req.level, who.permission))
    throw new Error(`${who.name} holds ${who.permission}, so it cannot be given ${req.level}`);
  if (req.another && named.config.google !== req.another)
    throw new Error(`Only Gmail and Google Drive take another account`);
  const conn = req.another ? await addGoogleAccount(req.another) : named;
  await db
    .insert(grants)
    .values({ staffId, connectorId: conn.id, level: req.level, askId })
    .onConflictDoUpdate({
      target: [grants.staffId, grants.connectorId],
      set: { level: req.level, askId, grantedAt: new Date() }
    });
  const steps = connectSteps(conn);
  if (steps.length) {
    // A further Google account not signed in yet reads as one, beside the one already there.
    const g = conn.config.google;
    const called =
      g && conn.id !== GOOGLE[g].id && !conn.config.account
        ? `another ${conn.name} account`
        : conn.name;
    await db.insert(tasks).values({
      staffId,
      askId,
      title: `Connect ${called} for ${who.name}`,
      why: `${who.name} needs ${conn.name} at ${req.level} level.`,
      steps
    });
    return { task: true, connector: conn.id };
  }
  // Already connected: the staffer can use it now, and nothing waits on the owner.
  await record({
    kind: 'access',
    actor: 'owner',
    title: `Gave ${who.name} ${conn.name} (${req.level})`,
    body: `${conn.name} was already connected, so there were no steps for ${await ownerName()}.`,
    askId
  });
  // An ask's carry-out is its caller's to start (`decide`), since one answer may settle twins.
  return { task: false, connector: conn.id };
}

/**
 * A tool the owner already gave a staffer stopped working: its connect steps go
 * on the desk again, after the staffer's own steps for getting a new key. There
 * is no ask, since the owner said yes once. A tool has one open reconnect at a time.
 */
export async function reconnectTask(
  staffId: string,
  connectorId: string,
  problem: string,
  getKey: string[]
): Promise<{ task: TaskRow; already: boolean } | { problem: string }> {
  const who = await staffer(staffId);
  const conn = await connector(connectorId);
  if (!who || !conn) return { problem: `No connector named ${connectorId}.` };
  const [grant] = await db
    .select()
    .from(grants)
    .where(and(eq(grants.staffId, staffId), eq(grants.connectorId, conn.id)));
  if (!grant) return { problem: `You were never given ${conn.name}. Use ask_for_access.` };
  const open = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, 'open'), eq(tasks.staffId, staffId)));
  const waiting = open.find((t) =>
    t.steps.some((st) => st.action && 'connector' in st.action && st.action.connector === conn.id)
  );
  if (waiting) return { task: waiting, already: true };
  const steps = connectSteps(conn, true);
  const task = await giveTask(staffId, {
    title: `Reconnect ${conn.name} for ${who.name}`,
    why: problem,
    steps: [...getKey, ...steps],
    byOffice: true
  });
  return { task, already: false };
}

/**
 * The owner wants an AWS tool on another role or Region: its one desk step
 * goes on the desk again, from the office, starting on what it uses now.
 * Picking connects it again. A tool has one open at a time.
 */
export async function changeAwsTask(connectorId: string): Promise<TaskRow> {
  const conn = await connector(connectorId);
  if (!conn || !isAws(conn.id)) throw new Error('Only an AWS tool has a role and Region to change');
  const open = await db.select().from(tasks).where(eq(tasks.status, 'open'));
  const waiting = open.find((t) =>
    t.steps.some((st) => st.action?.kind === 'aws' && st.action.connector === conn.id)
  );
  if (waiting) return waiting;
  return giveTask(null, {
    title: `Change the role or Region for ${conn.name}`,
    why: `You asked to change the AWS role or Region ${conn.name} uses.`,
    steps: connectSteps(conn, true)
  });
}

/** The longest name the owner can give a service. */
export const SERVICE_NAME_MAX = 60;

/**
 * The owner names a service, such as Open Brain for a server they added by
 * its address. Odds read the new name too, since every run reads the row.
 */
export async function renameConnector(id: string, name: string): Promise<void> {
  const c = await connector(id);
  if (!c) throw new Error('No such service');
  const named = name.trim().replace(/\s+/g, ' ');
  if (!named || named.length > SERVICE_NAME_MAX)
    throw new Error(`Give it a name of 1 to ${SERVICE_NAME_MAX} characters.`);
  if (named === c.name) return;
  await db.update(connectors).set({ name: named }).where(eq(connectors.id, id));
  await record({ kind: 'access', actor: 'owner', title: `Renamed ${c.name} to ${named}` });
}

/** Each service's name by its id, for the lines that say what an Odd is doing. */
export async function serviceNames(): Promise<Record<string, string>> {
  const rows = await db.select({ id: connectors.id, name: connectors.name }).from(connectors);
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/** A service in the office and every Odd that holds it, for the owner's Services window. */
export type OfficeService = {
  id: string;
  name: string;
  description: string;
  ready: boolean;
  aws: boolean;
  odds: { id: string; name: string; level: Level }[];
};

/** Every service an Odd holds or that is connected, by name, with who holds it. */
export async function services(): Promise<OfficeService[]> {
  const held = await db
    .select({
      connectorId: grants.connectorId,
      level: grants.level,
      id: staff.id,
      name: staff.name
    })
    .from(grants)
    .innerJoin(staff, eq(grants.staffId, staff.id))
    .orderBy(asc(staff.name));
  return (await catalog())
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      ready: !!c.readyAt,
      aws: isAws(c.id),
      odds: held
        .filter((h) => h.connectorId === c.id)
        .map((h) => ({ id: h.id, name: h.name, level: h.level }))
    }))
    .filter((s) => s.ready || s.odds.length);
}

/**
 * The AWS tools, by what the owner wants: their secrets' names (and the
 * office's keys), reading their account, or building in it. The office signs
 * in to AWS itself, once for all three (the office's `aws.ts`).
 */
export const AWS_SECRETS_ID = 'aws-secrets';
export const AWS_READ_ID = 'aws-read';
export const AWS_BUILD_ID = 'aws-build';
export const AWS_IDS: readonly string[] = [AWS_SECRETS_ID, AWS_READ_ID, AWS_BUILD_ID];
export const isAws = (id: string): boolean => AWS_IDS.includes(id);
/** Where the one AWS sign-in sits in the secret store. */
export const AWS_SIGN_IN = { id: 'aws', name: 'sso' } as const;

const AWS_STEP: Record<string, string> = {
  [AWS_SECRETS_ID]:
    'Sign in to AWS, then pick the role the office reads your secrets with. Your Odds see secret names only, never their values.',
  [AWS_READ_ID]:
    'Sign in to AWS, then pick the role your Odds read AWS with. The office checks that it cannot read a secret value.',
  [AWS_BUILD_ID]:
    'Sign in to AWS, then pick the role your Odds build in AWS with. The office checks that it cannot read a secret value.'
};

/** The steps that connect a tool. `again` gives them even when it looks connected. */
function connectSteps(conn: ConnectorRow, again = false): Step[] {
  if (conn.readyAt && !again) return [];
  const key = `oauth:${conn.id}`;
  // One step: picking the role connects the tool too.
  if (isAws(conn.id))
    return [{ text: AWS_STEP[conn.id], done: false, action: { kind: 'aws', connector: conn.id } }];
  return [
    ...(conn.config.oauth
      ? [
          {
            text: `Click Sign in. ${conn.config.oauth === 'google' ? 'Google' : conn.name}'s sign-in page opens in a new tab.`,
            done: false,
            key,
            action: { kind: 'oauth' as const, connector: conn.id }
          },
          {
            text: 'Approve access on that page. This step ticks itself when it lands.',
            done: false,
            key
          }
        ]
      : []),
    ...[...(conn.config.secrets ?? []), ...(conn.config.headers ?? [])].map((name) => ({
      // A server named by its address has one header, and it holds the key.
      text: `Paste ${name === 'Authorization' || (conn.kind === 'http' && !conn.registry) ? `your ${conn.name} key` : `the ${name} value for ${conn.name}`} below. It goes in this computer's password store, never the database.`,
      done: false,
      action: { kind: 'secret' as const, connector: conn.id, name }
    })),
    {
      text: `Click Connect. The office starts ${conn.name} and lists its tools, marking the ones that only read.`,
      done: false,
      action: { kind: 'tools', connector: conn.id }
    }
  ];
}

export async function connector(id: string): Promise<ConnectorRow | undefined> {
  const [row] = await db.select().from(connectors).where(eq(connectors.id, id));
  return row;
}

export async function catalog(): Promise<ConnectorRow[]> {
  return db.select().from(connectors).orderBy(asc(connectors.name));
}

export async function addConnector(c: typeof connectors.$inferInsert): Promise<ConnectorRow> {
  const [row] = await db.insert(connectors).values(c).onConflictDoNothing().returning();
  return row ?? (await connector(c.id))!;
}

/**
 * The Google products the office serves itself: the connector each starts
 * with (migration 0009_google), and its plain name before a sign-in names
 * the account. A further account of one is a connector of its own
 * (`addGoogleAccount`). Code looks a Google connector up by
 * `config.google`, never by its id.
 */
export const GOOGLE: Record<GoogleProduct, { id: string; name: string; description: string }> = {
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    description: "Search, read, label, draft and send mail in the owner's Gmail."
  },
  drive: {
    id: 'google-drive',
    name: 'Google Drive',
    description: "Find and read files in the owner's Google Drive, and write Docs and Sheets."
  }
};

/** Whether two Google addresses are one account: Google ignores case. */
const sameAccount = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Every connector of one Google product, or of both, oldest first. */
export async function googleConnectors(product?: GoogleProduct): Promise<ConnectorRow[]> {
  const rows = await db
    .select()
    .from(connectors)
    .orderBy(asc(connectors.createdAt), asc(connectors.id));
  return rows.filter((c) => (product ? c.config.google === product : !!c.config.google));
}

/**
 * One more Google account of a product: a new connector, `gmail-2`,
 * `gmail-3` and so on, named plainly until its sign-in names the account.
 */
export async function addGoogleAccount(product: GoogleProduct): Promise<ConnectorRow> {
  const g = GOOGLE[product];
  for (;;) {
    const taken = (await googleConnectors(product)).map((c) => c.id);
    let n = 2;
    while (taken.includes(`${g.id}-${n}`)) n++;
    const [row] = await db
      .insert(connectors)
      .values({
        id: `${g.id}-${n}`,
        name: g.name,
        description: g.description,
        kind: 'builtin',
        config: { oauth: 'google', google: product }
      })
      .onConflictDoNothing()
      .returning();
    // Two at once can pick the same number: the second tries the next.
    if (row) return row;
  }
}

/**
 * The Gmail account a reply or filter goes through: the connector it names,
 * or, with none named, the first Gmail account its Odd holds.
 */
export async function mailboxOf(a: AskRow): Promise<ConnectorRow | undefined> {
  const named = a.reply?.connector ?? a.filter?.connector;
  if (named) return connector(named);
  const held = (await grantsFor(a.staffId)).find((g) => g.connector.config.google === 'gmail');
  return held?.connector ?? (await googleConnectors('gmail'))[0];
}

/** Give a connector the name the owner sees. */
export async function nameConnector(id: string, name: string): Promise<void> {
  await db.update(connectors).set({ name }).where(eq(connectors.id, id));
}

/**
 * Another connector of the same Google product already signed in to this
 * address, if one is: one account is one connector.
 */
export async function googleAccountHeld(
  id: string,
  address: string
): Promise<ConnectorRow | undefined> {
  const c = await connector(id);
  if (!c?.config.google) return undefined;
  return (await googleConnectors(c.config.google)).find(
    (o) => o.id !== id && sameAccount(o.config.account, address)
  );
}

/**
 * A Google sign-in landed: the connector keeps the address and is named after
 * it ("Gmail (ada@example.com)"), so the owner and its Odds know whose mail
 * or files it reaches. Its sign-in step reads as it always does again.
 */
export async function signedInAs(id: string, address: string): Promise<void> {
  const c = await connector(id);
  if (!c?.config.google) return;
  await db
    .update(connectors)
    .set({
      name: `${GOOGLE[c.config.google].name} (${address})`,
      config: { ...c.config, account: address }
    })
    .where(eq(connectors.id, id));
  await sayOnSignIn(id);
}

/**
 * Put words before the sign-in step of a connector's open connect tasks, such
 * as why the last sign-in was not kept. None puts the step back as it was.
 */
export async function sayOnSignIn(id: string, words?: string): Promise<void> {
  const c = await connector(id);
  if (!c) return;
  const [plain] = connectSteps(c, true);
  if (!plain) return;
  const open = await db.select().from(tasks).where(eq(tasks.status, 'open'));
  for (const t of open) {
    const steps = t.steps.map((s) =>
      s.action?.kind === 'oauth' && s.action.connector === id
        ? { ...s, text: words ? `${words} ${plain.text}` : plain.text }
        : s
    );
    if (JSON.stringify(steps) !== JSON.stringify(t.steps))
      await db.update(tasks).set({ steps }).where(eq(tasks.id, t.id));
  }
}

/** Whether a connector holds a sign-in in the secret store. */
function signedIn(id: string): boolean {
  try {
    const saved = JSON.parse(getSecret(id, 'oauth') ?? '{}') as { tokens?: unknown };
    return !!saved.tokens;
  } catch {
    return false;
  }
}

/**
 * The other Google connectors that share this one's grant at Google. Google
 * ties a sign-in to the account and the office's client, not to the product,
 * so cancelling Gmail's would end the same account's Drive too. One whose
 * account is not known counts as shared, to be safe.
 */
async function sharesGrant(c: ConnectorRow): Promise<ConnectorRow[]> {
  return (await googleConnectors()).filter(
    (o) =>
      o.id !== c.id &&
      signedIn(o.id) &&
      (!c.config.account || !o.config.account || sameAccount(o.config.account, c.config.account))
  );
}

/**
 * Tell Google to cancel a sign-in before the office forgets it, so the
 * permission is gone from the owner's Google account too, not just from this
 * computer. Best effort: false when Google could not be told.
 */
async function revokeAtGoogle(id: string): Promise<boolean> {
  let token: string | undefined;
  try {
    const saved = JSON.parse(getSecret(id, 'oauth') ?? '{}') as {
      tokens?: { refresh_token?: string; access_token?: string };
    };
    token = saved.tokens?.refresh_token ?? saved.tokens?.access_token;
  } catch {
    return false;
  }
  if (!token) return true;
  try {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000)
    });
    // 400 means Google no longer knows the token: already cancelled.
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

/** Change how the office starts a connector, e.g. when a server turns out to need no sign-in. */
export async function setConnectorConfig(
  id: string,
  config: ConnectorRow['config']
): Promise<void> {
  await db.update(connectors).set({ config }).where(eq(connectors.id, id));
}

/**
 * The names a tool's secrets go by in the system's secret store: its keys,
 * and a hosted server's sign-in. `all` adds the sign-in of any hosted server,
 * since one can leave tokens behind even after it turned out to need none.
 */
function secretNames(c: Pick<ConnectorRow, 'kind' | 'config'>, all = false): string[] {
  return [
    ...(c.config.secrets ?? []),
    ...(c.config.headers ?? []),
    ...(c.config.oauth || (all && c.kind === 'http') ? ['oauth'] : [])
  ];
}

/** Drop the open tasks whose steps connect a tool, for one staffer or for all of them. */
async function dropConnectTasks(id: string, staffId?: string): Promise<void> {
  const open = await db
    .select()
    .from(tasks)
    .where(
      staffId ? and(eq(tasks.status, 'open'), eq(tasks.staffId, staffId)) : eq(tasks.status, 'open')
    );
  const stale = open
    .filter((t) =>
      t.steps.some((s) => s.action && 'connector' in s.action && s.action.connector === id)
    )
    .map((t) => t.id);
  if (stale.length)
    await db.update(tasks).set({ status: 'dropped' }).where(inArray(tasks.id, stale));
}

/**
 * A tool not connected yet changes how it lets the office in, like a key in a
 * header instead of a sign-in. Its open connect tasks name the old way, so
 * they drop, and the next grant puts the new steps on the desk. Keys and
 * sign-ins the new way does not use come out of the secret store.
 */
export async function reconfigureConnector(
  id: string,
  config: ConnectorRow['config']
): Promise<void> {
  const before = await connector(id);
  await db.update(connectors).set({ config }).where(eq(connectors.id, id));
  await dropConnectTasks(id);
  if (!before) return;
  const keep = secretNames({ kind: before.kind, config });
  for (const name of secretNames(before, true)) if (!keep.includes(name)) deleteSecret(id, name);
}

/**
 * What happened at Google when the office forgot a Google connector: told
 * (true), could not be told (false), or left alone, since another connector
 * still uses the same Google account (`kept`, those connectors' names).
 */
type GoogleTold = boolean | { kept: string[] };

/**
 * No Odd holds a tool any more: its keys and sign-ins come out of the secret
 * store, so none sit there unused, and it needs connecting again before the
 * next grant uses it. True when there was something to remove. A further
 * Google account (`gmail-2`) leaves the catalog too, since the owner adds
 * another whenever they want one.
 */
async function forgetConnector(id: string): Promise<{ forgot: boolean; googleTold?: GoogleTold }> {
  const c = await connector(id);
  if (!c) return { forgot: false };
  if (isAws(id)) return { forgot: await forgetAws(c) };
  const product = c.config.google;
  let googleTold: GoogleTold | undefined;
  if (c.config.oauth === 'google' && signedIn(id)) {
    const shared = await sharesGrant(c);
    googleTold = shared.length ? { kept: shared.map((o) => o.name) } : await revokeAtGoogle(id);
  }
  const removed = secretNames(c, true).filter((name) => deleteSecret(id, name));
  if (product && id !== GOOGLE[product].id) {
    await db.delete(connectors).where(eq(connectors.id, id));
    return { forgot: removed.length > 0, googleTold };
  }
  if (removed.length) {
    const config = { ...c.config };
    delete config.account;
    await db
      .update(connectors)
      .set({ readyAt: null, ...(product ? { name: GOOGLE[product].name, config } : {}) })
      .where(eq(connectors.id, id));
  }
  return { forgot: removed.length > 0, googleTold };
}

/**
 * An AWS tool no Odd holds drops its role. Secrets Manager keeps its role
 * while another tool's key comes from AWS, since the office reads those keys
 * with it. The one sign-in goes once no AWS tool has a role.
 */
async function forgetAws(c: ConnectorRow): Promise<boolean> {
  const all = await db.select().from(connectors);
  const keysFromAws = all.some((k) => Object.keys(k.config.fromAws ?? {}).length);
  if (!c.config.aws || (c.id === AWS_SECRETS_ID && keysFromAws)) return false;
  await db
    .update(connectors)
    .set({ config: { ...c.config, aws: undefined }, readyAt: null })
    .where(eq(connectors.id, c.id));
  if (!all.some((k) => k.id !== c.id && isAws(k.id) && k.config.aws))
    deleteSecret(AWS_SIGN_IN.id, AWS_SIGN_IN.name);
  return true;
}

export async function connectorReady(
  id: string,
  tools: string[],
  readTools: string[]
): Promise<void> {
  await db
    .update(connectors)
    .set({ tools, readTools, readyAt: new Date() })
    .where(eq(connectors.id, id));
}

/**
 * Take tools out of what a Read only grant to a connector reaches, when they
 * no longer pass `readsOnly`: a connector the owner connected before the rule
 * held, or a server that changed its marks. Records which ones went and why,
 * so the owner can see it in the Ledger.
 */
export async function narrowReadTools(id: string, gone: string[]): Promise<void> {
  const c = await connector(id);
  if (!c || !gone.length) return;
  const keep = c.readTools.filter((t) => !gone.includes(t));
  if (keep.length === c.readTools.length) return;
  await db.update(connectors).set({ readTools: keep }).where(eq(connectors.id, id));
  await record({
    kind: 'access',
    actor: 'office',
    title: `Read only for ${c.name} no longer reaches ${gone.join(', ')}`,
    body: `${c.name} does not mark ${gone.length === 1 ? 'it' : 'them'} as only reading, or the name says ${gone.length === 1 ? 'it changes' : 'they change'} something. Read and write reaches ${gone.length === 1 ? 'it' : 'them'}: at Drafts for your yes each use waits for your yes, and at Acts on its own it goes.`
  });
}

export async function grantsFor(
  staffId: string
): Promise<(GrantRow & { connector: ConnectorRow })[]> {
  const rows = await db
    .select()
    .from(grants)
    .innerJoin(connectors, eq(grants.connectorId, connectors.id))
    .where(eq(grants.staffId, staffId));
  return rows.map((r) => ({ ...r.grants, connector: r.connectors }));
}

/**
 * Change a grant's level in place: Read only or Read and write. The tool stays
 * connected and signed in, with no new steps, and the change reaches the
 * Odd's next run. Write needs the Draft level or higher (`grantWorks`).
 */
export async function setGrantLevel(
  staffId: string,
  connectorId: string,
  level: 'read' | 'act'
): Promise<void> {
  const who = await staffer(staffId);
  const conn = await connector(connectorId);
  if (!who || !conn) throw new Error('No such Odd or tool');
  if (!grantWorks(level, who.permission))
    throw new Error(`${who.name} holds ${who.permission}, so it cannot be given ${level}`);
  const [changed] = await db
    .update(grants)
    .set({ level })
    .where(
      and(
        eq(grants.staffId, staffId),
        eq(grants.connectorId, connectorId),
        sql`${grants.level} <> ${level}`
      )
    )
    .returning();
  if (!changed) return;
  await record({
    kind: 'access',
    actor: 'owner',
    title: `${who.name} now has ${conn.name} ${level === 'act' ? 'to read and write' : 'to read only'}`
  });
}

export async function revoke(staffId: string, connectorId: string): Promise<void> {
  const [gone] = await db
    .delete(grants)
    .where(and(eq(grants.staffId, staffId), eq(grants.connectorId, connectorId)))
    .returning();
  if (!gone) return;
  await dropConnectTasks(connectorId, staffId);
  const [held] = await db
    .select({ staffId: grants.staffId })
    .from(grants)
    .where(eq(grants.connectorId, connectorId))
    .limit(1);
  const [c, who] = await Promise.all([connector(connectorId), staffer(staffId)]);
  const { forgot, googleTold } = held ? { forgot: false } : await forgetConnector(connectorId);
  await record({
    kind: 'access',
    actor: 'owner',
    title: `Revoked ${c?.name ?? connectorId} for ${who?.name ?? staffId}`,
    body: forgot
      ? `No Odd holds it now, so its saved keys and sign-ins came out of this computer's password store.${
          googleTold === true
            ? ' Google cancelled the sign-in too.'
            : googleTold === false
              ? ' Google could not be told, so remove Oddboro at myaccount.google.com/permissions.'
              : googleTold
                ? ` Google keeps the sign-in, since ${googleTold.kept.join(' and ')} ${googleTold.kept.length === 1 ? 'uses' : 'use'} the same Google account. It came out of this computer only.`
                : ''
        }`
      : undefined
  });
}

// Tasks for the owner

export async function giveTask(
  staffId: string | null,
  t: {
    title: string;
    why: string;
    steps: (string | Step)[];
    attach?: string[];
    /** Given while working on this hand-off: the owner's answer goes back to it. */
    handOffId?: number;
    /** Given on this thread: the owner's answer moves it on. */
    threadId?: number;
    /** The key of the run giving it, which its thread keeps, as `raiseAsk` says. */
    run?: string;
    /** The colleague whose handed-back work the lead gave this from (`VIA`). */
    via?: string;
    /** The office gives it in the Odd's name (a plan's steps, a reconnect), so it may repeat a title. */
    byOffice?: true;
  }
): Promise<TaskRow> {
  const steps = t.steps.map((s) => (typeof s === 'string' ? { text: s, done: false } : s));
  return db.transaction(async (tx) => {
    // An Odd's own task may not repeat an item it already has on the desk.
    if (staffId && !t.byOffice) {
      await lockDesk(tx, staffId);
      await refuseRepeat(tx, staffId, t.title);
    }
    const [row] = await tx
      .insert(tasks)
      .values({
        staffId,
        title: t.title,
        why: t.why,
        steps,
        handOffId: t.handOffId,
        threadId: t.threadId,
        via: t.via
      })
      .returning();
    if (row.threadId) {
      // A task the office gives itself has no Odd, so no run of one to keep.
      if (staffId) await keepRun(tx, row.threadId, { key: t.run, by: staffId });
      await raisedOn(tx, row.threadId);
    }
    if (staffId && t.attach?.length)
      await tx
        .insert(attachments)
        .values(
          t.attach.map((path) => ({ staffId, path, mediaType: mediaTypeOf(path), taskId: row.id }))
        );
    return row;
  });
}

/** The files a task carries, as paths inside its staffer's folder or names in a thread's folder (`workPath`). */
export async function taskFiles(taskId: number): Promise<string[]> {
  const rows = await db
    .select({ path: attachments.path })
    .from(attachments)
    .where(eq(attachments.taskId, taskId))
    .orderBy(asc(attachments.id));
  return rows.map((r) => r.path);
}

const MEDIA: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml'
};

/** The media type of an attachment, from its extension. */
export function mediaTypeOf(path: string): string {
  return MEDIA[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export async function task(id: number): Promise<TaskRow | undefined> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return row;
}

/** Tick a step, or every step sharing its key, and record an answer if the step asked for one. */
export async function tickStep(id: number, index: number, answer?: string): Promise<void> {
  const t = await task(id);
  const step = t?.steps[index];
  if (!t || !step) return;
  const steps = t.steps.map((s, i) =>
    i === index || (step.key && s.key === step.key)
      ? { ...s, done: true, ...(i === index && answer !== undefined ? { answer } : {}) }
      : s
  );
  await db.update(tasks).set({ steps }).where(eq(tasks.id, id));
}

/** Undo a step, and any step sharing its key, so the owner can do it again. Its answer goes too. */
export async function untickStep(id: number, index: number): Promise<void> {
  const t = await task(id);
  const step = t?.steps[index];
  if (!t || !step) return;
  const steps = t.steps.map((s, i) => {
    if (i !== index && !(step.key && s.key === step.key)) return s;
    const { answer: _, ...rest } = s;
    return { ...rest, done: false };
  });
  await db.update(tasks).set({ steps }).where(eq(tasks.id, id));
}

/** Tick every step whose key matches, across open tasks. Used when a sign-in lands. */
export async function tickKey(key: string): Promise<void> {
  const open = await db.select().from(tasks).where(eq(tasks.status, 'open'));
  for (const t of open)
    if (t.steps.some((s) => s.key === key && !s.done))
      await db
        .update(tasks)
        .set({ steps: t.steps.map((s) => (s.key === key ? { ...s, done: true } : s)) })
        .where(eq(tasks.id, t.id));
}

export async function finishTask(id: number, done: boolean, note: string | null): Promise<void> {
  const [t] = await db
    .update(tasks)
    .set({ status: done ? 'done' : 'dropped', note: note || null, doneAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.status, 'open')))
    .returning();
  if (!t) return;
  const answers = t.steps
    .filter((s) => s.answer && s.action?.kind === 'choice')
    .map((s) => `${s.text} ${s.answer}`);
  await record({
    kind: 'work',
    actor: 'owner',
    title: `${done ? 'Done' : 'Dropped'} by ${await ownerName()}: ${t.title}`,
    body: [t.why, ...answers].join('\n'),
    reason: t.note,
    taskId: t.id
  });
  if (!done) {
    // No run follows a dropped task: the answer itself goes back. A tool's connect
    // task belongs to the access ask it came from.
    const from = t.askId ? await ask(t.askId) : undefined;
    await answerLater(
      {
        handOffId: t.handOffId ?? from?.handOffId ?? null,
        threadId: t.threadId ?? from?.threadId ?? null
      },
      'failed',
      `${await ownerName()} dropped "${t.title}"${t.note ? `: ${t.note}` : '.'}`
    );
    return;
  }
  if (!t.staffId) return;
  // The owner finished connecting a tool a staffer asked for: it can start the
  // work that was waiting on it.
  const a = t.askId ? await ask(t.askId) : undefined;
  if (a?.kind === 'access') {
    await carryOutTogether([a, ...(await answeredWith(a))]);
    return;
  }
  // Any other task a staffer gave them: the staffer picks up whatever waited on
  // it, such as hiring from an intake the owner just filled in.
  await followUp(t.staffId, 'task_done', { taskId: t.id, note: t.note });
}

export async function tasksFrom(staffId: string): Promise<TaskRow[]> {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.staffId, staffId))
    .orderBy(desc(tasks.createdAt))
    .limit(30);
}

// Reports

export async function addReport(staffId: string, title: string, body: string, runId?: number) {
  await db.insert(reports).values({ staffId, title, body });
  await record({ kind: 'report', actor: staffId, title, body, runId });
}

export async function readReport(id: number): Promise<void> {
  await db.update(reports).set({ readAt: new Date() }).where(eq(reports.id, id));
}

// The desk: everything waiting on the owner

export type Desk = {
  asks: AskRow[];
  tasks: TaskRow[];
  reports: ReportRow[];
  /** What the open asks and tasks carry. */
  attachments: AttachmentRow[];
  /**
   * Each open folder ask's folder by ask id, the home written `~`
   * (`shownFolder`), which only the server can work out.
   */
  folders: Record<number, string>;
};

export async function desk(): Promise<Desk> {
  const [a, t, r, f] = await Promise.all([
    db.select().from(asks).where(eq(asks.status, 'open')).orderBy(asc(asks.createdAt)),
    db.select().from(tasks).where(eq(tasks.status, 'open')).orderBy(asc(tasks.createdAt)),
    db.select().from(reports).where(isNull(reports.readAt)).orderBy(asc(reports.createdAt)),
    db
      .select({ attachments })
      .from(attachments)
      .leftJoin(asks, eq(attachments.askId, asks.id))
      .leftJoin(tasks, eq(attachments.taskId, tasks.id))
      .where(or(eq(asks.status, 'open'), eq(tasks.status, 'open')))
      .orderBy(asc(attachments.id))
  ]);
  // A twin waits behind the first ask it repeats, and the owner's answer to
  // that one answers it too (`asksNoMore`, `decide`).
  const shown = a.filter((x) => !a.some((first) => first.id < x.id && asksNoMore(first, x)));
  return {
    asks: shown,
    tasks: t,
    reports: r,
    attachments: f.map((x) => x.attachments),
    folders: Object.fromEntries(
      shown.flatMap((x) => (x.folder ? [[x.id, shownFolder(x.folder.path)]] : []))
    )
  };
}

/** An ask or task an Odd has open on the owner's desk, as its prompt lists it. */
export type OnDesk = { kind: 'ask' | 'task'; id: number; title: string };

/**
 * What an Odd still has open on the owner's desk, newest first: up to `limit`
 * items, and how many more. A reply shows as "Reply to <subject>".
 */
export async function stillOnDesk(
  staffId: string,
  limit = 15
): Promise<{ items: OnDesk[]; more: number }> {
  const [a, t] = await Promise.all([
    db
      .select()
      .from(asks)
      .where(and(eq(asks.staffId, staffId), eq(asks.status, 'open'))),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.staffId, staffId), eq(tasks.status, 'open')))
  ]);
  const all = [
    ...a.map((x) => ({
      kind: 'ask' as const,
      id: x.id,
      title: x.reply ? `Reply to ${x.reply.subject}` : x.title,
      at: x.createdAt
    })),
    ...t.map((x) => ({ kind: 'task' as const, id: x.id, title: x.title, at: x.createdAt }))
  ].sort((x, y) => y.at.getTime() - x.at.getTime() || y.id - x.id);
  return {
    items: all.slice(0, limit).map(({ kind, id, title }) => ({ kind, id, title })),
    more: Math.max(0, all.length - limit)
  };
}

/** Something a staffer put on the owner's desk, as its chat shows it. */
export type Delivery = {
  kind: 'ask' | 'task' | 'report';
  id: number;
  title: string;
  at: Date;
  /** open, approved, denied, revise, done, dropped, or for a report new or read. */
  status: string;
  /** When the owner decided it, for an ask. */
  decidedAt?: Date | null;
};

/** What one staffer put on the owner's desk, newest last, with where each stands. */
export async function deliveries(staffId: string, limit = 200): Promise<Delivery[]> {
  const [a, t, r] = await Promise.all([
    db
      .select({
        id: asks.id,
        title: asks.title,
        at: asks.createdAt,
        status: asks.status,
        decidedAt: asks.decidedAt
      })
      .from(asks)
      .where(eq(asks.staffId, staffId))
      .orderBy(desc(asks.createdAt))
      .limit(limit),
    db
      .select({ id: tasks.id, title: tasks.title, at: tasks.createdAt, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.staffId, staffId))
      .orderBy(desc(tasks.createdAt))
      .limit(limit),
    db
      .select({
        id: reports.id,
        title: reports.title,
        at: reports.createdAt,
        readAt: reports.readAt
      })
      .from(reports)
      .where(eq(reports.staffId, staffId))
      .orderBy(desc(reports.createdAt))
      .limit(limit)
  ]);
  return [
    ...a.map((x) => ({ kind: 'ask' as const, ...x })),
    ...t.map((x) => ({ kind: 'task' as const, ...x })),
    ...r.map(({ readAt, ...x }) => ({
      kind: 'report' as const,
      ...x,
      status: readAt ? 'read' : 'new'
    }))
  ]
    .sort((x, y) => x.at.getTime() - y.at.getTime())
    .slice(-limit);
}

export async function report(id: number): Promise<ReportRow | undefined> {
  const [r] = await db.select().from(reports).where(eq(reports.id, id));
  return r;
}

// Jobs

export async function jobsFor(staffId: string): Promise<(JobRow & { lastRun?: RunRow })[]> {
  const list = await db
    .select()
    .from(jobs)
    .where(eq(jobs.staffId, staffId))
    .orderBy(asc(jobs.createdAt));
  return Promise.all(
    list.map(async (j) => {
      const [lastRun] = await db
        .select()
        .from(runs)
        .where(eq(runs.jobId, j.id))
        .orderBy(desc(runs.startedAt))
        .limit(1);
      return { ...j, lastRun };
    })
  );
}

export async function addJob(j: {
  staffId: string;
  name: string;
  instructions: string;
  schedule: Schedule;
  report?: boolean;
}): Promise<JobRow> {
  const [row] = await db
    .insert(jobs)
    .values({ ...j, nextRunAt: nextRun(j.schedule, new Date()) })
    .returning();
  return row;
}

export async function updateJob(
  id: number,
  patch: Partial<Pick<JobRow, 'name' | 'instructions' | 'schedule' | 'enabled' | 'report'>>
): Promise<void> {
  const [row] = await db.update(jobs).set(patch).where(eq(jobs.id, id)).returning();
  if (row && (patch.schedule || patch.enabled))
    await db
      .update(jobs)
      .set({ nextRunAt: nextRun(row.schedule, new Date()) })
      .where(eq(jobs.id, id));
}

/** A staffer changes one of its own jobs, carrying out a change the owner approved. */
/**
 * The owner's go-ahead for a staffer to change itself: their own words in a chat,
 * which the office hands the staffer's tools, or an ask the owner approved.
 */
export type GoAhead = { said: string } | { askId: number };

/** In a chat, the owner's words go in the ledger as their decision, beside the change. */
async function recordGoAhead(who: StaffRow, go: GoAhead, what: string): Promise<void> {
  if ('said' in go)
    await record({
      kind: 'decision',
      actor: 'owner',
      title: `Asked ${who.name} in chat: ${what}`,
      body: go.said
    });
}

export async function editOwnJob(
  staffId: string,
  name: string,
  patch: Partial<Pick<JobRow, 'instructions' | 'schedule' | 'report'>>,
  go: GoAhead
): Promise<JobRow | undefined> {
  const who = await staffer(staffId);
  const [j] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.staffId, staffId), eq(jobs.name, name)));
  if (!who || !j) return undefined;
  await updateJob(j.id, patch);
  await recordGoAhead(who, go, `change its job "${name}"`);
  await record({
    kind: 'work',
    actor: staffId,
    title: `Changed its job: ${name}`,
    body: [
      patch.instructions && `Steps:\n${patch.instructions}`,
      patch.schedule && `Schedule: ${JSON.stringify(patch.schedule)}`,
      patch.report !== undefined &&
        `Reports to ${await ownerName()}: ${patch.report ? 'yes' : 'no'}`
    ]
      .filter(Boolean)
      .join('\n\n'),
    askId: 'askId' in go ? go.askId : undefined
  });
  return j;
}

/**
 * Rewrite a staffer's job description, the text every run starts from. The owner
 * does it from the card, or the staffer does with their go-ahead. `was` is the
 * text the editor started from: if it changed since, the save stops instead of
 * overwriting someone else's edit. The ledger keeps the old and new versions.
 */
export async function setDescription(
  staffId: string,
  text: string,
  by: { owner: true; was: string } | { go: GoAhead }
): Promise<boolean> {
  const who = await staffer(staffId);
  if (!who) throw fixedError('No such Odd');
  const desk = text.trim();
  if (!desk) throw fixedError('A job description cannot be empty');
  if ('owner' in by && by.was.trim() !== who.desk.trim())
    throw new Error(`${who.name}'s job description changed since you opened it. Reopen it to see.`);
  if (desk === who.desk.trim()) return false;
  await db.update(staff).set({ desk }).where(eq(staff.id, staffId));
  if ('go' in by) await recordGoAhead(who, by.go, 'rewrite its job description');
  await record({
    kind: 'work',
    actor: 'owner' in by ? 'owner' : staffId,
    title: 'owner' in by ? `Edited ${who.name}'s job description` : 'Rewrote its job description',
    body: `Before:\n${who.desk}\n\nAfter:\n${desk}`,
    askId: 'go' in by && 'askId' in by.go ? by.go.askId : undefined
  });
  return true;
}

/** Remove a job that never ran. One that ran stays, paused, so its runs keep their record. */
export async function deleteJob(id: number): Promise<void> {
  const [ran] = await db.select({ id: runs.id }).from(runs).where(eq(runs.jobId, id)).limit(1);
  if (ran) throw fixedError('This job has run before, so it stays paused to keep its record.');
  await db.delete(jobs).where(eq(jobs.id, id));
}

export async function enabledJobs(): Promise<JobRow[]> {
  return db.select().from(jobs).where(eq(jobs.enabled, true));
}

export async function job(id: number): Promise<JobRow | undefined> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row;
}

export async function setNextRun(id: number, at: Date): Promise<void> {
  await db.update(jobs).set({ nextRunAt: at }).where(eq(jobs.id, id));
}

export async function startRun(j: JobRow, trigger: RunTrigger): Promise<RunRow> {
  const [row] = await db
    .insert(runs)
    .values({ jobId: j.id, staffId: j.staffId, trigger })
    .returning();
  return row;
}

export async function finishRun(r: RunRow, j: JobRow, ok: boolean, summary: string): Promise<void> {
  await db
    .update(runs)
    .set({ status: ok ? 'done' : 'failed', summary, finishedAt: new Date() })
    .where(eq(runs.id, r.id));
  if (ok && j.report) await addReport(j.staffId, j.name, summary, r.id);
  else
    await record({
      kind: 'work',
      actor: j.staffId,
      title: `${ok ? 'Ran' : 'Failed'}: ${j.name}${r.trigger === 'manual' ? ` (started by ${await ownerName()})` : ''}`,
      body: summary,
      runId: r.id
    });
}

/** Runs that a restart left marked running. */
export async function closeStaleRuns(): Promise<void> {
  await db
    .update(runs)
    .set({
      status: 'failed',
      summary: 'The office stopped while this ran.',
      finishedAt: new Date()
    })
    .where(eq(runs.status, 'running'));
}

/** "Fri, Oct 30, 7:00 AM": the office's own clock, so a schedule reads as written. */
const pt = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleString('en-US', {
        timeZone: zone(),
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    : null;

/** What the whole office did since a time: Marshall's daily report reads this. */
export async function officeActivity(since: Date) {
  const [people, ranJobs, openAsks, decided, openTasks, doneTasks, follow] = await Promise.all([
    roster(),
    db
      .select({
        staff: runs.staffId,
        job: jobs.name,
        status: runs.status,
        trigger: runs.trigger,
        summary: runs.summary,
        at: runs.startedAt
      })
      .from(runs)
      .innerJoin(jobs, eq(runs.jobId, jobs.id))
      .where(gte(runs.startedAt, since))
      .orderBy(asc(runs.startedAt)),
    db.select().from(asks).where(eq(asks.status, 'open')),
    db.select().from(asks).where(gte(asks.decidedAt, since)),
    db.select().from(tasks).where(eq(tasks.status, 'open')),
    db.select().from(tasks).where(gte(tasks.doneAt, since)),
    db
      .select({
        staff: followUps.staffId,
        kind: followUps.kind,
        ask: asks.title,
        report: reports.title,
        task: tasks.title,
        handOff: followUps.handOff,
        thread: threads.title,
        outcome: followUps.outcome,
        at: followUps.createdAt
      })
      .from(followUps)
      .leftJoin(asks, eq(followUps.askId, asks.id))
      .leftJoin(reports, eq(followUps.reportId, reports.id))
      .leftJoin(tasks, eq(followUps.taskId, tasks.id))
      .leftJoin(threads, eq(followUps.threadId, threads.id))
      .where(gte(followUps.createdAt, since))
  ]);
  const allJobs = await db.select().from(jobs).where(eq(jobs.enabled, true));
  return {
    since: pt(since),
    now: pt(new Date()),
    staff: people.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      jobs: allJobs
        .filter((j) => j.staffId === p.id)
        .map((j) => ({ name: j.name, schedule: j.schedule })),
      runs: ranJobs
        .filter((r) => r.staff === p.id)
        .map((r) => ({
          job: r.job,
          status: r.status,
          // 'manual' means the owner pressed Run now; only 'schedule' runs follow the timer.
          trigger: r.trigger,
          at: pt(r.at),
          summary: r.summary?.slice(0, 600)
        }))
    })),
    asks: {
      open: openAsks.map((a) => ({ from: a.staffId, title: a.title, since: pt(a.createdAt) })),
      decided: decided.map((a) => ({
        from: a.staffId,
        title: a.title,
        status: a.status,
        reason: a.reason
      }))
    },
    // Work owed after the owner answered: carrying out an approved ask, reworking one
    // the owner sent back, acting on their feedback on a report, or picking up after a
    // task they finished. A hand_off is work a colleague handed this staffer,
    // handed_back is the colleague's result coming home, and resume is a thread's
    // hub picking it back up. A null outcome is still to do.
    followUps: follow.map((f) => ({
      from: f.staff,
      kind: f.kind,
      about: f.ask ?? f.report ?? f.task ?? f.handOff?.title ?? f.thread,
      ...(f.handOff ? { colleague: f.handOff.from } : {}),
      outcome: f.outcome,
      at: pt(f.at)
    })),
    tasksForOwner: {
      open: openTasks.map((t) => ({ from: t.staffId, title: t.title, since: pt(t.createdAt) })),
      done: doneTasks.map((t) => ({ from: t.staffId, title: t.title, status: t.status }))
    }
  };
}

// Usage and the plan

/** One run's token counts, per model, as Claude Code's result reports them. */
export type ModelUsage = Record<
  string,
  {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    costUSD?: number;
  }
>;

/** `staffId` is null for a run as the office itself. */
export async function recordUsage(staffId: string | null, kind: UsageKind, byModel: ModelUsage) {
  const rows = Object.entries(byModel).map(([model, u]) => ({
    staffId,
    kind,
    model,
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.cacheReadInputTokens ?? 0,
    cacheWriteTokens: u.cacheCreationInputTokens ?? 0,
    costUsd: u.costUSD ?? 0
  }));
  if (rows.length) await db.insert(usage).values(rows);
}

export type PlanWindows = {
  fiveHour: number;
  fiveHourResetsAt: Date | null;
  sevenDay: number;
  sevenDayResetsAt: Date | null;
};

/** A run reports only the windows it has news of, often one: keep the other as it was. */
export async function setPlanLimits(w: Partial<PlanWindows>): Promise<void> {
  await db
    .insert(planLimits)
    .values({ id: 'claude', fiveHour: 0, sevenDay: 0, ...w, updatedAt: new Date() })
    .onConflictDoUpdate({ target: planLimits.id, set: { ...w, updatedAt: new Date() } });
}

/** What the staff call the owner. "the owner" until the install sets a name. */
export async function ownerName(): Promise<string> {
  const [row] = await db.select().from(owner).where(eq(owner.id, 'owner'));
  return row?.name.trim() || 'the owner';
}

/** Whether the owner has been through the office's welcome. */
export async function welcomed(): Promise<boolean> {
  const [row] = await db.select({ at: owner.welcomedAt }).from(owner).where(eq(owner.id, 'owner'));
  return !!row?.at;
}

/** The owner finished the welcome, under the name they gave. */
export async function finishWelcome(name: string): Promise<void> {
  await setOwnerName(name);
  await db.update(owner).set({ welcomedAt: new Date() }).where(eq(owner.id, 'owner'));
}

/** Set the owner's name. */
export async function setOwnerName(name: string): Promise<void> {
  const n = name.trim().slice(0, 30);
  if (!n) throw fixedError('Say a name');
  await db
    .insert(owner)
    .values({ id: 'owner', name: n, updatedAt: new Date() })
    .onConflictDoUpdate({ target: owner.id, set: { name: n, updatedAt: new Date() } });
}

/** The plan windows as last reported. A window past its reset reads as unused. */
export async function plan() {
  const [row] = await db.select().from(planLimits).where(eq(planLimits.id, 'claude'));
  if (!row) return null;
  const now = new Date();
  const fresh = (used: number, resetsAt: Date | null) => (resetsAt && resetsAt <= now ? 0 : used);
  return {
    fiveHour: fresh(row.fiveHour, row.fiveHourResetsAt),
    fiveHourResetsAt: row.fiveHourResetsAt,
    sevenDay: fresh(row.sevenDay, row.sevenDayResetsAt),
    sevenDayResetsAt: row.sevenDayResetsAt,
    updatedAt: row.updatedAt
  };
}

export type UsageTotals = { tokens: number; output: number; costUsd: number; runs: number };
/** `at` is the bucket's start, in epoch milliseconds. */
export type UsageBucket = { at: number; tokens: number; output: number };

/** A staffer's tokens over the last day, week and month: totals and bars. */
export async function usageFor(staffId: string) {
  const totals = async (interval: string): Promise<UsageTotals> => {
    const [r] = await pg`
      select coalesce(sum(tokens), 0)::float8 as tokens,
             coalesce(sum(output_tokens), 0)::float8 as output,
             coalesce(sum(cost_usd), 0)::float8 as "costUsd",
             count(distinct created_at)::int as runs
      from usage
      where staff_id = ${staffId} and created_at > now() - ${interval}::interval`;
    return r as unknown as UsageTotals;
  };
  const tz = zone();
  // Buckets line up on the office's hours and days, so a bar reads as "Tuesday".
  const buckets = async (step: string, count: number, unit: 'hour' | 'day') =>
    (await pg`
      with b as (
        select generate_series(
          date_trunc(${unit}, now() at time zone ${tz}) - (${count - 1} * ${step}::interval),
          date_trunc(${unit}, now() at time zone ${tz}),
          ${step}::interval
        ) as start
      )
      select (extract(epoch from b.start at time zone ${tz}) * 1000)::float8 as at,
             coalesce(sum(u.tokens), 0)::float8 as tokens,
             coalesce(sum(u.output_tokens), 0)::float8 as output
      from b
      left join usage u
        on u.staff_id = ${staffId}
       and u.created_at at time zone ${tz} >= b.start
       and u.created_at at time zone ${tz} < b.start + ${step}::interval
      group by b.start
      order by b.start`) as unknown as UsageBucket[];
  const [d1, d7, d30, h24, w7, m30] = await Promise.all([
    totals('24 hours'),
    totals('7 days'),
    totals('30 days'),
    buckets('1 hour', 24, 'hour'),
    buckets('6 hours', 28, 'hour'),
    buckets('1 day', 30, 'day')
  ]);
  return { totals: { d1, d7, d30 }, series: { d1: h24, d7: w7, d30: m30 } };
}

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
    .where(and(eq(pokes.status, 'waiting'), staffId ? eq(pokes.staffId, staffId) : undefined))
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
