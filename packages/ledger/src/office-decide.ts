// The owner's answer to an ask and to a report, what each answer starts, held
// calls, and taking an ask or a task off the desk.
import { and, eq, inArray } from 'drizzle-orm';
import { db } from './db.ts';
import { fixedError } from './errors.ts';
import { handBackLater } from './hand-offs.ts';
import { answerWindow } from './usage-window.ts';
import { answerHandOffs, answerThread, startHeld, type Db, type Tx } from './threads.ts';
import {
  asks,
  staff,
  tasks,
  type AskKind,
  type FolderRequest,
  type InChat,
  type Outcome,
  type HeldCall,
  type ReplyDraft
} from './schema.ts';
import { commandsHow } from './agents.ts';
import { currentPlatform } from './platform.ts';
import { bringBack, leavingRefused, removeOdd } from './leaving.ts';
import { giveStanding } from './standing.ts';
import { oweCatchUp } from './missed-runs.ts';
import { levelAtMost, type FolderAccess, type OwnSwitch } from './access-words.ts';
import { filterWords, type GmailFilter } from './filter-words.ts';
import { yesOrNo } from './tools.ts';
import { OWNER_ANSWERS, type AskAnswer, type AskEffect } from './desk-answers.ts';
import type { StaffRow, AskRow, ReportRow } from './office.ts';
import { anyStaffer, changeLevel, changeTools, networkNote, staffer } from './office-staff.ts';
import { changeFolder, gaveFolder, switchesOff, turnedOn, checkFolder } from './office-folders.ts';
import { record } from './office-ledger.ts';
import {
  raiseAsk,
  ask,
  type Decision,
  TWINS,
  asksNoMore,
  carryOutTogether
} from './office-asks.ts';
import { followUp } from './office-follow-ups.ts';
import { grantAccess } from './office-access.ts';
import { taskEnded } from './office-tasks.ts';
import { readReport, report } from './office-desk.ts';
import { ownerName } from './office-usage.ts';

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
  reportWhenDone = false,
  inChat = false
): Promise<boolean> {
  return decide(id, decision, reason, { reportWhenDone, inChat });
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
  /** The owner answered on the ask's card in its Odd's chat: the run the answer starts replies there. */
  inChat?: boolean;
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
 * the call and it goes on the desk as a `call` ask, showing the exact call,
 * with the Odd's own title and reason (`odd`). The title the office reads from
 * the call itself (`said`, Gmail's count of emails) comes first. The same call
 * still open is not raised twice: the Odd hears the one there.
 */
export async function raiseCall(
  place: CallPlace,
  call: HeldCall,
  service: string,
  odd: { title: string; why: string }
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
    title: `${call.said ?? odd.title} in ${service}`,
    why: odd.why,
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
  if (on.includes('commands') && commandsHow(before.agent, currentPlatform()).state === 'never')
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
 * Make the change a level or office tool ask asked for, in `tx`, with the
 * yes, or neither happens: the Settings tab's own change (`changeLevel`,
 * `changeTools`), with its ledger title. A level the Odd already holds or
 * passed stays as it is, so a yes never undoes a higher level set since, and
 * tools already on stay on; either still starts the work (`{}`). Nothing for
 * any other kind, or when the Odd is gone. A new kind fails the type check
 * here until it says which.
 */
async function grantSetting(tx: Tx, claimed: AskRow): Promise<{ title?: string } | undefined> {
  switch (claimed.kind) {
    case 'level': {
      if (!claimed.level) throw fixedError('This ask names no level');
      const before = await staffer(claimed.staffId, tx);
      if (!before) return;
      if (levelAtMost(claimed.level, before.permission)) return {};
      return changeLevel(tx, claimed.staffId, claimed.level);
    }
    case 'office_tool':
      if (!claimed.officeTools?.length) throw fixedError('This ask names no office tool');
      return (await changeTools(tx, claimed.staffId, claimed.officeTools, true)) ?? {};
    case 'approval':
    case 'access':
    case 'hire':
    case 'goal':
    case 'plan':
    case 'hand_offs':
    case 'window':
    case 'reply':
    case 'filter':
    case 'folder':
    case 'switch':
    case 'call':
    case 'remove':
    case 'bring_back':
    case 'catch_up':
    case 'standing':
      return;
    default:
      claimed.kind satisfies never;
  }
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
  accept = false,
  inChat = false
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
    const done = await decide(id, 'approve', reason, { folder: { ...a.folder, given }, inChat });
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
    /**
     * The Odd that raised it left the office (`removeOdd`): the office closes
     * it as a no, with this line as the answer that goes back, and no run reads it.
     */
    withdrawn?: string;
  }
): Promise<boolean> {
  if (decision === 'iterate' && !reason) throw fixedError('Say what to change');
  if (decision !== 'deny') {
    const [raised] = await db
      .select({ kind: asks.kind, odd: asks.odd })
      .from(asks)
      .where(eq(asks.id, id));
    // Refused before the ask closes, so a no-longer-possible yes leaves it open with the reason.
    if (decision === 'approve' && raised) {
      const move = oddMoveOf(raised.kind);
      const held = move && (await leavingRefused(LEAVING_CHECK[move], raised.odd));
      if (held) throw new Error(held);
    }
    if (decision === 'iterate' && yesOrNo(raised?.kind))
      throw new Error('Say yes or no: nobody reworks this one');
    // Only the office's send or save approves a reply, once Gmail took it.
    if (decision === 'approve' && raised?.kind === 'reply' && !o.reply)
      throw new Error(OWNER_ANSWERS.ask.reply.approve.by);
    // Only the office's Create filter approves a filter, once Gmail made it.
    if (decision === 'approve' && raised?.kind === 'filter' && !o.filter)
      throw new Error(OWNER_ANSWERS.ask.filter.approve.by);
    // Only the office's own call approves a held call, once it made it.
    if (decision === 'approve' && raised?.kind === 'call' && !o.call)
      throw new Error(OWNER_ANSWERS.ask.call.approve.by);
    // Only the office's Give access approves a folder ask, giving the folder with it.
    if (decision === 'approve' && raised?.kind === 'folder' && !o.folder?.given)
      throw new Error(OWNER_ANSWERS.ask.folder.approve.by);
  }
  const status = decision === 'approve' ? 'approved' : decision === 'deny' ? 'denied' : 'revise';
  const at = new Date();
  const { ask, twins, turned, granted } = await db.transaction(async (tx) => {
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
    if (claimed && effectsOf(claimed.kind, decision).includes('start_held'))
      await startHeld(tx, claimed);
    // The folder goes to the Odd with the yes, or neither happens.
    const given = claimed?.kind === 'folder' && decision === 'approve' && o.folder?.given;
    if (claimed && given) {
      // `giveFolder` checked this path with the owner's Accept, so no warning comes back.
      const changed = await changeFolder(tx, claimed.staffId, given.path, given.level, {
        accept: true
      });
      if (changed && 'refused' in changed) throw new FolderRefused(changed.refused);
    }
    // The switches turn on with the yes, or neither happens.
    const turned =
      claimed?.kind === 'switch' && decision === 'approve'
        ? await turnOnSwitches(tx, claimed)
        : undefined;
    // The standing yes goes on the grant with the yes, or neither happens.
    if (claimed && effectsOf(claimed.kind, decision).includes('give_standing'))
      await giveStanding(tx, claimed);
    // The level or office tools change with the yes, or neither happens.
    const granted = claimed && decision === 'approve' ? await grantSetting(tx, claimed) : undefined;
    // A yes or a no answers the twins too, at the same moment (`answeredWith`).
    // Sending one back leaves them waiting for the new version's answer.
    const open =
      claimed && TWINS[claimed.kind] && decision !== 'iterate'
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
    return { ask: claimed, twins: answered, turned, granted };
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
    actor: o.withdrawn ? 'office' : 'owner',
    // A folder given, a switch turned on, a level raised or office tools turned
    // on from its ask reads as the Settings tab's change does.
    title: o.withdrawn
      ? `Withdrawn: ${ask.title}`
      : made
        ? `Created a Gmail filter: ${filterDone(made)}`
        : gave
          ? gaveFolder((await anyStaffer(ask.staffId))?.name ?? ask.staffId, gave.path, gave.level)
          : turned?.on.length
            ? turnedOn(turned.before.name, turned.on)
            : granted?.title
              ? granted.title
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
  // Only the run this ask's own answer starts, never a twin's, replies under its card.
  const chat: InChat | undefined = o.inChat
    ? { staffId: ask.staffId, card: { kind: 'ask', id: ask.id, title: ask.title } }
    : undefined;
  const owner = await ownerName();
  const said = sent
    ? `${owner} ${sent.sent?.action === 'draft' ? 'saved to Gmail drafts' : 'sent'} "${ask.title}"`
    : made
      ? `${owner} created the Gmail filter "${ask.title}" as: ${filterDone(made)}`
      : `${owner} ${decision === 'deny' ? 'said no to' : 'approved'} "${ask.title}"`;
  const answer = o.withdrawn ?? (ask.reason ? `${said}: ${ask.reason}` : `${said}.`);
  for (const effect of effectsOf(ask.kind, decision)) {
    if (typeof effect === 'object') continue;
    switch (effect) {
      // Done before this loop: the caller's approval, and the held hand-off and the standing yes with the claim.
      case 'approval_work':
      case 'start_held':
      case 'give_standing':
        break;
      case 'grant_access': {
        if (!ask.access) break;
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
        break;
      }
      // The folder went to the Odd with the claim: the work that waited on it picks up.
      case 'give_folder':
        if (gave) await carryOutTogether([ask, ...twins], undefined, db, chat);
        break;
      // The switches turned on with the claim: the work that waited on them picks up.
      case 'turn_on':
        if (turned) await carryOutTogether([ask, ...twins], undefined, db, chat);
        break;
      // The level or tools changed with the claim: the work that waited on them picks up.
      case 'grant_setting':
        if (granted) await carryOutTogether([ask, ...twins]);
        break;
      case 'carry_out':
        await followUp(ask.staffId, 'carry_out', {
          askId: ask.id,
          note: ask.reason,
          reportWhenDone: o.reportWhenDone,
          chat
        });
        break;
      case 'rework':
        await followUp(ask.staffId, 'rework', { askId: ask.id, note: ask.reason, chat });
        break;
      case 'answer_window': {
        // The title asks whether to pause the work or let it carry on, so "approved" would not say which.
        const ran = `${owner} let hand-offs run until the usage window resets. Hand on the work the office held.`;
        await answerWindow(
          ask.id,
          decision === 'approve',
          ask.reason ? `${ran} They said: ${ask.reason}` : ran
        );
        break;
      }
      // A yes started the hand-off it held with the claim, and a no stops the thread.
      case 'answer_hand_offs':
        if (ask.threadId)
          await answerHandOffs({ ...ask, threadId: ask.threadId }, decision === 'approve', answer);
        else await answerBack(ask, decision, answer);
        break;
      case 'answer_back':
        for (const a of [ask, ...twins])
          await answerBack(a, decision, answer, a.id === ask.id ? chat : undefined);
        break;
      // A no with a reason may be a lesson: the Odd that asked reads it once. An
      // ask withdrawn because its Odd left has nobody to read it.
      case 'denied_lesson':
        if (ask.reason && !o.withdrawn)
          await followUp(ask.staffId, 'denied', { askId: ask.id, note: ask.reason });
        break;
      // Last in its row, so the answer went back first, and leaving closes any run it started.
      case 'odd_leaves':
        if (ask.odd) await removeOdd(ask.odd, { askId: ask.id });
        break;
      case 'odd_returns':
        if (ask.odd) await bringBack(ask.odd, { askId: ask.id });
        break;
      case 'catch_up':
        await oweCatchUp(ask);
        break;
      default:
        effect satisfies never;
    }
  }
  return true;
}

/** What the owner's decision on an ask of this kind does, from its row in `OWNER_ANSWERS`. */
function effectsOf(kind: AskKind, decision: Decision): readonly AskEffect[] {
  const cell = (OWNER_ANSWERS.ask[kind] as AskAnswer)[decision];
  return cell === 'refused' ? [] : 'by' in cell ? cell.then : cell;
}

/**
 * What `leavingRefused` checks before a yes that moves an Odd, by the move.
 * Any kind whose yes makes that move gets the same check.
 */
const LEAVING_CHECK = {
  odd_leaves: 'remove',
  odd_returns: 'bring_back'
} as const satisfies Partial<
  Record<Extract<AskEffect, string>, Parameters<typeof leavingRefused>[0]>
>;

/** The move the owner's yes to an ask of this kind makes, from its row in `OWNER_ANSWERS`. */
function oddMoveOf(kind: AskKind): keyof typeof LEAVING_CHECK | undefined {
  return effectsOf(kind, 'approve').find(
    (e): e is keyof typeof LEAVING_CHECK => typeof e === 'string' && Object.hasOwn(LEAVING_CHECK, e)
  );
}

/** No run carries out this answer: it goes back to the hand-off or thread the ask came from. */
const answerBack = (ask: AskRow, decision: Decision, answer: string, chat?: InChat) =>
  answerLater(
    { handOffId: ask.handOffId, threadId: ask.threadId, askId: ask.id },
    decision === 'deny' ? 'failed' : 'done',
    answer,
    db,
    chat
  );

/**
 * The Odd that raised an open ask left the office: the office closes it as a
 * no, and `line` goes back where the ask came from, to a hand-off's lead or the
 * thread's hub. Nobody reads it for a lesson.
 */
export async function withdrawAsk(id: number, line: string): Promise<void> {
  await decide(id, 'deny', line, { withdrawn: line });
}

/**
 * The Odd that gave the owner an open task left the office, or took the task
 * off the desk with its `withdraw` tool: the office drops it, and it ends as a
 * dropped task does, `line` going back where it came from.
 */
export async function withdrawTask(id: number, line: string): Promise<void> {
  const [t] = await db
    .update(tasks)
    .set({ status: 'dropped', note: line, withdrawn: true, doneAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.status, 'open')))
    .returning();
  if (!t) return;
  await record({
    kind: 'work',
    actor: 'office',
    title: `Withdrawn: ${t.title}`,
    body: line,
    taskId: t.id
  });
  await taskEnded(t, { ended: 'withdrawn', owner: await ownerName(), said: line });
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
  answer: string,
  q: Db = db,
  chat?: InChat
): Promise<void> {
  if (on.handOffId) await handBackLater(on.handOffId, outcome, answer, q);
  else if (on.threadId) await answerThread(on.threadId, answer, on.askId, q, chat);
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

export { answerLater };
