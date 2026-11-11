<script lang="ts">
  import type { PersonaRequest, TaskRow } from '@oddboro/ledger';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import AccountSignIn from './AccountSignIn.svelte';
  import PersonaRequestCard from './PersonaRequestCard.svelte';
  import { PersonaOffers, OFFERS_LINE } from './persona-offers.svelte.ts';
  import { opened } from './PersonaQuiet.svelte';
  let {
    requests,
    from,
    staff,
    tasks,
    onchanged
  }: {
    requests: PersonaRequest[];
    from: string;
    staff: StaffProfile[];
    tasks: TaskRow[];
    onchanged: () => void;
  } = $props();
  const offers = new PersonaOffers();
</script>

<AccountSignIn />
{#if offers.state && offers.state.state !== 'ok'}
  <p class="text-xs text-muted">{OFFERS_LINE[offers.state.state]}</p>
  {#if offers.state.state === 'rescope'}<button
      class="self-start text-sea"
      onclick={() => offers.signInAgain()}>Sign in again for personas</button
    >{/if}
{/if}
{#if offers.signingIn}{@render opened(offers.signingIn, () => (offers.signingIn = undefined))}{/if}
{#if offers.problem}<p class="text-coral" role="alert">{offers.problem}</p>{/if}
<button
  class="self-start text-xs text-sea"
  disabled={offers.busy}
  onclick={() => {
    void offers.load();
    onchanged();
  }}>Check connection again</button
>
{#each requests as request (request.id)}
  <PersonaRequestCard
    {request}
    offers={offers.state?.state === 'ok' ? offers.state.offers : []}
    {staff}
    tasks={tasks.filter((t) => t.staffId === from)}
    {onchanged}
  />
{/each}
