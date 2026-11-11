<script lang="ts">
  // What the owner can do to a service itself, wherever it shows: rename it,
  // and for an AWS tool already connected, change its role or Region, which
  // puts the AWS step on the desk again and opens it there. A change reaches
  // every list through the connectors table's change event.
  import { call, type ApiUrl } from './api.ts';
  import { deskRequest } from './windows.svelte.ts';

  type Props = { id: string; name: string; changes?: boolean };
  let { id, name, changes = false }: Props = $props();

  let renaming = $state(false);
  let newName = $state('');
  let busy = $state(false);
  let problem = $state('');

  const url = $derived<ApiUrl>(`/api/services/${encodeURIComponent(id)}`);

  async function rename() {
    busy = true;
    problem = '';
    try {
      await call(url, { name: newName }, 'PATCH');
      renaming = false;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function change() {
    busy = true;
    problem = '';
    try {
      const { taskId } = await call<{ taskId: number }>(url, {});
      deskRequest.focus = `task-${taskId}`;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if renaming}
  <form
    class="mt-2 flex gap-1.5"
    novalidate
    onsubmit={(e) => {
      e.preventDefault();
      if (newName.trim()) void rename();
    }}
  >
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="min-w-0 flex-1 rounded-lg bg-night/60 px-2 py-1 text-xs outline-none placeholder:text-faint"
      aria-label="A new name for {name}"
      maxlength="60"
      autocomplete="off"
      autofocus
      bind:value={newName}
    />
    <button
      class="rounded-lg bg-sea/25 px-2.5 py-1 text-xs disabled:opacity-40"
      disabled={busy || !newName.trim()}>Save</button
    >
    <button
      class="rounded-lg px-2 py-1 text-xs text-muted hover:text-ink"
      type="button"
      onclick={() => (renaming = false)}>Cancel</button
    >
  </form>
{:else}
  <div class="mt-1.5 flex gap-3">
    <button
      class="text-xs text-muted hover:text-ink"
      onclick={() => {
        newName = name;
        problem = '';
        renaming = true;
      }}>Rename</button
    >
    {#if changes}
      <button
        class="text-xs text-muted hover:text-ink disabled:opacity-40"
        disabled={busy}
        onclick={change}>Change role or Region</button
      >
    {/if}
  </div>
{/if}
{#if problem}
  <p class="mt-1 text-xs text-coral">{problem}</p>
{/if}
