<script lang="ts">
  import type { Schedule, Weekday } from '@oddboro/ledger';
  import { SCHEDULE_RULE, WEEKDAYS, zoneName, zoneShort } from '@oddboro/ledger/time';

  /** How often a job runs, in the office's time zone. */
  let { value = $bindable() }: { value: Schedule } = $props();

  let every = $state<Schedule['every']>(value.every);
  let n = $state(value.every === 'minutes' ? value.n : 60);
  let at = $state(value.every === 'minutes' ? '07:00' : value.at);
  let day = $state<Weekday>(value.every === 'week' ? value.day : 'Mon');
  const { ownerMinMinutes: least, ownerMaxMinutes: most } = SCHEDULE_RULE;

  $effect(() => {
    value =
      every === 'minutes'
        ? { every, n: Math.max(least, Math.round(n || least)) }
        : every === 'week'
          ? { every, day, at }
          : { every, at };
  });
  // 1440 is the minutes in a day, not the rule's longest gap, though the two are equal today.
  const perDay = $derived(every === 'minutes' ? Math.floor(1440 / Math.max(least, n || least)) : 1);
</script>

<div class="flex flex-wrap items-center gap-2 text-sm">
  <select
    class="rounded-lg bg-raise px-2 py-1.5 outline-none"
    bind:value={every}
    aria-label="How often"
  >
    <option value="minutes">Every</option>
    <option value="day">Every day at</option>
    <option value="weekday">Weekdays at</option>
    <option value="week">Once a week, on</option>
  </select>
  {#if every === 'week'}
    <select
      class="rounded-lg bg-raise px-2 py-1.5 outline-none"
      bind:value={day}
      aria-label="Day of the week"
    >
      {#each WEEKDAYS as d (d)}
        <option value={d}>{d}</option>
      {/each}
    </select>
  {/if}
  {#if every === 'minutes'}
    <input
      type="number"
      min={least}
      max={most}
      step="5"
      class="w-20 rounded-lg bg-raise px-2 py-1.5 outline-none"
      bind:value={n}
      aria-label="Minutes between runs"
    />
    <span class="text-muted">minutes</span>
  {:else}
    <input
      type="time"
      class="rounded-lg bg-raise px-2 py-1.5 outline-none"
      bind:value={at}
      aria-label={`Time, ${zoneName()}`}
    />
    <span class="text-muted">{zoneShort()}</span>
  {/if}
</div>
<p class="mt-1 text-[11px] text-faint">
  {perDay} run{perDay === 1 ? '' : 's'}
  {every === 'week' ? 'a week' : 'a day'}{every === 'weekday' ? ', Monday to Friday' : ''}. Each run
  uses your Claude plan.
</p>
