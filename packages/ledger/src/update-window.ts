// When a new version of the app installs: only when the owner says. Install
// now installs it now; Install tonight installs it at the start of the next
// window, which the owner picks in office time, 02:00 to 04:00 unless they
// change it. From 15 minutes before then the office holds the Odds: the job
// clock and follow-ups start nothing new. The app installs once that time has come and no run is
// active, or 20 minutes after it whatever is still running. No database here,
// so the page and the tests can import it.
import { instant, wallClock } from './time.ts';

export const DEFAULT_WINDOW = { start: '02:00', end: '04:00' } as const;
/** How long before the install the Odds stop starting new work. */
export const HOLD_MS = 15 * 60_000;
/** How long past the install time a run may hold the update back. */
export const OVERRUN_MS = 20 * 60_000;
/** How late a poke may land and still be worth saying. Later than this it is missed. */
export const POKE_GRACE_MS = 15 * 60_000;

/** True for "HH:MM" on a 24-hour clock. */
export function isClock(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** True when `now` falls inside the window, in office time. A window may run past midnight. */
export function inWindow(now: Date, start: string, end: string): boolean {
  const w = wallClock(now);
  const m = w.h * 60 + w.min;
  const s = minutes(start);
  const e = minutes(end);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

/** When a ready update installs: now inside the window, else the window's next start. */
export function nextWindowStart(now: Date, start: string, end: string): Date {
  if (inWindow(now, start, end)) return now;
  const [h, min] = start.split(':').map(Number);
  const today = wallClock(now);
  for (let i = 0; i < 3; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i, 12));
    const t = instant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, min);
    if (t > now) return t;
  }
  throw new Error(`No window start after ${now.toISOString()}`);
}

/** True from 15 minutes before the install until the app goes down for it. */
export function holding(installAt: Date | null | undefined, now: Date): boolean {
  return !!installAt && now.getTime() >= installAt.getTime() - HOLD_MS;
}

/** True when the app should install now: the time has come and nothing runs, or it ran 20 minutes over. */
export function timeToInstall(
  installAt: Date | null | undefined,
  now: Date,
  active: boolean
): boolean {
  if (!installAt || now < installAt) return false;
  return !active || now.getTime() >= installAt.getTime() + OVERRUN_MS;
}

/**
 * True when a poke due at `at` is more than 15 minutes late at `now`. Time the
 * app spent down for an update does not count against it, so a poke that came
 * due while it installed still lands after the restart.
 */
export function pokeMissed(
  at: Date,
  now: Date,
  down?: { from: Date | null; to: Date | null }
): boolean {
  let late = now.getTime() - at.getTime();
  if (down?.from) {
    const to = Math.min(now.getTime(), (down.to ?? now).getTime());
    late -= Math.max(0, to - Math.max(at.getTime(), down.from.getTime()));
  }
  return late > POKE_GRACE_MS;
}

/** True when version `a` is newer than `b`. Both are x.y.z. */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}
