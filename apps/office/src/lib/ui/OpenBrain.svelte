<script lang="ts">
  import { onMount } from 'svelte';
  import { call } from './api.ts';
  import type { brainState } from '../server/open-brain.ts';
  type State = Awaited<ReturnType<typeof brainState>>;
  type Host = 'codex' | 'claude';
  let brain = $state<State>();
  let url = $state('');
  let key = $state('');
  let problem = $state('');
  let busy = $state(false);
  let manual = $state<Host>();
  let path = $state('');
  async function read() {
    brain = await call<State>('/api/open-brain');
    if (!url && brain.existing.length === 1) url = brain.existing[0];
  }
  onMount(() => {
    void read().catch((e) => (problem = e.message));
  });
  async function act(action: string, values = {}) {
    busy = true;
    problem = '';
    try {
      brain = await call<State>('/api/open-brain', { action, ...values });
      key = '';
      url = brain.url ?? '';
      manual = undefined;
      path = '';
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
      await read().catch(() => {});
    } finally {
      busy = false;
    }
  }
  async function pair(host: Host) {
    busy = true;
    try {
      const folder = await call<{ path?: string; unavailable?: string }>('/api/folders/pick', {});
      if (folder.path) await act('pair', { host, path: folder.path });
      if (folder.unavailable) {
        manual = host;
        problem = folder.unavailable;
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section class="mb-3 rounded-xl border border-line bg-raise p-3 text-sm" aria-label="Open Brain">
  <h3 class="font-semibold">Open Brain</h3>
  {#if brain?.url}
    <p class="break-all text-xs text-muted">{brain.url}</p>
    <p class="mt-2 text-xs text-muted">
      {brain.watchesCaptures
        ? 'Your office checks new captures as well as job search results.'
        : 'This Brain has no recent-capture list. The office uses job searches and decisions from paired projects.'}
    </p>
    {#if brain.catchingUp}
      <p class="mt-2">Catching up on captures saved while the office was away.</p>
    {:else if brain.checkedAt}
      <p class="mt-2">
        Last checked {new Date(brain.checkedAt).toLocaleTimeString()}. {brain.affected} affected {brain.affected ===
        1
          ? 'job'
          : 'jobs'}.
      </p>
      {#each brain.findings as job (job.id)}
        <details class="mt-1 text-xs">
          <summary>Why {job.name} changed</summary>
          {#each job.sources as item (item.id)}<p class="mt-1 whitespace-pre-wrap">{item.text}</p>
            <small>Open Brain record {item.id}</small>{/each}
        </details>
      {/each}
    {/if}
    <p class="mt-2 text-xs text-muted">
      Pair a project folder to let its chat app share settled project decisions with this Brain.
      Open a new chat there and accept its hook trust prompt if asked. In Codex, review the new hook
      under Settings → Hooks or /hooks.
    </p>
    <div class="mt-2 flex flex-wrap gap-3">
      {#each brain.hosts as host (host)}
        <button disabled={busy} onclick={() => pair(host)}
          >Use in {host === 'codex' ? 'Codex' : 'Claude Code'}</button
        >
      {/each}
    </div>
    {#if manual}
      <input aria-label="Project folder path" placeholder="Project folder path" bind:value={path} />
      <button disabled={!path || busy} onclick={() => act('pair', { host: manual, path })}
        >Pair folder</button
      >
    {/if}
    {#each brain.pairs as p (p.id)}
      <p class="mt-2 break-all text-xs">
        {p.host} · {p.workspace} · {p.verified ? 'Decision received' : 'Waiting for first decision'}
        <button disabled={busy} onclick={() => act('unpair', { id: p.id })}>Remove</button>
      </p>
    {/each}
    <div class="mt-2 flex gap-3 text-xs">
      <button disabled={busy} onclick={() => act('check')}>Check again</button>
      <button disabled={busy} onclick={() => act('disconnect')}>Disconnect Brain</button>
    </div>
  {:else if brain}
    <p class="mt-1 text-xs text-muted">
      Your office checks for new captures and searches by job name. It reviews verified source
      records with the office AI. Each Odd gets the decisions that affect its work. Use a Brain
      whose records you can share with your office.
    </p>
    <form
      class="mt-2 grid gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        void act('connect', { url, key });
      }}
    >
      <label
        >Brain address<input
          class="block w-full rounded bg-night/40 p-2"
          type="url"
          required
          bind:value={url}
          list="brain-connections"
        /></label
      >
      <datalist id="brain-connections"
        >{#each brain.existing as address (address)}<option value={address}
          ></option>{/each}</datalist
      >
      <label
        >Brain key <span class="text-xs text-muted">(if not already connected)</span><input
          class="block w-full rounded bg-night/40 p-2"
          type="password"
          autocomplete="off"
          bind:value={key}
        /></label
      >
      <button class="justify-self-start rounded-lg bg-sea/15 px-3 py-1.5" disabled={!url || busy}
        >Connect Open Brain</button
      >
    </form>
  {/if}
  {#if busy}<p role="status" class="mt-2 text-xs">Working…</p>{/if}
  {#if problem || brain?.problem}<p role="alert" class="mt-2 text-xs text-coral">
      {problem || brain?.problem}
    </p>{/if}
</section>
