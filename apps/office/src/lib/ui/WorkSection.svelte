<script lang="ts">
  import type { AskRow } from '@oddboro/ledger';
  import Markdown from './Markdown.svelte';
  import { call } from './api.ts';
  import { runningFor, toolWords, type Work } from '../staff/work.ts';
  import { serviceNames } from './service-names.svelte.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  // What an Odd is working on right now, on its info page: each run going (a
  // job, an approved ask, a pick-up after a task or a colleague, work handed
  // over, parked work waking), what it is using this moment, and each
  // follow-up waiting to start. It updates as the Odd works.
  type Props = { profile: StaffProfile; items: Work[] };
  let { profile, items }: Props = $props();

  let asks = $state<Record<number, AskRow>>({});
  let now = $state(Date.now());

  // Whole minutes: a tick a minute while something runs, and none otherwise.
  // Work that waits shows no time.
  const running = $derived(items.some((w) => !w.queued));
  $effect(() => {
    if (!running) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  // The ask behind each piece of work, fetched once each.
  const asked = new Set<number>();
  $effect(() => {
    for (const w of items) {
      if (!w.askId || asked.has(w.askId)) continue;
      asked.add(w.askId);
      call<{ ask: AskRow }>(`/api/asks/${w.askId}`)
        .then((r) => {
          asks[r.ask.id] = r.ask;
        })
        .catch(() => asked.delete(w.askId!));
    }
  });
</script>

<section class="flex flex-col gap-2" aria-label="In progress">
  <h3 class="text-xs font-semibold text-ink">
    In progress{#if items.length}<span class="ms-1.5 text-ember">{items.length}</span>{/if}
  </h3>
  {#if !items.length}
    <p class="rounded-xl bg-raise px-3 py-3 text-sm text-muted">
      Nothing right now. Whatever {profile.name} works on shows here while it runs or waits to start.
    </p>
  {/if}
  {#each items as w (w.id)}
    {@const a = w.askId ? asks[w.askId] : undefined}
    <section class="rounded-xl bg-raise p-3" aria-label={w.label}>
      <div class="flex items-center gap-2 text-[10px] tracking-[0.16em] uppercase">
        <span class={w.queued ? 'text-faint' : 'text-ember'}>{w.detail}</span>
        <span class="text-faint">· {w.queued ? 'waiting' : runningFor(w.since, now)}</span>
      </div>
      <h3 class="mt-1 text-sm leading-snug font-medium">{w.label}</h3>
      {#if w.toStart}
        <p class="mt-1 text-xs text-muted">
          Starts once {profile.name}'s current run on this work ends.
        </p>
      {:else if w.queued}
        <p class="mt-1 text-xs text-muted">
          Waiting for a free slot: {profile.name} runs up to three things at once.
        </p>
      {:else}
        <p class="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <span class="busy"></span>
          {w.doing ? toolWords(w.doing, serviceNames.byId) : 'Thinking'}
          <span class="text-faint">· {w.steps} {w.steps === 1 ? 'step' : 'steps'}</span>
        </p>
      {/if}
      {#if a}
        <details class="mt-2 text-xs">
          <summary class="cursor-pointer text-muted">What you approved</summary>
          <div class="mt-1.5 flex flex-col gap-2">
            <div>
              <div class="text-faint">Why</div>
              <Markdown text={a.why} staff={a.staffId} class="text-ink" />
            </div>
            <div>
              <div class="text-faint">The plan</div>
              <Markdown text={a.ifApproved} staff={a.staffId} class="text-ink" />
            </div>
            {#if a.reason}
              <div>
                <div class="text-faint">Your words</div>
                <div class="text-ink">{a.reason}</div>
              </div>
            {/if}
          </div>
        </details>
      {/if}
    </section>
  {/each}
</section>

<style>
  .busy {
    inline-size: 6px;
    block-size: 6px;
    border-radius: 9999px;
    background: var(--color-ember);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .busy {
      animation: none;
    }
  }
</style>
