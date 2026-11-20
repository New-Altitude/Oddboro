<script lang="ts">
  // One Google Calendar event an Odd's call would make or change (a `call`
  // ask whose call carries `event`), reviewed on the Desk the way Google
  // Calendar's own editor works. On top, who wants it and why. Then a
  // summary, read only, like Google's event popup: one look says what will
  // happen. Edit opens the event in sections on one grid: when (with the
  // repeat and time zone), video call, where, guests, notifications, the
  // calendar group (calendar, colour, busy or free, visibility), files and
  // the description. The footer sticks to the bottom of the card: the one box
  // that says who Google emails and what changes, then the buttons. The office
  // makes it, as the owner left it, only on their click, and only then may
  // Google email anyone. The rules live in `#lib/calendar/event-card.ts`.
  import type { AskRow, HeldCall, HeldEvent } from '@oddboro/ledger';
  import { untrack } from 'svelte';
  import {
    attachmentOf,
    calendarOf,
    consequence,
    nameOf,
    startOf,
    timesOf,
    versionOf,
    type Form,
    type Scope
  } from '#lib/calendar/event-card.ts';
  import { COLOUR_NAMES, inUnits, REMINDER_UNITS, reminderWords } from '#lib/calendar/event.ts';
  import { parseRule, presetOf, presets, ruleLine, ruleWords } from '#lib/calendar/rrule.ts';
  import { fromNaive, naive, zoneName } from '#lib/calendar/zones.ts';
  import GuestField from './GuestField.svelte';
  import Markdown from './Markdown.svelte';
  import Pixel from './Pixel.svelte';
  import RepeatPicker from './RepeatPicker.svelte';
  import ReviewNav from './ReviewNav.svelte';
  import ZonePicker from './ZonePicker.svelte';
  import { call } from './api.ts';
  import { after, around } from './review-steps.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  type Props = {
    ask: AskRow & { call: HeldCall & { event: HeldEvent } };
    /** Every open event on the desk, oldest first. */
    events: AskRow[];
    staff: StaffProfile[];
    /** The ask this one reworks, when the owner sent that one back. */
    reworks: AskRow | null;
    /** Open another event by its ask id, or go back to the desk with none. */
    ongo: (id: number | undefined) => void;
    /** Open an Odd's card. */
    onstaff: (id: string) => void;
  };
  let { ask: a, events, staff, reworks, ongo, onstaff }: Props = $props();

  const odd = $derived(staff.find((p) => p.id === a.staffId));
  const from = $derived(odd?.name ?? 'The Odd');
  const via = $derived(a.via ? (staff.find((p) => p.id === a.via)?.name ?? a.via) : undefined);
  const next = $derived(around(events, a.id).next);

  // The parent keys this view on the ask, so each event starts from the
  // Odd's call, and a desk reload never undoes the owner's edits.
  const held = untrack(() => ({
    tool: a.call.tool,
    arguments: a.call.arguments,
    event: a.call.event
  }));
  const ev = held.event;
  const before = ev.before;
  const isNew = held.tool === 'create_event';
  const first = startOf(held);
  let f = $state<Form>(startOf(held));

  let editing = $state(false);
  let zoneOpen = $state(false);
  let busy = $state(false);
  let problem = $state('');
  /** Ask for changes or Discard, waiting for its note. */
  let mode = $state<'changes' | 'discard' | undefined>();
  let note = $state('');
  let link = $state('');
  let linkWrong = $state('');

  const version = $derived(versionOf(held, f, first));
  const said = $derived(consequence(held, version, f));
  const times = $derived(timesOf(f));
  const timeProblem = $derived('problem' in times ? times.problem : '');
  const cal = $derived(calendarOf(f.calendarId, ev.calendars));
  const occurrence = !!before?.recurringEventId;
  const addOn = before?.conference && !before.conference.meet ? before.conference : undefined;
  const meetAllowed = $derived(cal?.meet !== false);
  const canMove = $derived(isNew || !f.scope || f.scope === 'all');

  /** What the Odd asks, in one line. */
  const wants = (() => {
    if (isNew) {
      const n = first.guests.length;
      return n
        ? `wants to invite ${n === 1 ? '1 person' : `${n} people`} to an event`
        : 'wants to add an event to your calendar';
    }
    if (first.scope === 'following') return 'wants to change this and following events';
    if (first.scope === 'all') return 'wants to change every event in a series';
    if (first.scope === 'this') return 'wants to change one event in a series';
    return 'wants to change an event';
  })();

  const goLabel = $derived(
    said.emails
      ? isNew
        ? 'Send invites'
        : 'Save and email guests'
      : isNew
        ? 'Add to calendar'
        : 'Save'
  );

  // Words for the summary.
  const thisYear = new Date().getFullYear();
  function day(date: string, long = true): string {
    const at = new Date(`${date}T12:00:00Z`);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: long ? 'long' : 'short',
      month: long ? 'long' : 'short',
      day: 'numeric',
      ...(at.getUTCFullYear() !== thisYear ? { year: 'numeric' } : {})
    }).format(at);
  }
  const clock = (t: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(`2000-01-01T${t}:00Z`));
  const whenSaid = $derived.by(() => {
    if (!f.startDate || !f.endDate) return 'No time yet';
    if (f.allDay)
      return f.endDate === f.startDate
        ? `${day(f.startDate)}, all day`
        : `${day(f.startDate, false)} to ${day(f.endDate, false)}, all day`;
    if (f.startDate === f.endDate)
      return `${day(f.startDate)} · ${clock(f.startTime)} to ${clock(f.endTime)}`;
    return `${day(f.startDate, false)}, ${clock(f.startTime)} to ${day(f.endDate, false)}, ${clock(f.endTime)}`;
  });
  const onDay = $derived(f.startDate ? new Date(`${f.startDate}T12:00:00Z`) : new Date());
  const zoneSaid = $derived(
    f.allDay
      ? ''
      : f.endZone !== f.zone
        ? `${zoneName(f.zone, onDay)} to ${zoneName(f.endZone, onDay)}`
        : zoneName(f.zone, onDay)
  );
  const repeatSaid = $derived(ruleWords(f.recurrence, f.startDate, f.zone));
  const defaultReminders = $derived(cal?.reminders ?? []);
  const remindersSaid = $derived(
    f.remindersDefault
      ? defaultReminders.length
        ? `${defaultReminders.map(reminderWords).join(', ')} (calendar default)`
        : "The calendar's default"
      : f.reminders.length
        ? f.reminders.map(reminderWords).join(', ')
        : 'No notifications'
  );
  const colourHex = $derived(
    f.colorId !== 'calendar' ? ev.colors?.[f.colorId] : (cal?.color ?? undefined)
  );
  const colourSaid = $derived(
    f.colorId === 'calendar' ? 'Calendar colour' : (COLOUR_NAMES[f.colorId] ?? 'Colour')
  );
  const calendarSaid = $derived(
    cal?.name ?? (f.calendarId === 'primary' ? 'Primary calendar' : f.calendarId)
  );
  const VISIBILITY = { default: 'Default visibility', public: 'Public', private: 'Private' };
  const SCOPES: { key: Scope; label: string }[] = [
    { key: 'this', label: 'This event' },
    { key: 'following', label: 'This and following events' },
    { key: 'all', label: 'All events' }
  ];

  /** A new start keeps the length, as in Google, and a preset repeat follows the new day. */
  function moveStart(date: string, time: string) {
    const wasDate = f.startDate;
    const length = naive(`${f.endDate}T${f.endTime}`) - naive(`${f.startDate}T${f.startTime}`);
    if (date && f.endDate) {
      const end = fromNaive(naive(`${date}T${time}`) + Math.max(0, length));
      f.endDate = end.slice(0, 10);
      if (!f.allDay) f.endTime = end.slice(11, 16);
    }
    f.startDate = date;
    f.startTime = time;
    const key = presetOf(parseRule(f.recurrence, wasDate, f.zone), wasDate);
    if (date && date !== wasDate && key !== 'none' && key !== 'custom') {
      const p = presets(date).find((x) => x.key === key)?.repeat;
      if (p)
        f.recurrence = [
          ruleLine(p, f.zone, f.allDay),
          ...f.recurrence.filter((l) => !/^RRULE:/i.test(l))
        ];
    }
  }
  /** "This event" cannot repeat or move on its own: Google offers the rest then. */
  function setScope(s: Scope) {
    f.scope = s;
    if (s !== 'all') f.calendarId = first.calendarId;
  }
  function setRepeat(lines: string[]) {
    f.recurrence = lines;
    if (f.scope === 'this') setScope('following');
  }
  function setReminder(i: number, n: number, unit: string) {
    const u = REMINDER_UNITS.find((x) => x.unit === unit) ?? REMINDER_UNITS[3];
    f.reminders[i].minutes = Math.max(0, Math.min(40320, Math.round(n || 0) * u.minutes));
  }
  function addLink() {
    const file = attachmentOf(link);
    if (!file) {
      linkWrong = 'Paste a Google Drive or Docs link.';
      return;
    }
    if (!f.attachments.some((x) => x.fileUrl === file.fileUrl)) f.attachments.push(file);
    link = '';
    linkWrong = '';
  }

  async function act(fn: () => Promise<unknown>, then: number | undefined) {
    busy = true;
    problem = '';
    try {
      await fn();
      ongo(then);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  const go = () =>
    act(() => call(`/api/asks/${a.id}/call`, { arguments: version }), after(events, a.id));
  const decide = (decision: 'iterate' | 'deny') =>
    act(() => call(`/api/asks/${a.id}`, { decision, reason: note.trim() }), after(events, a.id));
  /** Skip leaves it on the desk and moves on, round to the first. */
  const skip = () => ongo((next ?? (events[0]?.id !== a.id ? events[0] : undefined))?.id);

  /** The description grows with what it holds. */
  function grow(el: HTMLTextAreaElement) {
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    el.addEventListener('input', fit);
    return { destroy: () => el.removeEventListener('input', fit) };
  }

  const ctl =
    'h-8 min-w-0 rounded-lg bg-raise px-2.5 text-sm text-ink outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-sea disabled:opacity-40';
  const row = 'grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3';
  const quiet =
    'h-8 rounded-lg px-2.5 text-xs text-muted hover:bg-raise hover:text-ink disabled:opacity-40';
  const fold =
    'cursor-pointer list-none items-center rounded-lg text-sm text-ink hover:text-sea [&::-webkit-details-marker]:hidden';
  const ICONS: Record<string, string> = {
    clock: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 4.5V8l2.5 1.5',
    video:
      'M2 4.5h8a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5zM10.5 7l4-2.5v7l-4-2.5',
    pin: 'M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14zM8 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
    people:
      'M6 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 3.2a2.5 2.5 0 0 1 0 4.6M12.6 9.8c1.2.5 1.9 1.8 1.9 3.7',
    bell: 'M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11L4 11zM6.5 14a1.5 1.5 0 0 0 3 0',
    calendar:
      'M3.5 3h9A1.5 1.5 0 0 1 14 4.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-8A1.5 1.5 0 0 1 3.5 3zM2 6.5h12M5.5 1.5v3M10.5 1.5v3',
    clip: 'm13 7.5-5.3 5.3a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3L6.2 11.3a1 1 0 0 1-1.5-1.5L10 4.5',
    text: 'M2.5 4h11M2.5 8h11M2.5 12h7'
  };
</script>

{#snippet icon(name: string, top = 'mt-2')}
  <svg
    class="{top} size-4 text-muted"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.3"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"><path d={ICONS[name]} /></svg
  >
{/snippet}

{#snippet swatch(hex: string | undefined, size = 'size-3 rounded-[4px]')}
  <!-- Google's own colour for the owner's event or calendar, only inside this mark. -->
  <span
    class="{size} inline-block shrink-0 {hex ? '' : 'border border-hairline'}"
    style:background-color={hex}
    aria-hidden="true"
  ></span>
{/snippet}

<ReviewNav label="Event" ask={a} list={events} {staff} {busy} {ongo} {onstaff} quiet>
  <div class="@container">
    <!-- Who wants it, and why. -->
    <div class="mt-2 flex items-start gap-3">
      <button
        class="shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-sea focus-visible:outline-none"
        title={`Open ${from}'s card`}
        onclick={() => onstaff(a.staffId)}
      >
        {#if odd}
          <Pixel
            src={odd.look?.portrait}
            frame={`${odd.portrait}/default`}
            fallback={`${odd.sprite}@${odd.variant}/idle-down-0`}
            scale={1}
            label={odd.name}
            class="flex size-10 items-center justify-center overflow-hidden rounded-lg bg-sea-deep"
          />
        {:else}
          <span class="block size-10 rounded-lg bg-sea-deep"></span>
        {/if}
      </button>
      <div class="min-w-0 flex-1">
        <p class="text-sm leading-snug text-ink">
          <span class="font-medium">{from}</span>{via ? `, from ${via}'s work,` : ''}
          {wants}
        </p>
        <details class="mt-0.5 text-xs">
          <summary
            class="cursor-pointer list-none text-muted hover:text-ink [&::-webkit-details-marker]:hidden"
            >Why <span class="text-faint" aria-hidden="true">▾</span></summary
          >
          <div class="mt-1 text-sm leading-relaxed text-ink">
            <Markdown text={a.why} staff={a.staffId} />
          </div>
        </details>
      </div>
    </div>

    {#if reworks}
      <div class="mt-3 rounded-lg bg-sea/10 px-2.5 py-2 text-xs">
        <div class="text-muted">Reworks “{reworks.title}”</div>
        {#if reworks.reason}<div class="mt-0.5">You asked: {reworks.reason}</div>{/if}
      </div>
    {/if}

    {#if occurrence}
      <fieldset class="mt-3">
        <legend class="text-xs text-muted">This event repeats. Change</legend>
        <div class="mt-1.5 grid gap-1">
          {#each SCOPES as s (s.key)}
            {@const locked = s.key === 'this' && f.recurrence.join() !== first.recurrence.join()}
            <label
              class="flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1 text-sm leading-tight {f.scope ===
              s.key
                ? 'bg-sea/15 text-ink ring-1 ring-sea/50'
                : 'bg-raise text-muted hover:text-ink'} {locked ? 'opacity-40' : ''}"
            >
              <input
                type="radio"
                class="accent-sea"
                name={`scope-${a.id}`}
                checked={f.scope === s.key}
                disabled={busy || locked}
                onchange={() => setScope(s.key)}
              />
              {s.label}
            </label>
          {/each}
        </div>
      </fieldset>
    {/if}

    {#if !editing}
      <!-- The summary: what the click makes, at a glance. -->
      <section class="mt-3 rounded-xl bg-raise p-3" aria-label="The event">
        <div class="flex items-start gap-2.5">
          <span class="mt-2">{@render swatch(colourHex)}</span>
          <h2 class="min-w-0 flex-1 text-lg leading-snug font-medium break-words text-ink">
            {f.summary.trim() || 'No title'}
          </h2>
        </div>
        <dl class="mt-2.5 flex flex-col gap-2.5 text-sm">
          <div class={row}>
            <dt class="sr-only">When</dt>
            {@render icon('clock', 'mt-0.5')}
            <dd>
              <div class="text-ink">{whenSaid}</div>
              <div class="text-xs text-muted">
                {[zoneSaid, f.recurrence.length ? repeatSaid : ''].filter(Boolean).join(' · ') ||
                  'Does not repeat'}
              </div>
            </dd>
          </div>
          {#if addOn || f.meet}
            <div class={row}>
              <dt class="sr-only">Video call</dt>
              {@render icon('video', 'mt-0.5')}
              <dd class="min-w-0">
                {#if addOn}
                  <div class="text-ink">{addOn.name ?? 'Video call'}</div>
                  {#if addOn.uri}<div class="truncate text-xs text-muted">{addOn.uri}</div>{/if}
                {:else}
                  <div class="text-ink">Google Meet video call</div>
                  <div class="truncate text-xs text-muted">
                    {before?.conference?.meet && before.conference.uri
                      ? before.conference.uri
                      : 'Google makes the link when you save'}
                  </div>
                {/if}
              </dd>
            </div>
          {/if}
          {#if f.location.trim()}
            <div class={row}>
              <dt class="sr-only">Where</dt>
              {@render icon('pin', 'mt-0.5')}
              <dd class="break-words text-ink">{f.location}</dd>
            </div>
          {/if}
          <div class={row}>
            <dt class="sr-only">Guests</dt>
            {@render icon('people', 'mt-0.5')}
            <dd class="min-w-0">
              {#if f.guests.length}
                <div class="text-ink">
                  {f.guests.length === 1 ? '1 guest' : `${f.guests.length} guests`}
                </div>
                <div class="text-xs leading-relaxed text-muted">
                  {f.guests.map((g) => `${nameOf(g)}${g.optional ? ' (optional)' : ''}`).join(', ')}
                </div>
              {:else}
                <div class="text-muted">No guests</div>
              {/if}
              {#if f.removed.length}
                <div class="text-xs text-coral">
                  Removing {f.removed.map(nameOf).join(', ')}
                </div>
              {/if}
            </dd>
          </div>
          <div class={row}>
            <dt class="sr-only">Notifications</dt>
            {@render icon('bell', 'mt-0.5')}
            <dd class="text-ink">{remindersSaid}</dd>
          </div>
          <div class={row}>
            <dt class="sr-only">Calendar</dt>
            {@render icon('calendar', 'mt-0.5')}
            <dd class="flex min-w-0 flex-wrap items-center gap-x-1.5 text-ink">
              {@render swatch(cal?.color, 'size-2.5 rounded-full')}
              <span class="truncate">{calendarSaid}</span>
              <span class="text-muted">
                · {f.showAs === 'free' ? 'Free' : 'Busy'} · {VISIBILITY[f.visibility]}</span
              >
            </dd>
          </div>
          {#if f.attachments.length}
            <div class={row}>
              <dt class="sr-only">Files</dt>
              {@render icon('clip', 'mt-0.5')}
              <dd class="min-w-0 text-ink">
                {f.attachments.map((x) => x.title ?? 'A Drive file').join(', ')}
              </dd>
            </div>
          {/if}
          {#if f.description.trim()}
            <div class={row}>
              <dt class="sr-only">Description</dt>
              {@render icon('text', 'mt-0.5')}
              <dd class="line-clamp-4 text-xs leading-relaxed whitespace-pre-wrap text-muted">
                {f.description.trim()}
              </dd>
            </div>
          {/if}
        </dl>
        <div class="mt-3 flex justify-end">
          <button
            class="h-8 rounded-lg bg-raise px-3 text-xs text-ink hover:bg-sea/25 disabled:opacity-40"
            disabled={busy}
            onclick={() => (editing = true)}>Edit details</button
          >
        </div>
      </section>
    {:else}
      <!-- The editor: one grid, an icon column and the controls. -->
      <section class="mt-3 flex flex-col gap-4 text-sm" aria-label="Edit the event">
        <div class="flex items-center gap-2">
          <label class="sr-only" for={`title-${a.id}`}>Title</label>
          <input
            id={`title-${a.id}`}
            class="h-10 min-w-0 flex-1 rounded-lg bg-raise px-3 text-base font-medium text-ink outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-sea"
            placeholder="Add title"
            bind:value={f.summary}
            disabled={busy}
          />
          <button
            class="h-10 shrink-0 rounded-lg bg-raise px-3 text-xs text-ink hover:bg-sea/25"
            onclick={() => (editing = false)}>Done</button
          >
        </div>

        <div class={row}>
          {@render icon('clock')}
          <div class="flex min-w-0 flex-col gap-2">
            <div
              class="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 @sm:grid-cols-[2.5rem_minmax(0,1fr)_8rem]"
            >
              <span class="hidden text-xs text-muted @sm:block">Starts</span>
              <input
                type="date"
                aria-label="Start date"
                class="{ctl} {f.allDay ? 'col-span-2' : ''}"
                value={f.startDate}
                disabled={busy}
                onchange={(e) => moveStart(e.currentTarget.value, f.startTime)}
              />
              {#if !f.allDay}
                <input
                  type="time"
                  aria-label="Start time"
                  class={ctl}
                  value={f.startTime}
                  disabled={busy}
                  onchange={(e) => moveStart(f.startDate, e.currentTarget.value)}
                />
              {/if}
              <span class="hidden text-xs text-muted @sm:block">Ends</span>
              <input
                type="date"
                aria-label="End date"
                class="{ctl} {f.allDay ? 'col-span-2' : ''}"
                min={f.startDate}
                bind:value={f.endDate}
                disabled={busy}
              />
              {#if !f.allDay}
                <input
                  type="time"
                  aria-label="End time"
                  class={ctl}
                  bind:value={f.endTime}
                  disabled={busy}
                />
              {/if}
            </div>
            {#if timeProblem}<p class="text-xs text-coral">{timeProblem}</p>{/if}
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <label class="flex items-center gap-1.5 text-ink">
                <input type="checkbox" class="accent-sea" bind:checked={f.allDay} disabled={busy} />
                All day
              </label>
              {#if !f.allDay}
                <button
                  class="text-sea underline-offset-2 hover:underline"
                  aria-expanded={zoneOpen}
                  onclick={() => (zoneOpen = !zoneOpen)}>Time zone</button
                >
                <span class="min-w-0 truncate text-muted">{zoneSaid}</span>
              {/if}
            </div>
            {#if zoneOpen && !f.allDay}
              <div class="flex flex-col gap-2 rounded-xl border border-hairline p-2.5">
                <div class="text-xs text-muted">
                  {f.endZone === f.zone ? 'Event time zone' : 'Start time zone'}
                </div>
                <ZonePicker
                  bind:value={
                    () => f.zone,
                    (v) => {
                      if (f.endZone === f.zone) f.endZone = v;
                      f.zone = v;
                    }
                  }
                  label="Start time zone"
                  on={f.startDate}
                  disabled={busy}
                />
                <label class="flex items-center gap-1.5 text-xs text-ink">
                  <input
                    type="checkbox"
                    class="accent-sea"
                    checked={f.endZone !== f.zone}
                    disabled={busy}
                    onchange={(e) => (f.endZone = e.currentTarget.checked ? 'Etc/UTC' : f.zone)}
                  />
                  Separate start and end time zones
                </label>
                {#if f.endZone !== f.zone}
                  <div class="text-xs text-muted">End time zone</div>
                  <ZonePicker
                    bind:value={f.endZone}
                    label="End time zone"
                    on={f.endDate}
                    disabled={busy}
                  />
                {/if}
              </div>
            {/if}
            <RepeatPicker
              bind:lines={() => f.recurrence, setRepeat}
              start={f.startDate}
              zone={f.zone}
              allDay={f.allDay}
              disabled={busy || !f.startDate}
            />
          </div>
        </div>

        <div class={row}>
          {@render icon('video')}
          <div class="flex min-w-0 flex-col gap-1.5">
            {#if addOn}
              <div class="flex h-8 items-center gap-2 text-ink">
                {addOn.name ?? 'A video call'}
              </div>
              {#if addOn.uri}<div class="truncate text-xs text-muted">{addOn.uri}</div>{/if}
              <p class="text-xs text-faint">
                It comes from an add-on, which Oddboro keeps as it is.
              </p>
            {:else if f.meet}
              <div class="flex h-8 min-w-0 items-center gap-2">
                <span class="text-ink">Google Meet video call</span>
                <button
                  class="ms-auto shrink-0 text-xs text-muted hover:text-coral"
                  disabled={busy}
                  onclick={() => (f.meet = false)}>Remove</button
                >
              </div>
              <div class="truncate text-xs text-muted">
                {before?.conference?.meet && before.conference.uri
                  ? before.conference.uri
                  : 'Google makes the link when you save.'}
              </div>
            {:else}
              <button
                class="h-8 self-start rounded-lg bg-raise px-3 text-sm text-ink hover:bg-sea/25 disabled:opacity-40"
                disabled={busy || !meetAllowed}
                onclick={() => (f.meet = true)}>Add Google Meet video call</button
              >
              {#if !meetAllowed}
                <p class="text-xs text-muted">This calendar does not take Google Meet calls.</p>
              {/if}
            {/if}
            {#if !addOn}
              <p class="text-[11px] leading-snug text-faint">
                Zoom links come from Zoom's own add-on, which Oddboro cannot start; add one in
                Google Calendar.
              </p>
            {/if}
          </div>
        </div>

        <div class={row}>
          {@render icon('pin')}
          <input
            aria-label="Where"
            class={ctl}
            placeholder="Add a place"
            bind:value={f.location}
            disabled={busy}
          />
        </div>

        <div class={row}>
          {@render icon('people')}
          <div class="flex min-w-0 flex-col gap-2">
            <GuestField
              bind:guests={f.guests}
              bind:removed={f.removed}
              organiser={ev.account}
              marknew={!isNew}
              disabled={busy}
            />
            <details class="text-sm">
              <summary class="{fold} flex h-8 gap-2">
                <span>Guest permissions</span>
                <span class="truncate text-xs text-muted"
                  >{[f.canModify && 'modify', f.canInvite && 'invite', f.canSee && 'see the list']
                    .filter(Boolean)
                    .join(', ') || 'none'}</span
                >
              </summary>
              <div class="flex flex-col gap-1.5 pt-1 text-sm text-ink">
                <label class="flex items-center gap-2"
                  ><input
                    type="checkbox"
                    class="accent-sea"
                    bind:checked={f.canModify}
                    disabled={busy}
                  /> Modify event</label
                >
                <label class="flex items-center gap-2"
                  ><input
                    type="checkbox"
                    class="accent-sea"
                    bind:checked={f.canInvite}
                    disabled={busy}
                  /> Invite others</label
                >
                <label class="flex items-center gap-2"
                  ><input
                    type="checkbox"
                    class="accent-sea"
                    bind:checked={f.canSee}
                    disabled={busy}
                  /> See guest list</label
                >
              </div>
            </details>
          </div>
        </div>

        <details>
          <summary class="{fold} grid h-8 grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            {@render icon('bell', 'mt-0')}
            <span class="flex min-w-0 items-center gap-2"
              ><span class="shrink-0">Notifications</span><span class="truncate text-xs text-muted"
                >{remindersSaid}</span
              ></span
            >
          </summary>
          <div class="flex min-w-0 flex-col gap-2 ps-7 pt-1">
            <label class="flex items-center gap-2 text-ink">
              <input
                type="checkbox"
                class="accent-sea"
                bind:checked={f.remindersDefault}
                disabled={busy}
              />
              Use the calendar's default
            </label>
            {#if !f.remindersDefault}
              {#each f.reminders as r, i (i)}
                {@const u = inUnits(r.minutes)}
                <div class="flex flex-wrap items-center gap-1.5">
                  <select
                    aria-label="How"
                    class="{ctl} w-[7.5rem]"
                    bind:value={r.method}
                    disabled={busy}
                  >
                    <option value="popup">Notification</option>
                    <option value="email">Email</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    aria-label="How long before"
                    class="{ctl} w-16"
                    value={u.n}
                    disabled={busy}
                    onchange={(e) => setReminder(i, Number(e.currentTarget.value), u.unit)}
                  />
                  <select
                    aria-label="Unit"
                    class="{ctl} w-[6.5rem]"
                    value={u.unit}
                    disabled={busy}
                    onchange={(e) => setReminder(i, u.n, e.currentTarget.value)}
                  >
                    {#each REMINDER_UNITS as x (x.unit)}
                      <option value={x.unit}>{x.unit}</option>
                    {/each}
                  </select>
                  <button
                    class="flex size-8 items-center justify-center rounded-lg text-faint hover:bg-coral/25 hover:text-ink"
                    aria-label="Remove this notification"
                    disabled={busy}
                    onclick={() => f.reminders.splice(i, 1)}
                    ><svg
                      class="size-2.5"
                      viewBox="0 0 10 10"
                      stroke="currentColor"
                      stroke-width="1.5"
                      aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg
                    ></button
                  >
                </div>
              {/each}
              {#if f.reminders.length < 5}
                <button
                  class="self-start text-xs text-sea hover:text-ink"
                  disabled={busy}
                  onclick={() => f.reminders.push({ method: 'popup', minutes: 10 })}
                  >Add a notification</button
                >
              {/if}
            {/if}
          </div>
        </details>

        <details>
          <summary class="{fold} grid h-8 grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            {@render icon('calendar', 'mt-0')}
            <span class="flex min-w-0 items-center gap-1.5">
              {@render swatch(cal?.color, 'size-2.5 rounded-full')}
              <span class="truncate">{calendarSaid}</span>
              <span class="shrink-0 text-xs text-muted"
                >· {colourSaid} · {f.showAs === 'free' ? 'Free' : 'Busy'}</span
              >
            </span>
          </summary>
          <div class="flex min-w-0 flex-col gap-3 ps-7 pt-1">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted">Calendar</span>
              {#if ev.calendars?.length}
                <div class="flex items-center gap-2">
                  {@render swatch(cal?.color, 'size-3 rounded-full')}
                  <select
                    aria-label="Calendar"
                    class="{ctl} flex-1"
                    value={cal?.id ?? f.calendarId}
                    disabled={busy || !canMove}
                    onchange={(e) => (f.calendarId = e.currentTarget.value)}
                  >
                    {#each ev.calendars as c (c.id)}
                      <option value={c.id}>{c.name}</option>
                    {/each}
                  </select>
                </div>
                {#if !canMove}
                  <p class="text-xs text-muted">Only all events in a series move together.</p>
                {/if}
              {:else}
                <span class="text-ink">{calendarSaid}</span>
              {/if}
            </div>
            <div class="flex flex-col gap-1.5">
              <span class="text-xs text-muted">Colour: {colourSaid}</span>
              {#if ev.colors}
                <div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Event colour">
                  {#each ['calendar', ...Object.keys(COLOUR_NAMES)] as c (c)}
                    {@const hex = c === 'calendar' ? cal?.color : ev.colors[c]}
                    {@const name = c === 'calendar' ? 'Calendar colour' : COLOUR_NAMES[c]}
                    <button
                      role="radio"
                      aria-checked={f.colorId === c}
                      aria-label={name}
                      title={name}
                      disabled={busy}
                      class="flex size-6 items-center justify-center rounded-full {f.colorId === c
                        ? 'ring-2 ring-ink'
                        : 'hover:ring-1 hover:ring-muted'}"
                      onclick={() => (f.colorId = c)}
                      >{@render swatch(hex, 'size-4 rounded-full')}</button
                    >
                  {/each}
                </div>
              {:else}
                <select
                  aria-label="Event colour"
                  class={ctl}
                  bind:value={f.colorId}
                  disabled={busy}
                >
                  <option value="calendar">Calendar colour</option>
                  {#each Object.entries(COLOUR_NAMES) as [k, v] (k)}
                    <option value={k}>{v}</option>
                  {/each}
                </select>
              {/if}
            </div>
            <div class="flex flex-wrap items-end gap-3">
              <div class="flex flex-col gap-1">
                <span class="text-xs text-muted">Show as</span>
                <div
                  class="flex h-8 rounded-lg bg-raise p-0.5"
                  role="radiogroup"
                  aria-label="Show as"
                >
                  {#each [['busy', 'Busy'], ['free', 'Free']] as const as [k, label] (k)}
                    <button
                      role="radio"
                      aria-checked={f.showAs === k}
                      class="rounded-md px-3 text-xs {f.showAs === k
                        ? 'bg-sea/25 text-ink'
                        : 'text-muted hover:text-ink'}"
                      disabled={busy}
                      onclick={() => (f.showAs = k)}>{label}</button
                    >
                  {/each}
                </div>
              </div>
              <label class="flex min-w-[8rem] flex-1 flex-col gap-1">
                <span class="text-xs text-muted">Visibility</span>
                <select class={ctl} bind:value={f.visibility} disabled={busy}>
                  <option value="default">Default visibility</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </label>
            </div>
          </div>
        </details>

        <details open={f.attachments.length > 0}>
          <summary class="{fold} grid h-8 grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            {@render icon('clip', 'mt-0')}
            <span class="flex min-w-0 items-center gap-2"
              ><span>Attachments</span><span class="text-xs text-muted"
                >{f.attachments.length
                  ? f.attachments.length === 1
                    ? '1 file'
                    : `${f.attachments.length} files`
                  : 'None'}</span
              ></span
            >
          </summary>
          <div class="flex min-w-0 flex-col gap-2 ps-7 pt-1">
            {#if f.attachments.length}
              <ul class="flex flex-wrap gap-1.5" aria-label="Files">
                {#each f.attachments as x, i (x.fileUrl)}
                  <li
                    class="flex h-7 max-w-full min-w-0 items-center gap-1 rounded-full bg-raise ps-2.5 pe-1 text-xs"
                  >
                    <a
                      class="min-w-0 truncate text-ink hover:text-sea"
                      href={x.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer">{x.title ?? 'A Drive file'}</a
                    >
                    <button
                      class="flex size-5 shrink-0 items-center justify-center rounded-full text-faint hover:bg-coral/25 hover:text-ink"
                      aria-label={`Remove ${x.title ?? 'this file'}`}
                      disabled={busy}
                      onclick={() => f.attachments.splice(i, 1)}
                      ><svg
                        class="size-2.5"
                        viewBox="0 0 10 10"
                        stroke="currentColor"
                        stroke-width="1.5"
                        aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg
                      ></button
                    >
                  </li>
                {/each}
              </ul>
            {/if}
            {#if f.attachments.length < 25}
              <div class="flex gap-1.5">
                <input
                  aria-label="A Google Drive link"
                  class="{ctl} flex-1"
                  placeholder="Paste a Google Drive link"
                  bind:value={link}
                  disabled={busy}
                  onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addLink())}
                />
                <button
                  class="h-8 shrink-0 rounded-lg bg-raise px-3 text-xs text-ink hover:bg-sea/25 disabled:opacity-40"
                  disabled={busy || !link.trim()}
                  onclick={addLink}>Add</button
                >
              </div>
            {/if}
            {#if linkWrong}<p class="text-xs text-coral">{linkWrong}</p>{/if}
            <p class="text-[11px] leading-snug text-faint">
              A link to the file, nothing uploaded. Guests open it only if it is shared with them in
              Drive.
            </p>
          </div>
        </details>

        <div class={row}>
          {@render icon('text')}
          <textarea
            aria-label="Description"
            rows="3"
            class="w-full min-w-0 resize-none overflow-hidden rounded-lg bg-raise px-2.5 py-1.5 leading-relaxed text-ink outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-sea"
            placeholder="Add a description"
            bind:value={f.description}
            disabled={busy}
            use:grow></textarea>
        </div>
      </section>
    {/if}

    <!-- The footer: what the click does, then the buttons, always in view. -->
    <div
      class="sticky bottom-0 z-10 -mx-3 -mb-3 mt-4 border-t border-hairline bg-panel-solid px-3 pt-2.5 pb-3"
    >
      <div
        role="status"
        aria-live="polite"
        class="rounded-lg bg-raise px-2.5 py-2 text-xs leading-relaxed {said.emails
          ? 'text-ink'
          : 'text-muted'}"
      >
        {#each said.lines as line (line)}<p>{line}</p>{/each}
        <p class="text-faint">
          {said.emails
            ? `Nothing changes and nobody gets an email until you click ${goLabel}.`
            : `Nothing changes in your calendar until you click ${goLabel}.`}
        </p>
      </div>
      {#if problem}
        <p class="mt-2 rounded-lg bg-coral/15 px-2.5 py-1.5 text-xs text-coral">{problem}</p>
      {/if}
      {#if mode}
        <label class="mt-2 block text-xs text-muted" for={`event-note-${a.id}`}
          >{mode === 'changes'
            ? `What should ${from} change?`
            : 'Why, if you want to say (optional)'}</label
        >
        <textarea
          id={`event-note-${a.id}`}
          rows="2"
          class="mt-1 w-full resize-y rounded-lg bg-raise px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-sea"
          placeholder={mode === 'changes'
            ? 'Say what to change.'
            : `${from} reads it for next time.`}
          bind:value={note}></textarea>
        <div class="mt-2 flex items-center gap-1.5">
          <button class={quiet} disabled={busy} onclick={() => ((mode = undefined), (note = ''))}
            >Cancel</button
          >
          {#if mode === 'changes'}
            <button
              class="ms-auto h-9 rounded-lg bg-sea px-4 text-sm font-medium text-night disabled:opacity-40"
              disabled={busy || !note.trim()}
              onclick={() => decide('iterate')}>Send back to {from}</button
            >
          {:else}
            <button
              class="ms-auto h-9 rounded-lg bg-raise px-4 text-sm font-medium text-ink hover:bg-coral/25 disabled:opacity-40"
              disabled={busy}
              onclick={() => decide('deny')}>Discard it</button
            >
          {/if}
        </div>
      {:else}
        <div class="mt-2 flex flex-wrap items-center gap-1">
          <button
            class="order-first h-9 w-full rounded-lg bg-sea px-4 text-sm font-medium text-night disabled:opacity-40 @md:order-last @md:ms-auto @md:w-auto"
            disabled={busy || !!timeProblem || (isNew && !f.summary.trim())}
            onclick={go}>{busy ? 'Working' : goLabel}</button
          >
          <button class={quiet} disabled={busy} onclick={() => (mode = 'changes')}
            >Ask for changes</button
          >
          <button class={quiet} disabled={busy} onclick={skip}>Skip</button>
          <button
            class="{quiet} hover:bg-coral/20"
            disabled={busy}
            onclick={() => (mode = 'discard')}>Discard</button
          >
        </div>
      {/if}
    </div>
  </div>
</ReviewNav>
