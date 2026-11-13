<script lang="ts">
  // Every Odd at the Office level of the pane, with what each waits on you
  // for. It takes the rail's place: a click goes down to that Odd, and ⌘K
  // (Ctrl K off a Mac) puts the cursor in its search. The owner shows them
  // as portraits with names, or as portraits alone, and the page remembers.
  import type { Desk } from '@oddboro/ledger';
  import type { StaffProfile } from '../staff/roster.ts';
  import Pixel from './Pixel.svelte';
  import { waitingOf } from './office-status.ts';

  type Props = {
    staff: StaffProfile[];
    desk: Desk;
    /** Pokes that landed and the owner has not read, by Odd. */
    messages: Record<string, number>;
    /** Bumps to put the cursor in the search. */
    find: number;
    /** No window is open under it, so the list takes the whole pane. */
    fill?: boolean;
    onselect: (id: string) => void;
  };
  let { staff, desk, messages, find, fill = false, onselect }: Props = $props();

  type View = 'names' | 'portraits';
  const VIEW_KEY = 'oddboro.odds.view';
  let view = $state<View>('names');
  try {
    if (localStorage.getItem(VIEW_KEY) === 'portraits') view = 'portraits';
  } catch {
    // Private window: the list shows names.
  }
  function setView(v: View) {
    view = v;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private window: the view holds for this visit only.
    }
  }

  let query = $state('');
  let box: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (find) {
      setView('names');
      box?.focus();
    }
  });

  const rows = $derived(
    staff
      .filter((p) => {
        const q = query.trim().toLowerCase();
        return !q || [p.name, p.role].some((w) => w.toLowerCase().includes(q));
      })
      .map((p) => ({ p, waits: waitingOf(desk, p.id), pokes: messages[p.id] ?? 0 }))
  );

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && rows.length) onselect(rows[0].p.id);
  }

  /** What the portrait alone says on hover: the name, and what waits. */
  const hover = (p: StaffProfile, waits: unknown[]) =>
    `${p.name}, ${p.role}${waits.length ? `. ${waits.length} waiting on you` : ''}`;
</script>

{#snippet portrait(p: StaffProfile, waiting: boolean, size: string)}
  <Pixel
    src={p.look?.portrait}
    frame={`${p.portrait}/default`}
    fallback={`${p.sprite}@${p.variant}/idle-down-0`}
    scale={1}
    label={p.name}
    class="flex {size} shrink-0 items-center justify-center overflow-hidden rounded-md bg-sea-deep {waiting
      ? 'ring-2 ring-ember'
      : ''}"
  />
{/snippet}

<section
  class="flex min-h-0 flex-col border-t border-hairline px-3 pt-3 pb-2 {fill ? 'flex-1' : ''}"
  aria-label="Your Odds"
>
  <div class="flex items-center gap-2">
    <h3 class="flex-1 text-[10px] tracking-[0.16em] text-muted uppercase">Your Odds</h3>
    {#if view === 'names' && staff.length > 4}
      <input
        bind:this={box}
        bind:value={query}
        onkeydown={keydown}
        class="w-32 rounded-lg bg-raise px-2 py-1 text-xs text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-sea"
        placeholder="Find an Odd"
        aria-label="Find an Odd"
      />
    {/if}
    <div class="flex rounded-lg bg-raise p-0.5" role="group" aria-label="Show Odds as">
      <button
        class="rounded-md px-1.5 py-0.5 {view === 'names'
          ? 'bg-sea/25 text-ink'
          : 'text-muted hover:text-ink'}"
        aria-pressed={view === 'names'}
        aria-label="Portraits and names"
        title="Portraits and names"
        onclick={() => setView('names')}
        ><svg class="size-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
          ><rect x="1" y="2" width="4" height="4" rx="1" /><rect
            x="7"
            y="3"
            width="8"
            height="2"
            rx="1"
          /><rect x="1" y="10" width="4" height="4" rx="1" /><rect
            x="7"
            y="11"
            width="8"
            height="2"
            rx="1"
          /></svg
        ></button
      >
      <button
        class="rounded-md px-1.5 py-0.5 {view === 'portraits'
          ? 'bg-sea/25 text-ink'
          : 'text-muted hover:text-ink'}"
        aria-pressed={view === 'portraits'}
        aria-label="Portraits only"
        title="Portraits only"
        onclick={() => setView('portraits')}
        ><svg class="size-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
          ><rect x="1" y="1" width="6" height="6" rx="1" /><rect
            x="9"
            y="1"
            width="6"
            height="6"
            rx="1"
          /><rect x="1" y="9" width="6" height="6" rx="1" /><rect
            x="9"
            y="9"
            width="6"
            height="6"
            rx="1"
          /></svg
        ></button
      >
    </div>
  </div>

  {#if view === 'portraits'}
    <ul class="mt-2 flex flex-wrap gap-2 overflow-y-auto {fill ? '' : 'max-h-40'}">
      {#each rows as { p, waits } (p.id)}
        <li>
          <button
            class="relative block rounded-lg p-0.5 hover:bg-sea/15"
            title={hover(p, waits)}
            aria-label={hover(p, waits)}
            onclick={() => onselect(p.id)}
          >
            {@render portrait(p, waits.length > 0, 'size-10')}
            {#if waits.length}
              <span
                class="absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-ember font-pixel text-[10px] text-night"
                >{waits.length}</span
              >
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <ul class="mt-2 flex flex-col gap-1 overflow-y-auto {fill ? '' : 'max-h-56'}">
      {#each rows as { p, waits, pokes } (p.id)}
        <li>
          <button
            class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-sea/15"
            onclick={() => onselect(p.id)}
          >
            {@render portrait(p, waits.length > 0, 'size-7')}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm text-ink"
                >{p.name} <span class="text-xs text-muted">{p.role}</span></span
              >
              {#if waits.length}
                <span class="block truncate text-xs text-ember"
                  >{waits.length} waiting: {waits[0].title}</span
                >
              {:else if pokes}
                <span class="block truncate text-xs text-sea"
                  >{pokes} new {pokes === 1 ? 'message' : 'messages'}</span
                >
              {:else}
                <span class="block truncate text-xs text-faint">Nothing waiting on you</span>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
