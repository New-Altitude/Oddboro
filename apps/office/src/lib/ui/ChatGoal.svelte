<script lang="ts">
  import { newTurnId } from '../staff/chat-input.ts';
  import { call } from './api.ts';

  // The manager's New goal field. The chat's plus menu opens it (`open`).
  let {
    managerId,
    onset,
    open = $bindable(false)
  }: { managerId: string; onset: () => void; open?: boolean } = $props();
  let title = $state('');
  let busy = $state(false);
  let problem = $state('');
  let result = $state('');
  let pending: { title: string; requestId: string } | undefined;
  let field: HTMLInputElement | undefined = $state();
  /** Put the caret in the goal field, as New goal does once it opens it. */
  export function focus() {
    field?.focus();
  }
  // Opening the field starts it fresh.
  $effect(() => {
    if (!open) return;
    result = '';
    problem = '';
  });

  async function setGoal(e: SubmitEvent) {
    e.preventDefault();
    const words = title.trim();
    if (!words || busy) return;
    busy = true;
    problem = '';
    try {
      if (pending?.title !== words) {
        pending = { title: words, requestId: newTurnId() };
      }
      const saved = await call<{ title: string }>('/api/goals', { ...pending, managerId });
      result = `Goal set: ${saved.title}`;
      pending = undefined;
      title = '';
      open = false;
      onset();
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if open || result}
  <div class="px-3 pb-1 text-xs">
    {#if open}
      <form class="flex flex-col gap-1.5 pb-2" onsubmit={setGoal}>
        <label class="text-muted" for="chat-goal">Goal to set</label>
        <input
          bind:this={field}
          id="chat-goal"
          class="rounded-lg bg-raise px-2.5 py-2 text-sm text-ink"
          bind:value={title}
          maxlength="140"
          disabled={busy}
        />
        {#if problem}<p role="alert" class="text-coral">{problem}</p>{/if}
        <div class="flex gap-2">
          <button class="choice" type="button" disabled={busy} onclick={() => (open = false)}
            >Cancel</button
          >
          <button class="choice" disabled={busy || !title.trim()}>Set goal</button>
        </div>
      </form>
    {:else}
      <span class="text-muted" role="status">{result}</span>
    {/if}
  </div>
{/if}
