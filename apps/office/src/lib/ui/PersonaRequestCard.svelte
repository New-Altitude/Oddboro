<script lang="ts">
  import type { PersonaRequest, TaskRow } from '@oddboro/ledger';
  import type { Offer } from '#lib/persona.ts';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import { call } from './api.ts';
  import { connect, personas } from './persona-offers.svelte.ts';
  import { opened } from './PersonaQuiet.svelte';
  let {
    request,
    offers,
    staff,
    tasks,
    onchanged
  }: {
    request: PersonaRequest;
    offers: Offer[];
    staff: StaffProfile[];
    tasks: TaskRow[];
    onchanged: () => void;
  } = $props();
  let slug = $state('');
  let target = $state('');
  let superseded = $state<number[]>([]);
  let busy = $state(false);
  let problem = $state('');
  const selected = $derived(offers.find((o) => o.slug === slug));
  const consent = $derived(personas[request.slug ?? slug]);
  async function choose() {
    busy = true;
    problem = '';
    try {
      await call('/api/persona-requests', {
        op: 'map',
        id: request.id,
        slug,
        staffId: target || null,
        supersededTasks: superseded
      });
      onchanged();
      await connect(slug);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  async function cancel() {
    try {
      await call('/api/persona-requests', { op: 'cancel', id: request.id });
      onchanged();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<article
  class="flex flex-col gap-2 rounded-lg border border-hairline bg-raise/50 p-3 text-xs"
  aria-label={`Connect ${request.identity}`}
>
  <p class="font-semibold text-ink">Connect {request.identity}</p>
  <p class="text-muted">Continue: {request.continuation}</p>
  {#if request.state === 'connected'}
    <p>
      Connected to {request.slug}. {request.resumedAt
        ? 'The original request was resumed once.'
        : 'The original work is no longer active, so no new run started.'}
    </p>
    {#if request.staffId}
      <a
        class="text-sea underline"
        href={`/api/persona-requests?revisions=${encodeURIComponent(request.staffId)}`}
        target="_blank"
        rel="noopener">Read the previous instructions and access</a
      >
    {/if}
  {:else}
    {#if request.state === 'approved'}
      <p>
        Waiting for {request.slug}. {request.staffId
          ? `Keep Odd ${request.staffId}.`
          : 'Use its offered Odd.'}
      </p>
      <button
        class="self-start text-sea"
        disabled={consent?.busy}
        onclick={() => connect(request.slug!)}>Finish connection</button
      >
    {:else}
      <label class="flex flex-col gap-1"
        >Offered persona
        <select
          class="rounded bg-night p-2 text-ink"
          bind:value={slug}
          onchange={() => (target = '')}
        >
          <option value="">Choose the identity you meant</option>
          {#each offers as o (o.slug)}<option value={o.slug}>{o.displayName} ({o.slug})</option
            >{/each}
        </select>
      </label>
      {#if !offers.length}<p>
          No persona offer is available here yet. Sign in or check again. This request stays open.
        </p>{/if}
      {#if selected}
        <p>{selected.disclosure}</p>
        <p>
          Instructions: {selected.role}. {selected.remit} Its coding tool prepares facts; the New Altitude
          persona supplies its judgment. The question and preparation leave this computer.
        </p>
        {#if selected.joined !== 'installed'}
          <label class="flex flex-col gap-1"
            >Odd to use
            <select class="rounded bg-night p-2 text-ink" bind:value={target}>
              <option value="">Add the offered Odd; keep existing Odds</option>
              {#each staff.filter((s) => !s.persona && s.id !== request.requesterId) as s (s.id)}<option
                  value={s.id}>Keep {s.name}'s ID and history ({s.id})</option
                >{/each}
            </select>
          </label>
        {:else}<p>
            This persona is already installed. Existing ordinary Odds will stay as they are.
          </p>{/if}
        {#if target}<p>
            The same Odd keeps its chat, notes, files and goals. Its old instructions and access
            remain readable as a revision. Jobs pause. Folder, connector and project access must be
            granted again.
          </p>{/if}
        {#if tasks.length}
          <details>
            <summary class="cursor-pointer text-muted">Review old setup tasks to withdraw</summary>
            <p>
              Check only tasks this verified connection replaces. They will be withdrawn with a
              reason, not marked successful.
            </p>
            {#each tasks as task (task.id)}
              <label class="my-2 flex gap-2"
                ><input type="checkbox" bind:group={superseded} value={task.id} /><span
                  >{task.title}: {task.why}</span
                ></label
              >
            {/each}
          </details>
        {/if}
        <button
          class="self-start rounded bg-sea px-3 py-2 font-medium text-night disabled:opacity-40"
          disabled={busy}
          onclick={choose}
          >{target ? 'Approve conversion and connect' : 'Use this persona and connect'}</button
        >
      {/if}
    {/if}
    {#if consent?.waiting}{@render opened(
        consent.waiting,
        () => (personas[request.slug ?? slug] = {})
      )}{/if}
    {#if consent?.problem}<p class="text-coral" role="alert">{consent.problem}</p>{/if}
    <button class="self-start text-muted" disabled={busy} onclick={cancel}
      >Cancel this connection request</button
    >
  {/if}
  {#if problem}<p class="text-coral" role="alert">{problem}</p>{/if}
</article>
