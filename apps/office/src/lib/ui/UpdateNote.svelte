<script lang="ts">
  import { call } from './api.ts';
  import UpdateReady, { type UpdateAction, type UpdateStatus } from './UpdateReady.svelte';

  // The floor's notice of a ready update, under the office's name, with
  // Install now, Install tonight and Wait. Wait hides it until the app next
  // opens; Setup's Updates section still shows the update. `changed` goes up
  // each time the update row changes, so the page's one live line drives it
  // and nothing polls.
  let { changed }: { changed: number } = $props();
  let update = $state<UpdateStatus | undefined>();
  let busy = $state(false);
  let problem = $state('');

  $effect(() => {
    void changed;
    call<UpdateStatus>('/api/update').then(
      (u) => (update = u),
      () => {}
    );
  });

  async function act(action: UpdateAction) {
    problem = '';
    busy = true;
    try {
      update = await call<UpdateStatus>('/api/update', { action });
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if update?.managed && update.ready && !update.waited}
  <div class="mt-2 flex flex-col gap-2">
    <UpdateReady {update} {busy} {act} />
    {#if problem}
      <p class="rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral" role="alert">{problem}</p>
    {/if}
  </div>
{/if}
