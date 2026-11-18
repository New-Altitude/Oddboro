// The Odds, their skills and their accounts.
import { boolean, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import type { LookSpec } from '@oddboro/sprites/look';
import { HIRE_DEFAULTS } from './grantable.ts';
import type { Agent, Effort, GrantedFolder } from './agents.ts';
import type { Level } from './access-words.ts';
import type { PersonaLink } from './personas.ts';
import { at, created } from './schema-columns.ts';

export const staff = pgTable('staff', {
  id: text().primaryKey(),
  name: text().notNull(),
  /** Original name in a Claude agent file, even when the owner names the hire differently. */
  claudeAgentName: text(),
  role: text().notNull(),
  office: text().notNull().default('Main Street'),
  sprite: text().notNull().default('staff'),
  variant: text().notNull(),
  portrait: text().notNull(),
  /** The room template it works in. */
  room: text().notNull().default('workspace'),
  permission: text().$type<Level>().notNull().default(HIRE_DEFAULTS.staff.permission),
  /**
   * The owner's choice for work another Odd hands it, made each time they put
   * it at Act: off, that work runs at Draft at most and no standing yes
   * applies there; on, it runs at the Odd's own level, standing yeses and
   * all. Kept when the level comes down, and changed on the Settings tab.
   */
  actsOnHandOffs: boolean().notNull().default(false),
  /** The coding tool its runs go through. The owner picks it at hire and on the Settings tab. */
  agent: text().$type<Agent>().notNull().default('claude'),
  /** The office tools the owner granted, beyond the ones every staffer has. See tools.ts. */
  tools: text().array().notNull().default(HIRE_DEFAULTS.staff.tools),
  /** The account its runs sign in with on its tool (accounts.ts); null is the tool's Office account. */
  account: text(),
  /** The model its runs use on its tool (`MODELS` in agents.ts); null is the office's. */
  model: text(),
  /** How hard its runs think, as the owner picked it; null is Medium (`effortFor` in agents.ts). */
  effort: text().$type<Effort>(),
  /** The owner's Run commands switch. Whether a run gets a shell also depends on its tool (`commandsHow`). */
  commands: boolean().notNull().default(HIRE_DEFAULTS.staff.commands),
  /** The owner's Browse the web switch. */
  web: boolean().notNull().default(HIRE_DEFAULTS.staff.web),
  /** Folders outside the office the owner lets it read, or read and change, one entry per real path. */
  folders: jsonb().$type<GrantedFolder[]>().notNull().default(HIRE_DEFAULTS.staff.folders),
  /** One sentence on what it is for, shown on the card. */
  remit: text().notNull(),
  /** The job description its Claude session runs with. */
  desk: text().notNull(),
  /** A generated look. Null keeps the hand-drawn art named by sprite and variant. */
  look: jsonb().$type<LookSpec>(),
  /** The drawn portrait for a generated look, as .px text. */
  portraitPx: text(),
  /** Set for an Odd installed from a New Altitude persona: which, its version, its disclosure, and why it is quiet. */
  package: jsonb().$type<PersonaLink>(),
  hiredAt: created('hired_at'),
  /**
   * Set when the Odd left the office (`removeOdd`): it is off the floor and
   * runs nothing, and its history stays. Bringing it back clears it.
   */
  leftAt: at('left_at'),
  /** The jobs that were on when it left, which bringing it back turns on again. */
  jobsOff: integer().array()
});

/**
 * The instruction skills the owner attached to a local Odd, one SKILL.md each,
 * by name. A run's prompt lists each name and description, and the Odd reads
 * the text with read_skill. A skill is text only: it grants no tool, folder or
 * permission.
 */
export const staffSkills = pgTable(
  'staff_skills',
  {
    staffId: text()
      .notNull()
      .references(() => staff.id),
    name: text().notNull(),
    /** When to use it, in one line: the file's own, or the owner's. */
    description: text().notNull(),
    /** The whole SKILL.md as the owner reviewed it. */
    text: text().notNull(),
    createdAt: created(),
    updatedAt: at('updated_at').notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.staffId, t.name] })]
);

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
