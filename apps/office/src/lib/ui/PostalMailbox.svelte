<script lang="ts">
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
    <button class="act" disabled={busy} onclick={() => choose(false)}>Show my mailboxes</button>
  {:else}
    {#if inboxes.length}
      <label
        >Mailbox for {odd}
        <select class="rounded bg-night p-1 text-ink" bind:value={selected}>
          <option value="">Choose a mailbox</option>
          {#each inboxes as box (box.pmb)}<option value={box.pmb}>{box.name} · PMB {box.pmb}</option
            >{/each}
        </select>
      </label>
    {:else}
      <label
        >Enter the mailbox number shown in LegalZoom
        <input class="rounded bg-night p-1 text-ink" bind:value={selected} maxlength="80" />
      </label>
    {/if}
    <button class="act" disabled={busy || !selected.trim()} onclick={() => choose(true)}
      >Let {odd} read PMB {selected || '…'}</button
    >
  {/if}
  {#if problem}<p role="alert" class="text-coral">{problem}</p>{/if}
</div>
