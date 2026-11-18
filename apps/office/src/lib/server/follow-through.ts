// Following a run through: the brief it edits and the work it hands back.
import { savedTaskWords } from './chat-delivery.ts';
import {
  anyStaffer,
  EDIT_CHARS,
  editShown,
  goal as findGoal,
  handOffBrief,
  handOffContext,
  ownerNoteOf,
  resultsToJoin,
  runsAtDraft,
  servesHandOff,
  servesNoThread,
  staffer,
  standsFor,
  taskFiles,
  thread as threadById,
  type AskRow,
  type EditShown,
  type FollowUpRow,
  type GoalRow,
  type Outcome,
  type TaskRow,
  type Unparked,
  workTitle
} from '@oddboro/ledger';
import { randomUUID } from 'node:crypto';
import { followUpDetail, type WorkAbout } from '../staff/work.ts';
import { readStaffFile } from './files.ts';
import { followUpBrief, waitEnded } from './follow-up-brief.ts';
import { OUTCOME_LINE } from './persona-run.ts';
import { slot } from './run-state.ts';
import { run } from './run-tool.ts';

const JOB_TIMEOUT_MS = 20 * 60_000;

/** What a staffer is told when it reads the owner's edit to its file, for a lesson. */
function editBrief(path: string, shown: EditShown): string[] {
  const cut = shown.from
    ? ` Both start at character ${shown.from}, a little before the first change; the start is the same in both.`
    : '';
  return [
    `{owner} edited your file ${path} and saved it. Below is the file just before their save (your version, unless they had saved it before), then as it is now, each cut at ${EDIT_CHARS} characters.${cut}`,
    '',
    '1. Work out what they changed.',
    '2. If the changes show how they want this kind of work done from now on, call keep_lesson once, quoting their words from the version now. It waits for their Keep, whatever you pass.',
    '3. If it is a one-off fix (a fact, a name, a typo), keep nothing, and say so.',
    '4. Do not edit the file, or anything else. This run only reads the edit.',
    '',
    '<before>',
    shown.before,
    '</before>',
    '',
    '<now>',
    shown.now,
    '</now>'
  ];
}

/**
 * Do the work the owner's answer calls for, in a fresh session, as soon as the owner
 * answers. The staffer ends its reply with an outcome line. A reply without one
 * counts as failed, so the owner hears about it.
 */
export async function followThrough(
  f: FollowUpRow & { unparked?: Unparked },
  a?: AskRow,
  t?: TaskRow,
  g?: GoalRow
): Promise<{ outcome: Outcome; text: string; saw?: string; joined?: number[] }> {
  const who = await staffer(f.staffId);
  if (!who) return { outcome: 'failed', text: `No Odd named ${f.staffId}` };
  // Work a colleague handed over, or its result coming home.
  const handed =
    (f.kind === 'hand_off' || f.kind === 'handed_back') && f.handOff
      ? { kind: f.kind, ...f.handOff }
      : undefined;
  const colleague = handed && {
    id: handed.from,
    name: (await anyStaffer(handed.from))?.name ?? handed.from
  };
  // The hand-off this run's work serves, if any: its own, or the one whose ask or
  // task the owner just answered. Its result goes back to the giver.
  const serves = await servesHandOff(f);
  // Whether this run carries out the owner's yes to an approval ask, which the Draft rule weighs.
  const carriesApproval = f.kind === 'carry_out' && a?.kind === 'approval';
  const giver = serves?.handOff
    ? {
        id: serves.handOff.from,
        name: (await anyStaffer(serves.handOff.from))?.name ?? serves.handOff.from
      }
    : undefined;
  // The thread it works on. Every hand-off is a step in one, and its files cross
  // in the thread's folder. Hand-backs written before they carried their thread cannot find it.
  const threadId = f.threadId ?? serves?.threadId ?? undefined;
  const thread = threadId ? await threadById(threadId) : undefined;
  if (colleague && !thread)
    return {
      outcome: 'failed',
      text: `This hand-off with ${colleague.name} lost track of the work it was for.`
    };
  // Results that landed while a run of this Odd's on the thread had yet to end:
  // this pick-up takes them too, and they end with it.
  const joined = await Promise.all(
    (await resultsToJoin(f)).flatMap(({ id, handOff: h, note }) =>
      h
        ? [
            anyStaffer(h.from).then((c) => ({
              id,
              h,
              result: note,
              colleague: { id: h.from, name: c?.name ?? h.from }
            }))
          ]
        : []
    )
  );
  const joinedIds = joined.map((j) => j.id);
  // What this pick-up raises comes from a colleague's work: the newest result's colleague.
  const via =
    handed?.kind === 'handed_back'
      ? [
          { id: f.id, from: handed.from },
          ...joined.map((j) => ({ id: j.id, from: j.h.from }))
        ].sort((x, y) => y.id - x.id)[0].from
      : undefined;
  // The owner's edit, read now, so saves while this waited to start are in it.
  let edit: { path: string; saw: string; shown: EditShown } | undefined;
  if (f.kind === 'edited') {
    const e = f.edit;
    if (!e) return { outcome: 'failed', text: 'This edit run lost track of its file.' };
    try {
      const saw = (await readStaffFile(who.id, e.path)).content;
      edit = { path: e.path, saw, shown: editShown(e.before, saw) };
    } catch (err) {
      return {
        outcome: 'failed',
        text: `Could not read ${e.path}: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
  const label = edit
    ? `Reading your edit to ${edit.path}`
    : handed
      ? `${handed.kind === 'hand_off' ? 'For' : 'Back from'} ${colleague?.name}: ${handed.title}`
      : f.kind === 'resume'
        ? (thread?.title ?? 'Picking the work back up')
        : (a?.title ??
          (t
            ? `After: ${t.title}`
            : g
              ? `Plan: ${g.title}`
              : f.kind === 'first_day'
                ? 'First day'
                : followUpDetail(f.kind, { colleague: colleague?.name })));
  const task = t ? { row: t, files: await taskFiles(t.id) } : undefined;
  // One carry-out may stand for twin asks that start no run of their own.
  // `standsFor` finds none for a kind that has no twins.
  const also = f.kind === 'carry_out' && a ? await standsFor(a) : [];
  const detail = followUpDetail(f.kind, { ask: a?.id, colleague: colleague?.name });
  // A colleague handed work on a goal's thread is told the goal in its brief.
  const goalServed =
    handed?.kind === 'hand_off' && thread?.goalId ? await findGoal(thread.goalId) : undefined;
  const goal = goalServed ?? (thread?.goalId ? await findGoal(thread.goalId) : g);
  const leadId = thread?.hubId ?? who.id;
  const about: WorkAbout | undefined =
    goal?.status === 'active'
      ? {
          key: randomUUID(),
          kind: 'goal',
          id: goal.id,
          title: goal.title,
          leadId,
          lead: leadId === who.id ? who.name : ((await staffer(leadId))?.name ?? leadId)
        }
      : undefined;
  // The owner sees the work by its one name, as it shows while queued and in
  // the Ledger; `label` stays the run's message to the model.
  const work = {
    kind: 'follow-up' as const,
    label: await workTitle(f),
    detail,
    askId: a?.id,
    about,
    handOffId: serves?.id
  };
  const draftOnly = runsAtDraft({
    kind: f.kind,
    serves: !!serves,
    carriesApproval,
    actsOnHandOffs: who.actsOnHandOffs
  });
  const res = await slot(who.id, work, (onEvent, runId) =>
    run(who, label, {
      kind: 'follow-up',
      literal:
        f.kind === 'task_done' && t?.responseVersion && t.response
          ? savedTaskWords(t.response)
          : undefined,
      runId,
      onEvent,
      asked:
        handed?.kind === 'hand_off'
          ? `${colleague?.name} asked you: ${handed.title}\n\n${handed.brief}`
          : undefined,
      approvedAsk: f.kind === 'carry_out' ? a?.id : undefined,
      ownerNote: ownerNoteOf(f),
      ownerEdit: edit && { path: edit.path, text: edit.shown.now },
      draftOnly,
      lessonRun: servesNoThread(f.kind),
      handOffId: serves?.id,
      // A lead's pick-up reads a colleague's result: it stays at Draft by its
      // kind, and its standing yeses follow the owner's choice too.
      fromColleague: serves !== undefined || f.kind === 'handed_back',
      threadId: thread?.id,
      via,
      shown: f.kind === 'handed_back' ? [f.id, ...joinedIds] : undefined,
      timeoutMs: JOB_TIMEOUT_MS,
      extra: [
        '',
        '## This run',
        '',
        '{owner} is not in a chat with you.',
        // Answered in its chat: the reply this run ends with shows there (`answerInChat`).
        ...(f.chatCard
          ? [
              `They answered in your chat, so your reply at the end also shows there, under the ${f.chatCard.kind} they answered. Write it to them.`
            ]
          : []),
        '',
        // Here, before the kind's own brief, so every kind of run that ended a park says so.
        ...(f.unparked ? waitEnded(f.unparked) : []),
        ...(handed && colleague && thread
          ? handOffBrief({
              kind: handed.kind,
              h: handed,
              colleague,
              me: who.id,
              result: f.note,
              thread: thread.id,
              goal: goalServed,
              joined,
              acts: !draftOnly && who.permission === 'act'
            })
          : edit
            ? editBrief(edit.path, edit.shown)
            : [
                ...followUpBrief(f, a, task, g, {
                  also,
                  draftOnly,
                  level: who.permission,
                  actsOnHandOffs: who.actsOnHandOffs
                }),
                ...(serves?.handOff && giver && thread
                  ? handOffContext({
                      h: serves.handOff,
                      giver: giver.name,
                      me: who.id,
                      thread: thread.id
                    })
                  : [])
              ]),
        '',
        'Then reply with what you did in a few plain lines. End with one line that is exactly one of: "Outcome: done", "Outcome: failed", "Outcome: waiting" (waiting means you put what you need on their desk).',
        ''
      ].join('\n')
    })
  );
  // The file an edited run read, so the office can tell a save made while it ran.
  const saw = edit?.saw;
  if (!res.ok) return { outcome: 'failed', text: res.text, saw, joined: joinedIds };
  const m = OUTCOME_LINE.exec(res.text);
  if (!m)
    return {
      outcome: 'failed',
      text: `${res.text}\n\n(${who.name} did not say whether it finished.)`,
      saw,
      joined: joinedIds
    };
  return {
    outcome: m[1].toLowerCase() as Outcome,
    text: res.text.slice(0, m.index).trim(),
    saw,
    joined: joinedIds
  };
}
