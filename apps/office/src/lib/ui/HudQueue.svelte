<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import type { HudItem } from './hud-items.ts';
  import { chord, keyLabel, type HudKeys } from './hud-keys.ts';
  let {
    items,
    keys,
    position = $bindable(),
    busy,
    action
  }: {
    items: HudItem[];
    keys: HudKeys;
    position: { id: string; index: number };
    busy: boolean;
    action: Snippet<[HudItem]>;
  } = $props();
  let list = $state<HTMLDivElement>(),
    detail = $state<HTMLElement>();
  const chats = $derived(items.filter((i) => i.waitingChat).length);
  const selected = $derived(
    items.find((n) => n.id === position.id) ?? items[Math.min(position.index, items.length - 1)]
  );
  export function focusSelected() {
    const button = list?.querySelector<HTMLButtonElement>('button[aria-current="true"]');
    button?.focus();
    return !!button;
  }
  export function backFromDetail(target: EventTarget | null) {
    return target instanceof Node && detail?.contains(target) && focusSelected();
  }
  function select(item: HudItem, index: number) {
    if (position.id !== item.id || position.index !== index) position = { id: item.id, index };
  }
  async function review(item: HudItem, index: number) {
    select(item, index);
    await tick();
    detail?.querySelector<HTMLElement>('button,a,summary')?.focus();
  }
  function move(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing || !selected) return;
    const key = chord(e);
    const i = items.indexOf(selected);
    if (key && key === keys.review) {
      e.preventDefault();
      if (!e.repeat) void review(selected, i);
      return;
    }
    const step = key && key === keys.next ? 1 : key && key === keys.previous ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    list?.querySelectorAll('button')[Math.max(0, Math.min(items.length - 1, i + step))]?.focus();
  }
</script>

<section aria-label="Decision queue">
  <h2>
    Decision queue <small aria-live="polite"
      >{items.length - chats}
      {items.length - chats === 1 ? 'decision' : 'decisions'}{#if chats}
        · {chats} {chats === 1 ? 'chat needs' : 'chats need'} input{/if}</small
    >
  </h2>
  {#if selected}
    <div class="queue">
      <div class="items" bind:this={list}>
        {#each items as item, i (item.id)}
          <button
            class:chosen={item.id === selected.id}
            aria-current={item.id === selected.id ? 'true' : undefined}
            onkeydown={move}
            onfocus={() => select(item, i)}
            onclick={() => review(item, i)}
          >
            <span class="rank">{i + 1}</span><span>{item.title}<small>{item.source}</small></span>
          </button>
        {/each}
      </div>
      <section class="answer" aria-label="Selected decision" bind:this={detail}>
        <small>{selected.source}</small>
        <h3>{selected.title}</h3>
        <p>{selected.reason}</p>
        {#if selected.consequence}<p>If you approve: {selected.consequence}</p>{/if}
        {@render action(selected)}
      </section>
    </div>
    <p class="hint">
      {keys.previous || keys.next
        ? [keys.previous, keys.next].filter(Boolean).map(keyLabel).join(' / ') +
          ' moves between decisions. '
        : ''}{keys.review && keys.review !== 'Enter'
        ? keyLabel(keys.review) + ' or Enter'
        : 'Enter'} reviews. Tab chooses an action.
    </p>
  {:else}<p class="hint">
      {busy ? 'Checking for decisions…' : 'No confirmed decisions waiting.'}
    </p>{/if}
</section>

<style>
  h2 {
    font: 1.18rem var(--font-pixel);
    margin-block-end: 0.5rem;
  }
  h2 small {
    margin-inline-start: 0.4rem;
  }
  .queue {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    border-block: 1px solid var(--color-hairline);
  }
  .items {
    border-inline-end: 1px solid var(--color-hairline);
  }
  .items button {
    display: flex;
    gap: 0.65rem;
    width: 100%;
    text-align: start;
    align-items: baseline;
    padding: 0.55rem 0.65rem;
    font-size: 0.87rem;
    overflow-wrap: anywhere;
  }
  .items button + button {
    border-block-start: 1px solid var(--color-hairline);
  }
  .items button.chosen {
    border-inline-start: 3px solid var(--color-sea);
    background: var(--color-raise);
  }
  .rank {
    font: 0.8rem var(--font-pixel);
    color: var(--color-sea);
  }
  small,
  .hint {
    color: var(--color-muted);
    font:
      0.76rem/1.4 Inter,
      system-ui,
      sans-serif;
  }
  .items small {
    display: block;
  }
  .answer {
    align-self: center;
    padding: 0.8rem;
    overflow-wrap: anywhere;
  }
  .answer h3 {
    font-weight: 650;
  }
  .answer p {
    margin-block: 0.35rem 0.6rem;
    font-size: 0.84rem;
  }
  .hint {
    margin-block-start: 0.45rem;
  }
  @media (max-width: 600px) {
    .queue {
      grid-template-columns: 1fr;
    }
    .items {
      border-inline-end: 0;
      border-block-end: 1px solid var(--color-hairline);
    }
  }
</style>
