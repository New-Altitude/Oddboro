// The desk: tasks, reports, attachments, pokes, lessons and the ledger.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  vector
} from 'drizzle-orm/pg-core';
import { at, created, id } from './schema-columns.ts';
import { staff } from './schema-staff.ts';
import { asks } from './schema-asks.ts';

/**
 * One step of a task for the owner. `action` puts a control in the step:
 * a sign-in, a field whose value goes in the keychain, a tool list to
 * confirm, or a choice.
 */
export type StepAction =
  | { kind: 'secret'; connector: string; name: string }
  /** `google`: the sign-in is Google's, so the step can name Google's own limits. */
  | { kind: 'oauth'; connector: string; google?: boolean }
  | { kind: 'aws'; connector: string }
  | { kind: 'postal'; connector: string }
  | { kind: 'choice'; options: string[] }
  | { kind: 'tools'; connector: string };
/** Steps that share a `key` tick together, e.g. the two steps of one sign-in. */
export type Step = {
  text: string;
  done: boolean;
  action?: StepAction;
  answer?: string;
  key?: string;
};
export type TaskStatus = 'open' | 'done' | 'dropped';

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    /** The staffer that gave the owner this task, if any. */
    staffId: text().references(() => staff.id),
    askId: integer().references(() => asks.id),
    /** The hand-off (its `hand_off` follow-up) the staffer gave this while working on. */
    handOffId: integer(),
    /** The thread the staffer gave this on: the owner's answer moves it on. */
    threadId: integer(),
    /** The colleague whose handed-back work the lead gave this from (a staff id). */
    via: text(),
    /**
     * The owner's message in the chat the Odd gave this in (`OWNER_SAID`), so the
     * run that picks it up hears what they asked for. Null outside a chat.
     */
    ownerSaid: text(),
    title: text().notNull(),
    why: text().notNull(),
    steps: jsonb().$type<Step[]>().notNull(),
    /** The task's working text. Version zero is the Odd's starting text until the owner saves it. */
    response: text(),
    responseVersion: integer().notNull().default(0),
    status: text().$type<TaskStatus>().notNull().default('open'),
    note: text(),
    /**
     * True when the office or the task's Odd took it off the desk (`withdrawTask`,
     * or `oddRemoved` as its Odd left), never the owner. Such a task reads as
     * dropped, so this keeps how it ended, even once an Odd that left is
     * brought back.
     */
    withdrawn: boolean().notNull().default(false),
    createdAt: created(),
    doneAt: at('done_at')
  },
  (t) => [
    // States no work change writes (work/state.ts), refused so a bug cannot store one.
    check('tasks_withdrawn_dropped', sql`not ${t.withdrawn} or ${t.status} = 'dropped'`)
  ]
);

export const reports = pgTable('reports', {
  id: id(),
  staffId: text()
    .notNull()
    .references(() => staff.id),
  title: text().notNull(),
  body: text().notNull(),
  createdAt: created(),
  readAt: at('read_at')
});

/**
 * A file a staffer hands the owner with an ask or a task: one in the
 * staffer's own folder, or one in the folder of a thread it is on. The desk
 * lists them. A Markdown one from its own folder opens in the editor right
 * there; one from a thread's folder opens to read only.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    staffId: text()
      .notNull()
      .references(() => staff.id),
    /**
     * Relative to the staffer's folder, e.g. notes/intake.md, or for a file in
     * a thread's folder, from the office's folder, e.g. threads/12/paige/index.html
     * (`workPath`), which `workFile` finds while the staffer is on that thread.
     */
    path: text().notNull(),
    mediaType: text().notNull(),
    taskId: integer().references(() => tasks.id),
    askId: integer().references(() => asks.id),
    createdAt: created()
  },
  (t) => [
    index('attachments_by_task').on(t.taskId),
    index('attachments_by_ask').on(t.askId),
    // Each one belongs to exactly one ask or one task.
    check('attachments_one_owner', sql`num_nonnulls(${t.taskId}, ${t.askId}) = 1`)
  ]
);

/** `sent` until the owner opens that staffer's chat, then `read`. */
export type PokeStatus = 'waiting' | 'sent' | 'read' | 'missed' | 'cancelled';

/**
 * A message a staffer writes now for the office to deliver to the owner later, once:
 * a check-in, a nudge. It lands in their chat with a Mac notification. Never an
 * ask, never a job.
 */
export const pokes = pgTable('pokes', {
  id: id(),
  staffId: text()
    .notNull()
    .references(() => staff.id),
  at: at('at').notNull(),
  message: text().notNull(),
  status: text().$type<PokeStatus>().notNull().default('waiting'),
  createdAt: created(),
  sentAt: at('sent_at')
});

/**
 * `said` when the owner's own words this run carried state it; `inferred` when the
 * Odd read it into a one-off correction. Only a said lesson goes live by itself.
 */
export type LessonHow = 'said' | 'inferred';
/**
 * `waiting` for the owner's Keep (an inferred lesson), `live` in every run,
 * `undone` by the owner, `replaced` by a newer lesson on the same point.
 */
export type LessonStatus = 'waiting' | 'live' | 'undone' | 'replaced';

/**
 * Something the owner said or fixed once, which an Odd acts on from then on.
 * A null `staffId` is a lesson for every Odd; `heardBy` is the Odd that caught it.
 */
export const lessons = pgTable(
  'lessons',
  {
    id: id(),
    staffId: text().references(() => staff.id),
    heardBy: text()
      .notNull()
      .references(() => staff.id),
    /** The lesson, one plain sentence. */
    text: text().notNull(),
    /** The owner's words it came from. */
    quote: text().notNull(),
    /** Where it applies, in a few plain words ("reports", "family plans"); null is everywhere. */
    appliesTo: text(),
    how: text().$type<LessonHow>().notNull(),
    status: text().$type<LessonStatus>().notNull(),
    /** The older lesson this one replaced. */
    replaces: integer(),
    /** Times the owner had to give this correction again after a lesson covered it. */
    missed: integer().notNull().default(0),
    createdAt: created()
  },
  (t) => [index('lessons_by_staff').on(t.staffId, t.status)]
);

/**
 * Runs where a lesson changed an Odd's work, as that Odd told the office. Kept
 * per Odd, so each Odd cites a lesson for every Odd its own first few times.
 */
export const lessonUses = pgTable(
  'lesson_uses',
  {
    staffId: text()
      .notNull()
      .references(() => staff.id),
    lessonId: integer()
      .notNull()
      .references(() => lessons.id),
    uses: integer().notNull().default(0),
    lastUsedAt: at('last_used_at')
  },
  (t) => [primaryKey({ columns: [t.staffId, t.lessonId] })]
);

export type LedgerKind = 'decision' | 'work' | 'report' | 'hire' | 'access';

/** Append-only. Every decision and every piece of finished work, by a staffer or by the owner. */
export const ledger = pgTable(
  'ledger',
  {
    id: id(),
    kind: text().$type<LedgerKind>().notNull(),
    /** A staff id, or `owner`. */
    actor: text().notNull(),
    title: text().notNull(),
    body: text().notNull().default(''),
    reason: text(),
    askId: integer().references(() => asks.id),
    taskId: integer().references(() => tasks.id),
    runId: integer(),
    createdAt: created(),
    embedding: vector({ dimensions: 768 }),
    /** Which model made `embedding` (`EMBED_MODEL`). Null for a vector from before the office ran its own. */
    embeddingModel: text()
  },
  (t) => [
    index('ledger_embedding').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('ledger_words').using(
      'gin',
      sql`to_tsvector('english', ${t.title} || ' ' || ${t.body} || ' ' || coalesce(${t.reason}, ''))`
    )
  ]
);
