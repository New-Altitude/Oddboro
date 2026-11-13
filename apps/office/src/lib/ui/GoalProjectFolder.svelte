<script lang="ts">
  import type { GoalRow } from '@oddboro/ledger';
  import { call } from './api.ts';

  let { goal, onchange }: { goal: GoalRow; onchange: () => Promise<void> } = $props();
  let typing = $state(false);
  let path = $state('');
  let busy = $state(false);
  let problem = $state('');

  async function save(folder: string | null) {
    busy = true;
    problem = '';
    try {
      await call(`/api/goals/${goal.id}`, { projectFolder: folder }, 'PUT');
      await onchange();
      typing = false;
    } catch (e) {
      problem = e instanceof Error ? e.message : 'Could not attach the folder.';
    } finally {
      busy = false;
    }
  }

  async function pick() {
    busy = true;
    problem = '';
    try {
      const result = await call<{ path?: string; unavailable?: string }>('/api/folders/pick', {});
      if (result.path) await save(result.path);
      else if (result.unavailable) {
        typing = true;
        problem = `${result.unavailable} Type the path below.`;
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : 'Could not open the folder picker.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex flex-col gap-1.5">
  <div class="text-xs text-muted">Project folder</div>
  {#if goal.projectFolder}<p class="break-all text-xs text-ink">{goal.projectFolder}</p>{/if}
  <p class="text-[11px] text-faint">
    Groups this goal with the project's work. Each Odd keeps its existing file access.
  </p>
  <div class="flex flex-wrap gap-3 text-xs">
    <button class="text-sea hover:underline disabled:opacity-40" disabled={busy} onclick={pick}
      >{goal.projectFolder ? 'Change folder' : 'Attach a folder'}</button
    >
    <button
      class="text-muted hover:text-ink"
      disabled={busy}
      onclick={() => {
        path = goal.projectFolder ?? '';
        typing = true;
      }}>Type a path</button
    >
    {#if goal.projectFolder}<button
        class="text-muted hover:text-ink"
        disabled={busy}
        onclick={() => save(null)}>Remove link</button
      >{/if}
  </div>
  {#if typing}
    <form
      class="flex gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        void save(path);
      }}
    >
      <input
        class="min-w-0 flex-1 rounded-lg bg-night/40 px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sea"
        aria-label="Project folder path"
        placeholder="Full folder path"
        bind:value={path}
      />
      <button
        class="rounded-lg bg-sea px-2.5 py-1.5 text-xs text-night disabled:opacity-40"
        disabled={busy || !path.trim()}>Save folder</button
      >
      <button type="button" class="text-xs text-muted" onclick={() => (typing = false)}
        >Cancel</button
      >
    </form>
  {/if}
  {#if problem}<p class="text-xs text-coral" role="alert">{problem}</p>{/if}
</div>
