// Wall clocks and time zones for calendar events, on the page and the
// server alike. A wall clock is a time as a person in that zone reads it,
// written "2026-11-20T10:00:00", with no offset. Google takes event times
// that way, beside their zone.

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** The wall clock of an instant in a zone, to the second. */
export function wallOf(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(at);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '00';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}

/** A wall clock read as if it were UTC, in ms: the way to add and compare wall clocks. */
export function naive(wall: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(wall);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

/** The wall clock `ms` from `naive` stands for. */
export const fromNaive = (ms: number): string => new Date(ms).toISOString().slice(0, 19);

/** A wall clock moved by some minutes, as a wall clock. */
export const addMinutes = (wall: string, minutes: number): string =>
  fromNaive(naive(wall) + minutes * 60_000);

/** The instant a wall clock in a zone names. A time a clock change skips moves on by the gap. */
export function instantOf(wall: string, tz: string): Date {
  const want = naive(wall);
  let at = want;
  for (let i = 0; i < 3; i++) {
    const off = naive(wallOf(new Date(at), tz)) - at;
    const next = want - off;
    if (next === at) break;
    at = next;
  }
  return new Date(at);
}

/** Whether a zone is one this system knows. */
export function knownZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A Google time (a date, or a dateTime with an offset) as a wall clock in `tz`. */
export function wallIn(t: { date?: string; dateTime?: string }, tz: string): string {
  if (t.date) return `${t.date}T00:00:00`;
  const v = t.dateTime ?? '';
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(v)) return v.length === 16 ? `${v}:00` : v.slice(0, 19);
  return wallOf(new Date(v), tz);
}

/** The zone's offset at that instant, like Google writes it: "GMT-08:00". */
export function offsetSaid(tz: string, at = new Date()): string {
  const mins = Math.round(
    (naive(wallOf(at, tz)) - Math.floor(at.getTime() / 1000) * 1000) / 60_000
  );
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  return `GMT${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** The zone's own name, without standard or daylight: "Pacific Time". */
export function zoneName(tz: string, at = new Date()): string {
  try {
    const n = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    return n && !/^GMT/.test(n) ? n : tz.replaceAll('_', ' ');
  } catch {
    return tz;
  }
}

/** A zone as a list shows it: "(GMT-08:00) Pacific Time - Los Angeles". */
export function zoneLabel(tz: string, at = new Date()): string {
  const city = tz.split('/').at(-1)?.replaceAll('_', ' ') ?? tz;
  const name = zoneName(tz, at);
  return `(${offsetSaid(tz, at)}) ${name}${name.includes(city) ? '' : ` - ${city}`}`;
}

/** UTC as RFC 5545 writes it: "20270401T065959Z". */
export const utcStamp = (at: Date): string =>
  at
    .toISOString()
    .replace(/\.\d{3}/, '')
    .replace(/[-:]/g, '');
