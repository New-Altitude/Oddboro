<script lang="ts">
  import { zone } from '@oddboro/ledger/time';
  import { BarChart } from 'layerchart';
  import type { UsageBucket, UsageTotals } from '@oddboro/ledger';
  import { call } from './api.ts';
  import { ago, compact, when } from './format.ts';

  type Plan = {
    fiveHour: number;
    fiveHourResetsAt: string | null;
    sevenDay: number;
    sevenDayResetsAt: string | null;
    updatedAt: string;
  } | null;
  type Usage = {
    totals: Record<'d1' | 'd7' | 'd30', UsageTotals>;
    series: Record<'d1' | 'd7' | 'd30', UsageBucket[]>;
    plan: Plan;
  };
  type Props = { staffId: string; version: number };
  let { staffId, version }: Props = $props();

  let usage = $state<Usage | undefined>();
  let range = $state<'d1' | 'd7' | 'd30'>('d1');

  $effect(() => {
    void version;
    call<Usage>(`/api/staff/${staffId}/usage`)
      .then((u) => (usage = u))
      .catch(() => {});
  });

  const RANGES = [
    { id: 'd1', label: '24h' },
    { id: 'd7', label: '7d' },
    { id: 'd30', label: '30d' }
  ] as const;

  /** The bucket label: an hour for the day view, a day for the others. */
  const bucketLabel = (ms: number, r: typeof range) =>
    r === 'd1'
      ? new Date(ms).toLocaleTimeString('en-US', { timeZone: zone(), hour: 'numeric' })
      : r === 'd7'
        ? new Date(ms).toLocaleString('en-US', {
            timeZone: zone(),
            weekday: 'short',
            hour: 'numeric'
          })
        : new Date(ms).toLocaleDateString('en-US', {
            timeZone: zone(),
            month: 'short',
            day: 'numeric'
          });

  const data = $derived(
    (usage?.series[range] ?? []).map((b) => ({ ...b, label: bucketLabel(b.at, range) }))
  );
  /** Label every few bars so the axis never crowds. */
  const every = $derived(range === 'd1' ? 6 : range === 'd7' ? 8 : 7);
  const ticks = $derived(
    data.filter((_, i) => i % every === Math.floor(every / 2)).map((d) => d.label)
  );

  const left = (used: number) => Math.max(0, Math.round((1 - used) * 100));
</script>

<div class="flex flex-col gap-2.5 px-4">
  <section aria-label="Claude plan">
    <div class="flex items-baseline justify-between text-[11px] text-muted">
      <span>Claude plan left</span>
      <span class="text-faint"
        >{usage?.plan ? `as of ${ago(usage.plan.updatedAt)}` : 'after the first run'}</span
      >
    </div>
    {#each [{ label: '5 hours', used: usage?.plan?.fiveHour, resets: usage?.plan?.fiveHourResetsAt }, { label: 'Week', used: usage?.plan?.sevenDay, resets: usage?.plan?.sevenDayResetsAt }] as w (w.label)}
      {@const pct = w.used === undefined ? undefined : left(w.used)}
      <div class="mt-1.5">
        <div class="flex items-baseline justify-between text-xs">
          <span class="text-ink">{w.label}</span>
          <span class="font-pixel text-sm text-ink"
            >{pct === undefined ? '...' : `${pct}%`}{#if pct !== undefined && pct < 20}<span
                class="ms-1 font-sans text-[10px] text-ember">Low</span
              >{/if}</span
          >
        </div>
        <div
          class="meter mt-1"
          role="meter"
          aria-label={`${w.label} window left`}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={pct ?? 0}
        >
          <span class:low={pct !== undefined && pct < 20} style="inline-size: {pct ?? 0}%"></span>
        </div>
        {#if w.resets}
          <div class="mt-0.5 text-[10px] text-faint">Resets {when(w.resets)}</div>
        {/if}
      </div>
    {/each}
  </section>

  <section aria-label="Tokens used">
    <div class="text-[11px] text-muted">Tokens used</div>
    <dl class="mt-1 grid grid-cols-3 gap-1">
      {#each RANGES as r (r.id)}
        {@const t = usage?.totals[r.id]}
        <div class="rounded-lg bg-raise px-2 py-1.5">
          <dt class="text-[10px] text-faint">{r.label}</dt>
          <dd class="font-pixel text-base leading-tight text-ink">
            {t ? compact.format(t.tokens) : '...'}
          </dd>
          <dd class="text-[10px] text-faint">
            {t ? `${t.runs} run${t.runs === 1 ? '' : 's'}` : ''}
          </dd>
        </div>
      {/each}
    </dl>
  </section>

  <section aria-label="Tokens over time">
    <div class="flex items-center justify-between">
      <span class="text-[11px] text-muted">Over time</span>
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
    <div class="chart mt-1 h-24">
      {#if data.length}
        <BarChart
          {data}
          x="label"
          y="tokens"
          series={[{ key: 'tokens', label: 'Tokens', color: 'var(--color-sea)' }]}
          bandPadding={0.25}
          grid={false}
          rule={false}
          padding={{ left: 30, bottom: 16 }}
          props={{
            bars: { radius: 2, rounded: 'top' },
            xAxis: { ticks, tickLength: 0 },
            yAxis: { ticks: 2, format: (v: number) => compact.format(v), tickLength: 0 }
          }}
        />
      {/if}
    </div>
  </section>
</div>

<style>
  .meter {
    height: 6px;
    border-radius: 99px;
    background: var(--color-raise);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: var(--color-sea);
  }
  .meter span.low {
    background: var(--color-ember);
  }
  /* LayerChart draws its tooltip from these. */
  .chart {
    --color-surface-100: var(--color-panel-solid);
    --color-surface-300: var(--color-panel-solid);
    --color-surface-content: var(--color-ink);
  }
  .chart :global(text) {
    fill: var(--color-faint);
    font-family: var(--font-sans);
    font-size: 9px;
    font-weight: 400;
    stroke: none;
  }
</style>
