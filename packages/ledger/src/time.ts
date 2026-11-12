// The office keeps one time zone: the owner's, which setup writes to .env as
// OFFICE_TIME_ZONE. A job's schedule is written in it, and this file turns a
// schedule into the next real instant it should run. The page gets the zone
// from the server and calls setZone before it shows a time.
import type { MissedRuns, Schedule, Weekday } from './schema.ts';

export const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * How often and when a job may run. The owner's limits and an Odd's differ on
 * purpose: the owner sets a job's schedule on the page, and an Odd sets
 * its own (`edit_my_job`). An Odd's minimum is higher than the owner's and
 * it has no maximum; its time takes any two digits each side, while the
 * owner's must be on the clock.
 */
export const SCHEDULE_RULE = {
  ownerMinMinutes: 5,
  ownerMaxMinutes: 1440,
  ownerAt: /^([01]\d|2[0-3]):[0-5]\d$/,
  oddMinMinutes: 15,
  oddAt: /^\d\d:\d\d$/
} as const;
/** What a job does with runs it missed while the office was off (`jobs.missed`), as the owner reads it. */
export const MISSED_WORDS: Record<MissedRuns, string> = {
  latest: 'Only the latest run matters',
  record: 'Fill every missed period'
};
const DAY_NAMES: Record<Weekday, string> = {
  Mon: 'Mondays',
  Tue: 'Tuesdays',
  Wed: 'Wednesdays',
  Thu: 'Thursdays',
  Fri: 'Fridays',
  Sat: 'Saturdays',
  Sun: 'Sundays'
};

let chosen: string | undefined;

/** The office's time zone, like "America/New_York". Until one is set, this Mac's own. */
export function zone(): string {
  return (
    chosen ??
    (typeof process === 'undefined' ? undefined : process.env?.OFFICE_TIME_ZONE) ??
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}

export function setZone(z: string): void {
  chosen = z;
}

/** True when the browser knows the zone, so setup can refuse a typo. */
export function isZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

/** "Pacific Time", or the zone's own name where it has no common one. */
export function zoneName(z = zone()): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'longGeneric' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value;
  return name ?? z;
}

/** "PT", "ET", or the shortest name the zone has. */
export function zoneShort(z = zone()): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortGeneric' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value;
  return name ?? z;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function format(z: string): Intl.DateTimeFormat {
  let f = formats.get(z);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: z,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short'
    });
    formats.set(z, f);
  }
  return f;
}

/** The office's wall clock at an instant. */
export function wallClock(t: Date) {
  const p = Object.fromEntries(
    format(zone())
      .formatToParts(t)
      .map((x) => [x.type, x.value])
  );
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    min: Number(p.minute),
    weekday: p.weekday as string
  };
}

/** "2026-11-03": the office's calendar day at an instant, not the UTC one. */
export function officeDay(t: Date): string {
  return t.toLocaleDateString('en-CA', { timeZone: zone() });
}

/** The instant an office wall-clock time names. */
export function instant(y: number, m: number, d: number, h: number, min: number): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const offset = (t: number) => {
    const p = wallClock(new Date(t));
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - t;
  };
  return new Date(guess - offset(guess - offset(guess)));
}

/** The first time after `from` that the schedule says to run. */
export function nextRun(s: Schedule, from: Date): Date {
  if (s.every === 'minutes')
    return new Date(from.getTime() + Math.max(SCHEDULE_RULE.ownerMinMinutes, s.n) * 60_000);
  const [h, min] = s.at.split(':').map(Number);
  const today = wallClock(from);
  for (let i = 0; i < 8; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i, 12));
    const t = instant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, min);
    if (t <= from) continue;
    const wd = wallClock(t).weekday;
    if (s.every === 'weekday' && (wd === 'Sat' || wd === 'Sun')) continue;
    if (s.every === 'week' && wd !== s.day) continue;
    return t;
  }
  throw new Error(`No next run for ${JSON.stringify(s)}`);
}

/**
 * Every time the schedule says to run from `first` up to `now`, oldest first:
 * `first` (a job's next run), then each `nextRun` after it. Stepping through
 * `nextRun` itself means any schedule it knows lists right.
 */
export function runsBetween(s: Schedule, first: Date, now: Date): Date[] {
  const times: Date[] = [];
  for (let t = first; t <= now; t = nextRun(s, t)) times.push(t);
  return times;
}

/** How long one period of the schedule is at a run time: from it to the run after it. */
export const periodAt = (s: Schedule, t: Date): number => nextRun(s, t).getTime() - t.getTime();

/** "Wed, Nov 11, 2026, 9:00 AM EST": a run's time in a brief, in the office's zone. */
export function runTime(t: Date): string {
  return t.toLocaleString('en-US', {
    timeZone: zone(),
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

/** "Every 30 minutes", "Daily at 7:00 AM", "Weekdays at 9:30 AM", "Fridays at 4:00 PM". */
export function describe(s: Schedule): string {
  if (s.every === 'minutes')
    return s.n % 60 === 0 && s.n >= 60
      ? `Every ${s.n / 60 === 1 ? 'hour' : `${s.n / 60} hours`}`
      : `Every ${s.n} minutes`;
  const [h, min] = s.at.split(':').map(Number);
  const time = `${h % 12 || 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const days = s.every === 'day' ? 'Daily' : s.every === 'week' ? DAY_NAMES[s.day] : 'Weekdays';
  return `${days} at ${time}`;
}

/**
 * The instant a staffer means by "14:30" (today, office time) or
 * "2026-11-02 14:30" (that day), or undefined if it is neither.
 */
export function officeAt(text: string, now = new Date()): Date | undefined {
  const m = /^(?:(\d{4})-(\d\d)-(\d\d)[ T])?(\d\d?):(\d\d)$/.exec(text.trim());
  if (!m) return undefined;
  const today = wallClock(now);
  const [y, mo, d] = m[1] ? [+m[1], +m[2], +m[3]] : [today.y, today.m, today.d];
  if (+m[4] > 23 || +m[5] > 59) return undefined;
  return instant(y, mo, d, +m[4], +m[5]);
}

/** "8:00 AM", or "Mon 8:00 AM" when it is not today, in office time. */
export function clockTime(t: Date, now = new Date()): string {
  const p = wallClock(t);
  const n = wallClock(now);
  const time = `${p.h % 12 || 12}:${String(p.min).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`;
  return p.y === n.y && p.m === n.m && p.d === n.d ? time : `${p.weekday} ${time}`;
}
