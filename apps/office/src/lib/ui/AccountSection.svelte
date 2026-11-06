<script lang="ts">
  import AccountSignIn from './AccountSignIn.svelte';
  import { signOut } from './account-actions.ts';
  import { account } from './account.svelte.ts';
  import PersonaOffer from './PersonaOffer.svelte';
  import { PersonaOffers } from './persona-offers.svelte.ts';

  // The Setup window's Account section: the same sign-in as the first-visit
  // card (with its Switch account), and Sign out while a sign-in is kept, ran
  // out or not. Under it, the New Altitude personas offered while signed in.
  // The offers stay mounted when signed out, which shows nothing, so Sign in
  // again's page link lasts through the sign-out it starts with.
  const personas = new PersonaOffers();
  let busy = $state(false);
  let problem = $state('');

  async function onSignOut() {
    busy = true;
    problem = '';
    try {
      await signOut();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section class="flex flex-col gap-2 text-xs" aria-label="Account">
  <h3 class="tracking-[0.16em] text-sea uppercase">Account</h3>
  <div>
    <AccountSignIn />
  </div>
  {#if account.status.state !== 'out'}
    <button
      class="self-start rounded-lg bg-raise px-3 py-2 font-medium hover:bg-sea/20 disabled:opacity-40"
      disabled={busy}
      onclick={onSignOut}>Sign out</button
    >
  {/if}
  {#if problem}
    <p class="rounded-lg bg-coral/15 px-3 py-2 text-coral" role="alert">{problem}</p>
  {/if}
  <PersonaOffer offers={personas} where="setup" />
</section>
