<script lang="ts">
  // How an event repeats, as Google Calendar's own editor offers it: Google's
  // presets from the first day ("Weekly on Friday"), and Custom (every N days,
  // weeks, months or years; which days; ends never, on a date or after N
  // times). It edits Google's RRULE line and keeps any EXDATE or RDATE. A
  // rule the card cannot edit stays as it is until the owner picks another.
  import {
    nthOf,
    parseRule,
    presetOf,
    presets,
    ruleLine,
    ruleWords,
    WEEKDAYS,
    type Repeat,
    type Weekday
  } from '#lib/calendar/rrule.ts';

  type Props = {
    lines: string[];
    /** The first day, "2026-11-20". */
    start: string;
    zone: string;
    allDay: boolean;
    disabled?: boolean;
  };
  let { lines = $bindable(), start, zone, allDay, disabled = false }: Props = $props();

  /** The Custom panel is open. */
  let custom = $state(false);

  const rule = $derived(parseRule(lines, start, zone));
  const choices = $derived(presets(start));
  const picked = $derived(lines.length ? (rule ? presetOf(rule, start) : 'kept') : 'none');
  /** The lines beside the RRULE: skipped and added dates. */
  const others = $derived(lines.filter((l) => !/^RRULE:/i.test(l)));

  const LETTER: Record<Weekday, string> = {
    SU: 'S',
    MO: 'M',
    TU: 'T',
    WE: 'W',
    TH: 'T',
    FR: 'F',
    SA: 'S'
  };
  const DAY: Record<Weekday, string> = {
    SU: 'Sunday',
    MO: 'Monday',
    TU: 'Tuesday',
    WE: 'Wednesday',
    TH: 'Thursday',
    FR: 'Friday',
    SA: 'Saturday'
  };

  /** The rule being edited in the Custom panel. */
  let draft = $state<Repeat>({
    freq: 'WEEKLY',
    interval: 1,
    days: [],
    monthly: { by: 'day', day: 1 },
    ends: { by: 'never' }
  });
  let untilDate = $state('');
  let count = $state(13);

  function choose(key: string) {
    if (key === 'custom') return openCustom();
    if (key === 'kept' || key === 'custom-now') return;
    const p = choices.find((c) => c.key === key);
    lines = p?.repeat ? [ruleLine(p.repeat, zone, allDay), ...others] : [];
  }
  function openCustom() {
    const n = nthOf(start);
    draft = structuredClone(
      $state.snapshot(rule) ?? {
        freq: 'WEEKLY',
        interval: 1,
        days: [n.day],
        monthly: { by: 'day', day: Number(start.slice(8, 10)) },
        ends: { by: 'never' }
      }
    ) as Repeat;
    untilDate =
      draft.ends.by === 'date'
        ? draft.ends.date
        : new Date(Date.parse(`${start}T00:00:00Z`) + 90 * 86_400_000).toISOString().slice(0, 10);
    count = draft.ends.by === 'count' ? draft.ends.count : 13;
    custom = true;
  }
  function done() {
    const r: Repeat = {
      ...$state.snapshot(draft),
      interval: Math.max(1, Math.min(99, Math.round(draft.interval) || 1)),
      days: draft.days.length ? draft.days : [nthOf(start).day],
      ends:
        draft.ends.by === 'date' && untilDate
          ? { by: 'date', date: untilDate }
          : draft.ends.by === 'count'
            ? { by: 'count', count: Math.max(1, Math.min(730, Math.round(count) || 1)) }
            : { by: 'never' }
    } as Repeat;
    lines = [ruleLine(r, zone, allDay), ...others];
    custom = false;
  }
  const monthlyNth = $derived(nthOf(start));
  const NTH = ['first', 'second', 'third', 'fourth', 'fifth'];
  const unitOf = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as const;
  const id = $props.id();
  const ctl =
    'h-8 rounded-lg bg-raise px-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-sea disabled:opacity-40';
</script>

<label class="sr-only" for={`${id}-repeat`}>Repeat</label>
<select
  id={`${id}-repeat`}
  class={`${ctl} w-full min-w-0`}
  value={custom ? 'custom-now' : picked}
  {disabled}
  onchange={(e) => choose(e.currentTarget.value)}
>
  {#each choices as c (c.key)}
    <option value={c.key}>{c.label}</option>
  {/each}
  {#if picked === 'custom' || picked === 'kept'}
    <option value={picked}>{ruleWords(lines, start, zone)}</option>
  {/if}
  {#if custom}<option value="custom-now">Custom</option>{/if}
  <option value="custom">Custom…</option>
</select>

{#if custom}
  <fieldset class="mt-2 flex flex-col gap-3 rounded-xl border border-hairline p-3 text-sm">
    <legend class="px-1 text-xs text-muted">Custom repeat</legend>
    <div class="flex flex-wrap items-center gap-2">
      <label for={`${id}-every`} class="text-muted">Repeat every</label>
      <input
        id={`${id}-every`}
        type="number"
        min="1"
        max="99"
        class={`${ctl} w-16`}
        bind:value={draft.interval}
      />
      <label class="sr-only" for={`${id}-unit`}>Unit</label>
      <select id={`${id}-unit`} class={ctl} bind:value={draft.freq}>
        {#each ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const as f (f)}
          <option value={f}>{unitOf[f]}{draft.interval === 1 ? '' : 's'}</option>
        {/each}
      </select>
    </div>
    {#if draft.freq === 'WEEKLY'}
      <div>
        <div class="text-muted">Repeat on</div>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {#each WEEKDAYS as d (d)}
            {@const on = draft.days.includes(d)}
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-full text-xs font-medium {on
                ? 'bg-sea text-night'
                : 'bg-raise text-muted hover:text-ink'}"
              aria-pressed={on}
              aria-label={DAY[d]}
              title={DAY[d]}
              onclick={() =>
                (draft.days = on ? draft.days.filter((x) => x !== d) : [...draft.days, d])}
              >{LETTER[d]}</button
            >
          {/each}
        </div>
      </div>
    {:else if draft.freq === 'MONTHLY'}
      <div>
        <label class="sr-only" for={`${id}-monthly`}>Which day of the month</label>
        <select
          id={`${id}-monthly`}
          class={`${ctl} w-full`}
          value={draft.monthly.by === 'day' ? 'day' : draft.monthly.nth === -1 ? 'last' : 'nth'}
          onchange={(e) => {
            const v = e.currentTarget.value;
            draft.monthly =
              v === 'day'
                ? { by: 'day', day: Number(start.slice(8, 10)) }
                : { by: 'weekday', nth: v === 'last' ? -1 : monthlyNth.nth, day: monthlyNth.day };
          }}
        >
          <option value="day">Monthly on day {Number(start.slice(8, 10))}</option>
          {#if monthlyNth.nth <= 4}
            <option value="nth"
              >Monthly on the {NTH[monthlyNth.nth - 1]} {DAY[monthlyNth.day]}</option
            >
          {/if}
          {#if monthlyNth.last}
            <option value="last">Monthly on the last {DAY[monthlyNth.day]}</option>
          {/if}
        </select>
      </div>
    {/if}
    <div role="radiogroup" aria-label="Ends" class="flex flex-col gap-2">
      <div class="text-muted">Ends</div>
      <label class="flex items-center gap-2">
        <input
          type="radio"
          name={`${id}-ends`}
          checked={draft.ends.by === 'never'}
          onchange={() => (draft.ends = { by: 'never' })}
        />
        Never
      </label>
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex w-14 items-center gap-2">
          <input
            type="radio"
            name={`${id}-ends`}
            checked={draft.ends.by === 'date'}
            onchange={() => (draft.ends = { by: 'date', date: untilDate })}
          />
          On
        </label>
        <input
          type="date"
          aria-label="Last day"
          class={`${ctl} min-w-0 flex-1`}
          min={start}
          bind:value={untilDate}
          onfocus={() => (draft.ends = { by: 'date', date: untilDate })}
        />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex w-14 items-center gap-2">
          <input
            type="radio"
            name={`${id}-ends`}
            checked={draft.ends.by === 'count'}
            onchange={() => (draft.ends = { by: 'count', count })}
          />
          After
        </label>
        <input
          type="number"
          min="1"
          max="730"
          aria-label="How many times"
          class={`${ctl} w-20`}
          bind:value={count}
          onfocus={() => (draft.ends = { by: 'count', count })}
        />
        <span class="text-muted">times</span>
      </div>
    </div>
    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="h-8 rounded-lg px-3 text-sm text-muted hover:text-ink"
        onclick={() => (custom = false)}>Cancel</button
      >
      <button
        type="button"
        class="h-8 rounded-lg bg-raise px-3 text-sm font-medium hover:bg-sea/25"
        onclick={done}>Done</button
      >
    </div>
  </fieldset>
{/if}
