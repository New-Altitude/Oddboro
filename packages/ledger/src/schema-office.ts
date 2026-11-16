// The office itself: usage, the owner's plan, its rooms, switches, updates and project sessions.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique
} from 'drizzle-orm/pg-core';
import type { ArtKind, Place } from '@oddboro/sprites/art';
import type { PartKind } from '@oddboro/sprites/look';
import type { FloorPlan, OfficeSpec, RoomKind, RoomTemplate } from '@oddboro/world';
import { at, created, id } from './schema-columns.ts';
import { staff } from './schema-staff.ts';
import { threads } from './schema-runs.ts';

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
  /**
   * When the owner said yes to Advanced mode in Setup. Null while it is off.
   * Project sessions, which run outside Oddboro's limits, exist only while it is on.
   */
  advancedAt: at('advanced_at'),
  /**
   * When the owner passed the Act check (act-check.ts). Null until then, and
   * while null nothing puts an Odd at Act (`changeLevel`, `hire`).
   */
  actCheckAt: at('act_check_at'),
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

// A connection belongs to one native conversation in the owner's chosen project.
// The provider keeps its full transcript. The office keeps requests it sent there.
export const projectSessions = pgTable(
  'project_sessions',
  {
    id: text().primaryKey(),
    agent: text().$type<'claude' | 'codex'>().notNull(),
    nativeId: text().notNull(),
    folder: text().notNull(),
    title: text().notNull(),
    staffId: text(),
    /**
     * The Odd the owner lets send work here without asking: only the one the
     * session is shared with. Null, the default, means every assignment waits
     * for the owner's Take over and send.
     */
    sendsUnasked: text(),
    /**
     * When the owner removed the session from the list. Null means listed.
     * Removing hides the row rather than deleting it, so its requests stay,
     * and connecting the same conversation again clears it.
     */
    hiddenAt: at('hidden_at'),
    /**
     * The absolute Claude folder the conversation lives in. Null means not
     * yet known, as for rows connected before sessions kept their folder,
     * and always for Codex.
     */
    configDir: text('config_dir'),
    createdAt: created()
  },
  (t) => [
    foreignKey({
      name: 'project_sessions_staff_id_fkey',
      columns: [t.staffId],
      foreignColumns: [staff.id]
    }),
    foreignKey({
      name: 'project_sessions_sends_unasked_fkey',
      columns: [t.sendsUnasked],
      foreignColumns: [staff.id]
    }),
    unique('project_sessions_agent_native_id_key').on(t.agent, t.nativeId),
    check('project_sessions_agent_check', sql`${t.agent} IN ('claude', 'codex')`)
  ]
);

export type ProjectRequestState =
  | 'proposed'
  | 'queued'
  | 'authorized'
  | 'sending'
  | 'working'
  | 'done'
  | 'stopped'
  | 'uncertain'
  | 'failed';

export const projectRequests = pgTable(
  'project_requests',
  {
    id: text().primaryKey(),
    sessionId: text().notNull(),
    staffId: text(),
    threadId: integer(),
    prompt: text().notNull(),
    file: text(),
    state: text().$type<ProjectRequestState>().notNull(),
    turn: text(),
    answer: text(),
    createdAt: created()
  },
  (t) => [
    foreignKey({
      name: 'project_requests_session_id_fkey',
      columns: [t.sessionId],
      foreignColumns: [projectSessions.id]
    }),
    foreignKey({
      name: 'project_requests_staff_id_fkey',
      columns: [t.staffId],
      foreignColumns: [staff.id]
    }),
    foreignKey({
      name: 'project_requests_thread_id_fkey',
      columns: [t.threadId],
      foreignColumns: [threads.id]
    }),
    index('project_requests_session').on(t.sessionId, t.createdAt)
  ]
);
