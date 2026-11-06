<script lang="ts">
  import type { PersonaOffers } from '../persona-offers.svelte.ts';
  import PersonaOffer from '../PersonaOffer.svelte';

  // New Altitude personas, after the sign-in: the offers Setup shows too, with
  // the card's Back and Next. Optional, so Next reads Skip until one is added.
  type Props = { offers: PersonaOffers; onnext: () => void; onback: () => void };
  let { offers, onnext, onback }: Props = $props();

  const added = $derived(
    offers.state?.state === 'ok' && offers.state.offers.some((o) => o.joined !== 'no')
  );
</script>

<div class="text-sm">
  <PersonaOffer {offers} where="onboarding" />
</div>

<div class="mt-4 flex items-center gap-3">
  <button class="btn ghost" onclick={onback}>Back</button>
  <span class="flex-1"></span>
  {#if added}
    <button class="btn primary" onclick={onnext}>Next</button>
  {:else}
    <button class="btn" onclick={onnext}>Skip</button>
  {/if}
</div>
