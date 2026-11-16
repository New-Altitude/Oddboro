// Connectors, grants, jobs, threads, follow-ups, chat cards and runs.
import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import type { Level } from './access-words.ts';
import type { FollowUpKind } from './work/kinds.ts';
import { at, created, id } from './schema-columns.ts';
import { staff } from './schema-staff.ts';
import { type JobFiles, goals, asks } from './schema-asks.ts';
import { tasks, reports } from './schema-desk.ts';

/**
 * How a staffer reaches an outside tool: a server it starts (`stdio`), a
 * hosted one (`http`), found in the MCP Registry or named by its address, or
 * one the office serves itself (`builtin`: Gmail and Google Drive, in
 * apps/office/src/lib/server/google/). A secret named in `secrets` lives in
 * the system's secret store, never here.
 */
export const CONNECTOR_KINDS = ['stdio', 'http', 'builtin'] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];
export type ConnectorConfig = {
  command?: string;
  args?: string[];
  url?: string;
  /** Environment variable names whose values the keychain holds. */
  secrets?: string[];
  /** HTTP header names whose whole values the keychain holds. */
  headers?: string[];
  /**
   * A server the owner signs in to with OAuth. The office keeps the tokens.
   * `true` finds the sign-in from the server's address; `'google'` signs in
   * with New Altitude's own Google client (oauth.ts).
   */
  oauth?: boolean | 'google';
  /** One of the AWS tools: the role it uses from the office's one AWS sign-in (`AWS_SIGN_IN`). */
  aws?: AwsConfig;
  /**
   * Every tool only reads, because the service's own permissions allow
   * nothing else (AWS read only's role), so a Read only grant reaches them all.
   */
  readsByRole?: boolean;
  /** The one LegalZoom mailbox the owner selected for this office. */
  pmb?: string;
  /**
   * Environment variables or headers whose value the office fetches from the
   * owner's AWS Secrets Manager when a run first uses the tool, in place of a
   * pasted one: the secret's name, and a key when the secret holds JSON.
   */
  fromAws?: Record<string, AwsSecretRef>;
  /** Which Google product a Google connector serves. The office looks a Google connector up by this, never by its id. */
  google?: GoogleProduct;
  /** The Google account a Google connector is signed in to, once its sign-in landed. */
  account?: string;
};
/** The Google products the office serves itself. One connector is one account of one product. */
export type GoogleProduct = 'gmail' | 'drive';

/** The role an AWS tool uses, and where. None of it is secret. */
export type AwsConfig = {
  accountId: string;
  role: string;
  /** The Region the owner's secrets or work are in. */
  region: string;
};

export type AwsSecretRef = { secret: string; key?: string };

export const connectors = pgTable('connectors', {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull(),
  kind: text().$type<ConnectorKind>().notNull(),
  config: jsonb().$type<ConnectorConfig>().notNull().default({}),
  /** The MCP Registry name it came from, if any. */
  registry: text(),
  /** Tools a Read grant may call: the ones that passed `readsOnly` when the owner connected it. */
  readTools: text().array().notNull().default([]),
  /** Every tool, for a Draft or Act grant. Filled in when the owner connects it. */
  tools: text().array().notNull().default([]),
  /**
   * What each tool does, by name, in the service's own words: filled in when
   * the owner connects it and kept current by each run's tool list
   * (`noteTools`). Only the owner's page shows them.
   */
  toolNotes: jsonb().$type<Record<string, string>>().notNull().default({}),
  /** Set once the owner has finished connecting it. */
  readyAt: at('ready_at'),
  createdAt: created()
});

export const grants = pgTable(
  'grants',
  {
    staffId: text()
      .notNull()
      .references(() => staff.id),
    connectorId: text()
      .notNull()
      .references(() => connectors.id),
    level: text().$type<Level>().notNull().default('read'),
    /**
     * Tools of this service the Odd uses without asking, its standing yes: at
     * Draft a call to one of them goes through instead of waiting on the desk.
     * Only a write grant has any (`setStanding`, `giveStanding`).
     */
    standing: text().array().notNull().default([]),
    /**
     * Tools of this service the owner approves each call to first, even at
     * Act: a call to one waits on the desk as every change does at Draft.
     * Each list is the exception to its level, so both keep their tools as
     * the level moves. A tool the service drops stays here, so one that comes
     * back by that name still asks first, and the tools it adds in the same
     * refresh join it, in case one is the same tool renamed (`setAskFirst`,
     * `refreshTools`).
     */
    askFirst: text().array().notNull().default([]),
    askId: integer().references(() => asks.id),
    grantedAt: created('granted_at')
  },
  (t) => [primaryKey({ columns: [t.staffId, t.connectorId] })]
);

/** How often a job runs, in the office's time zone. */
export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export type Schedule =
  | { every: 'minutes'; n: number }
  | { every: 'day'; at: string }
  | { every: 'weekday'; at: string }
  | { every: 'week'; day: Weekday; at: string };

/**
 * What a job does with runs it missed while the office was off. `latest`: only
 * the newest run matters, so it catches up once if it is still early enough,
 * else skips to its next time. `record`: each run adds an entry to a series, so
 * every missed period is filled. How: `apps/office/src/lib/server/jobs.ts`.
 */
export const MISSED_RUNS = ['latest', 'record'] as const;
export type MissedRuns = (typeof MISSED_RUNS)[number];

export const jobs = pgTable('jobs', {
  id: id(),
  staffId: text()
    .notNull()
    .references(() => staff.id),
  name: text().notNull(),
  instructions: text().notNull(),
  schedule: jsonb().$type<Schedule>().notNull(),
  files: jsonb().$type<JobFiles>(),
  changedAt: created('changed_at'),
  /** The result goes on the owner's desk as a report. */
  report: boolean().notNull().default(false),
  enabled: boolean().notNull().default(true),
  nextRunAt: at('next_run_at'),
  missed: text().$type<MissedRuns>().notNull().default('latest'),
  /** Missed scheduled times, ISO, oldest first, that the clock still owes one catch-up run. */
  owed: jsonb().$type<string[]>(),
  /** The run a `latest` job skipped, while it waits on the desk's While you were away card. */
  skippedAt: at('skipped_at'),
  createdAt: created()
});

/**
 * `open` until it ends, and the three ways it ends: the hub's last run said
 * done or failed, or the owner said no to more hand-offs (`stopped`). A done
 * or failed one opens again when its hub continues it. Whether an open one
 * waits on the owner is read from their desk (`stageOf` in threads.ts).
 */
export type ThreadStatus = 'open' | 'done' | 'failed' | 'stopped';

/**
 * One piece of work an Odd chains through colleagues (threads.ts). Its first
 * `hand_off` opens it, with that Odd as the hub; only the hub's runs hand off
 * again, so it stays hub and spoke, and threads never nest.
 */
export const threads = pgTable(
  'threads',
  {
    id: id(),
    /** What the work is for: the request, with any later steps or conditions. Every hub run on it sees this. */
    title: text().notNull(),
    goalId: integer().references(() => goals.id),
    hubId: text()
      .notNull()
      .references(() => staff.id),
    /** Who has it now. */
    holderId: text()
      .notNull()
      .references(() => staff.id),
    status: text().$type<ThreadStatus>().notNull().default('open'),
    /** In this round of work, up to `HAND_OFF_LIMIT` (threads.ts). Every round's are its `hand_off` follow-ups. */
    handOffsUsed: integer().notNull().default(0),
    /** When the hub picks it back up, set by the hub. The office clock wakes it. */
    resumeAt: at('resume_at'),
    /**
     * The `window` ask that holds this thread's hand-offs (`handedOff` in work/hand-offs.ts). Its
     * `resumeAt` is then the window's reset, and the owner's yes wakes it sooner.
     */
    heldBy: integer().references(() => asks.id),
    /** The task whose end wakes this thread (`wakeParked` in work/answers.ts). Never set alongside `resumeAt`. */
    resumeOnTask: integer().references(() => tasks.id),
    /**
     * The key of each run that put work here from outside the thread: a hand-off,
     * held or not, or a goal's plan (`keepRun` in work/hand-offs.ts, `raisedOn` in work/threads.ts).
     * While one of them goes (`runsGoing` in office-follow-ups.ts), the hub's pick-ups here
     * wait, so the hub runs once at a time on its thread.
     */
    runs: text().array().notNull().default([]),
    createdAt: created(),
    endedAt: at('ended_at')
  },
  (t) => [
    // States no work change writes (work/state.ts), refused so a bug cannot store one.
    check('threads_one_park', sql`num_nonnulls(${t.resumeAt}, ${t.resumeOnTask}) <= 1`),
    check('threads_held_has_time', sql`${t.heldBy} is null or ${t.resumeAt} is not null`)
  ]
);

/** `waiting` means the staffer put what it needs on the owner's desk. */
export type Outcome = 'done' | 'failed' | 'waiting';

/**
 * Work one staffer handed another (hand-offs.ts). On a `hand_off` row, `from`
 * is the staffer that handed it. On the `handed_back` row that brings the
 * result home, `from` is the colleague that did it, with how it ended, and
 * `id` is the `hand_off` row it answers. A hand-off that waited on the owner
 * comes home again once they answer; `answered` marks a hand-back whose text
 * is the owner's answer itself, since no run followed it.
 */
export type HandOff = {
  from: string;
  title: string;
  brief: string;
  /** Tools others on the thread have and the colleague lacks (sharing.ts). */
  withheld?: string[];
  /** The colleague's own tools that someone else on the thread lacks: it must not write their contents there. */
  kept?: string[];
  /**
   * The files named for this work, as paths inside the thread's folder. A
   * hand-off a v0.0.9 office stored holds paths in the giver's own folder
   * instead; the colleague's brief names those as no longer there.
   */
  files?: string[];
  outcome?: Outcome;
  id?: number;
  answered?: boolean;
};

/**
 * A hand-off held for the owner's yes: only what the lead chose, the work and
 * the colleague it goes to. What it carries is worked out at the yes
 * (`sharing`), since access can change while the ask waits.
 */
export type HeldHandOff = Pick<HandOff, 'from' | 'title' | 'brief' | 'files'> & { to: string };

/**
 * The owner saved an edit to a staffer's file: its path inside the staffer's
 * folder, and the file as it was just before that save. The `edited` run reads
 * the file as it is when the run starts.
 */
export type FileEdit = { path: string; before: string };

/**
 * The card in its Odd's chat the owner answered from: an ask they approved
 * or sent back there, or a task they finished there. The run their answer
 * starts replies in that chat under it, as well as in the Ledger.
 */
export type ChatCard = { kind: 'ask' | 'task'; id: number; title: string };

/**
 * An answer the owner gave in a chat: the Odd whose chat it is, and the card.
 * Only a run of that Odd's replies there (`chatCardOf`).
 */
export type InChat = { staffId: string; card: ChatCard };

/** The card a run of `staffId` replies under, when the owner answered in its own chat. */
export const chatCardOf = (staffId: string, chat?: InChat): ChatCard | undefined =>
  chat?.staffId === staffId ? chat.card : undefined;

export const followUps = pgTable(
  'follow_ups',
  {
    id: id(),
    staffId: text()
      .notNull()
      .references(() => staff.id),
    kind: text().$type<FollowUpKind>().notNull(),
    askId: integer().references(() => asks.id),
    reportId: integer().references(() => reports.id),
    taskId: integer().references(() => tasks.id),
    /** A new goal for the Office Manager to plan. */
    goalId: integer().references(() => goals.id),
    /** Work a colleague handed this staffer, or the result of work it handed one. */
    handOff: jsonb().$type<HandOff>(),
    /** The thread this run works on, either side (threads.ts). */
    threadId: integer().references(() => threads.id),
    /** On an `edited` follow-up, the file the owner edited. */
    edit: jsonb().$type<FileEdit>(),
    /** The owner's words: their reason, what to change, their answer, or their note on a task. */
    note: text(),
    /**
     * On a `task_done` or `carry_out` follow-up, the titles of other work parked on the task,
     * which picked up on its own as the task ended, so this run leaves it alone.
     * Office text, never the owner's words: it stays out of `note`.
     */
    pickedUp: text().array(),
    /**
     * The task the thread was parked on when this run's claim ended the park
     * (`startFollowUp`). Kept so a run that fails can give the wait back
     * (`finishFollowUp`): only a run that ends without failing, or the wait's own end, ends it.
     */
    unparkedTask: integer().references(() => tasks.id),
    /**
     * The time the thread was parked until when this run's claim ended the park,
     * kept for the same give-back. Never a usage-window hold's reset, which the claim leaves.
     */
    unparkedAt: at('unparked_at'),
    /** The owner ticked "Report when done": success goes on their desk too. A failure always does. */
    reportWhenDone: boolean().notNull().default(false),
    /** The owner answered in this Odd's chat, on this card: the run's reply goes there too. Null from the Desk. */
    chatCard: jsonb().$type<ChatCard>(),
    createdAt: created(),
    startedAt: at('started_at'),
    outcome: text().$type<Outcome>(),
    /** What the staffer said it did. */
    result: text(),
    doneAt: at('done_at')
  },
  (t) => [
    // States no work change writes (work/state.ts), refused so a bug cannot store one.
    check('follow_ups_ended_together', sql`(${t.outcome} is null) = (${t.doneAt} is null)`),
    check('follow_ups_one_unpark', sql`num_nonnulls(${t.unparkedTask}, ${t.unparkedAt}) <= 1`)
  ]
);

export type RunStatus = 'running' | 'done' | 'failed';
/** Why a run started: its schedule came due, or the owner pressed Run now. */
export type RunTrigger = 'schedule' | 'manual';

/**
 * A file job's run, as only the office records it. `periods` are the scheduled
 * times the run is for, ISO, oldest first, set as it starts. `sha256` is set
 * only once the office's file tools saw the run write `output` (the writer's
 * part and file name) with those exact bytes. A run with periods and no
 * digest left no checked file for them. A reader's run also names the input
 * it read and the writer's run that wrote it.
 */
export type CheckedFiles = {
  periods: string[];
  output: string;
  sha256?: string;
  input?: string;
  inputRun?: number;
};

export const runs = pgTable('runs', {
  id: id(),
  jobId: integer()
    .notNull()
    .references(() => jobs.id),
  staffId: text()
    .notNull()
    .references(() => staff.id),
  status: text().$type<RunStatus>().notNull().default('running'),
  trigger: text().$type<RunTrigger>().notNull().default('schedule'),
  summary: text(),
  /** A file job's run, as the office checked it (`CheckedFiles`). Null for other jobs. */
  checkedFiles: jsonb().$type<CheckedFiles>(),
  startedAt: created('started_at'),
  finishedAt: at('finished_at')
});
