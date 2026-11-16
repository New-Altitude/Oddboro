// Asks, and the goals they belong to.
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import type { FolderAccess, Level, OwnSwitch } from './access-words.ts';
import type { GmailFilter } from './filter-words.ts';
import type { MailAttachment } from './mail-attachments.ts';
import type { OfficeToolId } from './tools.ts';
import { at, created, id } from './schema-columns.ts';
import { staff } from './schema-staff.ts';
import type { GoogleProduct, Schedule, MissedRuns, HeldHandOff } from './schema-runs.ts';

/**
 * `goal` proposes a goal the manager heard in chat; approving sets it. `plan`
 * is how the office meets one goal: hires and work for staff already here.
 * `hand_offs` is the office's ask when a hand-off would pass a round's limit
 * (threads.ts): a yes starts another round, and a no stops the thread. `window` is the
 * office's one ask when the plan's 5-hour window passes its guard
 * (`handedOff` in work/hand-offs.ts): a yes lets hand-offs run until it resets, and a no holds
 * them until then. `reply` is one email reply an Odd proposes (`asks.reply`):
 * the owner edits it, then the office sends it or saves it to Gmail drafts.
 * `filter` is one Gmail filter an Odd proposes (`asks.filter`): the owner may
 * change it, then the office creates it in Gmail. `folder` is a folder on this
 * computer an Odd asks for (`asks.folder`): the owner may narrow it, then the
 * office gives it (`setFolder`). `call` is one call to an outside tool that
 * changes something, held by the gateway for an Odd at Draft (`asks.call`):
 * on the owner's yes the office makes that exact call. `switch` asks for the
 * owner's Run commands or Browse the web switch, or both (`asks.switches`):
 * the owner's yes turns them on. `level` asks for a higher level (`asks.level`)
 * and `office_tool` for office tools the owner grants (`asks.officeTools`): the
 * owner's yes makes the Settings tab's own change (`changeLevel`, `changeTools`).
 * `remove` asks to let an Odd go (`asks.odd`):
 * an Odd asking to leave names itself, and the Office Manager names another.
 * `bring_back` is the manager's ask to bring back an Odd that left. The owner's
 * yes does it (`removeOdd`, `bringBack`). `catch_up` is the office's ask to
 * fill more missed periods of a `record` job than it fills on its own
 * (`asks.catch_up`, missed-runs.ts): the owner's yes owes the job those periods.
 */
export const ASK_KINDS = [
  'approval',
  'access',
  'hire',
  'goal',
  'plan',
  'hand_offs',
  'window',
  'reply',
  'filter',
  'folder',
  'switch',
  'level',
  'office_tool',
  'call',
  'remove',
  'bring_back',
  'catch_up',
  'standing'
] as const;
export type AskKind = (typeof ASK_KINDS)[number];
/** `revise` means the owner sent it back to be reworked. */
export type AskStatus = 'open' | 'approved' | 'denied' | 'revise';
/**
 * What an access ask wants: a connector and a level. `another` asks for one
 * more Google account of that product: approving it makes a new connector
 * (`addGoogleAccount`) and `connector` then names it.
 */
export type AccessRequest = {
  connector: string;
  level: Level;
  another?: GoogleProduct;
  connectOnly?: true;
};
/**
 * What a folder ask wants: a folder by its real path (`checkFolder`), to read
 * or to read and change. `given` is set once the owner gave a folder for it:
 * the one they picked, which may be narrower than the Odd asked.
 */
export type FolderRequest = {
  path: string;
  level: FolderAccess;
  given?: { path: string; level: FolderAccess };
};
/**
 * One email reply an Odd proposes. The owner may change the recipients,
 * subject and body; the office stores their final version with `sent` once
 * Gmail took it.
 */
export type ReplyDraft = {
  /** The Gmail thread it answers, for a reply. */
  gmailThreadId?: string;
  /** The Gmail message id it answers. */
  inReplyTo?: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** The Odd's one or two lines on the email it answers. */
  summary: string;
  /** Files from the Odd's folder that go with it (`mail-attachments.ts`); the owner may drop any. */
  attachments?: MailAttachment[];
  /** The Gmail connector it goes out through: the account the email came to. */
  connector?: string;
  /** That account's address, as the desk shows it. */
  account?: string;
  /** Set once Gmail sent it or saved it as a draft. */
  sent?: { action: 'send' | 'draft'; at: string; gmailId: string };
};
/**
 * One call to an outside tool an Odd at Draft made, held for the owner's yes:
 * the tool, by its connector and its own name, and the exact arguments. The
 * office makes this call, and no other, once the owner approves, and keeps
 * what came back in `result`.
 */
export type HeldCall = {
  connector: string;
  tool: string;
  arguments: Record<string, unknown>;
  /** What it does in the owner's words, from the call alone ("Archive: 26 emails"): the ask's title. */
  said?: string;
  /**
   * Each thing it acts on, read from the service as it was held (an email's
   * subject, sender and date). Words from strangers: the page shows them,
   * and no Odd's prompt or brief ever carries them.
   */
  shown?: string[];
  /**
   * Calls to the same service the run made without asking (its standing yes)
   * before it made this one, such as the change a commit call applies. Only
   * the desk shows them.
   */
  before?: { tool: string; arguments: Record<string, unknown> }[];
  /** Set once the office made the call: whether the tool took it, and its words. */
  result?: { ok: boolean; text: string; at: string };
};
/** What a catch_up ask fills: one job's missed scheduled times, ISO, oldest first. */
export type CatchUp = { jobId: number; times: string[] };
/** A standing ask: tools of one service the Odd asks to use without asking. */
export type StandingRequest = { connector: string; tools: string[] };
/** A proposed hire. Approving it opens the hire window filled in with this. */
export type HireProposal = {
  name: string;
  role: string;
  /** A room template id, like `mail-room`. */
  room?: string;
  permission: Level;
  remit: string;
  /** The job description, a file in the proposer's folder, read when the owner opens the hire window. */
  jobDescriptionFile: string;
  /** Office tools beyond the ones every staffer has. */
  tools?: string[];
  job?: NewJob;
  /** What the person looks like, in words, for drawing their look. */
  appearance?: string;
  /** The owner's intake answers, a file in the proposer's folder. The hire gets a copy as `notes/intake.md`. */
  intakeFile?: string;
  /** The goal this hire serves, and its part in it. Hiring links them. */
  goal?: { id: number; part: string };
  /** A real person New Altitude offers as a persona: its slug. The hire window offers that persona. */
  personaSlug?: string;
};

/** Files a recurring job exchanges on one piece of work. Names start inside the thread. */
export type JobFiles = {
  thread: number;
  input?: string;
  output: string;
  /** The source tools whose contents the output shares. */
  sources?: string[];
  /** The owner approved putting those sources in this output on this work. */
  share?: boolean;
};

/** A new job for a staffer. */
export type NewJob = {
  name: string;
  instructions: string;
  schedule: Schedule;
  report?: boolean;
  missed?: MissedRuns;
  files?: Omit<JobFiles, 'thread'>;
};

/** One piece of a goal plan. The owner ticks the ones to go ahead with. */
export type GoalPlanItem =
  | { kind: 'hire'; hire: HireProposal; part: string }
  | {
      kind: 'assign';
      /** A staffer already here. */
      staff: string;
      part: string;
      /** A new job for it. */
      job?: NewJob;
      /** A change to one of its jobs, by name. */
      editJob?: {
        name: string;
        newName?: string;
        instructions?: string;
        schedule?: Schedule;
        missed?: MissedRuns;
        files?: Omit<JobFiles, 'thread'>;
      };
    };

/** How the office meets one goal. */
export type GoalPlan = {
  goalId: number;
  items: GoalPlanItem[];
  /** What only the owner can do, as numbered steps. Approving puts them on the desk as a task. */
  ownerSteps?: string[];
};

/** When a goal is for. `date` reads `due`. */
export type GoalHorizon = 'week' | 'quarter' | 'year' | 'date' | 'ongoing';
export const GOAL_STATUSES = ['active', 'paused', 'met', 'dropped'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** A goal as written, before it is one: what the owner or the manager proposes. */
export type GoalDraft = {
  title: string;
  why?: string;
  doneWhen?: string;
  horizon: GoalHorizon;
  /** YYYY-MM-DD, for a `date` horizon. */
  due?: string;
  area: string;
};

/** What the owner wants more of. Staff serve goals; the manager plans them. */
export const goals = pgTable('goals', {
  id: id(),
  /** One explicit submission from the manager's chat, kept across retries. */
  requestId: uuid().unique(),
  title: text().notNull(),
  why: text(),
  doneWhen: text(),
  horizon: text().$type<GoalHorizon>().notNull().default('ongoing'),
  due: text(),
  area: text().notNull().default('work'),
  status: text().$type<GoalStatus>().notNull().default('active'),
  createdAt: created(),
  updatedAt: at('updated_at').notNull().defaultNow()
});

/** Which staffer serves which goal, and its part in it. A staffer sees only these goals. */
export const staffGoals = pgTable(
  'staff_goals',
  {
    staffId: text()
      .notNull()
      .references(() => staff.id),
    goalId: integer()
      .notNull()
      .references(() => goals.id),
    part: text().notNull(),
    createdAt: created()
  },
  (t) => [primaryKey({ columns: [t.staffId, t.goalId] })]
);

export type GoalHealth = 'on_track' | 'slipping' | 'blocked';

/** A staffer's word on how a goal it serves is going, with one line of evidence. */
export const goalProgress = pgTable(
  'goal_progress',
  {
    id: id(),
    goalId: integer()
      .notNull()
      .references(() => goals.id),
    staffId: text()
      .notNull()
      .references(() => staff.id),
    health: text().$type<GoalHealth>().notNull(),
    note: text().notNull(),
    createdAt: created()
  },
  (t) => [index('goal_progress_goal_idx').on(t.goalId, t.createdAt)]
);

export const asks = pgTable(
  'asks',
  {
    id: id(),
    staffId: text()
      .notNull()
      .references(() => staff.id),
    kind: text().$type<AskKind>().notNull().default('approval'),
    title: text().notNull(),
    why: text().notNull(),
    ifApproved: text().notNull(),
    access: jsonb().$type<AccessRequest>(),
    hire: jsonb().$type<HireProposal>(),
    /** A goal ask's goal, set when the owner approves it. */
    goal: jsonb().$type<GoalDraft>(),
    /** A plan ask's plan. */
    plan: jsonb().$type<GoalPlan>(),
    /** A reply ask's email. */
    reply: jsonb().$type<ReplyDraft>(),
    /** A filter ask's Gmail filter. */
    filter: jsonb().$type<GmailFilter>(),
    /** A folder ask's folder and level. */
    folder: jsonb().$type<FolderRequest>(),
    /** A call ask's held call to an outside tool. */
    call: jsonb().$type<HeldCall>(),
    /** A catch_up ask's job, and each missed scheduled time it would fill. */
    catchUp: jsonb().$type<CatchUp>(),
    /** A switch ask's switches, Run commands or Browse the web, to turn on (`ask_for_switch`). */
    switches: jsonb().$type<OwnSwitch[]>(),
    /** A level ask's level, above the Odd's own when it asked (`ask_for_level`). */
    level: text().$type<Level>(),
    /** An office_tool ask's office tools, ones the Settings tab grants (`ask_for_office_tool`). */
    officeTools: text().array().$type<OfficeToolId[]>(),
    /** A remove or bring_back ask's Odd (a staff id). */
    odd: text(),
    /** A standing ask's tools, to use without asking (`ask_for_standing_yes`). */
    standing: jsonb().$type<StandingRequest>(),
    /** The ask this one reworks, after the owner sent that one back. */
    revises: integer(),
    /** The hand-off (its `hand_off` follow-up) the staffer raised this while working on. */
    handOffId: integer(),
    /** The thread the staffer raised this on: the owner's answer moves it on. */
    threadId: integer(),
    /** On a `hand_offs` ask, the hand-off past the limit it held: the owner's yes starts it. */
    held: jsonb().$type<HeldHandOff>(),
    /** The colleague whose handed-back work the lead raised this from (a staff id). */
    via: text(),
    status: text().$type<AskStatus>().notNull().default('open'),
    reason: text(),
    createdAt: created(),
    decidedAt: at('decided_at')
  },
  (t) => [
    // States no work change writes (work/state.ts), refused so a bug cannot store one.
    check('asks_open_undecided', sql`(${t.status} = 'open') = (${t.decidedAt} is null)`)
  ]
);
