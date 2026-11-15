<script lang="ts">
  // The phone's tab bar: Home, Goals, Messages and Desk, at the foot of every
  // screen. The Desk tab counts what waits there. Messages counts nothing
  // until the phone keeps what was read.
  import type { Tab } from './phone-home.ts';

  type Props = { tab: Tab; waiting: number; onpick: (t: Tab) => void };
  let { tab, waiting, onpick }: Props = $props();

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'home', label: 'Home', icon: 'M4 11 12 4l8 7v9H4z' },
    {
      id: 'goals',
      label: 'Goals',
      icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18m0 4a5 5 0 1 0 0 10 5 5 0 1 0 0-10m0 4a1 1 0 1 0 0 2 1 1 0 1 0 0-2'
    },
    { id: 'messages', label: 'Messages', icon: 'M4 5h16v11H9l-5 4z' },
    { id: 'desk', label: 'Desk', icon: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3' }
  ];
</script>

<nav class="tabs flex border-t border-hairline bg-night" aria-label="Phone tabs">
  {#each TABS as t (t.id)}
    <button
      class="relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-xs {tab ===
      t.id
        ? 'text-sea'
        : 'text-faint'}"
      aria-current={tab === t.id ? 'page' : undefined}
      onclick={() => onpick(t.id)}
    >
      <svg
        class="size-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
        stroke-linecap="round"
        aria-hidden="true"><path d={t.icon} /></svg
      >
      {t.label}
      {#if t.id === 'desk' && waiting}
        <span
          class="absolute top-1 start-1/2 ms-2 min-w-5 rounded-full bg-ember px-1.5 text-[11px] leading-5 font-medium text-night"
          >{waiting}<span class="sr-only"> waiting</span></span
        >
      {/if}
    </button>
  {/each}
</nav>

<style>
  .tabs {
    padding-block-end: env(safe-area-inset-bottom);
  }
</style>
