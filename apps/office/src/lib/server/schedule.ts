// Checks a schedule sent from the page.
import type { Schedule } from '@oddboro/ledger';
import { SCHEDULE_RULE, WEEKDAYS } from '@oddboro/ledger/time';

export function parseSchedule(v: unknown): Schedule | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (
    s.every === 'minutes' &&
    typeof s.n === 'number' &&
    s.n >= SCHEDULE_RULE.ownerMinMinutes &&
    s.n <= SCHEDULE_RULE.ownerMaxMinutes
  )
    return { every: 'minutes', n: Math.round(s.n) };
  if (typeof s.at !== 'string' || !SCHEDULE_RULE.ownerAt.test(s.at)) return null;
  if (s.every === 'day' || s.every === 'weekday') return { every: s.every, at: s.at };
  const day = WEEKDAYS.find((d) => d === s.day);
  if (s.every === 'week' && day) return { every: 'week', day, at: s.at };
  return null;
}
