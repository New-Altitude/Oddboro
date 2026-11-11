<script lang="ts">
  // An AWS tool already connected can change its role or Region, which puts
  // the AWS step on the desk again and opens it there. Renaming is on the
  // name itself (ServiceName.svelte).
  import { call } from './api.ts';
  import { deskRequest } from './windows.svelte.ts';

  let { id }: { id: string } = $props();

  let busy = $state(false);
  let problem = $state('');

  async function change() {
    busy = true;
    problem = '';
    try {
      const { taskId } = await call<{ taskId: number }>(
        `/api/services/${encodeURIComponent(id)}`,
        {}
      );
      deskRequest.focus = `task-${taskId}`;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<button
  class="mt-1.5 text-xs text-muted hover:text-ink disabled:opacity-40"
  disabled={busy}
  onclick={change}>Change role or Region</button
>
{#if problem}
  <p class="mt-1 text-xs text-coral">{problem}</p>
{/if}
