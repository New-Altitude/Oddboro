<script lang="ts">
  import type { Agent } from '@oddboro/ledger/agents';
  import { MagpieConnection } from './magpie.svelte.ts';
  import { magpieChoices } from './magpie-ui.ts';

  let {
    agent,
    value,
    officeModel,
    onpick
  }: {
    agent: Agent;
    value?: string;
    officeModel?: string;
    onpick: (model: string | null) => Promise<void>;
  } = $props();
  const connection = new MagpieConnection();
  const choices = $derived(magpieChoices(connection.state));
  let busy = $state(false);
  const selected = $derived(value?.startsWith('magpie:') ? value : '');
  async function pick(model: string) {
    busy = true;
    try {
      await onpick(model || null);
    } finally {
      busy = false;
    }
  }
</script>

<div class="rounded-lg bg-raise p-3">
  <h3 class="text-xs font-semibold">Magpie model connection</h3>
  <p class="mt-1 text-xs text-muted">
    {#if agent === 'pi'}Pi is included. Magpie supplies its provider account and model; there is no
      separate Pi login.{:else}The agent tool keeps its permissions and account folder. Magpie
      supplies the provider account and model.{/if}
  </p>
  {#if connection.state?.access === 'use'}<p class="mt-1 text-xs text-muted">
      Models connected. These are the gateway's published models and routing aliases. Management
      access is optional and can be connected in Setup to edit its providers or groups.
    </p>{/if}
  {#if agent === 'pi' || agent === 'claude' || agent === 'codex'}
    <label class="mt-2 block text-xs"
      >{connection.state?.access === 'use' ? 'Model or routing alias' : 'Model or routing group'}
      <select
        class="mt-1 w-full rounded-lg bg-night px-2 py-1.5 text-xs text-ink"
        value={selected}
        disabled={busy || connection.loading}
        onchange={(event) => pick(event.currentTarget.value)}
      >
        <option value="" disabled={agent === 'pi' && !officeModel?.startsWith('magpie:')}
          >{officeModel?.startsWith('magpie:')
            ? `Office default: ${officeModel.slice(7)}`
            : agent === 'pi'
              ? 'Choose a Magpie model or group'
              : 'Use office default'}</option
        >
        {#if selected && !choices.some((model) => model.id === selected)}<option value={selected}
            >{selected.slice(7)} (unavailable)</option
          >{/if}
        {#each choices as model (model.id)}<option value={model.id}>{model.name}</option>{/each}
      </select>
    </label>
    {#if selected || (!value && officeModel?.startsWith('magpie:'))}<p
        class="mt-2 text-xs text-muted"
      >
        This route uses Magpie's provider accounts. A direct vendor sign-in below is not needed.
        Changes apply on the next run.
      </p>{/if}
    {#if connection.problem}<p class="mt-2 text-xs text-coral" role="alert">
        {connection.problem}
      </p>{:else if connection.state?.problem}<p class="mt-2 text-xs text-coral" role="alert">
        {connection.state.problem}
      </p>{:else if !connection.loading && !choices.length}<p class="mt-2 text-xs text-muted">
        {connection.state?.access === 'use'
          ? 'No available gateway routes. Refresh or check the connection in Setup.'
          : 'No ready Magpie routes. Connect providers in Setup, under Models & connections.'}
      </p>{/if}
    <button
      class="mt-2 rounded-lg px-2 py-1 text-xs text-muted hover:bg-night"
      disabled={connection.loading}
      onclick={() => connection.load()}>Refresh model routes</button
    >
  {:else}
    <p class="mt-2 text-xs text-muted">
      Magpie routing supports included Pi, Claude Code and Codex. The selected tool keeps its direct
      account. Platform restrictions still apply.
    </p>
  {/if}
</div>
