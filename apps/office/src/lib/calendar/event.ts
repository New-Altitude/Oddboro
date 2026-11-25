// What the calendar tools and the Desk's event card both say about an
// event: Google's names for its colours, reminders in words, and Drive links.

/**
 * Google's names for its event colours, by `colorId`. `colors.get` gives
 * only the values, so the names come from Google Calendar's own editor.
 */
export const COLOUR_NAMES: Record<string, string> = {
  '1': 'Lavender',
  '2': 'Sage',
  '3': 'Grape',
  '4': 'Flamingo',
  '5': 'Banana',
  '6': 'Tangerine',
  '7': 'Peacock',
  '8': 'Graphite',
  '9': 'Blueberry',
  '10': 'Basil',
  '11': 'Tomato'
};

export type Reminder = { method: 'popup' | 'email'; minutes: number };
export const REMINDER_UNITS = [
  { unit: 'weeks', minutes: 10080 },
  { unit: 'days', minutes: 1440 },
  { unit: 'hours', minutes: 60 },
  { unit: 'minutes', minutes: 1 }
] as const;
export type ReminderUnit = (typeof REMINDER_UNITS)[number]['unit'];

/** Minutes as the largest whole unit: 1440 is 1 day. */
export function inUnits(minutes: number): { n: number; unit: ReminderUnit } {
  const u = REMINDER_UNITS.find((x) => minutes > 0 && minutes % x.minutes === 0) ?? {
    unit: 'minutes' as const,
    minutes: 1
  };
  return { n: minutes / u.minutes, unit: u.unit };
}

/** "10 minutes before", "1 day before, by email". */
export function reminderWords(r: { method: string; minutes: number }): string {
  const { n, unit } = inUnits(r.minutes);
  const when =
    r.minutes === 0 ? 'At the start' : `${n} ${n === 1 ? unit.slice(0, -1) : unit} before`;
  return r.method === 'email' ? `${when}, by email` : when;
}

/** A Drive file's id, from a Drive or Docs link, or the id itself. */
export function driveFileId(link: string): string | undefined {
  const v = link.trim();
  if (/^[\w-]{20,}$/.test(v)) return v;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return undefined;
  }
  if (!/^(drive|docs)\.google\.com$/.test(url.hostname)) return undefined;
  return /\/d\/([\w-]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id') ?? undefined;
}

/** The link Google Calendar keeps for a Drive file, as the Drive API's alternateLink gives it. */
export const driveLink = (fileId: string) =>
  `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`;

/** Addresses typed or pasted into the guest box: commas, spaces, semicolons and new lines split them. */
export function addressesIn(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((x) => x.replace(/^.*<(.+)>$/, '$1').replace(/^mailto:/i, ''))
    .filter(Boolean);
}

/** A plausible email address: what Google takes as a guest. */
export const isAddress = (s: string) => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(s);
