<script lang="ts">
  // A tile for every coding tool, all one height, with its maker's mark: setup's Your
  // AI (OfficeTools.svelte), where the pick is the office's tool, and an Odd's
  // Model tab, where it is that Odd's. A tile this system offers picks; one it
  // does not offer yet is greyed, with why. The caller says each tile's
  // one-word state, since what Ready means differs between the two.
  import type { Agent } from '@oddboro/ledger/agents';
  import type { AgentTools } from './agent-tools.svelte.ts';
  import { LOGOS } from './tool-logos.ts';

  type Props = {
    tools: AgentTools;
    /** The tool picked now. */
    picked: Agent;
    onpick: (id: Agent) => void;
    /** A tile's one-word state, such as Ready, Sign in or Install. */
    stateOf: (id: Agent) => string;
    /** What the tiles pick, for screen readers. */
    label: string;
  };
  let { tools, picked, onpick, stateOf, label }: Props = $props();
</script>

<div
  class="grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-4"
  role="radiogroup"
  aria-label={label}
>
  {#each tools.tools as t (t.id)}
    {@const on = picked === t.id}
    {@const state = stateOf(t.id)}
    <button
      class="tile"
      class:on
      role="radio"
      aria-checked={on}
      onclick={() => !on && onpick(t.id)}
    >
      <svg class="h-8 w-8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
        ><path fill-rule="evenodd" d={LOGOS[t.id]} /></svg
      >
      <span class="text-sm font-medium">{t.name}</span>
      <span class="text-xs" class:text-sea={state === 'Ready'} class:text-muted={state !== 'Ready'}
        >{state}</span
      >
    </button>
  {/each}
  {#each tools.later as l (l.id)}
    <div class="tile off" role="radio" aria-checked="false" aria-disabled="true" title={l.why}>
      <svg class="h-8 w-8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
        ><path fill-rule="evenodd" d={LOGOS[l.id]} /></svg
      >
      <span class="text-sm font-medium">{l.name}</span>
      <span class="text-xs text-muted">{l.why.startsWith('Coming') ? 'Coming soon' : l.why}</span>
    </div>
  {/each}
</div>

<style>
  /* One height for every tile, the tallest's: a long name or why never makes one stand taller.
     Each tile stacks from the top, so the marks and names line up across a row even when a
     narrow panel wraps one tile's name or why onto two lines. */
  .tile {
    display: flex;
    min-block-size: 6.5rem;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    border-radius: 0.75rem;
    background: var(--color-raise);
    padding-block: 0.75rem;
    padding-inline: 0.5rem;
    text-align: center;
    color: var(--color-ink);
  }
  button.tile:hover {
    box-shadow: inset 0 0 0 1px var(--color-hairline);
  }
  .tile.on,
  button.tile.on:hover {
    box-shadow: inset 0 0 0 2px var(--color-sea);
  }
  .tile.off {
    opacity: 0.5;
  }
</style>
