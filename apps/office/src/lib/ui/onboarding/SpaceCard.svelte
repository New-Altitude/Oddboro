<script lang="ts">
  // What the office should be. Quick: Main Street, the sample, which needs no drawing
  // and is the default. Custom: a line or two in the owner's words, or a chip
  // that writes it for them. The drawing starts the moment they move on and
  // keeps going while they finish.
  type Props = {
    description: string;
    mainStreet: boolean;
    /** A drawing already under way, from words given earlier. */
    drawing: boolean;
    /** False on Sonnet, which cannot design an office: Main Street only. */
    canDraw: boolean;
    onnext: () => void;
    onback: () => void;
  };
  let {
    description = $bindable(),
    mainStreet = $bindable(),
    drawing,
    canDraw,
    onnext,
    onback
  }: Props = $props();

  const CHIPS = [
    'A small studio: my office, a workspace for four, a kitchen and a couch.',
    'A loft: brick, big windows, two workspaces, a library and a gym.',
    'A lodge: timber walls, a stone fireplace, a library, a kitchen, woods all round.',
    'A campus: every kind of room, roomy, with woods around it.'
  ];
</script>

<p class="text-lg font-semibold">Pick your office.</p>
<p class="mt-1 text-sm text-muted">
  Start on Main Street, or describe your own and the office draws it.
</p>

<!-- One list, in two brackets, the way the manager card has them: the quick way first. -->
<div class="mt-3 grid gap-3" role="radiogroup" aria-label="Office">
  <div class="group-quick">
    <div class="mb-1.5 text-[10px] tracking-[0.14em] text-sea uppercase">Quick</div>
    <button
      class="option w-full"
      role="radio"
      aria-checked={mainStreet}
      class:on={mainStreet}
      disabled={drawing}
      onclick={() => {
        mainStreet = true;
        description = '';
      }}
    >
      <span class="flex items-baseline gap-2">
        <span class="font-pixel text-base leading-none">Main Street</span>
        <span class="text-[10px] tracking-[0.08em] text-sea uppercase">Default</span>
      </span>
      <span class="mt-1 block text-xs leading-snug text-muted">
        Ready now. Redesign it any time under Layout, on the Office tab.
      </span>
    </button>
  </div>
  <div class="group-custom">
    <div class="mb-1.5 text-[10px] tracking-[0.14em] text-muted uppercase">
      Custom (1-2 minutes)
    </div>
    <label class="sr-only" for="onboarding-space">The office you want</label>
    <textarea
      id="onboarding-space"
      class="field min-h-20 w-full resize-none"
      maxlength="1500"
      placeholder="Rooms, size, the feel. Two sentences is plenty."
      disabled={drawing || !canDraw}
      bind:value={description}
      oninput={() => (mainStreet = !description.trim())}></textarea>
    <div class="mt-2 flex flex-wrap gap-1.5">
      {#each CHIPS as c (c)}
        <button
          class="chip"
          role="radio"
          aria-checked={!mainStreet && description === c}
          class:on={!mainStreet && description === c}
          disabled={drawing || !canDraw}
          onclick={() => {
            description = c;
            mainStreet = false;
          }}>{c.split(':')[0]}</button
        >
      {/each}
    </div>
    {#if drawing}
      <p class="mt-2 text-xs text-faint">The office is already drawing this one.</p>
    {:else if !canDraw}
      <p class="mt-2 text-xs text-ember">
        On Sonnet the office cannot design one, so you start on Main Street. Pick Opus on Your
        Claude to describe your own.
      </p>
    {/if}
  </div>
</div>

<div class="mt-4 flex items-center gap-3">
  <button class="btn ghost" onclick={onback}>Back</button>
  <span class="flex-1"></span>
  <button class="btn primary" disabled={!mainStreet && !description.trim()} onclick={onnext}
    >Next</button
  >
</div>

<style>
  .option {
    display: block;
    border: 1px solid var(--color-hairline);
    border-radius: 0.75rem;
    background: var(--color-raise);
    padding: 0.5rem 0.75rem;
    text-align: start;
    transition: transform 160ms;
  }
  .option:hover {
    transform: translateX(2px);
  }
  :global([dir='rtl']) .option:hover {
    transform: translateX(-2px);
  }
  .option:disabled {
    opacity: 0.5;
    transform: none;
  }
  .option.on {
    border-color: var(--color-sea);
    background: color-mix(in srgb, var(--color-sea) 12%, transparent);
  }
  /* The bracket: a line down the start side of each group. */
  .group-quick,
  .group-custom {
    border-inline-start: 2px solid var(--color-hairline);
    padding-inline-start: 0.6rem;
  }
  .group-quick {
    border-inline-start-color: color-mix(in srgb, var(--color-sea) 50%, transparent);
  }
</style>
