<script lang="ts">
  import { railRing, tagWords, type OddNow } from '../staff/odd-now.ts';
  import type { Tag } from './floor-crew.svelte.ts';

  // One Odd's name tag over the floor: its name and what it is doing, ember
  // while it waits on the owner.

  type Props = {
    tag: Tag;
    now: OddNow;
    /** The Odd whose panel is open. */
    active: boolean;
    onclick: () => void;
  };

  let { tag, now, active, onclick }: Props = $props();

  const isWaiting = $derived(railRing(now));
  const words = $derived(tagWords(now, tag.heading));
</script>

<button
  class="tag pointer-events-auto absolute flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap"
  class:active
  class:waiting={isWaiting}
  style="transform: translate(calc({tag.x}px - 50%), calc({tag.y}px - 100% - 6px))"
  {onclick}
>
  <span class="font-medium text-ink">{tag.name}</span>
  <span class="max-w-64 truncate {isWaiting ? 'text-ember' : 'text-muted'}" title={words}
    >{words}</span
  >
</button>

<style>
  .tag {
    background: rgb(11 13 23 / 0.72);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.08);
    backdrop-filter: blur(6px);
  }
  .tag.active {
    box-shadow:
      0 0 0 1px var(--color-sea),
      0 0 14px rgb(47 179 166 / 0.45);
  }
  .tag.waiting {
    box-shadow:
      0 0 0 1px var(--color-ember),
      0 0 14px rgb(242 180 90 / 0.45);
  }
</style>
