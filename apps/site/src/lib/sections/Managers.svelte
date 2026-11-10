<script lang="ts">
  // The four Office Managers as character cards, with their real portraits
  // and their walk, plus the card for describing your own. While a card is
  // pointed at or keyboard focused its manager walks and blinks, and stands
  // with open eyes again on leaving; picking one by tap takes two steps. The card
  // is a list item with a heading; the button inside it covers the whole card.
  import SectionHeader from '#lib/components/SectionHeader.svelte';
  import { awake, stagger } from '#lib/motion/index.ts';
  import { MANAGERS } from '#lib/managers.ts';

  let picked = $state<string | undefined>();
  const pick = (id: string) => (picked = picked === id ? undefined : id);
</script>

<SectionHeader
  eyebrow="Managers"
  title="Meet your Office Manager."
  lede="Your first Odd runs the floor, writes your daily report, and helps you hire everyone else. Pick one of these four, or describe your own and the office draws them."
/>

<div class="-mx-4 mt-12 sm:mx-0">
  <ul
    use:stagger={{ step: 90 }}
    class="flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pt-2 pb-2 sm:grid sm:pt-0 sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:max-w-[640px] md:max-w-none lg:grid-cols-3 lg:max-[1152px]:max-w-[960px] xl:grid-cols-5"
    aria-label="Office Managers"
  >
    {#each MANAGERS as m (m.id)}
      {@const on = picked === m.id}
      <li
        class="manager bg-raise border-hairline rounded-card group hover:bg-panel-solid relative flex w-[78%] max-w-[324px] min-w-[284px] shrink-0 sm:max-w-none sm:min-w-0 snap-center flex-col border p-5 sm:w-auto {on
          ? 'ring-sea ring-2'
          : ''}"
        data-picked={on}
        use:awake
      >
        <div class="flex items-start justify-between">
          <div class="relative">
            <img
              src="/art/portrait-{m.id}.png"
              alt="{m.name}'s portrait"
              width="96"
              height="96"
              class="pixel rounded-md"
              draggable="false"
            />
            <img
              src="/art/portrait-{m.id}-blink.png"
              alt=""
              aria-hidden="true"
              width="96"
              height="96"
              class="blink-frame pixel absolute inset-0 rounded-md"
              draggable="false"
            />
          </div>
          <div class="pixel h-24 w-12 overflow-hidden" aria-hidden="true">
            <img
              src="/art/walk-{m.id}.png"
              alt=""
              width="192"
              height="96"
              class="walk-strip max-w-none"
              draggable="false"
            />
          </div>
        </div>
        <h3 class="font-pixel text-ink mt-4 text-2xl">{m.name}</h3>
        <p class="text-sea mt-1 text-xs font-semibold tracking-wide uppercase">{m.trait}</p>
        <p class="bubble text-muted mt-4 mb-4 text-[15px] text-pretty leading-relaxed">{m.says}</p>
        <button
          type="button"
          class="mt-auto flex w-full items-center justify-center gap-1.5 rounded-md border px-3.5 py-1.5 text-sm font-semibold transition-opacity group-hover:opacity-90 after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] {on
            ? 'border-sea text-sea'
            : 'border-sea bg-sea text-night'}"
          aria-pressed={on}
          onclick={() => pick(m.id)}
        >
          {#if on}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
              shape-rendering="crispEdges"
            >
              <path
                d="M10 2h1v2h-1v1H9v1H8v1H7v1H6v1H5v1H4V9H3V8H2V7H1V5h2v1h1v1h1V6h1V5h1V4h1V3h1V2z"
                fill="currentColor"
              />
            </svg>
            Your pick
          {:else}
            Pick
          {/if}
          <span class="sr-only">{m.name}</span>
        </button>
      </li>
    {/each}
    <li
      class="border-faint/60 rounded-card flex w-[78%] max-w-[324px] min-w-[284px] shrink-0 sm:max-w-none sm:min-w-0 snap-center flex-col border border-dashed p-5 text-start sm:w-auto"
    >
      <svg
        width="96"
        height="96"
        viewBox="0 0 12 12"
        class="text-sea rounded-md"
        aria-hidden="true"
        shape-rendering="crispEdges"
      >
        <rect width="12" height="12" fill="var(--color-night)" />
        <path
          d="M4 3h4v1h1v2H8v1H7v1H5V6h1V5h1V4H4z M5 9h2v2H5z"
          fill="currentColor"
          fill-rule="evenodd"
        />
      </svg>
      <h3 class="font-pixel text-ink mt-4 text-2xl">Describe your own.</h3>
      <p class="text-muted mt-4 text-[15px] leading-relaxed">
        Tell the office how they work, and it writes their job description. Build their look from
        parts, or have the office draw them.
      </p>
      <p class="text-faint mt-auto pt-4 text-xs">
        Drawing needs Claude Opus or Fable, or Codex on Sol or Astra.
      </p>
    </li>
  </ul>
</div>

<style>
  /* The whole card is the button's target, so the focus ring draws on the card. */
  .manager:has(button:focus-visible) {
    outline: 2px solid var(--color-sea);
    outline-offset: 3px;
  }
  .manager button:focus-visible {
    outline: none;
  }
  .bubble {
    position: relative;
    padding: 0.75rem 0.9rem;
    border: 1px solid var(--color-hairline);
    border-radius: 12px;
    border-start-start-radius: 2px;
    background: var(--color-panel);
  }
</style>
