<script lang="ts">
  // Which Odd uses the owner's plan most: every Odd's tokens over the last
  // day or week, most first. Loaded once as the Usage section opens.
  import type { OddUsage } from '@oddboro/ledger';
  import { call } from './api.ts';
  import { compact } from './format.ts';

  const RANGES = [
    { id: 'd1', label: '24h' },
    { id: 'd7', label: '7d' }
  ] as const;

  let usage = $state<Record<'d1' | 'd7', OddUsage[]> | undefined>();
  let range = $state<'d1' | 'd7'>('d1');

  $effect(() => {
    call<Record<'d1' | 'd7', OddUsage[]>>('/api/office/usage')
      .then((u) => (usage = u))
      .catch(() => {});
  });

  const rows = $derived(usage?.[range] ?? []);
  const total = $derived(rows.reduce((n, r) => n + r.tokens, 0));
  const top = $derived(Math.max(1, ...rows.map((r) => r.tokens)));
</script>

<section class="flex flex-col gap-1" aria-label="Token use">
  <div class="flex items-center justify-between">
    <span class="text-xs text-muted">Token use</span>
    <div class="flex gap-0.5 rounded-full bg-raise p-0.5" role="group" aria-label="Range">
      {#each RANGES as r (r.id)}
        <button
          class="rounded-full px-2 py-0.5 text-[10px] {range === r.id
            ? 'bg-sea/30 text-ink'
            : 'text-muted'}"
          aria-pressed={range === r.id}
          onclick={() => (range = r.id)}>{r.label}</button
        >
      {/each}
    </div>
  </div>
  {#if !usage}
    <p class="text-xs text-faint">Loading.</p>
  {:else if !rows.length}
    <p class="text-xs text-faint">No runs in this time.</p>
  {:else}
    {#each rows as r (r.staffId ?? '')}
      <div class="rounded-lg bg-raise px-2.5 py-1.5 text-xs">
        <div class="flex items-baseline gap-2">
          <span class="min-w-0 flex-1 truncate text-ink">{r.name ?? 'The office itself'}</span>
          <span class="shrink-0 text-[10px] text-faint"
            >{r.runs} run{r.runs === 1 ? '' : 's'} · {Math.round((r.tokens / total) * 100)}%</span
          >
          <span class="shrink-0 font-pixel text-sm text-ink">{compact.format(r.tokens)}</span>
        </div>
        <div class="meter mt-1">
          <span style="inline-size: {(r.tokens / top) * 100}%"></span>
        </div>
      </div>
    {/each}
  {/if}
</section>

<style>
  .meter {
    height: 4px;
    border-radius: 99px;
    background: var(--color-panel-solid);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: var(--color-sea);
  }
</style>
