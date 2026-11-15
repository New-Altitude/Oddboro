<script lang="ts">
  import { onMount } from 'svelte';
  import type { Decision } from '#lib/hud-decisions.ts';
  import { call } from './api.ts';
  import { reviewUrl } from './strip-review.ts';
  let decisions = $state<(Pick<Decision, 'id' | 'source' | 'title'> & { waitingChat: boolean })[]>(
      []
    ),
    partial = $state(false),
    problem = $state('');
  const chats = $derived(decisions.filter((item) => item.waitingChat).length);
  const identified = $derived(decisions.length - chats);
  let request: AbortController | undefined,
    again = false,
    mounted = false;
  export async function refresh() {
    if (!mounted || document.hidden) return;
    if (request) {
      again = true;
      return;
    }
    const read = (request = new AbortController());
    try {
      const next = await call<{ decisions: typeof decisions; partial: boolean }>(
        '/api/strip-decisions',
        undefined,
        'GET',
        read.signal
      );
      if (read.signal.aborted) return;
      decisions = next.decisions;
      partial = next.partial;
      problem = '';
    } catch {
      if (!read.signal.aborted) problem = 'Decision list unavailable.';
    } finally {
      request = undefined;
      if (again) {
        again = false;
        void refresh();
      }
    }
  }
  onMount(() => {
    mounted = true;
    void refresh();
    // Standalone agents do not publish their waiting state to Oddboro.
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      mounted = false;
      request?.abort();
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  });
</script>

{#if decisions.length}
  <section aria-label="Decisions" class="mb-2">
    <strong class="text-xs text-ember">
      {#if identified}{identified} {identified === 1 ? 'decision needs' : 'decisions need'} you{/if}
      {#if chats}{identified ? ' · ' : ''}{chats}
        {chats === 1 ? 'chat needs' : 'chats need'} input{/if}
    </strong>
    {#each decisions as d (d.id)}
      <a
        class="block rounded-md px-2 py-1 hover:bg-sea/10"
        id={'review-' + d.id}
        href={reviewUrl(d.id)}
        data-sveltekit-reload
        ><span class="block truncate">{d.title}</span><small class="text-muted">{d.source}</small
        ></a
      >
    {/each}
  </section>
{/if}
{#if problem || partial}<small class="block text-muted"
    >{problem || 'Some external agent requests may be unavailable.'}</small
  >{/if}
