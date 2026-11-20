// How the calendar tools make and change an event: the inputs both tools
// take, the body Google gets, who Google would email, and the three ways to
// change a repeating event ("This event", "This and following events", "All
// events"), done the way Google Calendar's own editor does them. calendar.ts
// registers the tools; this file says what each call sends.
import { randomUUID } from 'node:crypto';
import type { CalendarEvent, GoogleTime } from '@oddboro/ledger';
import { z } from 'zod';
import { driveFileId, driveLink } from '#lib/calendar/event.ts';
import { endBefore, lineDates, ruleParts, withParts } from '#lib/calendar/rrule.ts';
import { fromNaive, instantOf, knownZone, naive, wallIn, wallOf } from '#lib/calendar/zones.ts';
import { google, id, send, type Token } from './http.ts';

export const API = 'https://www.googleapis.com/calendar/v3';
export const calendar = z
  .string()
  .min(1)
  .refine((v) => v !== '.' && v !== '..', 'Use a Google calendar ID.');
export const events = (calendarId: string) =>
  `${API}/calendars/${encodeURIComponent(calendarId)}/events`;

/** Every field the tools read of one event. */
export const EVENT_FIELDS =
  'id,etag,status,htmlLink,summary,description,location,start,end,recurrence,recurringEventId,originalStartTime,attendeesOmitted,organizer,attendees(email,displayName,optional,self,resource,organizer,responseStatus),reminders,conferenceData,hangoutLink,transparency,visibility,colorId,guestsCanModify,guestsCanInviteOthers,guestsCanSeeOtherGuests,attachments,eventType';

const email = z.email().max(320);
const zone = z
  .string()
  .refine(knownZone, 'Use an IANA time zone, like America/Los_Angeles.')
  .describe('An IANA time zone, like America/Los_Angeles. The times are in it.');
const moment = z.string().min(10).max(40);
const guest = z.union([
  email,
  z.object({
    email,
    optional: z.boolean().optional().describe('An optional guest. Google shows them as optional.')
  })
]);
const colour = z.enum(['calendar', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
const recurrenceLine = z
  .string()
  .max(2000)
  .regex(/^(RRULE|EXRULE|RDATE|EXDATE)[:;]/, 'Each line starts RRULE:, EXDATE or RDATE.');

/** What both tools take, beside who is on the event. */
const eventInput = {
  calendar_id: calendar
    .optional()
    .describe('The calendar, from list_calendars. Leave out for the primary calendar.'),
  summary: z.string().trim().min(1).max(1024).describe("The event's title."),
  start_time: moment.describe(
    'When it starts: 2026-11-20T10:00:00 with time_zone, or with its UTC offset, like 2026-11-20T10:00:00-08:00. For an all-day event, the first day: 2026-11-20.'
  ),
  end_time: moment.describe(
    'When it ends, after the start. For an all-day event, the day after the last day: 2026-11-21 for one day.'
  ),
  all_day: z.boolean().optional().describe('An all-day event: the times are dates.'),
  time_zone: zone.optional(),
  end_time_zone: zone
    .optional()
    .describe("The end's own time zone, when it differs from time_zone, as for a flight."),
  location: z.string().max(1024).optional(),
  description: z.string().max(8000).optional().describe('Plain text.'),
  recurrence: z
    .array(recurrenceLine)
    .max(20)
    .optional()
    .describe(
      "A repeating event, in Google's own lines: one RRULE, and any EXDATE or RDATE, like RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270401T065959Z. UNTIL is in UTC for a timed event. For a change, the whole list after it."
    ),
  reminders: z
    .object({
      use_default: z.boolean().describe("Use the calendar's own default reminders."),
      overrides: z
        .array(
          z.object({
            method: z.enum(['popup', 'email']).describe('popup is a notification.'),
            minutes: z.number().int().min(0).max(40320).describe('How long before, in minutes.')
          })
        )
        .max(5)
        .optional()
        .describe('Up to 5, when use_default is false.')
    })
    .optional()
    .describe(
      "The owner's reminders. Leave out for the calendar's default. Nobody else sees them."
    ),
  google_meet: z
    .boolean()
    .optional()
    .describe(
      'true adds a Google Meet video call; false takes a Meet call off. A Zoom or other add-on call is never changed: Oddboro cannot make one.'
    ),
  show_as: z.enum(['busy', 'free']).optional().describe('Whether the time shows as busy.'),
  visibility: z.enum(['default', 'public', 'private']).optional(),
  guests_can_modify: z.boolean().optional().describe("Google's default is false."),
  guests_can_invite_others: z.boolean().optional().describe("Google's default is true."),
  guests_can_see_other_guests: z.boolean().optional().describe("Google's default is true."),
  color_id: colour
    .optional()
    .describe(
      'The event colour: 1 Lavender, 2 Sage, 3 Grape, 4 Flamingo, 5 Banana, 6 Tangerine, 7 Peacock, 8 Graphite, 9 Blueberry, 10 Basil, 11 Tomato, or calendar for the calendar colour. Only the owner sees it.'
    ),
  attachments: z
    .array(
      z.object({
        file_url: z.url().optional().describe('A Google Drive or Docs link to the file.'),
        file_id: id.optional().describe('The Drive file ID, instead of file_url.'),
        title: z.string().max(300).optional().describe("The file's name."),
        mime_type: z.string().max(200).optional()
      })
    )
    .max(25)
    .optional()
    .describe(
      'Google Drive files on the event, up to 25: the whole list. Links only: nothing is uploaded. Guests open a file only if it is shared with them in Drive.'
    )
};
export const createInput = {
  ...eventInput,
  attendees: z
    .array(guest)
    .max(50)
    .optional()
    .describe('Guests: an email address, or { email, optional }. Google emails each one an invite.')
};
export const updateInput = {
  event_id: id.describe('The event ID, from list_events.'),
  scope: z
    .enum(['this', 'following', 'all'])
    .optional()
    .describe(
      'For one occurrence of a repeating event (an ID from list_events with recurringEventId): this occurrence, it and every later one, or the whole series. Needed then.'
    ),
  ...eventInput,
  summary: eventInput.summary.optional(),
  start_time: eventInput.start_time.optional(),
  end_time: eventInput.end_time.optional(),
  move_to_calendar_id: calendar
    .optional()
    .describe(
      'Move the whole event to another calendar of this account. Google tells its guests the organiser changed.'
    ),
  added_attendees: z
    .array(guest)
    .max(50)
    .optional()
    .describe('Guests to add. Google emails each one an invite.'),
  removed_attendee_emails: z
    .array(email)
    .max(50)
    .optional()
    .describe('Email addresses to take off. Google emails each one that it is cancelled.'),
  marked_optional: z.array(email).max(50).optional().describe('Guests on it to make optional.'),
  marked_required: z.array(email).max(50).optional().describe('Guests on it to make required.')
};
export const CreateArgs = z.object(createInput);
export const UpdateArgs = z.object(updateInput);
export type CreateArgs = z.infer<typeof CreateArgs>;
export type UpdateArgs = z.infer<typeof UpdateArgs>;
type EventArgs = Partial<CreateArgs> & Partial<UpdateArgs>;

/** An event as Google returns it. */
export type GoogleEvent = Omit<CalendarEvent, 'conference' | 'attachments'> & {
  conferenceData?: {
    conferenceSolution?: { key?: { type?: string }; name?: string };
    entryPoints?: { entryPointType?: string; uri?: string }[];
    createRequest?: unknown;
    [k: string]: unknown;
  };
  attachments?: { fileUrl: string; title?: string; mimeType?: string; fileId?: string }[];
};
export type Attendee = NonNullable<CalendarEvent['attendees']>[number];

/** The event as the desk shows it: Google's own fields, the video call said simply. */
export function viewOf(e: GoogleEvent): CalendarEvent {
  const { conferenceData: c, ...rest } = e;
  return {
    ...rest,
    ...(c
      ? {
          conference: {
            meet: c.conferenceSolution?.key?.type === 'hangoutsMeet',
            name: c.conferenceSolution?.name,
            uri: c.entryPoints?.find((p) => p.entryPointType === 'video')?.uri
          }
        }
      : {})
  };
}

export const readEvent = (token: Token, calendarId: string, eventId: string) =>
  google<GoogleEvent>(
    token,
    `${events(calendarId)}/${eventId}?${new URLSearchParams({ fields: EVENT_FIELDS })}`
  );

export const unique = (list: string[]) => [
  ...new Map(list.map((e) => [e.trim().toLowerCase(), e.trim()])).values()
];
const guestOf = (g: z.infer<typeof guest>) =>
  typeof g === 'string' ? { email: g.trim() } : { email: g.email.trim(), optional: g.optional };
export const guestsOf = (list: z.infer<typeof guest>[] | undefined) => [
  ...new Map((list ?? []).map(guestOf).map((g) => [g.email.toLowerCase(), g])).values()
];

/** The addresses on an event Google emails: everyone but the owner's own account and rooms. */
export function others(list: Partial<Attendee>[] | undefined, account: string | undefined) {
  const own = account?.toLowerCase();
  return unique(
    (list ?? [])
      .filter((a) => a.email && !a.self && !a.resource && a.email.toLowerCase() !== own)
      .map((a) => a.email!)
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

/** One end of an event as Google takes it: a date, or a time with its zone or offset. */
function slot(v: string, allDay: boolean | undefined, tz: string | undefined): GoogleTime {
  if (allDay) {
    const day = v.slice(0, 10);
    if (!DATE.test(day) || Number.isNaN(Date.parse(day)))
      throw new Error('An all-day event takes dates, like 2026-11-20.');
    return { date: day };
  }
  if (!DATE_TIME.test(v) || Number.isNaN(Date.parse(OFFSET.test(v) ? v : `${v}Z`)))
    throw new Error(`"${v}" is not a time like 2026-11-20T10:00:00.`);
  if (!tz && !OFFSET.test(v))
    throw new Error(
      'Give time_zone, or the UTC offset on the time, like 2026-11-20T10:00:00-08:00.'
    );
  return { dateTime: v, ...(tz ? { timeZone: tz } : {}) };
}

/** The instant one end of an event stands for, in ms. A date counts as its UTC midnight. */
export function instant(t: GoogleTime): number {
  if (t.date) return naive(t.date);
  const v = t.dateTime ?? '';
  return OFFSET.test(v) ? Date.parse(v) : instantOf(v, t.timeZone ?? 'UTC').getTime();
}

/** Both ends of an event, the end after the start. Each end may have its own zone. */
export function times(a: {
  start_time: string;
  end_time: string;
  all_day?: boolean;
  time_zone?: string;
  end_time_zone?: string;
}) {
  const start = slot(a.start_time, a.all_day, a.time_zone);
  const end = slot(a.end_time, a.all_day, a.end_time_zone ?? a.time_zone);
  if (instant(end) <= instant(start)) throw new Error('The end must be after the start.');
  return { start, end };
}

/**
 * Words for an add-on call Oddboro cannot make or take off. Google's API
 * creates only Google Meet calls; Zoom and the like come from their own
 * Google Calendar add-on.
 */
export const addOnWords = (name: string | undefined) =>
  `Its video call comes from ${name ?? 'an add-on'}, which Oddboro cannot change. Change it in Google Calendar.`;

/** The fields of a call Google takes as they are, beside times and guests. */
export function fields(a: EventArgs, existing?: GoogleEvent): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (a.summary !== undefined) b.summary = a.summary;
  if (a.location !== undefined) b.location = a.location;
  if (a.description !== undefined) b.description = a.description;
  if (a.recurrence !== undefined) b.recurrence = a.recurrence;
  if (a.reminders)
    b.reminders = a.reminders.use_default
      ? { useDefault: true }
      : { useDefault: false, overrides: a.reminders.overrides ?? [] };
  if (a.show_as) b.transparency = a.show_as === 'free' ? 'transparent' : 'opaque';
  if (a.visibility) b.visibility = a.visibility;
  if (a.guests_can_modify !== undefined) b.guestsCanModify = a.guests_can_modify;
  if (a.guests_can_invite_others !== undefined)
    b.guestsCanInviteOthers = a.guests_can_invite_others;
  if (a.guests_can_see_other_guests !== undefined)
    b.guestsCanSeeOtherGuests = a.guests_can_see_other_guests;
  if (a.color_id) {
    // Back to the calendar's colour: Google clears colorId on a change, and a new event has none.
    if (a.color_id !== 'calendar') b.colorId = a.color_id;
    else if (existing?.colorId) b.colorId = null;
  }
  if (a.attachments)
    b.attachments = a.attachments.map((f) => {
      const fileId = driveFileId(f.file_url ?? f.file_id ?? '');
      if (!fileId) throw new Error(`"${f.file_url ?? f.file_id}" is not a Google Drive file.`);
      return {
        fileUrl: f.file_url ?? driveLink(fileId),
        ...(f.title ? { title: f.title } : {}),
        ...(f.mime_type ? { mimeType: f.mime_type } : {})
      };
    });
  if (a.google_meet !== undefined) {
    const call = existing?.conferenceData;
    const meet = call?.conferenceSolution?.key?.type === 'hangoutsMeet';
    if (a.google_meet && !call)
      b.conferenceData = {
        createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } }
      };
    else if (!a.google_meet && call) {
      if (!meet) throw new Error(addOnWords(call.conferenceSolution?.name));
      b.conferenceData = null;
    }
  }
  return b;
}

/** The query every write sends: who Google emails, and that Oddboro handles video calls and files. */
export const writeQuery = (emails: boolean) =>
  `sendUpdates=${emails ? 'all' : 'none'}&conferenceDataVersion=1&supportsAttachments=true`;

/** Only the owner sees these, so a change to them alone emails nobody. */
const PERSONAL = new Set(['reminders', 'color_id']);
/** The inputs that name the event rather than change it. */
const NAMING = new Set(['event_id', 'calendar_id', 'scope']);

/** A change that touches only what the owner alone sees: their reminders and the colour. */
export const personalOnly = (args: Record<string, unknown>) =>
  Object.entries(args).every(([k, v]) => v === undefined || NAMING.has(k) || PERSONAL.has(k));

/** What a change does, read from Google now. */
export type Plan = {
  /** Who Google emails if it goes with sendUpdates=all: everyone on it besides the owner, and anyone added. */
  emailed: string[];
  /** Who is on it now besides the owner. */
  others: string[];
  /** Which events it changes: one event, or for a repeating one, as `scope` says. */
  scope: 'single' | 'this' | 'following' | 'all';
  /** The event or occurrence the call named. */
  target: GoogleEvent;
  /** For an occurrence of a repeating event: its series. */
  series?: GoogleEvent;
  /** The guest list to send, when the change adds, takes off or marks someone. */
  attendees?: Partial<Attendee>[];
};

/** Whether two event ends are the same moment. */
const same = (a: GoogleTime | undefined, b: GoogleTime | undefined) =>
  !!a && !!b && instant(a) === instant(b);

/**
 * What a change does to the people on an event, read from Google now: which
 * events it changes, who Google emails (everyone on them besides the owner,
 * and anyone added, unless only the owner's own reminders or colour change),
 * and the attendee list to send when the guests change. Each attendee keeps
 * what Google holds of them, their answer included.
 */
export async function planChange(
  token: Token,
  account: string | undefined,
  args: UpdateArgs
): Promise<Plan> {
  const cal = args.calendar_id ?? 'primary';
  const target = await readEvent(token, cal, args.event_id);
  let scope: Plan['scope'] = 'single';
  let series: GoogleEvent | undefined;
  if (target.recurringEventId) {
    if (!args.scope)
      throw new Error(
        'This is one occurrence of a repeating event. Say scope: "this" for this occurrence, "following" for it and every later one, or "all" for the whole series.'
      );
    scope = args.scope;
    if (scope !== 'this') series = await readEvent(token, cal, target.recurringEventId);
    // From the first occurrence on is the whole series.
    if (scope === 'following' && series && same(target.originalStartTime, series.start))
      scope = 'all';
  } else if (target.recurrence?.length) {
    if (args.scope === 'this' || args.scope === 'following')
      throw new Error(
        "That ID is the whole series. For one occurrence, or it and the ones after, use the occurrence's ID from list_events."
      );
    scope = 'all';
    series = target;
  }
  if (scope === 'this' && args.recurrence !== undefined)
    throw new Error('One occurrence cannot repeat on its own. Use scope "following" or "all".');
  if ((scope === 'this' || scope === 'following') && args.move_to_calendar_id)
    throw new Error('Only a whole event moves to another calendar. Use scope "all".');
  if (scope === 'all' && args.recurrence?.length === 0)
    throw new Error(
      'A series cannot stop repeating in one change. Change this and following events instead.'
    );

  const base = series ?? target;
  const on = others(base.attendees, account);
  const added = guestsOf(args.added_attendees);
  const gone = new Set((args.removed_attendee_emails ?? []).map((e) => e.toLowerCase()));
  const optional = new Set((args.marked_optional ?? []).map((e) => e.toLowerCase()));
  const required = new Set((args.marked_required ?? []).map((e) => e.toLowerCase()));
  const has = (e: string | undefined) =>
    (base.attendees ?? []).some((a) => a.email?.toLowerCase() === e?.toLowerCase());
  const attendees =
    added.length || gone.size || optional.size || required.size
      ? [
          ...(base.attendees ?? [])
            .filter((a) => !gone.has(a.email?.toLowerCase() ?? ''))
            .map((a) => {
              const k = a.email?.toLowerCase() ?? '';
              return optional.has(k)
                ? { ...a, optional: true }
                : required.has(k)
                  ? { ...a, optional: false }
                  : a;
            }),
          ...added.filter((g) => !has(g.email))
        ]
      : undefined;
  const emailed = personalOnly(args)
    ? []
    : unique([
        ...on,
        ...others(
          added.filter((g) => !has(g.email)),
          account
        )
      ]);
  return { emailed, others: on, scope, target, series, attendees };
}

/** The arguments' times as Google takes them, when the call gives both. */
function givenTimes(args: UpdateArgs) {
  if (args.start_time === undefined && args.end_time === undefined) {
    if (args.all_day !== undefined || args.time_zone !== undefined || args.end_time_zone)
      throw new Error('all_day and time_zone go with start_time and end_time.');
    return undefined;
  }
  if (!args.start_time || !args.end_time) throw new Error('Give start_time and end_time together.');
  return times({ ...args, start_time: args.start_time, end_time: args.end_time });
}

/**
 * The series' times for a change to "All events" made from one occurrence:
 * the series' first event moves as far as the occurrence did, on the wall
 * clock of the series' zone, and keeps the new length. So moving Friday's
 * 10:00 to 11:00 moves every Friday.
 */
export function shiftedSeries(
  given: { start: GoogleTime; end: GoogleTime },
  occurrence: GoogleEvent,
  series: GoogleEvent
): { start: GoogleTime; end: GoogleTime } {
  const zone = series.start.timeZone ?? given.start.timeZone ?? 'UTC';
  const allDay = !!given.start.date;
  const wall = (t: GoogleTime) =>
    t.date ? `${t.date}T00:00:00` : wallOf(new Date(instant(t)), zone);
  const from = occurrence.originalStartTime ?? occurrence.start;
  const moved = naive(wall(given.start)) - naive(allDay ? wall(from).slice(0, 10) : wall(from));
  const startWall = fromNaive(naive(wallIn(series.start, zone)) + moved);
  if (allDay) {
    const days = naive(given.end.date!) - naive(given.start.date!);
    return {
      start: { date: startWall.slice(0, 10) },
      end: { date: fromNaive(naive(startWall) + days).slice(0, 10) }
    };
  }
  const length = instant(given.end) - instant(given.start);
  const endZone = given.end.timeZone ?? zone;
  const end = wallOf(new Date(instantOf(startWall, zone).getTime() + length), endZone);
  return {
    start: { dateTime: startWall, timeZone: zone },
    end: { dateTime: end, timeZone: endZone }
  };
}

/**
 * Change one event, one occurrence, or a whole series, and move it if asked.
 * "This and following" goes to `splitSeries`. Returns what Google did, in words.
 */
export async function changeEvent(
  token: Token,
  args: UpdateArgs,
  plan: Plan,
  emails: boolean
): Promise<string> {
  const cal = args.calendar_id ?? 'primary';
  if (plan.scope === 'following') return splitSeries(token, args, plan, emails);
  const base = plan.scope === 'all' ? plan.series! : plan.target;
  // The series, for "All events" named by one of its occurrences.
  const baseId = (plan.scope === 'all' && plan.target.recurringEventId) || args.event_id;
  const patch = fields(args, base);
  const t = givenTimes(args);
  if (t)
    Object.assign(
      patch,
      plan.scope === 'all' && plan.target.recurringEventId ? shiftedSeries(t, plan.target, base) : t
    );
  if (plan.attendees) patch.attendees = plan.attendees;
  const moving = args.move_to_calendar_id && args.move_to_calendar_id !== cal;
  if (!Object.keys(patch).length && !moving) throw new Error('Say what to change.');
  let made = { id: baseId };
  if (Object.keys(patch).length)
    made = await google<{ id: string }>(
      token,
      `${events(cal)}/${baseId}?${writeQuery(emails)}`,
      send('PATCH', patch)
    );
  if (moving)
    made = await google<{ id: string }>(
      token,
      `${events(cal)}/${baseId}/move?${new URLSearchParams({
        destination: args.move_to_calendar_id!,
        sendUpdates: emails ? 'all' : 'none'
      })}`,
      { method: 'POST' }
    );
  const what = plan.scope === 'all' ? `Every event in series ${made.id}` : `Event ${made.id}`;
  return `${what} is changed${moving ? ` and on calendar ${args.move_to_calendar_id}` : ''}.`;
}

/** How many occurrences of a series start before `before`, cancelled ones too, as COUNT counts them. */
async function countBefore(token: Token, cal: string, series: GoogleEvent, before: GoogleTime) {
  let n = 0;
  let page: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMax: new Date(instant(before)).toISOString(),
      showDeleted: 'true',
      maxResults: '2500',
      fields: 'nextPageToken,items(id)'
    });
    if (page) params.set('pageToken', page);
    const r = await google<{ items?: unknown[]; nextPageToken?: string }>(
      token,
      `${events(cal)}/${series.id}/instances?${params}`
    );
    n += r.items?.length ?? 0;
    page = r.nextPageToken;
  } while (page);
  return n;
}

/**
 * "This and following events", as Google Calendar's own editor does it, since
 * the API has no single call for it: the series ends the day before this
 * occurrence (UNTIL on its RRULE), and a new series starts at it, with the
 * change, carrying the guests, the video call and the rest. One owner action:
 * if the new series fails, the old one gets its rule back.
 */
export async function splitSeries(
  token: Token,
  args: UpdateArgs,
  plan: Plan,
  emails: boolean
): Promise<string> {
  const cal = args.calendar_id ?? 'primary';
  const series = { ...plan.series!, id: plan.target.recurringEventId! };
  const occ = plan.target;
  const from = occ.originalStartTime ?? occ.start;
  const zone = series.start.timeZone ?? occ.start.timeZone ?? 'UTC';
  const allDay = !!series.start.date;
  const day = (from.date ?? wallIn(from, zone)).slice(0, 10);
  const lines = series.recurrence ?? [];
  const rule = lines.find((l) => /^RRULE:/i.test(l));
  if (!rule)
    throw new Error('That series has no rule Oddboro can end. Change it in Google Calendar.');
  const ended = lines.map((l) => (l === rule ? endBefore(l, day, zone, allDay) : l));

  // The new series repeats as the old one did from here: what COUNT had
  // left, the same UNTIL, and the skipped and added dates from here on, when
  // the times stay.
  const t = givenTimes(args);
  let next = rule;
  const count = new Map(ruleParts(rule)).get('COUNT');
  if (count) {
    const left = Number(count) - (await countBefore(token, cal, series, from));
    if (left < 1) throw new Error('That occurrence is past the end of its series.');
    next = withParts(rule, { COUNT: String(left) });
  }
  const recurrence = args.recurrence ?? [
    next,
    ...lines.filter((l) => l !== rule && !t && lineDates(l).some((d) => d.slice(0, 10) >= day))
  ];

  const { conferenceData, attachments } = series;
  const body: Record<string, unknown> = {
    summary: series.summary,
    description: series.description,
    location: series.location,
    start: occ.start.date ? { date: occ.start.date } : { ...occ.start, timeZone: zone },
    end: occ.end.date ? { date: occ.end.date } : { ...occ.end, timeZone: occ.end.timeZone ?? zone },
    attendees: (plan.attendees ?? series.attendees ?? []).map((a) => ({
      email: a.email,
      ...(a.displayName ? { displayName: a.displayName } : {}),
      ...(a.optional ? { optional: true } : {}),
      ...(a.resource ? { resource: true } : {})
    })),
    reminders: series.reminders,
    transparency: series.transparency,
    visibility: series.visibility,
    colorId: series.colorId,
    guestsCanModify: series.guestsCanModify,
    guestsCanInviteOthers: series.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: series.guestsCanSeeOtherGuests,
    // The same call, Meet or an add-on's, so nobody's link changes.
    ...(conferenceData
      ? {
          conferenceData: Object.fromEntries(
            Object.entries(conferenceData).filter(([k]) => k !== 'createRequest')
          )
        }
      : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...fields(args, series),
    ...(t ?? {}),
    ...(recurrence.length ? { recurrence } : { recurrence: undefined })
  };
  for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === null) delete body[k];

  const query = writeQuery(emails);
  await google(token, `${events(cal)}/${series.id}?${query}`, send('PATCH', { recurrence: ended }));
  let made: { id: string };
  try {
    made = await google<{ id: string }>(token, `${events(cal)}?${query}`, send('POST', body));
  } catch (e) {
    await google(
      token,
      `${events(cal)}/${series.id}?${query}`,
      send('PATCH', { recurrence: lines })
    ).catch(() => {});
    throw e;
  }
  return `Series ${series.id} now ends before ${day}, and the change starts series ${made.id} from ${day}.`;
}
