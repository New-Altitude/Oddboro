<script lang="ts">
  // A section of the pane that folds open in place: a header row with a
  // chevron, and what it holds under it. The header is the section's title, so
  // what it holds starts with no title of its own. The page remembers which are open
  // for each viewer (`folds` in windows.svelte.ts). What it holds loads the
  // first time it opens and stays after it folds, so a drawing keeps going.
  import { tick, type Snippet } from 'svelte';
  import { folds, setFold, type Fold } from './windows.svelte.ts';

  type Props = {
    id: Fold;
    title: string;
    /** A count after the title, as "Waiting (3)". */
    count?: number;
    /** Something in it is still drawing. */
    busy?: boolean;
    /** Buttons at the end of the header row, such as + Hire. */
    actions?: Snippet;
    /** Classes for the open body, such as a fixed height. */
    body?: string;
    children: Snippet;
  };
  let { id, title, count, busy = false, actions, body = '', children }: Props = $props();

  const isOpen = $derived(folds.open[id]);
  let seen = $state(false);
  $effect.pre(() => {
    if (isOpen) seen = true;
  });

  let head: HTMLElement | undefined = $state();
  // Asked to show itself, from a shortcut or another window: scroll to it, once.
  $effect(() => {
    if (folds.reveal !== id) return;
    folds.reveal = undefined;
    void tick().then(() => head?.scrollIntoView({ block: 'start' }));
  });
</script>

<section class="border-t border-hairline first:border-t-0" aria-labelledby={`fold-${id}`}>
  <div bind:this={head} class="flex items-center gap-2 px-3 py-1.5">
    <button
      id={`fold-${id}`}
      class="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 text-start font-pixel text-lg leading-none text-ink hover:text-sea"
      aria-expanded={isOpen}
      aria-controls={`fold-${id}-body`}
      onclick={() => setFold(id, !isOpen)}
    >
      <svg
        class="size-3.5 shrink-0 text-muted transition-transform rtl:-scale-x-100 {isOpen
          ? 'rotate-90'
          : ''}"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg
      >
      <span class="truncate">{count === undefined ? title : `${title} (${count})`}</span>
      {#if busy}<span class="busy ms-1" aria-label="drawing"></span>{/if}
    </button>
    {@render actions?.()}
  </div>
  {#if seen}
    <div id={`fold-${id}-body`} class={body} class:hidden={!isOpen}>
      {@render children()}
    </div>
  {/if}
</section>

<style>
  /* A section still drawing: a pixel square that blinks. */
  .busy {
    display: inline-block;
    inline-size: 6px;
    block-size: 6px;
    background: var(--color-sea);
    animation: busy 0.8s steps(1) infinite;
  }
  @keyframes busy {
    50% {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .busy {
      animation: none;
    }
  }
</style>
