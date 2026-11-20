<script lang="ts">
  // The top of a review that steps through the open asks of one kind on the
  // Desk (ReplyReview, FilterReview, EventReview): "Reply 1 of 3 · from
  // Paige", Back and Next, and the arrow keys outside a field. The review
  // itself goes below. `quiet` is for a review that names the Odd itself
  // (EventReview): one faint line, and arrows for Back and Next.
  import type { AskRow } from '@oddboro/ledger';
  import type { Snippet } from 'svelte';
  import { when } from './format.ts';
  import { chatAbout } from './chat-about.svelte.ts';
  import { around } from './review-steps.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  type Props = {
    /** What one of them is called: "Reply", "Filter". */
    label: string;
    ask: AskRow;
    /** Every open ask of this kind on the desk, oldest first. */
    list: AskRow[];
    staff: StaffProfile[];
    busy: boolean;
    /** Open another by its ask id. */
    ongo: (id: number | undefined) => void;
    /** Open an Odd's card. */
    onstaff: (id: string) => void;
    /** The review names the Odd itself: drop "from", and step with arrows. */
    quiet?: boolean;
    children: Snippet;
  };
  let {
    label,
    ask: a,
    list,
    staff,
    busy,
    ongo,
    onstaff,
    quiet = false,
    children
  }: Props = $props();

  const nameOf = (id: string | null) => staff.find((p) => p.id === id)?.name ?? id ?? 'the Odd';
  const here = $derived(around(list, a.id));
  const kind = $derived(label.toLowerCase());

  let view = $state<HTMLElement>();
  /** The arrow keys step through them, unless the cursor is in a field. */
  function onkeydown(e: KeyboardEvent) {
    if (busy || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const focus = document.activeElement;
    // Only while the owner is on this view: the Desk stays mounted behind other windows.
    if (focus && focus !== document.body && !view?.contains(focus)) return;
    if (focus?.closest('input, textarea, select, [contenteditable]')) return;
    if (!view?.checkVisibility()) return;
    const to = e.key === 'ArrowLeft' ? here.prev : here.next;
    if (!to) return;
    e.preventDefault();
    ongo(to.id);
  }
</script>

<svelte:window {onkeydown} />

<div bind:this={view}>
  {#if quiet}
    <div class="flex items-center gap-1 text-[10px] tracking-[0.16em] text-faint uppercase">
      <span class="min-w-0 flex-1 truncate"
        >{label} {here.at + 1} of {list.length} · {when(a.createdAt)}</span
      >
      {#each [{ to: here.prev, word: 'Back', key: '←', d: 'M7.5 2.5 4 6l3.5 3.5' }, { to: here.next, word: 'Next', key: '→', d: 'M4.5 2.5 8 6l-3.5 3.5' }] as step (step.word)}
        <button
          class="flex size-6 items-center justify-center rounded-md text-muted hover:bg-raise hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          disabled={!step.to || busy}
          aria-label={step.word}
          title={`${step.word} (${step.key})`}
          onclick={() => step.to && ongo(step.to.id)}
          ><svg
            class="size-3 rtl:-scale-x-100"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"><path d={step.d} /></svg
          ></button
        >
      {/each}
    </div>
  {:else}
    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1 text-[10px] tracking-[0.16em] uppercase">
        <span class="text-ember">{label} {here.at + 1} of {list.length}</span>
        <span class="text-faint"
          >· from
          <button
            class="tracking-[0.16em] uppercase hover:text-ink"
            onclick={() => onstaff(a.staffId)}>{nameOf(a.staffId)}</button
          >{#if a.via}, from
            <button
              class="tracking-[0.16em] uppercase hover:text-ink"
              title={`Open ${nameOf(a.via)}'s chat`}
              onclick={() => a.via && chatAbout(a.via, '')}>{nameOf(a.via)}</button
            >'s work{/if} · {when(a.createdAt)}</span
        >
      </div>
      <button
        class="rounded-lg bg-raise px-2 py-1 text-xs text-muted hover:text-ink disabled:opacity-40"
        disabled={!here.prev || busy}
        title={`The ${kind} before (←)`}
        onclick={() => here.prev && ongo(here.prev.id)}>Back</button
      >
      <button
        class="rounded-lg bg-raise px-2 py-1 text-xs text-muted hover:text-ink disabled:opacity-40"
        disabled={!here.next || busy}
        title={`The next ${kind} (→)`}
        onclick={() => here.next && ongo(here.next.id)}>Next</button
      >
    </div>
  {/if}
  {@render children()}
</div>
