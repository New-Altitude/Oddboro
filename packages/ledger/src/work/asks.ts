// An ask from raised to decided: an Odd raises it, and the owner answers it.
// Each decider mirrors the database code it replaces, named on each, and
// takes every fact from the loaded rows.
//
// Pure: every import that reaches the database is a type.
import { askReplaced, ASK_REPLACED, OWNER_ANSWERS, type AskAnswer } from '../desk-answers.ts';
import { fixedError } from '../errors.ts';
import type { Decision } from '../office-asks.ts';
import type { AskKind, InChat, Outcome } from '../schema.ts';
import { yesOrNo } from '../tools.ts';
import type { After, Decided } from '../transition.ts';
import {
  ANSWERED_ALREADY,
  answerBack,
  answerLead,
  callResultText,
  effectsOf,
  filterDone,
  offWorkAnswer,
  replyDone,
  startCarryOuts,
  turnedOn
} from './answers.ts';
import type { AskDone, EventOf } from './events.ts';
import {
  changeOf,
  draft,
  filled,
  putAll,
  type Change,
  type Draft,
  type LedgerLine,
  type WorkRows
} from './snapshot.ts';
import { askRow, type Ask, type AskBase } from './state.ts';
import {
  freeFromWindow,
  handOn,
  hasLeft,
  LEFT_RAISES_NOTHING,
  leftBeforeStarting,
  oweRun,
  raisedOn,
  stopThread
} from './threads.ts';
import { asksNoMore, TWINNED } from './twins.ts';

/**
 * An Odd raises an ask, as `raiseAsk` in office-asks.ts does, and a held
 * call as `raiseCall` in office-decide.ts does. The same call still open is
 * not raised twice: the result names the one there. A new version of the
 * Odd's own open ask closes it as replaced, so the owner sees one. Raised on
 * a thread, it keeps the thread open until the owner answers (`raisedOn`).
 * The repeat refusals stay in the entry, under its desk lock.
 */
export function askRaised(
  rows: WorkRows,
  e: EventOf<'askRaised'>,
  now: Date
): Decided<Change<{ already: number } | null>> {
  const a = e.ask;
  if (hasLeft(rows, a.staffId)) return { refused: LEFT_RAISES_NOTHING };
  const call = a.kind === 'call' ? a.call : undefined;
  const same = call
    ? [...rows.asks.values()]
        .filter(
          (r) =>
            r.staffId === a.staffId &&
            r.kind === 'call' &&
            r.status === 'open' &&
            r.call?.connector === call.connector &&
            r.call.tool === call.tool &&
            JSON.stringify(r.call.arguments) === JSON.stringify(call.arguments)
        )
        .sort((x, y) => x.id - y.id)[0]
    : undefined;
  if (same) return { change: changeOf(draft(rows), { already: same.id }), after: [] };

  const d = draft(
    rows,
    e.attach?.length
      ? [{ kind: 'attachments', staffId: a.staffId, paths: e.attach, to: { ask: 'ask' } }]
      : []
  );
  const empty = {
    access: null,
    hire: null,
    goal: null,
    plan: null,
    reply: null,
    filter: null,
    folder: null,
    call: null,
    catchUp: null,
    switches: null,
    odd: null,
    standing: null,
    revises: null,
    handOffId: null,
    threadId: null,
    held: null,
    via: null,
    reason: null
  };
  putAll(d, [
    {
      table: 'asks',
      ref: 'ask',
      insert: { ...filled(empty, a), createdAt: now, status: 'open' }
    }
  ]);
  const old = a.revises ? rows.asks.get(a.revises) : undefined;
  if (old?.status === 'open' && old.staffId === a.staffId) {
    const { status: _, ...base } = old;
    putAll(d, [
      {
        table: 'asks',
        row: { ...base, reason: ASK_REPLACED, status: 'revise', decidedAt: now, replaced: true }
      }
    ]);
  }
  if (a.threadId) raisedOn(d, a.threadId, { run: e.run, by: a.staffId, plan: !!a.plan }, now);
  return { change: changeOf(d, null), after: [] };
}

/**
 * Why the owner's answer is refused before the ask closes, as `decide` in
 * office-decide.ts refuses it, so the ask stays open: a kind nobody reworks
 * sent back, or a bare yes to a kind the office approves only by doing it.
 */
function answerRefused(kind: AskKind, decision: Decision, done: AskDone): string | undefined {
  if (decision === 'iterate' && yesOrNo(kind)) return 'Say yes or no: nobody reworks this one';
  if (decision !== 'approve') return undefined;
  const notDone =
    (kind === 'reply' && !done.reply) ||
    (kind === 'filter' && !done.filter) ||
    (kind === 'call' && !done.call) ||
    (kind === 'folder' && !done.folder?.given);
  const cell = (OWNER_ANSWERS.ask[kind] as AskAnswer).approve;
  return notDone && 'by' in cell ? cell.by : undefined;
}

/** An open ask as the owner's answer closes it, at `now`. */
function decidedAs(a: AskBase, decision: Decision, reason: string | null, now: Date): Ask {
  if (decision === 'iterate') {
    const replaced = askReplaced({ status: 'revise', reason });
    return { ...a, reason, status: 'revise', decidedAt: now, replaced };
  }
  return { ...a, reason, status: decision === 'approve' ? 'approved' : 'denied', decidedAt: now };
}

/** What the office did to approve an ask by doing it, which the answer line names. */
function doneWith(rows: WorkRows, ask: Ask, decision: Decision) {
  const approve = decision === 'approve';
  return {
    sent: approve && ask.reply?.sent ? ask.reply : undefined,
    made: approve && ask.filter?.created ? ask.filter : undefined,
    called: approve && ask.call?.result ? ask.call.result : undefined,
    gave: approve ? ask.folder?.given : undefined,
    turned: ask.kind === 'switch' && approve ? rows.prepared.switches : undefined
  };
}
type DoneWith = ReturnType<typeof doneWith>;

/**
 * The owner decided an ask, as `decide` in office-decide.ts does: the ask
 * closes with the answer and what the office did to approve it, its open
 * twins close with it on a yes or a no, and what the answer starts follows
 * its row in `OWNER_ANSWERS`. The entry's own writes (`perKind`) go first, in
 * the same transaction; the I/O an answer does (`effects`) waits for the
 * commit. Twins hear the same words, each back where it came from; those on
 * no work reach their Odd once (`offWorkAnswer`).
 */
export function askDecided(
  rows: WorkRows,
  e: EventOf<'askDecided'>,
  now: Date
): Decided<Change<null>> {
  const { decision, done = {}, effects } = e;
  if (decision === 'iterate' && !e.reason) return { refused: 'Say what to change' };
  const loaded = rows.asks.get(e.id);
  // Refused on the loaded ask whatever its status, before the claim, as today.
  const refused = loaded && decision !== 'deny' && answerRefused(loaded.kind, decision, done);
  if (refused) return { refused };
  if (loaded?.status !== 'open') return { refused: ANSWERED_ALREADY };

  const reason = e.reason || null;
  const { status: _, ...base } = loaded;
  const ask = decidedAs({ ...base, ...done }, decision, reason, now);
  // A yes or a no answers the twins too; sending one back leaves them for the new version.
  const twins =
    TWINNED.includes(ask.kind) && decision !== 'iterate'
      ? [...rows.asks.values()]
          .filter(
            (r) =>
              r.status === 'open' &&
              r.staffId === ask.staffId &&
              r.kind === ask.kind &&
              asksNoMore(askRow(ask), askRow(r))
          )
          .sort((x, y) => x.id - y.id)
          .map(({ status: __, ...r }) => decidedAs(r, decision, reason, now))
      : [];
  const d = draft(
    rows,
    e.perKind.map((effect) => ({ kind: 'perKind', effect }) as const)
  );
  putAll(
    d,
    [ask, ...twins].map((row) => ({ table: 'asks', row }) as const)
  );

  const approved = decision === 'approve';
  const did = doneWith(rows, ask, decision);
  const row = askRow(ask);
  const after: After[] = [{ record: decisionLine(rows, { ask, twins, did, e }) }];
  const carryOut = e.carryOut;
  if (carryOut) after.push({ then: 'carryOut', run: () => carryOut(row) });

  // Only the run this ask's own answer starts, never a twin's, replies under its card.
  const chat: InChat | undefined = e.inChat
    ? { staffId: ask.staffId, card: { kind: 'ask', id: ask.id, title: ask.title } }
    : undefined;
  const owner = rows.owner;
  const said = did.sent
    ? `${owner} ${did.sent.sent?.action === 'draft' ? 'saved to Gmail drafts' : 'sent'} "${ask.title}"`
    : did.made
      ? `${owner} created the Gmail filter "${ask.title}" as: ${filterDone(did.made)}`
      : `${owner} ${decision === 'deny' ? 'said no to' : 'approved'} "${ask.title}"`;
  const answer = e.withdrawn ?? (reason ? `${said}: ${reason}` : `${said}.`);
  const outcome: Outcome = decision === 'deny' ? 'failed' : 'done';
  const back = (a: Ask, card?: InChat): boolean =>
    answerBack(
      d,
      { handOffId: a.handOffId, threadId: a.threadId, askId: a.id },
      { outcome, answer, chat: card },
      now
    );
  // Settled on no work: `offWorkAnswer` carries them once every other run is put.
  const offWork: Ask[] = [];
  const cell = effectsOf(ask.kind, decision);
  for (const effect of cell) {
    if (typeof effect === 'object') continue;
    switch (effect) {
      // The entry's own writes, in `perKind`: the approval, and the standing yes.
      case 'approval_work':
      case 'give_standing':
        break;
      // A colleague that left since the hand-off was held gets none: its lead hears so (`answerHandOffs`).
      case 'start_held': {
        if (!ask.held || !ask.threadId || hasLeft(d.rows, ask.held.to)) break;
        const handOff = rows.prepared.sharing;
        if (!handOff)
          throw fixedError('A held hand-off was approved with what it carries not prepared.');
        handOn(d, { threadId: ask.threadId, to: ask.held.to, handOff, used: 1 }, now);
        break;
      }
      case 'grant_access': {
        const access = ask.access;
        if (!access) break;
        after.push({
          then: 'grantAccess',
          run: async () => {
            const granted = await effects.grantAccess(ask.staffId, access, ask.id);
            // Another Google account is a new connector: the ask and its twins
            // name it from now on, so finishing the connect task finds them.
            if (access.another)
              await effects.pointAsksAtConnector(
                [ask, ...twins].map((a) => a.id),
                { ...access, connector: granted.connector }
              );
            // Connected already: the work that waited picks up now. Otherwise
            // finishing the connect task starts it (`taskEnded`).
            if (!granted.task) await effects.carryOutTogether([row, ...twins.map(askRow)]);
          }
        });
        break;
      }
      // The folder went to the Odd with the claim: the work that waited on it picks up.
      case 'give_folder':
        if (did.gave) startCarryOuts(d, [ask, ...twins], { chat }, now);
        break;
      // The switches turned on with the claim: the work that waited on them picks up.
      case 'turn_on':
        if (did.turned) startCarryOuts(d, [ask, ...twins], { chat }, now);
        break;
      case 'carry_out':
        oweRun(
          d,
          {
            staffId: ask.staffId,
            kind: 'carry_out',
            askId: ask.id,
            note: reason,
            reportWhenDone: e.reportWhenDone
          },
          { chat },
          now
        );
        break;
      case 'rework':
        oweRun(
          d,
          { staffId: ask.staffId, kind: 'rework', askId: ask.id, note: reason },
          { chat },
          now
        );
        break;
      case 'answer_window':
        if (approved) answerWindow(d, ask, now);
        break;
      case 'answer_hand_offs':
        if (ask.threadId)
          answerHandOffs(d, { ...ask, threadId: ask.threadId }, approved, answer, now);
        else if (!back(ask)) offWork.push(ask);
        break;
      case 'answer_back':
        for (const a of [ask, ...twins])
          if (!back(a, a.id === ask.id ? chat : undefined)) offWork.push(a);
        break;
      // A no with a reason may be a lesson: the Odd that asked reads it once. An
      // ask withdrawn because its Odd left has nobody to read it.
      case 'denied_lesson':
        if (reason && !e.withdrawn)
          oweRun(d, { staffId: ask.staffId, kind: 'denied', askId: ask.id, note: reason }, {}, now);
        break;
      // Last in its row, so the answer went back first, and leaving closes any run it started.
      case 'odd_leaves': {
        const odd = ask.odd;
        if (odd)
          after.push({ then: 'removeOdd', run: () => effects.removeOdd(odd, { askId: ask.id }) });
        break;
      }
      case 'odd_returns': {
        const odd = ask.odd;
        if (odd)
          after.push({ then: 'bringBack', run: () => effects.bringBack(odd, { askId: ask.id }) });
        break;
      }
      case 'catch_up':
        after.push({ then: 'oweCatchUp', run: () => effects.oweCatchUp(row) });
        break;
      default:
        effect satisfies never;
    }
  }
  // No answered row when the Odd took the item off the desk itself, when a
  // goal's yes starts its planning run, which carries the answer, or when the
  // same yes lets that Odd go, which would fail the row at once.
  const ownLeave = cell.includes('odd_leaves') && ask.odd === ask.staffId;
  if (!e.withdrawn && !cell.includes('approval_work') && !ownLeave)
    offWorkAnswer(
      d,
      {
        staffId: ask.staffId,
        item: 'ask',
        ids: offWork.map((a) => a.id),
        asked: ask.id,
        line: answer,
        chat
      },
      now
    );
  return { change: changeOf(d, null), after };
}

/**
 * The ledger line of the owner's answer, as `decide` writes it. A folder
 * given or switches turned on read as the Settings tab's change does, from
 * the words the loader prepared.
 */
function decisionLine(
  rows: WorkRows,
  o: { ask: Ask; twins: readonly Ask[]; did: DoneWith; e: EventOf<'askDecided'> }
): LedgerLine {
  const { ask, twins, e } = o;
  const { sent, made, called, gave, turned } = o.did;
  const verb = sent
    ? replyDone(sent)
    : { approve: 'Approved', deny: 'Denied', iterate: 'Sent back' }[e.decision];
  const folderTitle = rows.prepared.folderTitle;
  if (gave && !folderTitle)
    throw fixedError('A folder yes was decided with its ledger line not prepared.');
  const cc = sent?.cc.length ? `, cc ${sent.cc.join(', ')}` : '';
  return {
    kind: 'decision',
    actor: e.withdrawn ? 'office' : 'owner',
    title: e.withdrawn
      ? `Withdrawn: ${ask.title}`
      : made
        ? `Created a Gmail filter: ${filterDone(made)}`
        : gave && folderTitle
          ? folderTitle
          : turned?.off.length
            ? turnedOn(turned.before.name, turned.off)
            : called
              ? `${called.ok ? 'Made' : 'Made, and it failed'}: ${ask.title}`
              : `${verb}: ${ask.title}`,
    body: `${sent ? `To ${sent.to.join(', ')}${cc}. Subject: ${sent.subject}. ` : ''}${called ? `It returned: ${callResultText(called, 600)} ` : ''}${turned ? (turned.networkBody ?? '') + ' ' : ''}Asked by ${ask.staffId}. ${ask.why}${
      twins.length
        ? ` This also answers ${twins.map((t) => `#${t.id}`).join(', ')}, the same ask from another of ${ask.staffId}'s runs.`
        : ''
    }`,
    reason: ask.reason,
    askId: ask.id
  };
}

/**
 * A yes to the usage window's ask, as `answerWindow` in usage-window.ts
 * does: every open thread it holds picks back up, its lead told hand-offs
 * run until the reset. A no leaves them for the clock to wake at the reset.
 */
function answerWindow(d: Draft, ask: Ask, now: Date): void {
  // The title asks whether to pause the work or let it carry on, so "approved" would not say which.
  const ran = `${d.rows.owner} let hand-offs run until the usage window resets. Hand on the work the office held.`;
  const line = ask.reason ? `${ran} They said: ${ask.reason}` : ran;
  const held = [...d.rows.threads.values()]
    .filter((t) => t.status === 'open' && t.park.on === 'window' && t.park.ask === ask.id)
    .map((t) => t.id)
    .sort((a, b) => a - b);
  freeFromWindow(d, ask.id, held);
  for (const id of held) answerLead(d, id, line, { askId: ask.id }, now);
}

/**
 * The owner answered a `hand_offs` ask, as `answerHandOffs` in ../threads.ts
 * does. A yes already started the hand-off it held (`start_held`); the lead
 * hears the yes itself only when the owner wrote something with it. One held
 * for a colleague that left since never goes, and the lead hears why. A no
 * stops the work, the held hand-off never goes, and the lead hears so it can
 * say where the work stands.
 */
function answerHandOffs(
  d: Draft,
  a: Ask & { threadId: number },
  approved: boolean,
  answer: string,
  now: Date
): void {
  if (!approved) {
    stopThread(d, a.threadId, now);
    answerLead(
      d,
      a.threadId,
      `${answer} The work has stopped: nothing more runs on it. Say where it stands, and finish.`,
      { askId: a.id },
      now
    );
    return;
  }
  const { held } = a;
  // An ask raised before asks held their hand-off, or one held for a
  // colleague that left since: the yes starts a new round, the lead hands on again.
  if (!held || hasLeft(d.rows, held.to)) {
    const t = d.rows.threads.get(a.threadId);
    if (t) putAll(d, [{ table: 'threads', row: { ...t, handOffsUsed: 0 } }]);
    const gone = held
      ? ` "${held.title}" never went: ${leftBeforeStarting(d.rows.staff.get(held.to)?.name ?? held.to)}`
      : '';
    answerLead(d, a.threadId, `${answer}${gone} Hand on the next piece now.`, { askId: a.id }, now);
    return;
  }
  if (!a.reason) return;
  const { to, title } = held;
  answerLead(
    d,
    a.threadId,
    `${answer} "${title}" went to ${d.rows.staff.get(to)?.name ?? to} as you handed it, the first hand-off of a new round, and its result brings you back. Do not hand it on again.`,
    { askId: a.id },
    now
  );
}
