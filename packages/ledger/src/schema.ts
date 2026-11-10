// Every table the office keeps. Staff, what they ask the owner, what the owner has to do,
// the access the owner grants, the jobs they run, and the ledger: one row for every
// thing that was decided or done, searchable by meaning.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  vector
} from 'drizzle-orm/pg-core';
import type { ArtKind, Place } from '@oddboro/sprites/art';
import type { LookSpec, PartKind } from '@oddboro/sprites/look';
import type { FloorPlan, OfficeSpec, RoomKind, RoomTemplate } from '@oddboro/world';
import { STARTER_TOOLS } from './tools.ts';
import type { Agent, Effort, GrantedFolder } from './agents.ts';
import type { FolderAccess, Level, OwnSwitch } from './access-words.ts';
import type { GmailFilter } from './filter-words.ts';

const at = (name: string) => timestamp(name, { withTimezone: true });
const created = (name = 'created_at') => at(name).notNull().defaultNow();
const id = () => integer().primaryKey().generatedAlwaysAsIdentity();

export const staff = pgTable('staff', {
  id: text().primaryKey(),
  name: text().notNull(),
  role: text().notNull(),
  office: text().notNull().default('Main Street'),
  sprite: text().notNull().default('staff'),
  variant: text().notNull(),
  portrait: text().notNull(),
  /** The room template it works in. */
  room: text().notNull().default('workspace'),
  permission: text().$type<Level>().notNull().default('read'),
  /** The coding tool its runs go through. The owner picks it at hire and on the Settings tab. */
  agent: text().$type<Agent>().notNull().default('claude'),
  /** The office tools the owner granted, beyond the ones every staffer has. See tools.ts. */
  tools: text().array().notNull().default(STARTER_TOOLS),
  /** The account its runs sign in with on its tool (accounts.ts); null is the tool's Office account. */
  account: text(),
  /** The model its runs use on its tool (`MODELS` in agents.ts); null is the office's. */
  model: text(),
  /** How hard its runs think, as the owner picked it; null is Medium (`effortFor` in agents.ts). */
  effort: text().$type<Effort>(),
  /** The owner's Run commands switch. Whether a run gets a shell also depends on its tool (`commandsHow`). */
  commands: boolean().notNull().default(false),
  /** The owner's Browse the web switch. */
  web: boolean().notNull().default(false),
  /** Folders outside the office the owner lets it read, or read and change, one entry per real path. */
  folders: jsonb().$type<GrantedFolder[]>().notNull().default([]),
  /** One sentence on what it is for, shown on the card. */
  remit: text().notNull(),
  /** The job description its Claude session runs with. */
  desk: text().notNull(),
  /** A generated look. Null keeps the hand-drawn art named by sprite and variant. */
  look: jsonb().$type<LookSpec>(),
  /** The drawn portrait for a generated look, as .px text. */
  portraitPx: text(),
  hiredAt: created('hired_at'),
  /** Set when the owner lets a staffer go. Its history stays. */
  leftAt: at('left_at')
});

/**
 * The accounts the owner added beyond each tool's Office account, which has
 * no row: a named sign-in for one coding tool, kept in its own folder
 * (`accountHome`). Odds share them.
 */
export const accounts = pgTable('accounts', {
  id: text().primaryKey(),
  agent: text().$type<Agent>().notNull(),
  /** What the owner calls it, like "Work" or "Personal". */
  label: text().notNull(),
  createdAt: created('created_at')
});
export type AccountRow = typeof accounts.$inferSelect;

/**
 * `goal` proposes a goal the manager heard in chat; approving sets it. `plan`
 * is how the office meets one goal: hires and work for staff already here.
 * `hand_offs` is the office's ask when a hand-off would pass a round's limit
 * (threads.ts): a yes starts another round, and a no stops the thread. `window` is the
 * office's one ask when the plan's 5-hour window passes its guard
 * (usage-window.ts): a yes lets hand-offs run until it resets, and a no holds
 * them until then. `reply` is one email reply an Odd proposes (`asks.reply`):
 * the owner edits it, then the office sends it or saves it to Gmail drafts.
 * `filter` is one Gmail filter an Odd proposes (`asks.filter`): the owner may
 * change it, then the office creates it in Gmail. `folder` is a folder on this
 * computer an Odd asks for (`asks.folder`): the owner may narrow it, then the
 * office gives it (`setFolder`). `call` is one call to an outside tool that
 * changes something, held by the gateway for an Odd at Draft (`asks.call`):
 * on the owner's yes the office makes that exact call. `switch` asks for the
 * owner's Run commands or Browse the web switch, or both (`asks.switches`):
 * the owner's yes turns them on.
 */
export type AskKind =
  | 'approval'
  | 'access'
  | 'hire'
  | 'goal'
  | 'plan'
  | 'hand_offs'
  | 'window'
  | 'reply'
  | 'filter'
  | 'folder'
  | 'switch'
  | 'call';
/** `revise` means the owner sent it back to be reworked. */
export type AskStatus = 'open' | 'approved' | 'denied' | 'revise';
/**
 * What an access ask wants: a connector and a level. `another` asks for one
 * more Google account of that product: approving it makes a new connector
 * (`addGoogleAccount`) and `connector` then names it.
 */
export type AccessRequest = { connector: string; level: Level; another?: GoogleProduct };
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
  /** Set once the office made the call: whether the tool took it, and its words. */
  result?: { ok: boolean; text: string; at: string };
};
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
  job?: { name: string; instructions: string; schedule: Schedule; report?: boolean };
  /** What the person looks like, in words, for drawing their look. */
  appearance?: string;
  /** The owner's intake answers, a file in the proposer's folder. The hire gets a copy as `notes/intake.md`. */
  intakeFile?: string;
  /** The goal this hire serves, and its part in it. Hiring links them. */
  goal?: { id: number; part: string };
};

/** A new job for a staffer. */
export type NewJob = { name: string; instructions: string; schedule: Schedule; report?: boolean };

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
      editJob?: { name: string; instructions?: string; schedule?: Schedule };
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
export type GoalStatus = 'active' | 'paused' | 'met' | 'dropped';

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

export const asks = pgTable('asks', {
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
  /** A switch ask's switches, Run commands or Browse the web, to turn on (`ask_for_switch`). */
  switches: jsonb().$type<OwnSwitch[]>(),
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
});

/**
 * One step of a task for the owner. `action` puts a control in the step:
 * a sign-in, a field whose value goes in the keychain, a tool list to
 * confirm, or a choice.
 */
export type StepAction =
  | { kind: 'secret'; connector: string; name: string }
  | { kind: 'oauth'; connector: string }
  | { kind: 'aws'; connector: string }
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

export const tasks = pgTable('tasks', {
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
  title: text().notNull(),
  why: text().notNull(),
  steps: jsonb().$type<Step[]>().notNull(),
  status: text().$type<TaskStatus>().notNull().default('open'),
  note: text(),
  createdAt: created(),
  doneAt: at('done_at')
});

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
    embedding: vector({ dimensions: 768 })
  },
  (t) => [
    index('ledger_embedding').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('ledger_words').using(
      'gin',
      sql`to_tsvector('english', ${t.title} || ' ' || ${t.body} || ' ' || coalesce(${t.reason}, ''))`
    )
  ]
);

/**
 * How a staffer reaches an outside tool: a server it starts (`stdio`), a
 * hosted one (`http`), found in the MCP Registry or named by its address, or
 * one the office serves itself (`builtin`: Gmail and Google Drive, in
 * apps/office/src/lib/server/google/). A secret named in `secrets` lives in
 * the system's secret store, never here.
 */
export type ConnectorKind = 'stdio' | 'http' | 'builtin';
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

export const jobs = pgTable('jobs', {
  id: id(),
  staffId: text()
    .notNull()
    .references(() => staff.id),
  name: text().notNull(),
  instructions: text().notNull(),
  schedule: jsonb().$type<Schedule>().notNull(),
  /** The result goes on the owner's desk as a report. */
  report: boolean().notNull().default(false),
  enabled: boolean().notNull().default(true),
  nextRunAt: at('next_run_at'),
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
export const threads = pgTable('threads', {
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
   * The `window` ask that holds this thread's hand-offs (usage-window.ts). Its
   * `resumeAt` is then the window's reset, and the owner's yes wakes it sooner.
   */
  heldBy: integer().references(() => asks.id),
  /**
   * The key of each run that put work here from outside the thread: a hand-off,
   * held or not, or a goal's plan (`keepRun` in threads.ts).
   * While one of them goes (`runsGoing` in office.ts), the hub's pick-ups here
   * wait, so the hub runs once at a time on its thread.
   */
  runs: text().array().notNull().default([]),
  createdAt: created(),
  endedAt: at('ended_at')
});

/**
 * Work a staffer owes after the owner answers it: carry out an approved ask, rework
 * one the owner sent back, take in the reason for a no, act on their feedback on a report, pick up the work
 * that waited on a task the staffer gave them, or plan a goal the owner set. A
 * new hire with a job gets started without being asked by its `first_day`. A `hand_off` is
 * work a colleague handed it, and `handed_back` brings the result home. A
 * `resume` picks a thread back up for its hub: at the time the hub set, or with
 * the owner's answer when no other run follows it. An `edited` run reads the
 * owner's edit to one of the staffer's files, for a lesson.
 */
export type FollowUpKind =
  | 'carry_out'
  | 'rework'
  | 'denied'
  | 'feedback'
  | 'task_done'
  | 'goal'
  | 'first_day'
  | 'hand_off'
  | 'handed_back'
  | 'resume'
  | 'edited';
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
  outcome?: Outcome;
  id?: number;
  answered?: boolean;
};

/**
 * A hand-off held for the owner's yes: only what the lead chose, the work and
 * the colleague it goes to. What it carries is worked out at the yes
 * (`sharing`), since access can change while the ask waits.
 */
export type HeldHandOff = Pick<HandOff, 'from' | 'title' | 'brief'> & { to: string };

/**
 * The owner saved an edit to a staffer's file: its path inside the staffer's
 * folder, and the file as it was just before that save. The `edited` run reads
 * the file as it is when the run starts.
 */
export type FileEdit = { path: string; before: string };

export const followUps = pgTable('follow_ups', {
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
  /** The owner's words: their reason, what to change, their feedback, or their note on a task. */
  note: text(),
  /** The owner ticked "Report when done": success goes on their desk too. A failure always does. */
  reportWhenDone: boolean().notNull().default(false),
  createdAt: created(),
  startedAt: at('started_at'),
  outcome: text().$type<Outcome>(),
  /** What the staffer said it did. */
  result: text(),
  doneAt: at('done_at')
});

export type RunStatus = 'running' | 'done' | 'failed';
/** Why a run started: its schedule came due, or the owner pressed Run now. */
export type RunTrigger = 'schedule' | 'manual';

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
  startedAt: created('started_at'),
  finishedAt: at('finished_at')
});

export type UsageKind = 'chat' | 'job' | 'draft' | 'follow-up' | 'look' | 'office';

/** Hairstyles and clothing Claude drew when the library had nothing that fit. */
export const parts = pgTable(
  'parts',
  {
    kind: text().$type<PartKind>().notNull(),
    name: text().notNull(),
    /** The part as .px text, in the looks palette. */
    px: text().notNull(),
    /** Who it was first drawn for. */
    drawnFor: text().references(() => staff.id),
    createdAt: created()
  },
  (t) => [primaryKey({ columns: [t.kind, t.name] })]
);

/** Tokens one run used, per model. Read from the run's own result. */
export const usage = pgTable(
  'usage',
  {
    id: id(),
    /** Null for a run as the office, like drawing a look before anyone is hired. */
    staffId: text().references(() => staff.id),
    kind: text().$type<UsageKind>().notNull(),
    model: text().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cacheReadTokens: integer().notNull().default(0),
    cacheWriteTokens: integer().notNull().default(0),
    /** Every token the row counts, its one sum, which a staffer's usage (`usageFor`) adds up. */
    tokens: integer().generatedAlwaysAs(
      sql`input_tokens + output_tokens + cache_read_tokens + cache_write_tokens`
    ),
    /** What the run would cost at API list prices. The owner's plan does not bill it. */
    costUsd: doublePrecision().notNull().default(0),
    createdAt: created()
  },
  (t) => [index('usage_by_staff').on(t.staffId, t.createdAt)]
);

/**
 * The person the office works for, as the staff address them. One row. Each
 * install sets its own, so no name is written into the code.
 */
export const owner = pgTable('owner', {
  id: text().primaryKey().default('owner'),
  name: text().notNull(),
  /** When the owner finished the welcome. Until then the office opens on it. */
  welcomedAt: at('welcomed_at'),
  updatedAt: at('updated_at').notNull().defaultNow()
});

/**
 * The owner's Claude plan windows, as the last run reported them. One row. The
 * windows are the account's, so every staffer shares them.
 */
export const planLimits = pgTable('plan_limits', {
  id: text().primaryKey().default('claude'),
  /** Share of the 5-hour window used, 0 to 1. */
  fiveHour: doublePrecision().notNull(),
  fiveHourResetsAt: at('five_hour_resets_at'),
  /** Share of the weekly window used, 0 to 1. */
  sevenDay: doublePrecision().notNull(),
  sevenDayResetsAt: at('seven_day_resets_at'),
  updatedAt: at('updated_at').notNull().defaultNow()
});

/**
 * Office layouts drawn from the owner's words. The one marked `active` is the
 * office; the rest are earlier layouts the owner can move back to. The plan
 * and its rooms are kept as built, so a change to the generator never moves
 * furniture in an office already lived in. `spec` is what Claude wrote, for
 * redrawing.
 */
export const offices = pgTable('offices', {
  id: id(),
  name: text().notNull(),
  description: text().notNull(),
  spec: jsonb().$type<OfficeSpec>().notNull(),
  plan: jsonb().$type<FloorPlan>().notNull(),
  templates: jsonb().$type<Record<string, RoomTemplate>>().notNull(),
  /** Room template id to the kind of room it is. */
  kinds: jsonb().$type<Record<string, RoomKind>>().notNull(),
  active: boolean().notNull().default(false),
  createdAt: at('created_at').notNull().defaultNow(),
  movedInAt: at('moved_in_at')
});

/**
 * Art the office drew for a layout: props, wall hangings, things for desks,
 * floors and wall styles the library had no sprite for. Kept once the owner
 * moves into the layout that asked for it; every later drawing can use it.
 */
export const art = pgTable('art', {
  /** The name the spec uses: unique across the library and everything drawn. */
  name: text().primaryKey(),
  kind: text().$type<ArtKind>().notNull(),
  /** What it looks like, in a sentence. */
  about: text().notNull(),
  place: text().$type<Place>(),
  /** The library piece a theme's stand-in takes the place of, footprint and spots. */
  replaces: text(),
  /** The piece as .px text, in the house palette. */
  px: text().notNull(),
  /** A wall style's four tones, light to deep. */
  ramp: jsonb().$type<string[]>(),
  /** The layout it was first drawn for. */
  drawnFor: integer().references(() => offices.id, { onDelete: 'set null' }),
  createdAt: created()
});

/**
 * Which room each staffer worked in, per office, as it was when the owner
 * moved out: moving back puts everybody where they were. `office` is the
 * sample's plan id or `office-<id>` for a layout.
 */
export const officeRooms = pgTable('office_rooms', {
  office: text().primaryKey(),
  rooms: jsonb().$type<Record<string, string>>().notNull(),
  updatedAt: at('updated_at').notNull().defaultNow()
});

/**
 * The names the owner gives the office's rooms. A room without a row keeps the
 * name its floor plan starts it with. `room` is the composed room's id, like
 * `lobby#2`.
 */
export const roomNames = pgTable(
  'room_names',
  {
    office: text().notNull(),
    room: text().notNull(),
    name: text().notNull(),
    updatedAt: at('updated_at').notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.office, t.room] })]
);

/**
 * What the owner switched off in an office: a lamp, a screen, a fire. A prop
 * without a row is on. `obj` is the placed prop's id, like `library#3/desk-lamp#2`.
 */
export const switchedOff = pgTable(
  'switched_off',
  {
    office: text().notNull(),
    obj: text().notNull(),
    offAt: at('off_at').notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.office, t.obj] })]
);

/**
 * The app's updates. One row. The owner's window, in office time, is when a
 * new version may install. The shell reports the version it has downloaded
 * (`readyVersion`), and the office picks `installAt`: the next window's start,
 * or now when the owner presses Install now. `downAt` and `upAt` are when the
 * app last went down for an update and came back, so a poke due between them
 * still lands. See `update-window.ts`.
 */
export const appUpdate = pgTable('app_update', {
  id: text().primaryKey().default('app'),
  windowStart: text().notNull().default('02:00'),
  windowEnd: text().notNull().default('04:00'),
  readyVersion: text(),
  readyNotes: text(),
  readyAt: at('ready_at'),
  installAt: at('install_at'),
  downAt: at('down_at'),
  upAt: at('up_at'),
  updatedAt: at('updated_at').notNull().defaultNow()
});
