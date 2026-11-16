<script lang="ts">
  import { untrack } from 'svelte';
  import { ADVANCED_CONSENT } from '@oddboro/ledger/access';
  import { call } from './api.ts';
  import { advanced } from './windows.svelte.ts';

  // The Setup window's Advanced section: power features that work outside
  // Oddboro's limits, off until the owner says yes to one plain warning.
  // Today that is Projects, Claude Code and Codex in the owner's own folders.
  let asking = $state(false);
  let busy = $state(false);
  let problem = $state('');
  /** A Claude folder as Setup's route lists it; `mark` is the name Projects shows. */
  type ClaudeFolder = { path: string; isDefault: boolean; mark: string };
  let folders = $state<ClaudeFolder[]>([]);
  let typed = $state('');

  const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

  /** One change at a time; a refusal shows in the office's own words. */
  async function act(job: () => Promise<void>) {
    busy = true;
    problem = '';
    try {
      await job();
    } catch (e) {
      problem = said(e);
    } finally {
      busy = false;
    }
  }

  const turn = (on: boolean) =>
    act(async () => {
      advanced.on = (await call<{ on: boolean }>('/api/setup/advanced', { on }, 'PUT')).on;
      asking = false;
    });

  async function load() {
    try {
      folders = (await call<{ folders: ClaudeFolder[] }>('/api/setup/claude-folders')).folders;
    } catch (e) {
      problem = said(e);
    }
  }
  // Each time advanced mode comes on: the section stays mounted while its own
  // toggle flips it, and the folders live in the office's settings file, which
  // no page state follows.
  $effect(() => {
    if (advanced.on) untrack(load);
  });

  const change = (body: { add: string } | { remove: string }) =>
    act(async () => {
      folders = (await call<{ folders: ClaudeFolder[] }>('/api/setup/claude-folders', body, 'PUT'))
        .folders;
      // So an open Projects window lists the folders again.
      advanced.folders += 1;
      if ('add' in body) typed = '';
    });
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
    <h4 id="claude-folders" class="mt-2 font-medium text-ink">Claude folders</h4>
    <p class="text-muted">
      Projects lists conversations from each of these. ~/.claude is always here.
    </p>
    <ul class="flex flex-col gap-1" aria-labelledby="claude-folders">
      {#each folders as f (f.path)}
        <li class="flex items-center justify-between gap-2 rounded-lg bg-raise px-3 py-2">
          <span class="min-w-0 truncate" title={f.path}>{f.mark}</span>
          {#if !f.isDefault}
            <button
              class="shrink-0 text-muted hover:text-ink disabled:opacity-40"
              aria-label="Remove {f.mark}"
              disabled={busy}
              onclick={() => change({ remove: f.path })}>Remove</button
            >
          {/if}
        </li>
      {/each}
    </ul>
    <form
      class="flex gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        change({ add: typed });
      }}
    >
      <input
        class="min-w-0 flex-1 rounded-lg bg-night/60 px-2.5 py-1.5 outline-none placeholder:text-faint"
        placeholder="~/.claude-work"
        aria-label="A Claude folder’s path"
        bind:value={typed}
        disabled={busy}
      />
      <button type="submit" class={button} disabled={busy || !typed.trim()}>Add</button>
    </form>
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
