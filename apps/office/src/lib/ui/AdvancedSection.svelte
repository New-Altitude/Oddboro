<script lang="ts">
  import { ADVANCED_CONSENT } from '@oddboro/ledger/access';
  import { call } from './api.ts';
  import { advanced } from './windows.svelte.ts';

  // The Setup window's Advanced section: power features that work outside
  // Oddboro's limits, off until the owner says yes to one plain warning.
  // Today that is Projects, Claude Code and Codex in the owner's own folders.
  let asking = $state(false);
  let busy = $state(false);
  let problem = $state('');

  async function turn(on: boolean) {
    busy = true;
    problem = '';
    try {
      advanced.on = (await call<{ on: boolean }>('/api/setup/advanced', { on }, 'PUT')).on;
      asking = false;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  const button =
    'rounded-lg bg-raise px-3 py-2 text-xs font-medium hover:bg-sea/20 disabled:opacity-40';
</script>

<section class="flex flex-col gap-2 text-xs" aria-label="Advanced">
  <h3 class="tracking-[0.16em] text-sea uppercase">Advanced</h3>
  {#if advanced.on}
    <p class="text-muted">
      Advanced mode is on. Projects in the top bar opens Claude Code and Codex in your own folders,
      with your permissions on this computer.
    </p>
    <p class="text-faint">
      Turning it off takes every Odd off your project sessions and stops work still waiting. Work
      already running in Claude Code or Codex keeps running there.
    </p>
    <button class="self-start {button}" disabled={busy} onclick={() => turn(false)}
      >Turn off advanced mode</button
    >
  {:else if asking}
    <div
      class="flex flex-col gap-2 rounded-lg bg-ember/10 p-3"
      role="alertdialog"
      aria-labelledby="advanced-consent"
    >
      <p id="advanced-consent" class="text-sm text-ink">{ADVANCED_CONSENT}</p>
      <div class="flex flex-wrap gap-2">
        <button
          class="rounded-lg bg-ember px-3 py-2 text-xs font-medium text-night disabled:opacity-40"
          disabled={busy}
          onclick={() => turn(true)}>Turn on advanced mode</button
        >
        <button class={button} disabled={busy} onclick={() => (asking = false)}>Not now</button>
      </div>
    </div>
  {:else}
    <p class="text-muted">
      Features that work outside Oddboro’s limits, such as Projects: Claude Code and Codex in your
      own folders. Off until you turn it on.
    </p>
    <button class="self-start {button}" onclick={() => (asking = true)}>Turn on</button>
  {/if}
  {#if problem}
    <p class="rounded-lg bg-coral/15 px-3 py-2 text-coral" role="alert">{problem}</p>
  {/if}
</section>
