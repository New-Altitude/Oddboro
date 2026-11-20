// A repeating event's rule, as Google keeps it (RFC 5545 lines: an RRULE,
// and any EXDATE or RDATE) and as a person reads it ("Weekly on Tue and Thu,
// until Mar 31, 2027"). Used by the calendar tools and by the Desk's event
// card, which offers Google's own presets and a custom rule.
import { instantOf, utcStamp, wallOf } from './zones.ts';

export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** A rule the card can show and edit. Every part is set, from the event's first day where the rule says nothing. */
export type Repeat = {
  freq: Freq;
  interval: number;
  /** Weekly: on these days. */
  days: Weekday[];
  /** Monthly: on a day of the month, or on the nth weekday (-1 is the last). */
  monthly: { by: 'day'; day: number } | { by: 'weekday'; nth: number; day: Weekday };
  ends: { by: 'never' } | { by: 'date'; date: string } | { by: 'count'; count: number };
};

const DAY_NAME: Record<Weekday, string> = {
  SU: 'Sunday',
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday'
};
const NTH = ['first', 'second', 'third', 'fourth', 'fifth'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

/** A date's parts, read as written: "2026-11-20". */
function ymd(date: string) {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return { y, m, d, weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Where a date falls in its month: the third Friday, and whether it is also the last. */
export function nthOf(date: string): { nth: number; last: boolean; day: Weekday } {
  const { y, m, d, weekday } = ymd(date);
  return { nth: Math.ceil(d / 7), last: d + 7 > daysIn(y, m), day: weekday };
}

/** The parts of an RRULE line, in order. */
export function ruleParts(line: string): [string, string][] {
  return line
    .replace(/^RRULE:/i, '')
    .split(';')
    .filter(Boolean)
    .map((p) => {
      const at = p.indexOf('=');
      return [p.slice(0, at).toUpperCase(), p.slice(at + 1)] as [string, string];
    });
}

/** An RRULE line with some parts set in place or taken out (undefined), new ones at the end. */
export function withParts(line: string, set: Record<string, string | undefined>): string {
  const parts = ruleParts(line)
    .filter(([k]) => !(k in set) || set[k] !== undefined)
    .map(([k, v]): [string, string] => [k, k in set ? set[k]! : v]);
  for (const [k, v] of Object.entries(set))
    if (v !== undefined && !parts.some(([p]) => p === k)) parts.push([k, v]);
  return `RRULE:${parts.map(([k, v]) => `${k}=${v}`).join(';')}`;
}

/** UNTIL as a date in the event's zone: Google writes it in UTC for a timed event. */
export function untilDate(until: string, zone: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(until);
  if (!m) return '';
  if (!m[4] || !m[7]) return `${m[1]}-${m[2]}-${m[3]}`;
  const at = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return wallOf(at, zone).slice(0, 10);
}

/** UNTIL for the end of `date` in the event's zone: a date for an all-day event, else UTC. */
export function untilOf(date: string, zone: string, allDay: boolean): string {
  if (allDay) return date.replace(/-/g, '');
  return utcStamp(instantOf(`${date}T23:59:59`, zone));
}

const RRULE_KNOWN = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'UNTIL', 'COUNT', 'WKST']);

/**
 * The rule in `lines` as the card edits it, from the event's first day
 * (`start`, a date) and zone. Undefined when there is no RRULE, or when it
 * uses a part the card does not edit (BYMONTH, BYSETPOS, more than one
 * RRULE): the card then shows it in words and keeps it as it is.
 */
export function parseRule(lines: string[] | undefined, start: string, zone: string) {
  const rules = (lines ?? []).filter((l) => /^RRULE:/i.test(l));
  if (rules.length !== 1) return undefined;
  const parts = new Map(ruleParts(rules[0]));
  if ([...parts.keys()].some((k) => !RRULE_KNOWN.has(k))) return undefined;
  const freq = parts.get('FREQ') as Freq;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return undefined;
  const interval = Number(parts.get('INTERVAL') ?? 1);
  if (!Number.isInteger(interval) || interval < 1) return undefined;
  const first = ymd(start);
  const byDay = parts.get('BYDAY')?.split(',') ?? [];
  const byMonthDay = parts.get('BYMONTHDAY');
  const r: Repeat = {
    freq,
    interval,
    days: [first.weekday],
    monthly: { by: 'day', day: first.d },
    ends: { by: 'never' }
  };
  if (freq === 'WEEKLY' && byDay.length) {
    if (!byDay.every((d) => (WEEKDAYS as readonly string[]).includes(d))) return undefined;
    r.days = WEEKDAYS.filter((d) => byDay.includes(d));
  } else if (freq === 'MONTHLY' && byDay.length) {
    const m = byDay.length === 1 ? /^([+-]?\d)(SU|MO|TU|WE|TH|FR|SA)$/.exec(byDay[0]) : null;
    if (!m || byMonthDay) return undefined;
    r.monthly = { by: 'weekday', nth: Number(m[1]), day: m[2] as Weekday };
  } else if (freq === 'MONTHLY' && byMonthDay) {
    const day = Number(byMonthDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;
    r.monthly = { by: 'day', day };
  } else if (byDay.length || byMonthDay) return undefined;
  const until = parts.get('UNTIL');
  const count = parts.get('COUNT');
  if (until) {
    const date = untilDate(until, zone);
    if (!date) return undefined;
    r.ends = { by: 'date', date };
  } else if (count) r.ends = { by: 'count', count: Math.max(1, Number(count)) };
  return r;
}

/** The RRULE line for a rule, the way Google's own editor writes it. */
export function ruleLine(r: Repeat, zone: string, allDay: boolean): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.ends.by === 'date') parts.push(`UNTIL=${untilOf(r.ends.date, zone, allDay)}`);
  if (r.ends.by === 'count') parts.push(`COUNT=${r.ends.count}`);
  if (r.freq === 'WEEKLY') parts.push(`BYDAY=${WEEKDAYS.filter((d) => r.days.includes(d))}`);
  if (r.freq === 'MONTHLY')
    parts.push(
      r.monthly.by === 'day'
        ? `BYMONTHDAY=${r.monthly.day}`
        : `BYDAY=${r.monthly.nth}${r.monthly.day}`
    );
  return `RRULE:${parts.join(';')}`;
}

const short = (d: Weekday) => DAY_NAME[d].slice(0, 3);
/** "Tue", "Tue and Thu", "Mon, Wed and Fri". */
export function andList(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
const dateSaid = (date: string, withYear = true) => {
  const { y, m, d } = ymd(date);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}${withYear ? `, ${y}` : ''}`;
};
const nthSaid = (nth: number) => (nth === -1 ? 'last' : (NTH[nth - 1] ?? `${nth}th`));

/** A rule in words: "Weekly on Tue and Thu, until Mar 31, 2027". */
export function repeatWords(r: Repeat, start: string): string {
  const first = ymd(start);
  const every = (one: string, many: string) =>
    r.interval === 1 ? one : `Every ${r.interval} ${many}`;
  let said: string;
  if (r.freq === 'DAILY') said = every('Daily', 'days');
  else if (r.freq === 'WEEKLY') {
    const weekdays = r.days.join() === 'MO,TU,WE,TH,FR';
    if (weekdays && r.interval === 1) said = 'Every weekday (Monday to Friday)';
    else {
      const on =
        r.days.length === 1
          ? DAY_NAME[r.days[0]]
          : weekdays
            ? 'weekdays'
            : andList(r.days.map(short));
      said = `${every('Weekly', 'weeks')} on ${on}`;
    }
  } else if (r.freq === 'MONTHLY')
    said = `${every('Monthly', 'months')} on ${
      r.monthly.by === 'day'
        ? `day ${r.monthly.day}`
        : `the ${nthSaid(r.monthly.nth)} ${DAY_NAME[r.monthly.day]}`
    }`;
  else said = `${every('Annually', 'years')} on ${MONTHS[first.m - 1]} ${first.d}`;
  if (r.ends.by === 'date') said += `, until ${dateSaid(r.ends.date)}`;
  if (r.ends.by === 'count') said += r.ends.count === 1 ? ', once' : `, ${r.ends.count} times`;
  return said;
}

/** Google's own choices for a repeat, from the event's first day, then Custom. */
export function presets(start: string): { key: string; label: string; repeat?: Repeat }[] {
  const f = ymd(start);
  const n = nthOf(start);
  const base = {
    interval: 1,
    days: [f.weekday] as Weekday[],
    monthly: { by: 'day', day: f.d } as Repeat['monthly'],
    ends: { by: 'never' } as Repeat['ends']
  };
  const out: { key: string; label: string; repeat?: Repeat }[] = [
    { key: 'none', label: 'Does not repeat' },
    { key: 'daily', label: '', repeat: { ...base, freq: 'DAILY' } },
    { key: 'weekly', label: '', repeat: { ...base, freq: 'WEEKLY' } }
  ];
  if (n.nth <= 4)
    out.push({
      key: 'monthly-nth',
      label: '',
      repeat: { ...base, freq: 'MONTHLY', monthly: { by: 'weekday', nth: n.nth, day: f.weekday } }
    });
  if (n.last)
    out.push({
      key: 'monthly-last',
      label: '',
      repeat: { ...base, freq: 'MONTHLY', monthly: { by: 'weekday', nth: -1, day: f.weekday } }
    });
  out.push(
    { key: 'monthly-day', label: '', repeat: { ...base, freq: 'MONTHLY' } },
    { key: 'yearly', label: '', repeat: { ...base, freq: 'YEARLY' } },
    {
      key: 'weekdays',
      label: '',
      repeat: { ...base, freq: 'WEEKLY', days: ['MO', 'TU', 'WE', 'TH', 'FR'] }
    }
  );
  for (const p of out) if (p.repeat) p.label = repeatWords(p.repeat, start);
  return out;
}

/** Whether two rules repeat the same way. */
export function sameRepeat(a: Repeat, b: Repeat): boolean {
  return ruleLine(a, 'UTC', true) === ruleLine(b, 'UTC', true);
}

/** The preset a rule is, or "custom". */
export function presetOf(r: Repeat | undefined, start: string): string {
  if (!r) return 'none';
  return presets(start).find((p) => p.repeat && sameRepeat(p.repeat, r))?.key ?? 'custom';
}

/** The dates of EXDATE or RDATE lines, as "2026-11-27" or "2026-11-27T10:00:00" (zone dropped). */
export function lineDates(line: string): string[] {
  const values = line.slice(line.indexOf(':') + 1);
  return values
    .split(',')
    .map((v) => /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(v.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => `${m[1]}-${m[2]}-${m[3]}${m[4] ? `T${m[4]}:${m[5]}:${m[6]}` : ''}`);
}

/**
 * Every rule line in words, for the summary and the tools: the RRULE as the
 * card says it, or "Repeats on a custom rule" when it uses parts the card
 * does not edit, with any skipped or added dates counted.
 */
export function ruleWords(lines: string[] | undefined, start: string, zone: string): string {
  if (!lines?.length) return 'Does not repeat';
  const r = parseRule(lines, start, zone);
  const skipped = lines.filter((l) => /^EXDATE/i.test(l)).flatMap(lineDates).length;
  const added = lines.filter((l) => /^RDATE/i.test(l)).flatMap(lineDates).length;
  let said = r ? repeatWords(r, start) : 'Repeats on a custom rule';
  if (skipped) said += `, except ${skipped === 1 ? '1 date' : `${skipped} dates`}`;
  if (added) said += `, plus ${added === 1 ? '1 more date' : `${added} more dates`}`;
  return said;
}

/**
 * The rule of a series that stops before an occurrence, the way Google's
 * editor ends one for "This and following events": UNTIL at the end of the
 * day before, in the event's zone, and no COUNT.
 */
export function endBefore(line: string, occurrenceDate: string, zone: string, allDay: boolean) {
  const { y, m, d } = ymd(occurrenceDate);
  const dayBefore = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  return withParts(line, { COUNT: undefined, UNTIL: untilOf(dayBefore, zone, allDay) });
}
