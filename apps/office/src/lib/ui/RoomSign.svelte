<script lang="ts">
  import PixelIcon from './PixelIcon.svelte';
  import type { Label } from './floor-crew.svelte.ts';

  // One room's sign over the floor, with the pencil that renames the room. The
  // page holds the rename, so only one room renames at a time.

  type Props = {
    label: Label;
    /** This room is the one being renamed. */
    renaming: boolean;
    /** The name as the owner types it. */
    draft: string;
    /** Why the last save failed, if it did. */
    problem: string;
    oninput: (name: string) => void;
    onsave: () => void;
    onkeydown: (e: KeyboardEvent) => void;
    onrename: () => void;
  };

  let { label, renaming, draft, problem, oninput, onsave, onkeydown, onrename }: Props = $props();
</script>

<div
  class="absolute origin-top-left flex items-center gap-[0.5em] font-pixel text-[11px] tracking-[0.2em] whitespace-nowrap text-ink/55 uppercase"
  style="transform: translate({label.x}px, {label.y}px) scale({label.scale}) translateY(-50%); max-inline-size: {label.width}px"
>
  {#if renaming}
    <form
      class="pointer-events-auto flex flex-col gap-1"
      novalidate
      onsubmit={(e) => {
        e.preventDefault();
        onsave();
      }}
    >
      <input
        class="rename w-[16em] rounded bg-night/80 px-1.5 py-0.5 font-pixel tracking-[0.2em] text-ink uppercase outline-none"
        aria-label="Room name"
        maxlength="40"
        {@attach (n) => n.select()}
        value={draft}
        oninput={(e) => oninput(e.currentTarget.value)}
        {onkeydown}
        onblur={onsave}
      />
      {#if problem}
        <span class="font-sans text-xs tracking-normal text-coral normal-case">{problem}</span>
      {/if}
    </form>
  {:else}
    <span class="min-w-0 truncate">{label.name}</span>
    <button
      class="pointer-events-auto -m-1 p-1 opacity-70 hover:text-ink hover:opacity-100 focus-visible:text-ink focus-visible:opacity-100"
      aria-label={`Rename ${label.name}`}
      title="Rename"
      onclick={onrename}><PixelIcon name="pencil" /></button
    >
  {/if}
</div>

<style>
  .rename {
    box-shadow: 0 0 0 1px var(--color-sea);
    font-size: inherit;
  }
</style>
