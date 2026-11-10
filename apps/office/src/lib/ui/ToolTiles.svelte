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
    picked: Agent | 'magpie';
    onpick: (id: Agent) => void;
    /** A tile's one-word state, such as Ready, Sign in or Install. */
    stateOf: (id: Agent) => string;
    /** What the tiles pick, for screen readers. */
    label: string;
    /** Your AI keeps Pi behind Magpie; advanced Odd controls still list real runners. */
    hideBuiltInPi?: boolean;
    /** Magpie is a connection choice, not an Agent value passed to runner APIs. */
    magpie?: { state: string; disabled: boolean; onpick: () => void };
  };
  let { tools, picked, onpick, stateOf, label, magpie, hideBuiltInPi = false }: Props = $props();
</script>

<div
  class="grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-4"
  role="radiogroup"
  aria-label={label}
>
  {#each tools.tools.filter((tool) => !hideBuiltInPi || tool.id !== 'pi') as t (t.id)}
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
  {#if magpie}
    <button
      class="tile"
      class:on={picked === 'magpie'}
      role="radio"
      aria-checked={picked === 'magpie'}
      disabled={magpie.disabled}
      onclick={() => magpie?.onpick()}
    >
      <svg
        class="h-8 w-8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
        ><path
          d="M4 17h5l3-5 3 5h5M7 7l5 5 5-5M4 7h3V4M20 7h-3V4M9 20v-3M15 20v-3"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
      <span class="text-sm font-medium">Magpie</span>
      <span
        class="text-xs"
        class:text-sea={magpie.state === 'Ready'}
        class:text-muted={magpie.state !== 'Ready'}>{magpie.state}</span
      >
    </button>
  {/if}
  {#each tools.later.filter((tool) => !hideBuiltInPi || tool.id !== 'pi') as l (l.id)}
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
  /* One height for every tile, the tallest's: a long name or why never makes one stand taller. */
  .tile {
    display: flex;
    min-block-size: 6.5rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border-radius: 0.75rem;
    background: var(--color-raise);
    padding: 0.5rem;
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
  button.tile:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  button.tile:focus-visible {
    outline: 2px solid var(--color-sea);
    outline-offset: 2px;
  }
  .tile.off {
    opacity: 0.5;
  }
</style>
