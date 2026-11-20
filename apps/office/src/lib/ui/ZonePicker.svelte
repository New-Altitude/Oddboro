<script lang="ts">
  // One time zone, picked from the zones this system knows
  // (`Intl.supportedValuesOf`), never typed: a search box over the list, as in
  // setup. The list is built when it opens, once.
  import { zoneLabel } from '#lib/calendar/zones.ts';

  type Props = {
    value: string;
    /** What it is the zone of, for the screen reader: "Start time zone". */
    label: string;
    /** The day the event is on, so each zone shows its offset then. */
    on?: string;
    disabled?: boolean;
  };
  let { value = $bindable(), label, on, disabled = false }: Props = $props();

  let open = $state(false);
  let find = $state('');
  let all = $state<{ zone: string; label: string }[]>([]);
  const at = $derived(on ? new Date(`${on}T12:00:00Z`) : new Date());
  const shown = $derived.by(() => {
    const q = find.trim().toLowerCase().replaceAll(' ', '_');
    const words = find.trim().toLowerCase();
    return q
      ? all.filter((z) => z.zone.toLowerCase().includes(q) || z.label.toLowerCase().includes(words))
      : all;
  });
  function toggle() {
    open = !open;
    find = '';
    if (open && !all.length)
      all = Intl.supportedValuesOf('timeZone')
        .map((zone) => ({ zone, label: zoneLabel(zone, at) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
  }
  const id = $props.id();
</script>

<div class="min-w-0">
  <button
    type="button"
    class="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg bg-raise px-2.5 text-start text-sm text-ink hover:bg-hairline disabled:opacity-40"
    aria-expanded={open}
    aria-label={`${label}: ${value}`}
    {disabled}
    onclick={toggle}
    ><span class="min-w-0 flex-1 truncate">{zoneLabel(value, at)}</span><svg
      class="size-3 shrink-0 text-muted"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg
    ></button
  >
  {#if open}
    <div class="mt-1.5 flex flex-col gap-1.5">
      <label class="sr-only" for={`${id}-find`}>Find a time zone</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id={`${id}-find`}
        class="h-8 rounded-lg bg-raise px-2.5 text-sm outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-sea"
        placeholder="Find a city or zone"
        autofocus
        bind:value={find}
        onkeydown={(e) => {
          if (e.key === 'Escape') open = false;
          if (e.key === 'Enter' && shown[0]) ((value = shown[0].zone), (open = false));
        }}
      />
      <label class="sr-only" for={`${id}-list`}>{label}</label>
      <select
        id={`${id}-list`}
        size="6"
        class="rounded-lg bg-raise px-1 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sea"
        {value}
        onchange={(e) => ((value = e.currentTarget.value), (open = false))}
      >
        {#each shown as z (z.zone)}
          <option value={z.zone}>{z.label}</option>
        {/each}
      </select>
    </div>
  {/if}
</div>
