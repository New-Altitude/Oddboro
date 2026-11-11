<script lang="ts">
  // A service's name, with a pencil that edits it in place. Enter or Save
  // keeps the new name and Escape drops it. A change reaches every list
  // through the connectors table's change event.
  import { call } from './api.ts';
  import IconButton from './IconButton.svelte';

  let { id, name }: { id: string; name: string } = $props();

  let editing = $state(false);
  let draft = $state('');
  let busy = $state(false);
  let problem = $state('');

  async function save() {
    const next = draft.trim();
    if (!next || next === name) return void (editing = false);
    busy = true;
    problem = '';
    try {
      await call(`/api/services/${encodeURIComponent(id)}`, { name: next }, 'PATCH');
      editing = false;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if editing}
  <form
    class="flex min-w-0 gap-1.5"
    novalidate
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <input
      class="min-w-0 flex-1 rounded-lg bg-night/60 px-2 py-0.5 text-sm font-medium outline-none"
      aria-label="A new name for {name}"
      maxlength="60"
      autocomplete="off"
      {@attach (n) => n.select()}
      bind:value={draft}
      onkeydown={(e) => {
        if (e.key === 'Escape') editing = false;
      }}
    />
    <button
      class="rounded-lg bg-sea/25 px-2.5 py-0.5 text-xs disabled:opacity-40"
      disabled={busy || !draft.trim()}>Save</button
    >
  </form>
  {#if problem}
    <p class="mt-1 text-xs text-coral">{problem}</p>
  {/if}
{:else}
  <div class="flex min-w-0 items-center gap-1.5">
    <span class="min-w-0 truncate font-medium">{name}</span>
    <IconButton
      icon="pencil"
      word="Edit name"
      label="Edit the name of {name}"
      onclick={() => {
        draft = name;
        problem = '';
        editing = true;
      }}
    />
  </div>
{/if}
