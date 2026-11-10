// The office's own tools, in plain words. Every staffer has the ones marked
// `always`: they are how it asks the owner for things and sees what it holds.
// The owner grants the rest one staffer at a time, from the Settings tab. Safe to
// import in the browser.
import type { AskKind, Step } from './schema.ts';

export type OfficeTool = {
  id: string;
  name: string;
  /** What it lets a staffer do, for the owner. */
  does: string;
  always?: boolean;
};

export const OFFICE_TOOLS: readonly OfficeTool[] = [
  { id: 'raise_ask', name: 'Ask you', does: 'Puts an ask on your desk.', always: true },
  { id: 'my_asks', name: 'Its asks', does: 'Sees how you decided its asks.', always: true },
  { id: 'my_access', name: 'Its access', does: 'Sees the tools you gave it.', always: true },
  {
    id: 'reconnect_access',
    name: 'Reconnect its tools',
    does: 'Gives you the steps to connect a tool again, one you already gave it, when its key or sign-in stops working.',
    always: true
  },
  {
    id: 'ask_for_folder',
    name: 'Ask for folders',
    does: 'Asks you for a folder on this computer, to read or to change. You give it with one click, or a narrower one.',
    always: true
  },
  {
    id: 'ask_for_switch',
    name: 'Ask for switches',
    does: 'Asks you to turn on Run commands or Browse the web for it. You turn it on with one click.',
    always: true
  },
  { id: 'my_jobs', name: 'Its jobs', does: 'Sees its own jobs and schedules.', always: true },
  {
    id: 'keep_lesson',
    name: 'Keep lessons',
    does: 'Remembers a correction you give it, so you never give it twice. You see each one in its chat, with Undo.',
    always: true
  },
  {
    id: 'used_lesson',
    name: 'Use lessons',
    does: 'Tells the office when a lesson changed its work, so you see which ones it uses.',
    always: true
  },
  {
    id: 'my_goals',
    name: 'Its goals',
    does: 'Sees the goals it serves, and how they are going. Never the others.',
    always: true
  },
  {
    id: 'log_progress',
    name: 'Log progress',
    does: 'Says how a goal it serves is going, with one line of evidence.',
    always: true
  },
  {
    id: 'tell_lead',
    name: 'Tell the lead',
    does: 'Passes what you tell it in chat about work another Odd leads to that Odd, in your words.',
    always: true
  },
  {
    id: 'search_ledger',
    name: 'Search the ledger',
    does: 'Reads every decision you made and all work done, by anyone.'
  },
  {
    id: 'give_owner_a_task',
    name: 'Give you tasks',
    does: 'Puts numbered steps on your desk for things only you can do.'
  },
  {
    id: 'find_connectors',
    name: 'Find tools',
    does: 'Searches the office catalog and the public MCP Registry.'
  },
  {
    id: 'ask_for_access',
    name: 'Ask for tools',
    does: 'Asks you to connect an outside tool for it.'
  },
  {
    id: 'edit_my_job',
    name: 'Edit its jobs',
    does: 'Changes its own jobs, when you ask in chat or approve an ask.'
  },
  {
    id: 'edit_my_description',
    name: 'Edit its job description',
    does: 'Rewrites its own job description, when you ask in chat or approve an ask.'
  },
  {
    id: 'hand_off',
    name: 'Hand off work',
    does: 'Gives a colleague a piece of work. The colleague starts at once, and the result comes back to it to pick each next step, or a time to pick the work back up. It says up front how many steps it expects. Needing more than it expected, or expecting a lot, asks you first.'
  },
  {
    id: 'poke_owner',
    name: 'Poke you',
    does: 'Sends you a chat message later, once: a check-in or a nudge.'
  },
  {
    id: 'propose_reply',
    name: 'Propose replies',
    does: 'Brings you one email reply at a time to edit, then send or save to Gmail drafts. Only with Gmail, and nothing goes until you click.',
    // Every Odd's, offered only while it holds Gmail (mcp.ts): a hire proposal's
    // list of tools once left it out, and its replies went into a file instead.
    always: true
  },
  {
    id: 'propose_filter',
    name: 'Propose filters',
    does: 'Brings you one Gmail filter at a time to change, then create. Only with Gmail, and nothing changes until you click.',
    // Every Odd's, offered only while it holds Gmail, as propose_reply is.
    always: true
  },
  {
    id: 'propose_hire',
    name: 'Propose hires',
    does: 'Brings you a hire, ready to open in the hire window.'
  },
  {
    id: 'office_report',
    name: 'Office report',
    does: 'Sees what every Odd did: jobs, runs, asks and tasks.'
  },
  {
    id: 'list_goals',
    name: 'All goals',
    does: 'Sees every goal, who serves it and how it is going.'
  },
  {
    id: 'propose_goal',
    name: 'Propose goals',
    does: 'Offers a goal it heard from you, for your yes. Never sets one alone.'
  },
  {
    id: 'propose_goal_plan',
    name: 'Plan goals',
    does: 'Brings you one plan per goal: who to hire and what Odds already here take on.'
  },
  {
    id: 'update_goal',
    name: 'Update goals',
    does: 'Marks a goal met or paused, or rewords it, when you ask in chat or approve an ask.'
  }
];

/** What a new hire starts with. The owner adds or removes from there. */
export const STARTER_TOOLS = [
  'search_ledger',
  'give_owner_a_task',
  'find_connectors',
  'ask_for_access',
  'edit_my_job',
  'edit_my_description',
  'hand_off',
  'poke_owner'
];

const GRANTABLE = new Set(OFFICE_TOOLS.filter((t) => !t.always).map((t) => t.id));
export const isGrantable = (id: string) => GRANTABLE.has(id);

/** Whether a staffer holding `granted` may use the office tool `id`. */
export const hasTool = (granted: readonly string[], id: string) =>
  OFFICE_TOOLS.some((t) => t.id === id && (t.always || granted.includes(id)));

/** A task step the owner ticks by hand: one with no control, or a sign-in. */
export const tickable = (s: Step) => !s.action || s.action.kind === 'oauth';

/**
 * Asks the office raises itself, not an Odd: the owner answers yes or no, and
 * nobody could rework one sent back, so they take no Iterate.
 */
export const yesOrNo = (kind: AskKind | undefined): boolean =>
  kind === 'hand_offs' || kind === 'window';
