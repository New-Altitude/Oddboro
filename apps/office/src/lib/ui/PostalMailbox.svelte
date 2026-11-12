<script lang="ts">
  // The desk step that picks the one LegalZoom mailbox an Odd reads. The step
  // ticks on the server; the desk reloads with it done.
  import { call } from './api.ts';
  let { taskId, index, odd }: { taskId: number; index: number; odd: string } = $props();
  let inboxes = $state<{ pmb: string; name: string }[] | null>(null);
  let selected = $state('');
  let problem = $state('');
  let busy = $state(false);
  async function choose(save: boolean) {
    busy = true;
    problem = '';
    try {
      if (save)
        await call(`/api/tasks/${taskId}`, { op: 'postal-select', index, value: selected.trim() });
      else {
        const result = await call<{ inboxes: { pmb: string; name: string }[] }>(
          `/api/tasks/${taskId}`,
          { op: 'postal-inboxes', index }
        );
        inboxes = result.inboxes;
        selected = inboxes.length === 1 ? inboxes[0].pmb : '';
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : 'Could not reach LegalZoom.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="mt-2 flex flex-col items-start gap-2 text-xs">
  {#if inboxes === null}
    <button
      class="rounded-lg bg-sea px-3 py-1.5 font-medium text-night disabled:opacity-40"
      disabled={busy}
      onclick={() => choose(false)}>{busy ? 'Connecting' : 'Show my mailboxes'}</button
    >
  {:else}
    <label class="flex w-full flex-col gap-1 text-muted">
      {inboxes.length ? `Mailbox for ${odd}` : 'The mailbox number shown in LegalZoom'}
      {#if inboxes.length}
        <select
          class="rounded-lg bg-night/60 px-2.5 py-1.5 text-ink outline-none"
          bind:value={selected}
        >
          <option value="">Choose a mailbox</option>
          {#each inboxes as box (box.pmb)}<option value={box.pmb}>{box.name} · PMB {box.pmb}</option
            >{/each}
        </select>
      {:else}
        <input
          class="rounded-lg bg-night/60 px-2.5 py-1.5 text-ink outline-none"
          bind:value={selected}
          maxlength="80"
        />
      {/if}
    </label>
    <button
      class="rounded-lg bg-sea px-3 py-1.5 font-medium text-night disabled:opacity-40"
      disabled={busy || !selected.trim()}
      onclick={() => choose(true)}>Let {odd} read PMB {selected || '…'}</button
    >
  {/if}
  {#if problem}<p role="alert" class="text-coral">{problem}</p>{/if}
</div>
