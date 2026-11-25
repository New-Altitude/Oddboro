<script lang="ts">
  // ⌘K (Ctrl K off a Mac) from anywhere: a small box to find an Odd by name
  // or role. Up and Down move, Enter opens that Odd as a click on it would,
  // and Esc closes and puts the cursor back where it was.
  import type { Desk } from '@oddboro/ledger';
  import type { StaffProfile } from '../staff/roster.ts';
  import CountBadge from './CountBadge.svelte';
  import Pixel from './Pixel.svelte';
  import { finderKey, findOdds } from './odd-finder.ts';

  type Props = {
    staff: StaffProfile[];
    desk: Desk;
    /** Pokes that landed and the owner has not read, by Odd. */
    messages: Record<string, number>;
    onpick: (id: string) => void;
    onclose: () => void;
  };
  let { staff, desk, messages, onpick, onclose }: Props = $props();

  let typed = $state('');
  let at = $state(0);
  const found = $derived(findOdds(staff, typed));
  const on = $derived(found[Math.min(at, found.length - 1)]);

  const waitingOf = (id: string) =>
    desk.asks.filter((a) => a.staffId === id).length +
    desk.tasks.filter((t) => t.staffId === id).length +
    desk.reports.filter((r) => r.staffId === id).length;

  /** Open as a modal, and give the cursor back to where it was on the way out. */
  function modal(d: HTMLDialogElement) {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    d.showModal();
    return () => {
      if (d.open) d.close();
      if (back?.isConnected) back.focus();
    };
  }

  function keydown(e: KeyboardEvent) {
    const step = finderKey(e.key, at, found.length);
    if (!step) return;
    e.preventDefault();
    if ('to' in step) at = step.to;
    else onpick(found[step.pick].id);
  }
</script>

<dialog
  {@attach modal}
  class="m-auto mt-[15vh] w-[min(28rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl bg-panel-solid p-0 text-ink shadow-float backdrop:bg-night/60"
  aria-label="Find an Odd"
  {onclose}
  onclick={(e) => {
    // A click on the backdrop closes it.
    if (e.target === e.currentTarget) onclose();
  }}
>
  <input
    class="w-full border-b border-hairline bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-faint"
    placeholder="Find an Odd by name or role"
    role="combobox"
    aria-label="Find an Odd"
    aria-expanded="true"
    aria-controls="odd-finder-list"
    aria-autocomplete="list"
    aria-activedescendant={on ? `odd-finder-${on.id}` : undefined}
    autocomplete="off"
    spellcheck="false"
    bind:value={typed}
    oninput={() => (at = 0)}
    onkeydown={keydown}
  />
  <ul id="odd-finder-list" class="max-h-80 overflow-y-auto p-1.5" role="listbox" aria-label="Odds">
    {#each found as p (p.id)}
      {@const waits = waitingOf(p.id)}
      {@const pokes = messages[p.id] ?? 0}
      <!-- The box keeps the keyboard; a click on a row opens it too. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        id={`odd-finder-${p.id}`}
        role="option"
        aria-selected={on?.id === p.id}
        class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 {on?.id === p.id
          ? 'bg-sea/20'
          : 'hover:bg-raise'}"
        onclick={() => onpick(p.id)}
      >
        <Pixel
          src={p.look?.portrait}
          frame={`${p.portrait}/default`}
          fallback={`${p.sprite}@${p.variant}/idle-down-0`}
          scale={1}
          label={p.name}
          class="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-sea-deep"
        />
        <span class="min-w-0 flex-1 truncate text-sm"
          >{p.name} <span class="text-xs text-muted">{p.role}</span></span
        >
        {#if waits}<CountBadge n={waits} tone="waiting" />{/if}
        {#if pokes}<CountBadge n={pokes} tone="unread" />{/if}
      </li>
    {:else}
      <li class="px-2 py-3 text-center text-sm text-muted">No Odd by that name or role.</li>
    {/each}
  </ul>
</dialog>
