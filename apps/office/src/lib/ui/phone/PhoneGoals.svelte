<script lang="ts">
  // The phone's Goals tab: each active goal, newest first, with its area, when
  // it is for, its lead, the faces of the Odds serving it, what of it waits on
  // the owner and how far along it is (`phoneGoals` on the server). Setting a
  // goal stays at the computer, so there is no New here. A tap opens the
  // goal's page.
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import type { PhoneGoalCard } from '#lib/server/phone-goals.ts';
  import OddFace from './OddFace.svelte';
  import { metaLine, progressLine, underWay, waitingBadge } from './phone-goals.ts';

  type Props = {
    goals: PhoneGoalCard[];
    staff: StaffProfile[];
    onopen: (id: number) => void;
  };
  let { goals, staff, onopen }: Props = $props();
  const who = (id: string | undefined) => staff.find((p) => p.id === id);
</script>

<div class="flex h-full flex-col">
  <header class="border-b border-hairline px-5 pt-6 pb-4">
    <h1 class="text-2xl font-semibold text-ink">Goals</h1>
    {#if goals.length}
      <p class="mt-0.5 text-sm text-muted">{underWay(goals.length)}</p>
    {/if}
  </header>

  <ul class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    {#each goals as g (g.id)}
      <li>
        <button
          class="w-full rounded-2xl bg-raise px-5 py-4 text-start"
          onclick={() => onopen(g.id)}
        >
          <span class="area block">{g.area}</span>
          <span class="mt-1 block text-xl leading-snug font-semibold text-ink">{g.title}</span>
          {#if g.progress.total}
            <span
              class="mt-3 block h-1.5 overflow-hidden rounded-full bg-hairline"
              role="progressbar"
              aria-label="Parts done"
              aria-valuemin={0}
              aria-valuemax={g.progress.total}
              aria-valuenow={g.progress.done}
            >
              <span
                class="block h-full rounded-full bg-sea"
                style:inline-size={`${(g.progress.done / g.progress.total) * 100}%`}
              ></span>
            </span>
          {/if}
          <span class="mt-3 flex items-center gap-3">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-muted">{metaLine(g, who(g.leadId)?.name)}</span>
              <span class="block truncate text-sm text-faint">{progressLine(g.progress)}</span>
            </span>
            <span class="flex shrink-0">
              {#each g.faces.slice(0, 4) as id, n (id)}
                <OddFace
                  odd={who(id)}
                  class="size-10 rounded-full ring-2 ring-night {n ? '-ms-3' : ''}"
                />
              {/each}
            </span>
          </span>
          {#if g.waiting}
            <span
              class="mt-3 inline-block rounded-full bg-ember/15 px-3 py-1 text-sm font-medium text-ember"
              >{waitingBadge(g.waiting)}</span
            >
          {/if}
        </button>
      </li>
    {:else}
      <li class="py-10 text-center text-muted">No goals under way.</li>
    {/each}
  </ul>
</div>

<style>
  .area {
    font-size: 0.75rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-muted);
  }
</style>
