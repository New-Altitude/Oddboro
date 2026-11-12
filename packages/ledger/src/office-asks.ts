// Asks on the desk: raising one, refusing a repeat, and finding the twins one
// answer covers.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db.ts';
import { goalThread, keepRun, raisedOn, type Db, type Tx } from './threads.ts';
import {
  asks,
  attachments,
  tasks,
  type AccessRequest,
  type AskKind,
  type FolderRequest,
  type GoalDraft,
  type GoalPlan,
  type HireProposal,
  type HeldCall,
  type ReplyDraft
} from './schema.ts';
import { levelAtMost, switchesSaid, type OwnSwitch } from './access-words.ts';
import { sameCriteria, type GmailFilter } from './filter-words.ts';
import { ASK_REPLACED } from './desk-answers.ts';
import type { AskRow, LedgerRow } from './office.ts';
import { precedent } from './office-ledger.ts';
import { followUp } from './office-follow-ups.ts';
import { mediaTypeOf } from './office-tasks.ts';

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
const ONCE_ONLY: AskKind[] = ['approval', 'goal', 'remove', 'bring_back'];

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
    /** A remove or bring_back ask's Odd (leaving.ts). */
    odd?: string;
    /** `goal`, `plan`, `reply`, `filter`, `folder`, `switch`, `call`, `remove` and `bring_back` say so; the rest follow from access or hire. */
    kind?:
      'goal' | 'plan' | 'reply' | 'filter' | 'folder' | 'switch' | 'call' | 'remove' | 'bring_back';
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
        .set({ status: 'revise', reason: ASK_REPLACED, decidedAt: new Date() })
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

export async function ask(id: number, q: Db = db): Promise<AskRow | undefined> {
  const [row] = await q.select().from(asks).where(eq(asks.id, id));
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

export const DECISIONS = ['approve', 'deny', 'iterate'] as const;
export type Decision = (typeof DECISIONS)[number];

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
export async function answeredWith(a: AskRow, q: Db = db): Promise<AskRow[]> {
  if (!TWINNED.includes(a.kind) || !a.decidedAt) return [];
  const rows = await q
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

/**
 * Start the carry-outs for asks one answer settled (`carriedOutBy`).
 * `pickedUp` is the work parked on the connect task that just ended, which
 * picks up in its own run (`finishTask`).
 */
async function carryOutTogether(
  together: AskRow[],
  pickedUp?: string[],
  q: Db = db
): Promise<void> {
  for (const a of carriedOutBy(together))
    await followUp(a.staffId, 'carry_out', { askId: a.id, note: null, pickedUp }, q);
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

export { lockDesk, refuseRepeat, TWINNED, asksNoMore, carryOutTogether };
