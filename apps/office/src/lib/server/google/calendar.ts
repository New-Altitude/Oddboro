// The calendar for one connected Google account. Each reply keeps Google's
// time zones, all-day dates and page tokens so an Odd can read the next page.
// With write, an Odd creates and changes events (`create_event`,
// `update_event`, Google's own names), with what Google Calendar's own
// editor offers: a repeat, optional guests, a Meet call, reminders, Drive
// files, a colour, busy or free, and visibility. What each call sends is in
// calendar-write.ts. There is no tool to delete an event or a calendar.
// Google emails everyone on an event it creates or changes, so a call that
// would email anyone besides the owner goes only on the owner's click on
// their desk (`OWNER_META`): the gateway holds it at any level (`eventHold`),
// and the tool refuses it from a run.
import type { HeldCalendar, HeldEvent } from '@oddboro/ledger';
import { z } from 'zod';
import { ruleWords } from '#lib/calendar/rrule.ts';
import { wallIn } from '#lib/calendar/zones.ts';
import {
  API,
  calendar,
  changeEvent,
  createInput,
  CreateArgs,
  EVENT_FIELDS,
  events,
  fields,
  guestsOf,
  others,
  planChange,
  readEvent,
  times,
  updateInput,
  UpdateArgs,
  viewOf,
  writeQuery,
  type GoogleEvent
} from './calendar-write.ts';
import { accountServer, DATA_NOTE, google, id, run, send, untrusted, type Token } from './http.ts';

const read = { readOnlyHint: true };
const when = z.string().datetime({ offset: true }).describe('A date and time with its UTC offset.');
const period = { time_min: when, time_max: when };
const page = {
  page_token: z.string().optional().describe('nextPageToken from the previous page.')
};
/** What list_events gives of each occurrence: enough to know it, its repeat and who is on it. */
const LISTED_FIELDS =
  'id,etag,status,summary,location,start,end,originalStartTime,recurringEventId,htmlLink,attendees(email,optional,self,responseStatus),reminders,hangoutLink,conferenceData(conferenceSolution(name,key),entryPoints(entryPointType,uri)),transparency,visibility,colorId,attachments(title,fileUrl)';

function checkPeriod(start: string, end: string) {
  if (Date.parse(end) <= Date.parse(start)) throw new Error('The end must be after the start.');
}

/** An event with its repeat said in words beside Google's own lines. */
function withRepeat<
  E extends {
    recurrence?: string[];
    start?: { date?: string; dateTime?: string; timeZone?: string };
  }
>(e: E) {
  if (!e.recurrence?.length || !e.start) return e;
  const zone = e.start.timeZone ?? 'UTC';
  return { ...e, repeats: ruleWords(e.recurrence, wallIn(e.start, zone).slice(0, 10), zone) };
}

export function calendarServer(token: Token, account?: string) {
  const server = accountServer('google-calendar', account, 'the Google Calendar account');
  const result = (data: unknown) => untrusted('calendar', JSON.stringify(data));

  server.registerTool(
    'list_calendars',
    {
      description: `List this account's calendars, their IDs, time zones, access levels, default reminders and which video calls each takes. Follow nextPageToken for more. ${DATA_NOTE}`,
      inputSchema: page,
      annotations: read
    },
    run(async ({ page_token }) => {
      const params = new URLSearchParams({
        fields:
          'nextPageToken,items(id,summary,summaryOverride,primary,timeZone,accessRole,backgroundColor,defaultReminders,conferenceProperties)',
        maxResults: '100'
      });
      if (page_token) params.set('pageToken', page_token);
      return result(await google(token, `${API}/users/me/calendarList?${params}`));
    })
  );

  server.registerTool(
    'list_events',
    {
      description: `Read events overlapping a time range on one calendar. Recurring events appear as individual occurrences, each with recurringEventId: get_event on that ID gives the rule. Follow nextPageToken for more. ${DATA_NOTE}`,
      inputSchema: { calendar_id: calendar, ...period, ...page },
      annotations: read
    },
    run(async ({ calendar_id, time_min, time_max, page_token }) => {
      checkPeriod(time_min, time_max);
      const params = new URLSearchParams({
        timeMin: time_min,
        timeMax: time_max,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
        fields: `nextPageToken,timeZone,items(${LISTED_FIELDS})`
      });
      if (page_token) params.set('pageToken', page_token);
      return result(await google(token, `${events(calendar_id)}?${params}`));
    })
  );

  server.registerTool(
    'get_event',
    {
      description: `Read one event: its guests and their answers, its repeat (Google's lines and in words), reminders, video call, files, colour and guest permissions. For an occurrence of a repeating event, series gives the rule. Use the event ID from list_events. ${DATA_NOTE}`,
      inputSchema: { calendar_id: calendar, event_id: id },
      annotations: read
    },
    run(async ({ calendar_id, event_id }) => {
      const e = await readEvent(token, calendar_id, event_id);
      const series = e.recurringEventId
        ? await google<GoogleEvent>(
            token,
            `${events(calendar_id)}/${e.recurringEventId}?fields=id,recurrence,start`
          ).catch(() => undefined)
        : undefined;
      return result({ ...withRepeat(e), ...(series ? { series: withRepeat(series) } : {}) });
    })
  );

  server.registerTool(
    'check_availability',
    {
      description: `Read busy intervals for up to 50 calendar IDs. If Google returns an error for a calendar, its availability is unknown. ${DATA_NOTE}`,
      inputSchema: { calendar_ids: z.array(calendar).min(1).max(50), ...period },
      annotations: read
    },
    run(async ({ calendar_ids, time_min, time_max }) => {
      checkPeriod(time_min, time_max);
      return result(
        await google(
          token,
          `${API}/freeBusy`,
          send('POST', {
            timeMin: time_min,
            timeMax: time_max,
            items: calendar_ids.map((id) => ({ id }))
          })
        )
      );
    })
  );
  const write = { readOnlyHint: false, destructiveHint: false };

  server.registerTool(
    'create_event',
    {
      description: `Create an event on one of this account's calendars: one-off or repeating, with guests (some optional), a Google Meet call, reminders, Drive files, a colour, and whether the time shows as busy. Google emails an invite to everyone in attendees, so an event with anyone besides the owner waits on the owner's desk until they click, whatever your level: say so in your reply. Without attendees it follows your level. The office ends the description with a line "${EVENT_FOOTER}", which the owner may delete: never write it yourself.`,
      inputSchema: createInput,
      annotations: write
    },
    run(async (args: CreateArgs, _odd, ownerSaidYes) => {
      const guests = guestsOf(args.attendees);
      const emailed = others(guests, account);
      if (emailed.length && !ownerSaidYes) throw new Error(waits(emailed));
      const body = {
        ...fields({ ...args, location: args.location || undefined }),
        summary: args.summary,
        ...times(args),
        // The line goes in where the text is first written; on the owner's
        // click the description is theirs, so a line they removed stays out.
        description: ownerSaidYes
          ? args.description || undefined
          : withEventFooter(args.description),
        ...(guests.length ? { attendees: guests } : {})
      };
      const made = await google<{ id: string }>(
        token,
        `${events(args.calendar_id ?? 'primary')}?${writeQuery(ownerSaidYes === true && emailed.length > 0)}`,
        send('POST', body)
      );
      return `Event ${made.id} is on the calendar. ${told(emailed, 'an invite')}`;
    })
  );

  server.registerTool(
    'update_event',
    {
      description: `Change one event: only the fields you give change. For one occurrence of a repeating event, say scope: this occurrence, it and every later one, or the whole series. Google emails everyone on the event about a change, so a change to an event with anyone besides the owner on it, or one that adds someone, waits on the owner's desk until they click, whatever your level: say so in your reply. Reminders and the colour alone email nobody, since only the owner sees them. Use the event ID from list_events.`,
      inputSchema: updateInput,
      annotations: write
    },
    run(async (args: UpdateArgs, _odd, ownerSaidYes) => {
      const plan = await planChange(token, account, args);
      if (plan.emailed.length && !ownerSaidYes) throw new Error(waits(plan.emailed));
      const emails = ownerSaidYes === true && plan.emailed.length > 0;
      return `${await changeEvent(token, args, plan, emails)} ${told(emails ? plan.emailed : [], 'the change')}`;
    })
  );
  return server;
}

/** The last line of an event the office creates. The owner may delete it, and it stays deleted. */
export const EVENT_FOOTER = 'Added by Oddboro: https://oddboro.com';

/** The description with a blank line and the footer after it, unless a line already says it. */
export function withEventFooter(description: string | undefined): string {
  const text = (description ?? '').trimEnd();
  if (text.split('\n').some((line) => /^added by oddboro\b/i.test(line.trim()))) return text;
  return text ? `${text}\n\n${EVENT_FOOTER}` : EVENT_FOOTER;
}

/** The tools that can make Google email someone. */
export const EVENT_TOOLS: readonly string[] = ['create_event', 'update_event'];

/** What the owner may change on the desk, beside the Odd's call. Never which event, nor its account. */
const SHARED = [
  'summary',
  'start_time',
  'end_time',
  'all_day',
  'time_zone',
  'end_time_zone',
  'location',
  'description',
  'recurrence',
  'reminders',
  'google_meet',
  'show_as',
  'visibility',
  'guests_can_modify',
  'guests_can_invite_others',
  'guests_can_see_other_guests',
  'color_id',
  'attachments'
];
const EDITABLE: Record<string, readonly string[]> = {
  create_event: [...SHARED, 'calendar_id', 'attendees'],
  update_event: [
    ...SHARED,
    'scope',
    'move_to_calendar_id',
    'added_attendees',
    'removed_attendee_emails',
    'marked_optional',
    'marked_required'
  ]
};

/**
 * A held event call as the owner left it on the desk: their values for the
 * fields they may change, and the rest (which event) as the Odd called it.
 * A field they left out goes; an empty one stays, so "no place" and "no
 * files" are theirs to say. A calendar must be one the desk offered them
 * (`event.calendars`), on the same account. The tool checks the rest.
 */
export function ownerEdit(
  tool: string,
  held: Record<string, unknown>,
  edited: Record<string, unknown>,
  event?: HeldEvent
): Record<string, unknown> {
  const editable = EDITABLE[tool];
  if (!editable) throw new Error('Only a calendar event takes changes on the desk.');
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(held).filter(([k]) => !editable.includes(k))
  );
  for (const k of editable) {
    const v = edited[k];
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  const offered = new Set(['primary', ...(event?.calendars ?? []).map((c) => c.id)]);
  for (const k of ['calendar_id', 'move_to_calendar_id'] as const)
    if (k in out && out[k] !== held[k] && !offered.has(String(out[k])))
      throw new Error('Pick one of the calendars the desk offers.');
  return out;
}

const waits = (emailed: string[]) =>
  `Google would email ${emailed.join(', ')}, and that goes only when the owner clicks it on their desk. Call it again with oddboro_title and oddboro_why, and the office puts it there.`;

const told = (emailed: string[], what: string) =>
  emailed.length ? `Google emailed ${what} to ${emailed.join(', ')}.` : 'Nobody was emailed.';

/** A held event call, ready for the desk. */
export type EventHold = {
  /** Who Google emails if the owner clicks it: anyone at all means it waits for them. */
  emailed: string[];
  /** The call's inputs as the desk shows them: a new event's description ends with the footer. */
  args: Record<string, unknown>;
  /** What it does, from the call alone, for the ask's title. */
  said: string;
  /** What the desk shows beside the call, read from Google only when it is held. */
  view: () => Promise<HeldEvent>;
};

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 59).trimEnd()}…` : s);
const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);

/**
 * The calendars on the account the owner can add events to, and Google's
 * event colours, for the card to offer. Either one Google will not give is
 * left out, and the card offers less.
 */
async function choices(token: Token): Promise<Pick<HeldEvent, 'calendars' | 'colors'>> {
  type Listed = {
    id: string;
    summary?: string;
    summaryOverride?: string;
    primary?: boolean;
    backgroundColor?: string;
    timeZone?: string;
    accessRole?: string;
    defaultReminders?: { method: string; minutes: number }[];
    conferenceProperties?: { allowedConferenceSolutionTypes?: string[] };
  };
  const [list, colours] = await Promise.all([
    google<{ items?: Listed[] }>(
      token,
      `${API}/users/me/calendarList?${new URLSearchParams({
        minAccessRole: 'writer',
        maxResults: '250',
        fields:
          'items(id,summary,summaryOverride,primary,backgroundColor,timeZone,accessRole,defaultReminders,conferenceProperties)'
      })}`
    ).catch(() => undefined),
    google<{ event?: Record<string, { background: string }> }>(
      token,
      `${API}/colors?fields=event`
    ).catch(() => undefined)
  ]);
  const calendars: HeldCalendar[] | undefined = list?.items
    ?.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
    .map((c) => ({
      id: c.id,
      name: c.summaryOverride || c.summary || c.id,
      ...(c.primary ? { primary: true } : {}),
      ...(c.backgroundColor ? { color: c.backgroundColor } : {}),
      ...(c.timeZone ? { timeZone: c.timeZone } : {}),
      reminders: c.defaultReminders ?? [],
      meet: (c.conferenceProperties?.allowedConferenceSolutionTypes ?? []).includes('hangoutsMeet')
    }));
  const colors = colours?.event
    ? Object.fromEntries(Object.entries(colours.event).map(([k, v]) => [k, v.background]))
    : undefined;
  return { ...(calendars ? { calendars } : {}), ...(colors ? { colors } : {}) };
}

/** For an occurrence, the series it belongs to, read now if the plan did not. */
async function seriesOf(
  token: Token,
  cal: string,
  target: GoogleEvent,
  series: GoogleEvent | undefined
): Promise<Pick<HeldEvent, 'series'>> {
  if (!target.recurringEventId) return {};
  const s =
    series ??
    (await google<GoogleEvent>(
      token,
      `${events(cal)}/${target.recurringEventId}?fields=id,recurrence,start`
    ).catch(() => undefined));
  return s ? { series: { id: s.id, recurrence: s.recurrence ?? [], start: s.start } } : {};
}

/**
 * A call to `create_event` or `update_event` as the gateway weighs it: who
 * Google would email, which makes it wait for the owner's click at any
 * level, and what the desk shows. Undefined for any other call, or one
 * whose inputs the tool would refuse anyway.
 */
export async function eventHold(
  token: Token,
  account: string | undefined,
  tool: string,
  given: Record<string, unknown>
): Promise<EventHold | undefined> {
  if (tool === 'create_event') {
    const a = CreateArgs.safeParse(given);
    if (!a.success) return undefined;
    const emailed = others(guestsOf(a.data.attendees), account);
    return {
      emailed,
      // The footer goes in now, where the owner sees it and may delete it.
      args: { ...given, description: withEventFooter(a.data.description) },
      said: emailed.length
        ? `Invite ${people(emailed.length)} to "${short(a.data.summary)}"`
        : `Add "${short(a.data.summary)}" to the calendar`,
      view: async () => ({ account, others: [], ...(await choices(token)) })
    };
  }
  if (tool === 'update_event') {
    const a = UpdateArgs.safeParse(given);
    if (!a.success) return undefined;
    const plan = await planChange(token, account, a.data);
    const what = `"${short(a.data.summary ?? plan.target.summary ?? 'an event')}"`;
    const which =
      plan.scope === 'following'
        ? ' and every event after it'
        : plan.scope === 'all'
          ? ', every time it repeats'
          : '';
    const { target, series } = plan;
    return {
      emailed: plan.emailed,
      args: given,
      said: plan.emailed.length
        ? `Change ${what}${which} and email ${people(plan.emailed.length)}`
        : `Change ${what}${which}`,
      view: async () => ({
        account,
        now: target.summary,
        // A change to the series goes to the series' guests, so the card shows them.
        others: others((plan.scope === 'this' ? target : (series ?? target)).attendees, account),
        before:
          plan.scope === 'this' || !series
            ? viewOf(target)
            : { ...viewOf(target), attendees: viewOf(series).attendees },
        ...(await seriesOf(token, a.data.calendar_id ?? 'primary', target, series)),
        ...(await choices(token))
      })
    };
  }
  return undefined;
}
