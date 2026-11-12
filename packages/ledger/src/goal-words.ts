// Goals in plain words, for the page and the staff alike. Safe to import in the
// browser.
import type { GoalHealth, GoalHorizon, GoalStatus } from './schema.ts';

/** The areas a goal starts in. The owner can name others. */
export const GOAL_AREAS = ['work', 'family', 'health', 'money', 'learning', 'fun'];

export const HORIZONS: { id: GoalHorizon; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
  { id: 'date', label: 'By a date' },
  { id: 'ongoing', label: 'Ongoing' }
];

/** Whether a goal is still worked on: its threads, its Odds' goals and the Goals window's live list. */
export const GOAL_IS_LIVE: Record<GoalStatus, boolean> = {
  active: true,
  paused: true,
  met: false,
  dropped: false
};

export const STATUS_WORDS: Record<GoalStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  met: 'Met',
  dropped: 'Dropped'
};

export const HEALTH_WORDS: Record<GoalHealth, string> = {
  on_track: 'On track',
  slipping: 'Slipping',
  blocked: 'Blocked'
};

/** "This quarter", or "By Nov 30" for a date. */
export function goalWhen(g: { horizon: GoalHorizon; due?: string | null }): string {
  if (g.horizon === 'date' && g.due) {
    const d = new Date(`${g.due}T12:00:00Z`);
    return `By ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  }
  return HORIZONS.find((h) => h.id === g.horizon)?.label ?? 'Ongoing';
}
