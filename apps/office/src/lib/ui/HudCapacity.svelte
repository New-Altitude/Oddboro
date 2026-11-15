<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { agentAttention, Allowance } from '#lib/server/agent-attention.ts';
  import type { HudItem } from './hud-items.ts';
  import { AGENT_NAMES } from '@oddboro/ledger/agents';
  let {
    needs,
    running,
    attention,
    row
  }: {
    needs: HudItem[];
    running: HudItem[];
    attention?: Awaited<ReturnType<typeof agentAttention>>;
    row: Snippet<[HudItem]>;
  } = $props();
  const groups = ['codex', 'claude', 'office'] as const;
  let expanded = $state<HudItem['group']>();
  const name = (id: HudItem['group']) => (id === 'office' ? 'Oddboro' : AGENT_NAMES[id]);
</script>

{#snippet limit(w: Allowance | null | undefined)}
  {#if w && w.resets > Date.now()}
    <strong>{w.left}%</strong><progress max="100" value={w.left} aria-label="Allowance remaining"
    ></progress>
    <small
      >Resets {new Date(w.resets).toLocaleString(undefined, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit'
      })}</small
    >
  {:else}<span class="quiet">Unavailable</span>{/if}
{/snippet}
<table aria-label="Agent threads and plan allowances">
  <thead><tr><th>Agent</th><th>Activity</th><th>Weekly left</th><th>Session left</th></tr></thead>
  <tbody
    >{#each groups as group}
      {@const jobs = running.filter((r) => r.group === group)}
      {@const pending = needs.filter((n) => n.group === group)}
      {@const partial =
        group === 'claude' ? !attention?.claude : group === 'codex' ? !attention?.codex : false}
      <tr
        ><th scope="row"
          ><button
            aria-expanded={expanded === group}
            onclick={() => (expanded = expanded === group ? undefined : group)}
            ><span aria-hidden="true">{expanded === group ? '▾' : '▸'}</span> {name(group)}</button
          ></th
        >
        <td
          >{jobs.length}
          {partial ? 'seen running' : 'running'}<small>{pending.length} waiting</small></td
        >
        {#if group === 'office'}<td colspan="2" class="quiet">Uses linked provider plans</td>
        {:else}<td>{@render limit(attention?.plans[group]?.week)}</td><td
            >{@render limit(attention?.plans[group]?.session)}</td
          >{/if}
      </tr>
      {#if expanded === group}<tr
          ><td colspan="4">
            {#each [...pending, ...jobs] as item}{@render row(item)}{:else}<small
                >No work reported.</small
              >{/each}
          </td></tr
        >{/if}
    {/each}</tbody
  >
</table>

<style>
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.84rem;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: start;
    border-block-end: 1px solid var(--color-hairline);
    padding: 0.42rem 0.4rem;
    vertical-align: middle;
  }
  th:first-child {
    padding-inline-start: 0;
  }
  thead th {
    font-size: 0.73rem;
    font-weight: 500;
    color: var(--color-muted);
  }
  button {
    color: var(--color-ink);
    font-weight: 600;
  }
  button span {
    color: var(--color-sea);
  }
  small,
  .quiet {
    color: var(--color-muted);
    font-size: 0.73rem;
  }
  small {
    display: block;
  }
  progress {
    display: inline-block;
    inline-size: 2.6rem;
    block-size: 0.38rem;
    vertical-align: middle;
    margin-inline-start: 0.5rem;
    accent-color: var(--color-sea);
  }
  @media (max-width: 600px) {
    progress {
      display: none;
    }
    td,
    th {
      padding-inline: 0.23rem;
    }
  }
</style>
