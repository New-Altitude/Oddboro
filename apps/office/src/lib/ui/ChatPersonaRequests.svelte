<script lang="ts">
  import { untrack } from 'svelte';
  import type { PersonaRequest, TaskRow } from '@oddboro/ledger';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import { call } from './api.ts';
  import ChatPersonaSetup from './ChatPersonaSetup.svelte';
  import PersonaRequestCard from './PersonaRequestCard.svelte';
  let {
    from,
    version,
    staff,
    tasks
  }: { from: string; version: number; staff: StaffProfile[]; tasks: TaskRow[] } = $props();
  let requests = $state<PersonaRequest[]>([]);
  let problem = $state('');
  let show = $state(false);
  async function load(id = from) {
    try {
      requests = await call<PersonaRequest[]>(
        `/api/persona-requests?from=${encodeURIComponent(id)}`
      );
      problem = '';
    } catch {
      problem = 'Connection requests did not load. Try again.';
    }
  }
  $effect(() => {
    version;
    const id = from;
    untrack(() => {
      void load(id);
    });
  });
  const waiting = $derived(
    requests.filter((r) => r.state !== 'cancelled' && r.state !== 'connected')
  );
  const connected = $derived(requests.filter((r) => r.state === 'connected').slice(0, 5));
</script>

{#if waiting.length || connected.length || problem}
  <section class="flex flex-col gap-2" aria-label="Persona connections">
    {#if waiting.length}<ChatPersonaSetup
        requests={waiting}
        {from}
        {staff}
        {tasks}
        onchanged={() => {
          void load();
        }}
      />{/if}
    {#if connected.length}
      <details bind:open={show}>
        <summary class="cursor-pointer text-xs text-muted">Connected requests</summary>
        {#each connected as request (request.id)}<PersonaRequestCard
            {request}
            offers={[]}
            {staff}
            tasks={[]}
            onchanged={() => {
              void load();
            }}
          />{/each}
      </details>
    {/if}
    {#if problem}<p class="text-coral" role="alert">{problem}</p>
      <button class="text-sea" onclick={() => load()}>Try again</button>{/if}
  </section>
{/if}
