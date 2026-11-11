<script lang="ts">
  import { call } from './api.ts';
  import type { previewHandoff } from '#lib/server/codex-handoff.ts';
  import type { ChatEntry } from '#lib/staff/chat.ts';

  let {
    handoff,
    onkeep
  }: {
    handoff: Awaited<ReturnType<typeof previewHandoff>>;
    onkeep: (line: ChatEntry, added: boolean) => void;
  } = $props();
  // svelte-ignore state_referenced_locally
  let goalId = $state<number | null>(handoff.goals.length === 1 ? handoff.goals[0].id : null);
  let saving = $state(false);
  let problem = $state('');

  async function keep() {
    saving = true;
    problem = '';
    try {
      const { line, added } = await call<{ line: ChatEntry; added: boolean }>(
        `/api/staff/${handoff.staff}/codex-handoff`,
        { ticket: handoff.ticket, revision: handoff.revision, goalId }
      );
      onkeep(line, added);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<section
  class="mx-3 mb-2 max-h-60 overflow-auto rounded-xl bg-raise p-3 text-sm"
  aria-label="Codex handoff"
>
  <details>
    <summary class="cursor-pointer font-medium">{handoff.title} · from Codex</summary>
    <pre class="mt-2 whitespace-pre-wrap">{handoff.excerpt}</pre>
    <p class="mt-2 text-xs text-muted">{handoff.files.join(' · ')}</p>
  </details>
  {#if handoff.previous}
    <p class="mt-2 text-muted">Another version is already in this chat.</p>
  {/if}
  {#if handoff.goals.length}
    <label class="mt-2 block"
      >Goal
      <select class="ms-1 max-w-full rounded bg-night p-1" bind:value={goalId}>
        <option value={null}>No goal</option>
        {#each handoff.goals as goal (goal.id)}<option value={goal.id}>{goal.title}</option>{/each}
      </select>
    </label>
  {/if}
  <button class="choice mt-2" onclick={keep} disabled={saving}
    >{handoff.previous ? 'Bring this version into chat' : 'Bring into chat'}</button
  >
  {#if problem}<p class="mt-1 text-coral" role="alert">{problem}</p>{/if}
</section>
