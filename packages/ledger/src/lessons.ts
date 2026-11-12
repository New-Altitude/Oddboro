// Lessons: anything the owner says or fixes once, every Odd it covers acts on
// from then on. An Odd keeps one when it hears a correction; the office loads
// the live ones into every run, and the owner sees, edits or takes back each.
// An Odd also reads the owner's edits to its files for one (`learnFromEdit`).
import {
  and,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  or,
  sql
} from 'drizzle-orm';
import { db } from './db.ts';
import { anyStaffer, record } from './office.ts';
import {
  attachments,
  followUps,
  lessonUses,
  lessons,
  type FileEdit,
  type FollowUpKind,
  type LessonHow,
  type LessonStatus
} from './schema.ts';
import { addFollowUp } from './threads.ts';

export type LessonRow = typeof lessons.$inferSelect;
/** How often a lesson changed one Odd's work. */
export type LessonUse = Pick<typeof lessonUses.$inferSelect, 'uses' | 'lastUsedAt'>;
/** How a lesson reads: its status, or `dropped` for a guess the owner did not keep in time. */
export type LessonState = LessonStatus | 'dropped';
/** A lesson as one Odd follows it, with that Odd's own uses. */
export type TaughtLesson = Omit<LessonRow, 'status'> & { status: LessonState } & LessonUse;
/** A lesson as the owner sees it in an Odd's chat. */
export type LessonLine = Pick<
  TaughtLesson,
  'id' | 'text' | 'quote' | 'appliesTo' | 'how' | 'status' | 'staffId' | 'missed'
>;
/** Who a lesson is for: the Odd that heard it, or every Odd. */
export type LessonScope = 'me' | 'everyone';
/**
 * The owner's words a run carries, and where they came from: their chat
 * message, their note on an ask or a task, or their version of a file they
 * edited. The office sets them, never the Odd.
 */
export type OwnerWords = { text: string; from: 'chat' | 'note' | 'edit' };
/**
 * Why a new lesson replaces an old one: `missed` when the owner had to say
 * again what the old one covered, `refined` when they changed what they want.
 */
export const WHY_REPLACED = ['missed', 'refined'] as const;
export type WhyReplaced = (typeof WHY_REPLACED)[number];

/** An Odd says a lesson changed its work this many times, then stops saying so. */
export const CITE_FIRST = 3;
/**
 * Live and waiting lessons an Odd may keep in one scope, so a run's prompt
 * stays short. A dropped guess does not count.
 */
export const LESSON_CAP = 25;
/** Days a guess waits for the owner's Keep before it drops. */
export const GUESS_DAYS = 7;
/** A quote this short could be found in almost anything the owner wrote. */
export const QUOTE_MIN_WORDS = 3;
/** Where a lesson applies is a few plain words, like "reports" or "family plans". */
export const APPLIES_TO_MAX = 60;

/** Where a lesson applies, as its lines say it: nothing when it applies everywhere. */
const onlyIn = (l: Pick<LessonRow, 'appliesTo'>) =>
  l.appliesTo ? ` (only in: ${l.appliesTo})` : '';

/**
 * A live lesson as a run's prompt lists it, kept on `day`. The office fills
 * in `{owner}` with the owner's name, as it does for the whole prompt.
 */
export const lessonLine = (
  l: Pick<LessonRow, 'id' | 'staffId' | 'text' | 'appliesTo' | 'quote'>,
  day: string
) =>
  `- #${l.id}, ${day}, ${l.staffId ? 'for you' : 'for every Odd'}: ${l.text}${onlyIn(l)} ({owner}: "${l.quote}")`;

/** Where a lesson applies as stored: trimmed, and null for everywhere. */
const place = (appliesTo: string | null | undefined) => appliesTo?.trim() || null;

/** How much of each version of an edited file the Odd reading the edit sees. */
export const EDIT_CHARS = 8000;
/** Context kept before the first change, so the Odd sees where it falls. */
const EDIT_LEAD = 500;

/** Both versions of an edited file as the Odd reading the edit sees them. */
export type EditShown = { from: number; before: string; now: string };

/**
 * Both versions cut to EDIT_CHARS, from a little before the first change, so
 * an edit far down a long file still shows. `from` is where both start.
 */
export function editShown(before: string, now: string): EditShown {
  let same = 0;
  while (same < before.length && before[same] === now[same]) same++;
  const from = Math.max(0, same - EDIT_LEAD);
  return {
    from,
    before: before.slice(from, from + EDIT_CHARS),
    now: now.slice(from, from + EDIT_CHARS)
  };
}

/** Words compared without case, spacing, quote marks or end punctuation. */
const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '');

/** Words alone: no case, quote marks or punctuation, one space between. */
const wordsOf = (s: string) =>
  plain(s)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Whether `quote` is the owner's own words: at least QUOTE_MIN_WORDS whole
 * words, found in that order in what they said this run.
 */
export function heardIn(quote: string, words: string | undefined): boolean {
  const q = wordsOf(quote);
  return (
    !!words && q.split(' ').length >= QUOTE_MIN_WORDS && ` ${wordsOf(words)} `.includes(` ${q} `)
  );
}

/**
 * A lesson that replaces another says why, and only one that replaces says
 * why, so the Odd has to choose whether it missed the old one.
 */
export function replacingProblem(a: {
  replaces?: number;
  whyReplaced?: WhyReplaced;
}): string | undefined {
  if (a.replaces && !a.whyReplaced)
    return `Say why it replaces lesson #${a.replaces}: why_replaced is missed or refined.`;
  if (!a.replaces && a.whyReplaced)
    return 'Pass replaces with the id of the lesson this one replaces.';
}

/**
 * How a lesson is kept, and who it is for. It is `said` only when the Odd says
 * so and the quote is in the owner's words this run carried; anything else
 * waits as `inferred`. Words from an edit make only a guess, for the Odd that
 * read it, whatever the Odd asked: the owner changed a file and stated no
 * rule, so what the change means is the Odd's reading until they keep it.
 */
export function keptAs(
  heardBy: string,
  a: { how: LessonHow; scope: LessonScope; quote: string; ownerWords?: OwnerWords }
): { how: LessonHow; staffId: string | null } {
  const edit = a.ownerWords?.from === 'edit';
  return {
    how: !edit && a.how === 'said' && heardIn(a.quote, a.ownerWords?.text) ? 'said' : 'inferred',
    staffId: !edit && a.scope === 'everyone' ? null : heardBy
  };
}

/**
 * A guess the owner did not keep within GUESS_DAYS. It is worked out as the
 * lesson is read, so nothing runs on a timer to drop it, and Keep after all
 * still makes it live.
 */
export const dropped = (l: Pick<LessonRow, 'status' | 'createdAt'>) =>
  l.status === 'waiting' && Date.now() - l.createdAt.getTime() > GUESS_DAYS * 86_400_000;

/**
 * Whether a follow-up's `note` is the owner's own words, which a lesson may
 * quote (`OWNER_NOTE`). A hand-off's note is the colleague's brief, a
 * hand-back's is the colleague's result, and a hub's pick-up joins the
 * office's lines around each answer.
 */
export const NOTE_IS_OWNERS: Record<FollowUpKind, boolean> = {
  carry_out: true,
  rework: true,
  denied: true,
  task_done: true,
  goal: true,
  first_day: true,
  hand_off: false,
  handed_back: false,
  resume: false,
  // An answer's note joins the office's lines around each answer, as a pick-up's does.
  answered: false,
  // An edit's words go as OWNER_EDIT, which makes only guesses.
  edited: false
};

/** The owner's note a follow-up run carries as `OWNER_NOTE`, when the note is theirs. */
export const ownerNoteOf = (f: { kind: FollowUpKind; note: string | null }) =>
  NOTE_IS_OWNERS[f.kind] ? (f.note ?? undefined) : undefined;

const followedBy = (staffId: string) => or(eq(lessons.staffId, staffId), isNull(lessons.staffId));

/** The lessons a run follows: live, for this Odd or every Odd, newest first. */
export async function liveLessons(staffId: string): Promise<LessonRow[]> {
  return db
    .select()
    .from(lessons)
    .where(and(followedBy(staffId), eq(lessons.status, 'live')))
    .orderBy(desc(lessons.createdAt));
}

/**
 * Every lesson for this Odd or every Odd, whatever its status, newest first,
 * with this Odd's uses. That includes every lesson it heard, which is always
 * for it or for everyone. A guess past GUESS_DAYS reads as `dropped`.
 */
export async function lessonsOf(staffId: string): Promise<TaughtLesson[]> {
  const rows = await db
    .select({
      ...getTableColumns(lessons),
      uses: sql<number>`coalesce(${lessonUses.uses}, 0)`.mapWith(Number),
      lastUsedAt: lessonUses.lastUsedAt
    })
    .from(lessons)
    .leftJoin(lessonUses, and(eq(lessonUses.lessonId, lessons.id), eq(lessonUses.staffId, staffId)))
    .where(followedBy(staffId))
    .orderBy(desc(lessons.createdAt));
  return rows.map((l) => (dropped(l) ? { ...l, status: 'dropped' as const } : l));
}

/** A lesson in the Lessons window: how often it changed each Odd's work, and in all. */
export type LibraryLesson = LessonRow & LessonUse & { usesBy: Record<string, LessonUse> };

/**
 * Everything the office knows about the owner, for the Lessons window: every
 * open lesson, for one Odd or every Odd, guesses waiting for their Keep first,
 * each group newest first, with each Odd's uses and the total. A guess past
 * GUESS_DAYS, an undone lesson and a replaced one are left out.
 */
export async function libraryLessons(): Promise<LibraryLesson[]> {
  const [rows, uses] = await Promise.all([
    db
      .select()
      .from(lessons)
      .where(inArray(lessons.status, ['live', 'waiting']))
      .orderBy(desc(lessons.createdAt)),
    db.select().from(lessonUses)
  ]);
  return openGuessesFirst(rows).map((l) => {
    const mine = uses.filter((u) => u.lessonId === l.id);
    const last = mine.map((u) => u.lastUsedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
    return {
      ...l,
      uses: mine.reduce((n, u) => n + u.uses, 0),
      lastUsedAt: last ? new Date(last) : null,
      usesBy: Object.fromEntries(
        mine.map((u) => [u.staffId, { uses: u.uses, lastUsedAt: u.lastUsedAt }])
      )
    };
  });
}

/** How far the page has been told: the newest lesson kept and the newest use. */
export type LessonMark = { kept: number; used: Date | null };
/** A lesson an Odd kept (the Odd that heard it), or an Odd's use of one. */
export type LessonNews = { kind: 'kept' | 'used'; staff: string; lesson: number };

/** Where the news starts as the office starts, so a restart tells nothing again. */
export async function lessonMark(): Promise<LessonMark> {
  const [[k], [u]] = await Promise.all([
    db.select({ kept: max(lessons.id) }).from(lessons),
    db.select({ used: max(lessonUses.lastUsedAt) }).from(lessonUses)
  ]);
  return { kept: k?.kept ?? 0, used: u?.used ?? null };
}

/**
 * Each lesson row and each use newer than `mark`, and the mark after them.
 * The owner's changes (Keep, Undo, an edit) write no new row and no use, so
 * they are never news. Uses one Odd makes of one lesson between two reads
 * share one row, so they are one piece of news.
 */
export async function lessonNewsSince(
  mark: LessonMark
): Promise<{ news: LessonNews[]; mark: LessonMark }> {
  const [kept, used] = await Promise.all([
    db
      .select({ id: lessons.id, heardBy: lessons.heardBy })
      .from(lessons)
      .where(gt(lessons.id, mark.kept))
      .orderBy(lessons.id),
    db
      .select()
      .from(lessonUses)
      .where(mark.used ? gt(lessonUses.lastUsedAt, mark.used) : isNotNull(lessonUses.lastUsedAt))
      .orderBy(lessonUses.lastUsedAt)
  ]);
  return {
    news: [
      ...kept.map((l) => ({ kind: 'kept' as const, staff: l.heardBy, lesson: l.id })),
      ...used.map((u) => ({ kind: 'used' as const, staff: u.staffId, lesson: u.lessonId }))
    ],
    mark: {
      kept: kept.at(-1)?.id ?? mark.kept,
      used: used.at(-1)?.lastUsedAt ?? mark.used
    }
  };
}

/**
 * The lessons a list shows, from rows newest first: live ones and guesses
 * waiting for the owner's Keep, guesses first. A dropped guess is left out.
 */
export function openGuessesFirst<T extends { status: LessonState; createdAt: Date }>(
  rows: T[]
): T[] {
  return (
    rows
      .filter(
        (l) =>
          (l.status === 'live' || l.status === 'waiting') &&
          !dropped({ status: l.status, createdAt: l.createdAt })
      )
      // Stable, so each group stays newest first.
      .sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting'))
  );
}

/** How many guesses wait for the owner's Keep on each Odd's Lessons tab: its own and every Odd's. */
export async function guessesWaiting(staffIds: string[]): Promise<Record<string, number>> {
  const waiting = (
    await db
      .select({ staffId: lessons.staffId, status: lessons.status, createdAt: lessons.createdAt })
      .from(lessons)
      .where(eq(lessons.status, 'waiting'))
  ).filter((l) => !dropped(l));
  return Object.fromEntries(
    staffIds.map((id) => [id, waiting.filter((l) => !l.staffId || l.staffId === id).length])
  );
}

export async function lesson(id: number): Promise<LessonRow | undefined> {
  const [row] = await db.select().from(lessons).where(eq(lessons.id, id));
  return row;
}

const forWhom = async (l: Pick<LessonRow, 'staffId'>) =>
  l.staffId ? ((await anyStaffer(l.staffId))?.name ?? l.staffId) : 'every Odd';

/** The ledger keeps the owner's words, and how many times they had to give them. */
const recordTaught = async (l: LessonRow) =>
  record({
    kind: 'decision',
    actor: 'owner',
    title: `Taught ${await forWhom(l)}${l.missed ? `, told ${l.missed + 1} times now` : ''}: ${l.text}${onlyIn(l)}`,
    reason: l.quote
  });

/** A lesson goes live: the one it replaces stops, and the ledger keeps the owner's words. */
async function goLive(l: LessonRow): Promise<void> {
  if (l.replaces)
    await db
      .update(lessons)
      .set({ status: 'replaced' })
      .where(and(eq(lessons.id, l.replaces), inArray(lessons.status, ['live', 'waiting'])));
  await recordTaught(l);
}

/**
 * An Odd keeps a lesson it heard. It is `said` only when the quote is in the
 * owner's words this run carried; otherwise it waits for the owner's Keep.
 * A run with none of their words keeps nothing: waiting lessons count toward
 * the cap, so guesses from an email or a page could crowd out the owner's own.
 * Only a `said` lesson changes one already there: a guess with the same words
 * and place returns that lesson as it is, replacing nothing and counting no
 * miss, and a new guess replaces its lesson only once the owner keeps it, so
 * nothing the Odd inferred changes what the owner already taught.
 * Returns the lesson, or why it was not kept.
 */
export async function keepLesson(
  heardBy: string,
  a: {
    text: string;
    quote: string;
    how: LessonHow;
    scope: LessonScope;
    /** Where it applies, in a few plain words; left out, it applies everywhere. */
    appliesTo?: string;
    replaces?: number;
    /** Given exactly when `replaces` is. */
    whyReplaced?: WhyReplaced;
    /** The owner's words this run carries. */
    ownerWords: OwnerWords | undefined;
  }
): Promise<LessonRow | { problem: string }> {
  if (!a.ownerWords?.text.trim())
    return {
      problem:
        "Lessons come only from the owner's own words in a chat, a note or an edit, and this run carries none, so tell the owner in your reply instead."
    };
  // The chat shows the quote as the owner's words, so one read from an edit
  // has to be in the file as they saved it.
  if (a.ownerWords.from === 'edit' && !heardIn(a.quote, a.ownerWords.text))
    return {
      problem: `Quote ${QUOTE_MIN_WORDS} or more words in a row from the file as it is now, or keep nothing.`
    };
  const { how, staffId } = keptAs(heardBy, a);
  const scoped = staffId ? eq(lessons.staffId, staffId) : isNull(lessons.staffId);
  const open = and(scoped, inArray(lessons.status, ['live', 'waiting']));
  const problem = replacingProblem(a);
  if (problem) return { problem };
  const missedIt = a.whyReplaced === 'missed';
  let missed = 0;
  if (a.replaces) {
    const old = await lesson(a.replaces);
    if (
      !old ||
      !['live', 'waiting'].includes(old.status) ||
      dropped(old) ||
      (old.staffId && old.staffId !== heardBy)
    )
      return { problem: `Lesson #${a.replaces} is not one of your current lessons.` };
    // Replacing it would stop it for every other Odd too.
    if (!old.staffId && staffId)
      return {
        problem: `Lesson #${a.replaces} is for every Odd, so a lesson only for you cannot replace it. Keep yours without replaces: the newer lesson wins for you.`
      };
    if (missedIt) missed = old.missed + 1;
  }
  const held = (await db.select().from(lessons).where(open)).filter((l) => !dropped(l));
  const appliesTo = place(a.appliesTo);
  const sameWords = held.filter((l) => plain(l.text) === plain(a.text));
  const same = sameWords.find((l) => plain(l.appliesTo ?? '') === plain(appliesTo ?? ''));
  if (same) {
    if (how !== 'said') return same;
    const replaces = a.replaces && a.replaces !== same.id ? a.replaces : same.replaces;
    const nowSaid = same.status === 'waiting';
    if (!missedIt && !nowSaid && replaces === same.replaces) return same;
    const [row] = await db
      .update(lessons)
      .set({
        replaces,
        // The quote that was heard is what makes it `said`, so it replaces the guessed one.
        ...(nowSaid ? { how, status: 'live' as const, quote: a.quote.trim() } : {}),
        ...(missedIt ? { missed: sql`${lessons.missed} + 1` } : {})
      })
      .where(eq(lessons.id, same.id))
      .returning();
    // Said, so it is live now, whether it was before or waited as a guess.
    await goLive(row);
    return row;
  }
  // The same words for another place are another lesson, which replaces the
  // open one with those words (a live one first) as it goes live: at once when
  // said, on the owner's Keep when a guess. So narrowing or moving a lesson
  // leaves one place, not both.
  const moved = a.replaces
    ? undefined
    : (sameWords.find((l) => l.status === 'live') ?? sameWords[0]);
  const replacing = a.replaces ?? moved?.id;
  if (held.length >= LESSON_CAP && !replacing)
    return {
      problem: `${staffId ? 'You hold' : 'The office holds'} ${LESSON_CAP} lessons already. Pass replaces with the id of the one this covers, and why_replaced.`
    };
  const [row] = await db
    .insert(lessons)
    .values({
      staffId,
      heardBy,
      text: a.text.trim(),
      quote: a.quote.trim(),
      appliesTo,
      how,
      status: how === 'said' ? 'live' : 'waiting',
      replaces: replacing ?? null,
      missed
    })
    .returning();
  if (row.status === 'live') await goLive(row);
  return row;
}

/**
 * The owner changes a lesson: Keep one that waits, Undo one, reword it, say
 * where it applies (null or empty for everywhere), or widen or narrow who it
 * is for. Returns the lesson as it stands.
 */
export async function changeLesson(
  id: number,
  patch: {
    text?: string;
    appliesTo?: string | null;
    scope?: LessonScope;
    status?: Extract<LessonStatus, 'live' | 'undone'>;
  }
): Promise<LessonRow | undefined> {
  const was = await lesson(id);
  if (!was) return undefined;
  const text = patch.text?.trim();
  const moved = patch.appliesTo !== undefined;
  // A lesson for one Odd never replaces a lesson for every Odd, so narrowing
  // one lets go of the office-wide lesson it replaced.
  const old = patch.scope === 'me' && was.replaces ? await lesson(was.replaces) : undefined;
  const letGo = old && !old.staffId ? old.id : undefined;
  const [row] = await db
    .update(lessons)
    .set({
      // The owner typed the new text, so it is their words now.
      ...(text ? { text, quote: text, how: 'said' as const } : {}),
      ...(moved ? { appliesTo: place(patch.appliesTo) } : {}),
      ...(patch.scope ? { staffId: patch.scope === 'everyone' ? null : was.heardBy } : {}),
      ...(letGo ? { replaces: null } : {}),
      ...(patch.status ? { status: patch.status } : {})
    })
    .where(eq(lessons.id, id))
    .returning();
  if (patch.status === 'live' && was.status !== 'live') await goLive(row);
  else if (patch.status === 'undone' && was.status === 'live')
    await record({
      kind: 'decision',
      actor: 'owner',
      title: `Took back a lesson for ${await forWhom(was)}: ${was.text}`
    });
  if (letGo) await bringBack(letGo, id);
  if (patch.status === 'undone' && was.replaces) await bringBack(was.replaces, id);
  else if (row.status === 'live' && (text || moved || patch.scope))
    await record({
      kind: 'decision',
      actor: 'owner',
      title: `Changed a lesson, now for ${await forWhom(row)}: ${row.text}${onlyIn(row)}`,
      reason: was.text === row.text ? null : `Was: ${was.text}`
    });
  return row;
}

/**
 * A lesson that stops replacing another (Undo, or narrowed to one Odd) brings
 * back the one it replaced, while that one is still replaced and no other
 * open lesson replaces it.
 */
async function bringBack(oldId: number, stoppedId: number): Promise<void> {
  const others = (
    await db
      .select({ status: lessons.status, createdAt: lessons.createdAt })
      .from(lessons)
      .where(
        and(
          eq(lessons.replaces, oldId),
          ne(lessons.id, stoppedId),
          inArray(lessons.status, ['live', 'waiting'])
        )
      )
  ).filter((l) => !dropped(l));
  if (others.length) return;
  await db
    .update(lessons)
    .set({ status: 'live' })
    .where(and(eq(lessons.id, oldId), eq(lessons.status, 'replaced')));
}

/** An Odd says a live lesson it follows changed its work. Returns it with that Odd's count. */
export async function usedLesson(id: number, staffId: string): Promise<TaughtLesson | undefined> {
  const [l] = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.id, id), eq(lessons.status, 'live'), followedBy(staffId)));
  if (!l) return undefined;
  const now = new Date();
  const [use] = await db
    .insert(lessonUses)
    .values({ staffId, lessonId: id, uses: 1, lastUsedAt: now })
    .onConflictDoUpdate({
      target: [lessonUses.staffId, lessonUses.lessonId],
      set: { uses: sql`${lessonUses.uses} + 1`, lastUsedAt: now }
    })
    .returning();
  return { ...l, uses: use.uses, lastUsedAt: use.lastUsedAt };
}

/**
 * The owner saved an edit to an Odd's file: start one `edited` run for the
 * Odd to read it for a lesson. `before` is the file just before the save.
 * A save while a run for that file has not finished starts nothing: one yet
 * to start keeps the earlier `before` and reads the newest version when it
 * starts, and once one under way ends, the office calls this again with the
 * version it read, so a save made meanwhile starts one more. A file on a task
 * is a form the owner filled in, not a correction, and an unchanged file says
 * nothing. Returns whether it started one.
 */
export async function learnFromEdit(
  staffId: string,
  edit: FileEdit,
  after: string
): Promise<boolean> {
  if (edit.before === after) return false;
  const [onTask] = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        eq(attachments.staffId, staffId),
        eq(attachments.path, edit.path),
        isNotNull(attachments.taskId)
      )
    );
  if (onTask) return false;
  const [unfinished] = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(
      and(
        eq(followUps.staffId, staffId),
        eq(followUps.kind, 'edited'),
        isNull(followUps.outcome),
        sql`${followUps.edit}->>'path' = ${edit.path}`
      )
    );
  if (unfinished) return false;
  await addFollowUp(db, { staffId, kind: 'edited', edit, note: null });
  return true;
}
