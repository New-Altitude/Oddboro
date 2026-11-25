<script lang="ts">
  // Your Odds, on the Odds tab under Waiting: every Odd with what it waits on
  // you for and what it said that you have not read. A click goes down to that
  // Odd, + Hire opens a hire, and the box filters the list in place. The owner
  // shows them as portraits with names, or as portraits alone, and the page
  // remembers.
  import type { Desk } from '@oddboro/ledger';
  import type { StaffProfile } from '../staff/roster.ts';
  import CountBadge from './CountBadge.svelte';
  import Fold from './Fold.svelte';
  import Pixel from './Pixel.svelte';
  import { folds } from './windows.svelte.ts';

  type Props = {
    staff: StaffProfile[];
    desk: Desk;
    /** Pokes that landed and the owner has not read, by Odd. */
    messages: Record<string, number>;
    onselect: (id: string) => void;
    onhire: () => void;
    /** Opens the ⌘K finder. */
    onfind: () => void;
  };
  let { staff, desk, messages, onselect, onhire, onfind }: Props = $props();

  /** The shortcut as this system names it: ⌘K until the page knows it is not on a Mac. */
  let mac = $state(true);
  $effect(() => {
    mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  });
  const keyLabel = $derived(mac ? '⌘K' : 'Ctrl K');

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

  /** What each Odd has waiting on the owner, oldest first: asks, tasks, then unread reports. */
  const waitingOf = (id: string) =>
    [
      ...desk.asks.filter((a) => a.staffId === id),
      ...desk.tasks.filter((t) => t.staffId === id),
      ...desk.reports.filter((r) => r.staffId === id)
    ].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const rows = $derived(
    staff
      .filter((p) => {
        const q = query.trim().toLowerCase();
        return !q || [p.name, p.role].some((w) => w.toLowerCase().includes(q));
      })
      .map((p) => ({ p, waits: waitingOf(p.id), pokes: messages[p.id] ?? 0 }))
  );

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && rows.length) onselect(rows[0].p.id);
  }

  /** What the portrait alone says on hover: the name, what waits, and what is unread. */
  const hover = (p: StaffProfile, waits: unknown[], pokes: number) =>
    `${p.name}, ${p.role}${waits.length ? `. ${waits.length} waiting on you` : ''}${pokes ? `. ${pokes} unread` : ''}`;
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

{#snippet counts(waits: number, pokes: number)}
  {#if waits}<CountBadge n={waits} tone="waiting" />{/if}
  {#if pokes}<CountBadge n={pokes} tone="unread" />{/if}
{/snippet}

{#snippet actions()}
  <!-- On the title's row: the finder's shortcut, how the list shows (while it is
       open), and + Hire in teal. -->
  <button
    class="shrink-0 rounded-md border border-hairline px-1.5 py-0.5 text-xs text-muted hover:border-sea/60 hover:text-ink"
    title={`Find an Odd (${keyLabel})`}
    aria-label={`Find an Odd, ${keyLabel}`}
    aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
    onclick={onfind}><kbd class="font-sans">{keyLabel}</kbd></button
  >
  {#if folds.open.odds}
    <div class="flex rounded-lg bg-raise p-0.5" role="group" aria-label="Show Odds as">
      <button
        class="rounded-md px-2 py-1 {view === 'names'
          ? 'bg-sea/25 text-ink'
          : 'text-muted hover:text-ink'}"
        aria-pressed={view === 'names'}
        aria-label="Portraits and names"
        title="Portraits and names"
        onclick={() => setView('names')}
        ><svg class="size-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
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
        class="rounded-md px-2 py-1 {view === 'portraits'
          ? 'bg-sea/25 text-ink'
          : 'text-muted hover:text-ink'}"
        aria-pressed={view === 'portraits'}
        aria-label="Portraits only"
        title="Portraits only"
        onclick={() => setView('portraits')}
        ><svg class="size-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
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
  {/if}
  <button
    class="shrink-0 rounded-lg bg-sea px-3 py-1 text-sm font-medium text-night hover:bg-sea/80"
    onclick={onhire}>+ Hire</button
  >
{/snippet}

<Fold id="odds" title="Your Odds" count={staff.length} {actions} body="px-3 pb-2">
  {#if view === 'names' && staff.length > 4}
    <input
      bind:value={query}
      onkeydown={keydown}
      class="w-full rounded-lg bg-raise px-2 py-1 text-xs text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-sea"
      placeholder="Find an Odd"
      aria-label="Find an Odd"
    />
  {/if}

  {#if view === 'portraits'}
    <ul class="mt-2 flex flex-wrap gap-2">
      {#each rows as { p, waits, pokes } (p.id)}
        <li>
          <button
            class="relative block rounded-lg p-0.5 hover:bg-sea/15"
            title={hover(p, waits, pokes)}
            aria-label={hover(p, waits, pokes)}
            onclick={() => onselect(p.id)}
          >
            {@render portrait(p, waits.length > 0, 'size-10')}
            {#if waits.length}
              <span
                class="absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-ember font-pixel text-[10px] text-night"
                aria-hidden="true">{waits.length}</span
              >
            {/if}
            {#if pokes}
              <span
                class="absolute -end-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-sea font-pixel text-[10px] text-night"
                aria-hidden="true">{pokes}</span
              >
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <ul class="mt-2 flex flex-col gap-1">
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
                <span class="block truncate text-xs text-ember">Waiting: {waits[0].title}</span>
              {:else if pokes}
                <span class="block truncate text-xs text-sea"
                  >{pokes === 1 ? 'A new message' : 'New messages'}</span
                >
              {:else}
                <span class="block truncate text-xs text-faint">Nothing waiting on you</span>
              {/if}
            </span>
            {@render counts(waits.length, pokes)}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Fold>
