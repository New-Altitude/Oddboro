<script lang="ts">
  // The guests on an event, as chips that wrap: each one's name or address,
  // an Optional switch, and a remove button. Typed or pasted addresses join
  // on a comma, space or Enter. A guest taken off an event they were on waits
  // under "Removing" (Google emails them a cancellation) and can be put back
  // before the click. The owner is the organiser, never a chip.
  import { addressesIn, isAddress } from '#lib/calendar/event.ts';
  import { nameOf, type Guest } from '#lib/calendar/event-card.ts';

  type Props = {
    guests: Guest[];
    removed: Guest[];
    /** The account's own address: the organiser. */
    organiser?: string;
    /** Mark a guest the change adds as new: off for a new event, where every guest is. */
    marknew?: boolean;
    disabled?: boolean;
  };
  let {
    guests = $bindable(),
    removed = $bindable(),
    organiser,
    marknew = false,
    disabled = false
  }: Props = $props();

  let typed = $state('');
  let wrong = $state('');
  const own = $derived(organiser?.toLowerCase());
  const has = (list: Guest[], e: string) =>
    list.some((g) => g.email.toLowerCase() === e.toLowerCase());

  /** Take every address in the box; whatever is not one stays there to fix. */
  function take(text = typed) {
    const words = addressesIn(text);
    const bad: string[] = [];
    for (const w of words) {
      if (!isAddress(w)) {
        bad.push(w);
        continue;
      }
      if (w.toLowerCase() === own || has(guests, w)) continue;
      const back = removed.find((g) => g.email.toLowerCase() === w.toLowerCase());
      if (back) {
        removed = removed.filter((g) => g !== back);
        guests = [...guests, back];
      } else guests = [...guests, { email: w, optional: false, existing: false }];
    }
    typed = bad.join(' ');
    wrong = bad.length ? `Not an email address: ${bad.join(', ')}` : '';
  }
  function remove(g: Guest) {
    guests = guests.filter((x) => x !== g);
    if (g.existing) removed = [...removed, g];
  }
  function putBack(g: Guest) {
    removed = removed.filter((x) => x !== g);
    guests = [...guests, g];
  }
  const id = $props.id();
</script>

<div class="flex flex-col gap-2">
  {#if organiser}
    <div class="flex min-w-0 items-center gap-2 text-xs text-muted">
      <span class="truncate">Organiser: {organiser} (you)</span>
    </div>
  {/if}
  {#if guests.length}
    <ul class="flex flex-wrap gap-1.5" aria-label="Guests">
      {#each guests as g (g.email)}
        <li
          class="flex h-7 max-w-full min-w-0 items-center gap-1 rounded-full bg-raise ps-2.5 pe-1 text-xs"
          title={g.email}
        >
          <span class="min-w-0 truncate text-ink">{nameOf(g)}</span>
          {#if marknew && !g.existing}<span class="shrink-0 text-faint">new</span>{/if}
          <button
            type="button"
            class="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] {g.optional
              ? 'bg-sea/25 text-ink'
              : 'text-faint hover:text-ink'}"
            aria-pressed={g.optional}
            aria-label={`${nameOf(g)} is optional`}
            {disabled}
            onclick={() => (g.optional = !g.optional)}>Optional</button
          >
          <button
            type="button"
            class="flex size-5 shrink-0 items-center justify-center rounded-full text-faint hover:bg-coral/25 hover:text-ink"
            aria-label={`Remove ${nameOf(g)}`}
            {disabled}
            onclick={() => remove(g)}
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
  <label class="sr-only" for={`${id}-add`}>Add guests</label>
  <input
    id={`${id}-add`}
    class="h-8 w-full min-w-0 rounded-lg bg-raise px-2.5 text-sm outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-sea"
    placeholder="Add guests by email"
    autocomplete="off"
    {disabled}
    bind:value={typed}
    onkeydown={(e) => {
      if (
        e.key === 'Enter' ||
        e.key === ',' ||
        e.key === ';' ||
        (e.key === ' ' && typed.includes('@'))
      ) {
        if (!typed.trim()) return;
        e.preventDefault();
        take();
      }
    }}
    onpaste={(e) => {
      const text = e.clipboardData?.getData('text') ?? '';
      if (!/[\s,;]/.test(text.trim())) return;
      e.preventDefault();
      take(`${typed} ${text}`);
    }}
    onblur={() => typed.trim() && take()}
  />
  {#if wrong}<p class="text-xs text-coral">{wrong}</p>{/if}
  {#if removed.length}
    <div class="rounded-lg border border-hairline px-2.5 py-2 text-xs">
      <div class="text-muted">Removing. Google emails each a cancellation.</div>
      <ul class="mt-1 flex flex-col gap-1">
        {#each removed as g (g.email)}
          <li class="flex min-w-0 items-center gap-2">
            <span
              class="min-w-0 flex-1 truncate text-ink line-through decoration-faint"
              title={g.email}>{nameOf(g)}</span
            >
            <button
              type="button"
              class="shrink-0 text-sea hover:text-ink"
              {disabled}
              onclick={() => putBack(g)}>Put back</button
            >
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
