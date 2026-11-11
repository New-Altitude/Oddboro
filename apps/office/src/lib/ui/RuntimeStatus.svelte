<script lang="ts">
  import type { RuntimeSummary } from '@oddboro/ledger';
  import { call } from './api.ts';
  let data = $state<RuntimeSummary>(),
    problem = $state('');
  const when = (at?: number) => (at === undefined ? 'Not recorded' : new Date(at).toLocaleString());
  async function load() {
    try {
      data = await call<RuntimeSummary>('/api/runtime');
      problem = '';
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    void load();
  });
</script>

<details class="border-t border-hairline pt-3">
  <summary>Office runtime</summary>
  <button class="btn" onclick={load}>Refresh runtime</button>
  {#if data}
    <p>
      Checked {when(data.observedAt)}. {data.mode === 'desktop'
        ? 'Packaged app'
        : 'Source installation'}.
    </p>
    <dl class="grid grid-cols-2 gap-2 text-sm">
      <dt>Job clock</dt>
      <dd>{data.clockState}; last successful check {when(data.clock?.checkedAt)}</dd>
      <dt>Server supervision</dt>
      <dd>
        {data.desktop?.state ?? 'Not reported'}{data.supervisorVerifiedForClock
          ? ''
          : ' (not verified for this clock)'}
      </dd>
      <dt>Open at login</dt>
      <dd>
        {data.desktop?.openAtLogin === true
          ? 'On'
          : data.desktop?.openAtLogin === false
            ? 'Off'
            : 'Unknown'}; checked {when(data.desktop?.loginCheckedAt)}
      </dd>
      <dt>Sleep prevention</dt>
      <dd>
        {data.power?.state ?? 'Not verified'}{data.power?.platform === 'macos'
          ? ' on AC power only'
          : data.power
            ? '; lid and system settings can still suspend this computer'
            : ''}
      </dd>
      <dt>Last clean shutdown</dt>
      <dd>{when(data.desktop?.lastCleanShutdownAt)}</dd>
      <dt>Last restart reason</dt>
      <dd>{data.desktop?.restartReason?.replaceAll('_', ' ') ?? 'Not recorded'}</dd>
    </dl>
    {#each data.clock?.gaps ?? [] as gap, i (i)}<p>
        Clock gap: {when(gap.from)} to {when(gap.to)}. Last successful check: {when(gap.lastCheck)}.
        Cause unknown.
      </p>{/each}
    <p class="text-xs text-muted">{data.limitation}</p>
  {/if}
  {#if problem}<p role="alert">{problem}</p>{/if}
</details>
