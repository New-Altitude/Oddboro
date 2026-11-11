<script module lang="ts">
  // The New Altitude page a sign-in opened, linked again because Safari can
  // block a window opened after an await. Add, Reconnect and Sign in again
  // all show it.
  export { opened };
</script>

<script lang="ts">
  import { QUIET_LINE, type Quiet } from '#lib/persona.ts';
  import { checkAgain, connect, personas } from './persona-offers.svelte.ts';

  // A quiet persona Odd: why it stays quiet and the one thing that wakes it.
  // The chat and the persona's offer both show this one.
  type Props = { slug: string; name: string; quiet: Quiet };
  let { slug, name, quiet }: Props = $props();

  const BUTTON: Record<Quiet, { label: string; act: () => Promise<void> }> = {
    access: { label: 'Check again', act: () => checkAgain(slug, name) },
    grant: { label: 'Reconnect', act: () => connect(slug) },
    'signed-out': { label: 'Reconnect', act: () => connect(slug) }
  };
  const mine = $derived(personas[slug]);
</script>

{#snippet opened(url: string, cancel: () => void)}
  <p class="leading-relaxed text-ink">Finish signing in on the page that opened.</p>
  <div class="mt-2 flex flex-wrap items-center gap-3">
    <a class="text-sea underline underline-offset-2" href={url} target="_blank" rel="noopener"
      >Open the sign-in page</a
    >
    <button
      class="rounded-lg bg-raise px-3 py-2 font-medium text-ink hover:bg-sea/20"
      onclick={cancel}>Cancel</button
    >
  </div>
{/snippet}

<div class="flex flex-col gap-2">
  <p class="leading-relaxed text-ink">{QUIET_LINE[quiet](name)}</p>
  {#if mine?.waiting}
    {@render opened(mine.waiting, () => (personas[slug] = {}))}
  {:else}
    <button
      class="self-start rounded-lg bg-raise px-3 py-2 font-medium text-ink hover:bg-sea/20 disabled:opacity-40"
      disabled={mine?.busy}
      onclick={BUTTON[quiet].act}>{BUTTON[quiet].label}</button
    >
  {/if}
  {#if mine?.problem}
    <p class="rounded-lg bg-coral/15 px-3 py-2 text-coral" role="alert">{mine.problem}</p>
  {/if}
</div>
