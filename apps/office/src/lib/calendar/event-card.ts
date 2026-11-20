// The Desk's event card as data: the form it starts from (the Odd's call on
// top of the event as Google had it), the owner's version it sends back
// (only what the Odd set or the owner changed), and who Google will email.
// EventReview.svelte draws it; this file holds every rule, so tests can
// check them without a page.
import type { CalendarEvent, HeldCalendar, HeldEvent } from '@oddboro/ledger';
import { driveFileId, driveLink, type Reminder } from './event.ts';
import { instantOf, naive, fromNaive, wallIn } from './zones.ts';

export type Guest = {
  email: string;
  name?: string;
  optional: boolean;
  /** On the event before this change. */
  existing: boolean;
  response?: string;
};
export type Attachment = { fileUrl: string; title?: string; mimeType?: string };
export type Scope = 'this' | 'following' | 'all';

export type Form = {
  summary: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  /** The last day: for an all-day event, the day before Google's own end date. */
  endDate: string;
  endTime: string;
  zone: string;
  endZone: string;
  recurrence: string[];
  location: string;
  description: string;
  meet: boolean;
  remindersDefault: boolean;
  reminders: Reminder[];
  showAs: 'busy' | 'free';
  visibility: 'default' | 'public' | 'private';
  colorId: string;
  guests: Guest[];
  removed: Guest[];
  canModify: boolean;
  canInvite: boolean;
  canSee: boolean;
  calendarId: string;
  attachments: Attachment[];
  scope?: Scope;
};

/** The held call as the card reads it. */
export type Held = { tool: string; arguments: Record<string, unknown>; event: HeldEvent };

const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const lines = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
const lower = (s: string) => s.toLowerCase();
const dayAfter = (date: string, n = 1) => fromNaive(naive(date) + n * 86_400_000).slice(0, 10);

/** Guests as a call gives them: an address, or { email, optional }. */
function guestsIn(v: unknown): { email: string; optional: boolean }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((g) =>
    typeof g === 'string'
      ? [{ email: g, optional: false }]
      : g && typeof g === 'object' && typeof (g as { email?: unknown }).email === 'string'
        ? [
            {
              email: (g as { email: string }).email,
              optional: !!(g as { optional?: unknown }).optional
            }
          ]
        : []
  );
}

/** The calendar a call names, as the list has it: "primary" is the account's primary calendar. */
export function calendarOf(id: string, calendars: HeldCalendar[] | undefined) {
  return (
    calendars?.find((c) => c.id === id) ??
    (id === 'primary' ? calendars?.find((c) => c.primary) : undefined)
  );
}

/** The zone to show a time in when the call and the event give none. */
const here = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** One end of the event as the form holds it. */
function endOf(v: string | undefined, zone: string) {
  if (!v) return { date: '', time: '' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: v, time: '' };
  const wall = wallIn({ dateTime: v }, zone);
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) };
}

/** The form the card starts from: the Odd's call over the event as Google had it. */
export function startOf(held: Held): Form {
  const a = held.arguments;
  const ev = held.event;
  const before: Partial<CalendarEvent> = ev.before ?? {};
  const isNew = held.tool === 'create_event';
  const calendarId = text(a.calendar_id) ?? 'primary';
  const cal = calendarOf(calendarId, ev.calendars);

  // When: the call's times, else the event's.
  const allDay = bool(a.all_day) ?? (a.start_time === undefined ? !!before.start?.date : false);
  const zone = text(a.time_zone) ?? before.start?.timeZone ?? cal?.timeZone ?? here();
  const endZone = text(a.end_time_zone) ?? text(a.time_zone) ?? before.end?.timeZone ?? zone;
  let s = endOf(text(a.start_time), zone);
  let e = endOf(text(a.end_time), endZone);
  if (a.start_time === undefined && before.start) {
    s = endOf(before.start.date ?? before.start.dateTime, zone);
    e = endOf(before.end?.date ?? before.end?.dateTime, endZone);
  }
  // An all-day end is the day after the last day; the form holds the last day.
  if (allDay && e.date) e = { ...e, date: dayAfter(e.date, -1) };
  if (e.date && s.date && e.date < s.date) e = { ...e, date: s.date };

  const attendees = before.attendees ?? [];
  const own = ev.account ? lower(ev.account) : undefined;
  const isGuest = (g: { email: string; self?: boolean; resource?: boolean }) =>
    !g.self && !g.resource && lower(g.email) !== own;
  const marked = (k: string) => new Set((lines(a[k]) ?? []).map(lower));
  const optional = marked('marked_optional');
  const required = marked('marked_required');
  const gone = marked('removed_attendee_emails');
  const existing: Guest[] = isNew
    ? []
    : attendees.filter(isGuest).map((g) => ({
        email: g.email,
        name: g.displayName,
        optional: optional.has(lower(g.email))
          ? true
          : required.has(lower(g.email))
            ? false
            : !!g.optional,
        existing: true,
        response: g.responseStatus
      }));
  const added: Guest[] = guestsIn(isNew ? a.attendees : a.added_attendees)
    .filter((g) => isGuest(g) && !existing.some((x) => lower(x.email) === lower(g.email)))
    .map((g) => ({ ...g, existing: false }));

  const reminders = (a.reminders ?? undefined) as
    { use_default?: boolean; overrides?: Reminder[] } | undefined;
  const series = ev.series?.recurrence ?? before.recurrence;
  const attachments = Array.isArray(a.attachments)
    ? (
        a.attachments as {
          file_url?: string;
          file_id?: string;
          title?: string;
          mime_type?: string;
        }[]
      )
        .map((f) => ({
          fileUrl: f.file_url ?? (f.file_id ? driveLink(f.file_id) : ''),
          title: f.title,
          mimeType: f.mime_type
        }))
        .filter((f) => f.fileUrl)
    : (before.attachments ?? []).map((f) => ({
        fileUrl: f.fileUrl,
        title: f.title,
        mimeType: f.mimeType
      }));

  return {
    summary: text(a.summary) ?? before.summary ?? '',
    allDay,
    startDate: s.date,
    startTime: s.time || '09:00',
    endDate: e.date,
    endTime: e.time || '10:00',
    zone,
    endZone,
    recurrence: lines(a.recurrence) ?? series ?? [],
    location: text(a.location) ?? before.location ?? '',
    description: text(a.description) ?? before.description ?? '',
    meet: bool(a.google_meet) ?? !!before.conference?.meet,
    remindersDefault: reminders
      ? reminders.use_default !== false
      : before.reminders?.useDefault !== false,
    reminders: (reminders && !reminders.use_default
      ? (reminders.overrides ?? [])
      : before.reminders?.useDefault === false
        ? (before.reminders.overrides ?? [])
        : (cal?.reminders ?? [])
    ).map((r) => ({ method: r.method === 'email' ? 'email' : 'popup', minutes: r.minutes })),
    showAs:
      (text(a.show_as) as Form['showAs']) ??
      (before.transparency === 'transparent' ? 'free' : 'busy'),
    visibility:
      (text(a.visibility) as Form['visibility']) ??
      ((before.visibility === 'public' || before.visibility === 'private'
        ? before.visibility
        : 'default') as Form['visibility']),
    colorId: text(a.color_id) ?? before.colorId ?? 'calendar',
    guests: [...existing.filter((g) => !gone.has(lower(g.email))), ...added],
    removed: existing.filter((g) => gone.has(lower(g.email))),
    canModify: bool(a.guests_can_modify) ?? before.guestsCanModify ?? false,
    canInvite: bool(a.guests_can_invite_others) ?? before.guestsCanInviteOthers ?? true,
    canSee: bool(a.guests_can_see_other_guests) ?? before.guestsCanSeeOtherGuests ?? true,
    calendarId: text(a.move_to_calendar_id) ?? calendarId,
    attachments,
    scope: before.recurringEventId ? ((text(a.scope) as Scope) ?? 'this') : undefined
  };
}

/** The times as the call takes them, or why the form's times cannot go. */
export function timesOf(f: Form):
  | {
      start_time: string;
      end_time: string;
      all_day?: true;
      time_zone?: string;
      end_time_zone?: string;
    }
  | { problem: string } {
  if (!f.startDate || !f.endDate) return { problem: 'Pick a start and an end.' };
  if (f.allDay) {
    if (f.endDate < f.startDate) return { problem: 'The last day is before the first.' };
    return { start_time: f.startDate, end_time: dayAfter(f.endDate), all_day: true };
  }
  const start = `${f.startDate}T${f.startTime}:00`;
  const end = `${f.endDate}T${f.endTime}:00`;
  if (instantOf(end, f.endZone).getTime() <= instantOf(start, f.zone).getTime())
    return { problem: 'The end is not after the start.' };
  return {
    start_time: start,
    end_time: end,
    time_zone: f.zone,
    ...(f.endZone !== f.zone ? { end_time_zone: f.endZone } : {})
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const guestArg = (g: Guest) => (g.optional ? { email: g.email, optional: true } : g.email);

/**
 * The owner's version for the office: each field the Odd set or the owner
 * changed, and nothing else, so a change sends only what changes.
 */
export function versionOf(held: Held, f: Form, first: Form): Record<string, unknown> {
  const a = held.arguments;
  const isNew = held.tool === 'create_event';
  const out: Record<string, unknown> = {};
  /** A field goes when the Odd set it, the owner changed it, or it is a new event's. */
  const put = (key: string, now: unknown, was: unknown, value: unknown = now) => {
    if (key in a || isNew || !same(now, was)) out[key] = value;
  };
  put('summary', f.summary.trim(), first.summary.trim());
  const t = timesOf(f);
  const moved =
    f.allDay !== first.allDay ||
    f.startDate !== first.startDate ||
    f.endDate !== first.endDate ||
    (!f.allDay &&
      (f.startTime !== first.startTime ||
        f.endTime !== first.endTime ||
        f.zone !== first.zone ||
        f.endZone !== first.endZone));
  if ('start_time' in t && (isNew || 'start_time' in a || moved)) Object.assign(out, t);
  put('location', f.location.trim(), first.location.trim());
  put('description', f.description, first.description);
  // A new event that does not repeat says nothing of it.
  if (
    ('recurrence' in a || !same(f.recurrence, first.recurrence)) &&
    !(isNew && !f.recurrence.length)
  )
    out.recurrence = f.recurrence;
  const reminders = f.remindersDefault
    ? { use_default: true }
    : { use_default: false, overrides: f.reminders };
  const firstReminders = first.remindersDefault
    ? { use_default: true }
    : { use_default: false, overrides: first.reminders };
  if ('reminders' in a || !same(reminders, firstReminders)) out.reminders = reminders;
  if ('google_meet' in a || f.meet !== first.meet) out.google_meet = f.meet;
  if ('show_as' in a || f.showAs !== first.showAs) out.show_as = f.showAs;
  if ('visibility' in a || f.visibility !== first.visibility) out.visibility = f.visibility;
  if ('color_id' in a || f.colorId !== first.colorId) out.color_id = f.colorId;
  if ('guests_can_modify' in a || f.canModify !== first.canModify)
    out.guests_can_modify = f.canModify;
  if ('guests_can_invite_others' in a || f.canInvite !== first.canInvite)
    out.guests_can_invite_others = f.canInvite;
  if ('guests_can_see_other_guests' in a || f.canSee !== first.canSee)
    out.guests_can_see_other_guests = f.canSee;
  if ('attachments' in a || !same(f.attachments, first.attachments))
    out.attachments = f.attachments.map((x) => ({
      file_url: x.fileUrl,
      ...(x.title ? { title: x.title } : {}),
      ...(x.mimeType ? { mime_type: x.mimeType } : {})
    }));

  if (isNew) {
    out.attendees = f.guests.map(guestArg);
    out.calendar_id = f.calendarId;
    return out;
  }
  if (f.scope) out.scope = f.scope;
  const added = f.guests.filter((g) => !g.existing);
  const kept = f.guests.filter((g) => g.existing);
  const removed = f.removed.filter((g) => g.existing);
  if ('added_attendees' in a || added.length) out.added_attendees = added.map(guestArg);
  if ('removed_attendee_emails' in a || removed.length)
    out.removed_attendee_emails = removed.map((g) => g.email);
  // Marks go against Google's own list, so an Odd's mark the owner keeps still goes.
  const optionalNow = new Set(
    (held.event.before?.attendees ?? []).filter((g) => g.optional).map((g) => lower(g.email))
  );
  const marks = (want: boolean) =>
    kept
      .filter((g) => g.optional === want && optionalNow.has(lower(g.email)) !== want)
      .map((g) => g.email);
  if ('marked_optional' in a || marks(true).length) out.marked_optional = marks(true);
  if ('marked_required' in a || marks(false).length) out.marked_required = marks(false);
  const from = text(a.calendar_id) ?? 'primary';
  if (
    f.calendarId !== from &&
    calendarOf(f.calendarId, held.event.calendars)?.id !==
      calendarOf(from, held.event.calendars)?.id
  )
    out.move_to_calendar_id = f.calendarId;
  else if ('move_to_calendar_id' in a) out.move_to_calendar_id = from;
  return out;
}

/** Only the owner sees these, so a change to them alone emails nobody (as the tool decides). */
const PERSONAL = new Set(['reminders', 'color_id', 'scope']);

/** What the owner's click does, in words for the consequence box. */
export type Consequence = {
  /** Who Google emails: anyone at all, and the click is what sends it. */
  emails: boolean;
  lines: string[];
};

/** A guest by name if Google has one, else their address. */
export const nameOf = (g: Guest) => g.name || g.email;
const list = (gs: Guest[]) => {
  const names = gs.map(nameOf);
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};

export function consequence(held: Held, version: Record<string, unknown>, f: Form): Consequence {
  const isNew = held.tool === 'create_event';
  const out: string[] = [];
  if (f.scope === 'this') out.push('Changes only this event in the series.');
  if (f.scope === 'following') out.push('Changes this and every following event.');
  if (f.scope === 'all' || (!isNew && !f.scope && held.event.before?.recurrence?.length))
    out.push('Changes every event in the series.');
  const personal = !isNew && Object.keys(version).every((k) => PERSONAL.has(k));
  if (isNew) {
    if (f.guests.length) out.push(`Google will email an invite to ${list(f.guests)}.`);
    else out.push('Nobody else gets an email. It goes on your calendar only.');
    return { emails: f.guests.length > 0, lines: out };
  }
  if (personal) {
    out.push('Nobody else gets an email: only you see reminders and the colour.');
    return { emails: false, lines: out };
  }
  const added = f.guests.filter((g) => !g.existing);
  const told = f.guests.filter((g) => g.existing);
  const removed = f.removed.filter((g) => g.existing);
  if (added.length) out.push(`Google will email an invite to ${list(added)}.`);
  if (told.length) out.push(`Google will email the change to ${list(told)}.`);
  if (removed.length) out.push(`Removing ${list(removed)}: Google emails a cancellation.`);
  if (!added.length && !told.length && !removed.length) out.push('Nobody else gets an email.');
  return { emails: added.length + told.length + removed.length > 0, lines: out };
}

/** A Drive link the owner pasted, as an attachment, or undefined when it is not one. */
export function attachmentOf(link: string): Attachment | undefined {
  const id = driveFileId(link);
  if (!id) return undefined;
  return { fileUrl: /^https?:/.test(link.trim()) ? link.trim() : driveLink(id) };
}
