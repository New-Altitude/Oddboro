// What the office does with its tables. The office app and the staff tool
// server both call these, so a rule lives in one place: an ask is decided only
// here, a task is finished only here, and each writes its ledger row.
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  or,
  sql
} from 'drizzle-orm';
import { db, sql as pg } from './db.ts';
import { embed } from './embed.ts';
import { fixedError } from './errors.ts';
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
  usage,
  followUps,
  goals,
  type AccessRequest,
  type FollowUpKind,
  type GoalDraft,
  type GoalPlan,
  type HireProposal,
  type Level,
  type Outcome,
  type LedgerKind,
  type RunTrigger,
  type Schedule,
  type Step,
  type UsageKind
} from './schema.ts';
import { nextRun, zone } from './time.ts';
import { isGrantable, OFFICE_TOOLS, STARTER_TOOLS, tickable } from './tools.ts';
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

const LEVELS: Level[] = ['read', 'draft', 'act'];
export const levelAtMost = (a: Level, b: Level) => LEVELS.indexOf(a) <= LEVELS.indexOf(b);

// Staff

export async function roster(): Promise<StaffRow[]> {
  return db.select().from(staff).where(isNull(staff.leftAt)).orderBy(asc(staff.hiredAt));
}

export async function staffer(id: string): Promise<StaffRow | undefined> {
  const [row] = await db.select().from(staff).where(eq(staff.id, id));
  return row;
}

/** Only the owner moves a staffer's level. Grants above the new level wait until it rises again. */
export async function setPermission(id: string, permission: Level): Promise<void> {
  const before = await staffer(id);
  if (!before || before.permission === permission) return;
  await db.update(staff).set({ permission }).where(eq(staff.id, id));
  const up = LEVELS.indexOf(permission) > LEVELS.indexOf(before.permission);
  await record({
    kind: 'access',
    actor: 'owner',
    title: `${up ? 'Raised' : 'Lowered'} ${before.name} from ${before.permission} to ${permission}`
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
    .values({ ...values, id, tools: tools ?? STARTER_TOOLS })
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
export async function record(e: {
  kind: LedgerKind;
  actor: string;
  title: string;
  body?: string;
  reason?: string | null;
  askId?: number;
  taskId?: number;
  runId?: number;
}): Promise<void> {
  const text = [e.title, e.body, e.reason].filter(Boolean).join('\n');
  await db.insert(ledger).values({ ...e, embedding: await embed(text, 'document') });
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
    /** `goal` and `plan` say so; the rest follow from access or hire. */
    kind?: 'goal' | 'plan';
    revises?: number;
    /** Files in the staffer's folder that go with it. */
    attach?: string[];
  }
): Promise<{ ask: AskRow; precedent: LedgerRow[] }> {
  const { attach, kind, ...fields } = a;
  const ask = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(asks)
      .values({
        staffId,
        kind: kind ?? (a.access ? 'access' : a.hire ? 'hire' : 'approval'),
        ...fields
      })
      .returning();
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

/**
 * The owner's decision. Approving an access ask grants it and gives the owner the steps
 * to connect; approving any other ask but a hire sends the staffer to carry it
 * out. A hire is approved by hiring, from the hire window. Iterate sends it
 * back with what to change, and needs their words.
 */
export async function decideAsk(
  id: number,
  decision: Decision,
  reason: string | null,
  reportWhenDone = false
): Promise<void> {
  if (decision === 'iterate' && !reason) throw fixedError('Say what to change');
  const status = decision === 'approve' ? 'approved' : decision === 'deny' ? 'denied' : 'revise';
  const [ask] = await db
    .update(asks)
    .set({ status, reason: reason || null, decidedAt: new Date() })
    .where(and(eq(asks.id, id), eq(asks.status, 'open')))
    .returning();
  if (!ask) return;
  const verb = { approve: 'Approved', deny: 'Denied', iterate: 'Sent back' }[decision];
  await record({
    kind: 'decision',
    actor: 'owner',
    title: `${verb}: ${ask.title}`,
    body: `Asked by ${ask.staffId}. ${ask.why}`,
    reason: ask.reason,
    askId: ask.id
  });
  if (decision === 'approve' && ask.access) await grantAccess(ask.staffId, ask.access, ask.id);
  else if (decision === 'approve' && ask.kind === 'approval')
    await followUp(ask.staffId, 'carry_out', { askId: ask.id, note: ask.reason, reportWhenDone });
  else if (decision === 'iterate')
    await followUp(ask.staffId, 'rework', { askId: ask.id, note: ask.reason });
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
  await db.insert(followUps).values({ staffId, kind, ...f });
}

/**
 * A new hire's first day: right after it says hello, it starts its work. Its
 * result goes on the owner's desk, so they see the first piece of work.
 */
export async function startFirstDay(staffId: string): Promise<void> {
  await followUp(staffId, 'first_day', { note: null, reportWhenDone: true });
}

/** Follow-ups no staffer has started yet, with the ask, report, task or goal each is about. */
export async function followUpsToDo(): Promise<
  {
    f: FollowUpRow;
    ask?: AskRow;
    report?: ReportRow;
    task?: TaskRow;
    goal?: typeof goals.$inferSelect;
  }[]
> {
  const rows = await db
    .select()
    .from(followUps)
    .where(isNull(followUps.startedAt))
    .orderBy(asc(followUps.createdAt));
  return Promise.all(
    rows.map(async (f) => ({
      f,
      ask: f.askId ? await ask(f.askId) : undefined,
      report: f.reportId
        ? (await db.select().from(reports).where(eq(reports.id, f.reportId)))[0]
        : undefined,
      task: f.taskId ? (await db.select().from(tasks).where(eq(tasks.id, f.taskId)))[0] : undefined,
      goal: f.goalId ? (await db.select().from(goals).where(eq(goals.id, f.goalId)))[0] : undefined
    }))
  );
}

/** Claim a follow-up. False when something else already started it. */
export async function startFollowUp(id: number): Promise<boolean> {
  const claimed = await db
    .update(followUps)
    .set({ startedAt: new Date() })
    .where(and(eq(followUps.id, id), isNull(followUps.startedAt)))
    .returning({ id: followUps.id });
  return claimed.length > 0;
}

const OUTCOME_TITLE: Record<FollowUpKind, Record<Outcome, string>> = {
  carry_out: { done: 'Did', failed: 'Failed', waiting: 'Waiting on {owner} for' },
  rework: { done: 'Reworked', failed: 'Could not rework', waiting: 'Reworked' },
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
  }
};

/**
 * Record how a follow-up ended. Every outcome goes in the ledger. The owner's desk
 * gets a failure always, and a success only when the owner asked for one. When the
 * staffer is waiting, what it needs is already on their desk as an ask or task.
 */
export async function finishFollowUp(
  f: FollowUpRow,
  about: string,
  outcome: Outcome,
  result: string
): Promise<void> {
  await db
    .update(followUps)
    .set({ outcome, result, doneAt: new Date() })
    .where(eq(followUps.id, f.id));
  const title = `${OUTCOME_TITLE[f.kind][outcome].replace('{owner}', await ownerName())}: ${about}`;
  await record({
    kind: 'work',
    actor: f.staffId,
    title,
    body: result,
    askId: f.askId ?? undefined
  });
  if (outcome === 'failed' || (outcome === 'done' && f.reportWhenDone))
    await db.insert(reports).values({ staffId: f.staffId, title, body: result });
}

/** Follow-ups a restart cut off mid-run. They fail rather than run twice. */
export async function closeStaleFollowUps(): Promise<void> {
  const stale = await db
    .select()
    .from(followUps)
    .where(and(isNotNull(followUps.startedAt), isNull(followUps.outcome)));
  for (const f of stale)
    await finishFollowUp(
      f,
      f.askId
        ? ((await ask(f.askId))?.title ?? `ask ${f.askId}`)
        : f.taskId
          ? `task ${f.taskId}`
          : f.goalId
            ? `goal ${f.goalId}`
            : f.kind === 'first_day'
              ? 'getting started'
              : `report ${f.reportId}`,
      'failed',
      'The office restarted while this was running, so it may be half done. Check it, then ask the Odd to finish it.'
    );
}

// Access

/** Grant access, then give the owner whatever steps connecting it still needs. */
export async function grantAccess(
  staffId: string,
  req: AccessRequest,
  askId?: number
): Promise<void> {
  const who = await staffer(staffId);
  const conn = await connector(req.connector);
  if (!who || !conn) throw fixedError('No such Odd or connector');
  if (req.level === 'draft') throw new Error(`${conn.name} connects to read, or to read and write`);
  if (!levelAtMost(req.level, who.permission))
    throw new Error(`${who.name} holds ${who.permission}, so it cannot be given ${req.level}`);
  await db
    .insert(grants)
    .values({ staffId, connectorId: conn.id, level: req.level, askId })
    .onConflictDoUpdate({
      target: [grants.staffId, grants.connectorId],
      set: { level: req.level, askId, grantedAt: new Date() }
    });
  const steps = connectSteps(conn);
  if (steps.length) {
    await db.insert(tasks).values({
      staffId,
      askId,
      title: `Connect ${conn.name} for ${who.name}`,
      why: `${who.name} needs ${conn.name} at ${req.level} level.`,
      steps
    });
    return;
  }
  // Already connected: the staffer can use it now, and nothing waits on the owner.
  await record({
    kind: 'access',
    actor: 'owner',
    title: `Gave ${who.name} ${conn.name} (${req.level})`,
    body: `${conn.name} was already connected, so there were no steps for ${await ownerName()}.`,
    askId
  });
  if (askId) await followUp(staffId, 'carry_out', { askId, note: null });
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
    steps: [...getKey, ...steps]
  });
  return { task, already: false };
}

/** The steps that connect a tool. `again` gives them even when it looks connected. */
function connectSteps(conn: ConnectorRow, again = false): Step[] {
  if (conn.readyAt && !again) return [];
  const key = `oauth:${conn.id}`;
  return [
    ...(conn.config.oauth
      ? [
          {
            text: `Click Sign in. ${conn.name}'s sign-in page opens in a new tab.`,
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
      text: `Paste ${name === 'Authorization' ? `your ${conn.name} key` : `the ${name} value for ${conn.name}`} below. It goes in this computer's password store, never the database.`,
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

/** Change how the office starts a connector, e.g. when a server turns out to need no sign-in. */
export async function setConnectorConfig(
  id: string,
  config: ConnectorRow['config']
): Promise<void> {
  await db.update(connectors).set({ config }).where(eq(connectors.id, id));
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

export async function revoke(staffId: string, connectorId: string): Promise<void> {
  const [gone] = await db
    .delete(grants)
    .where(and(eq(grants.staffId, staffId), eq(grants.connectorId, connectorId)))
    .returning();
  if (gone)
    await record({
      kind: 'access',
      actor: 'owner',
      title: `Revoked ${connectorId} for ${staffId}`
    });
}

// Tasks for the owner

export async function giveTask(
  staffId: string | null,
  t: { title: string; why: string; steps: (string | Step)[]; attach?: string[] }
): Promise<TaskRow> {
  const steps = t.steps.map((s) => (typeof s === 'string' ? { text: s, done: false } : s));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tasks)
      .values({ staffId, title: t.title, why: t.why, steps })
      .returning();
    if (staffId && t.attach?.length)
      await tx
        .insert(attachments)
        .values(
          t.attach.map((path) => ({ staffId, path, mediaType: mediaTypeOf(path), taskId: row.id }))
        );
    return row;
  });
}

/** The files a task carries, as paths inside its staffer's folder. */
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
/** Tick every step the owner can tick by hand, in one write: "I did all of these." */
export async function tickAll(id: number): Promise<void> {
  const t = await task(id);
  if (!t) return;
  const steps = t.steps.map((s) => (tickable(s) ? { ...s, done: true } : s));
  await db.update(tasks).set({ steps }).where(eq(tasks.id, id));
}

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
  if (!done || !t.staffId) return;
  // The owner finished connecting a tool a staffer asked for: it can start the
  // work that was waiting on it.
  const a = t.askId ? await ask(t.askId) : undefined;
  if (a?.kind === 'access') {
    await followUp(t.staffId, 'carry_out', { askId: a.id, note: null });
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
  return { asks: a, tasks: t, reports: r, attachments: f.map((x) => x.attachments) };
}

/** Something a staffer put on the owner's desk, as its chat shows it. */
export type Delivery = {
  kind: 'ask' | 'task' | 'report';
  id: number;
  title: string;
  at: Date;
  /** open, approved, denied, revise, done, dropped, or for a report new or read. */
  status: string;
};

/** What one staffer put on the owner's desk, newest last, with where each stands. */
export async function deliveries(staffId: string, limit = 200): Promise<Delivery[]> {
  const [a, t, r] = await Promise.all([
    db
      .select({ id: asks.id, title: asks.title, at: asks.createdAt, status: asks.status })
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
        outcome: followUps.outcome,
        at: followUps.createdAt
      })
      .from(followUps)
      .leftJoin(asks, eq(followUps.askId, asks.id))
      .leftJoin(reports, eq(followUps.reportId, reports.id))
      .leftJoin(tasks, eq(followUps.taskId, tasks.id))
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
    // task they finished. A null outcome is still to do.
    followUps: follow.map((f) => ({
      from: f.staff,
      kind: f.kind,
      about: f.ask ?? f.report ?? f.task,
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
      select coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::float8 as tokens,
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
             coalesce(sum(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens), 0)::float8 as tokens,
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
