<script lang="ts">
  // The analytics question, pinned to the bottom of the screen until the
  // visitor answers. Both answers are the same size: no is as easy as yes.
  import { answer, consent } from '#lib/analytics.svelte.ts';
</script>

{#if consent.asking}
  <div
    role="region"
    aria-label="Analytics cookies"
    class="bg-panel-solid border-hairline fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl rounded-xl border p-4 shadow-lg"
  >
    <p class="text-ink text-sm leading-relaxed">
      May we count your visit? With your yes, PostHog sets a cookie so we can see which pages people
      read and what they click on oddboro.com. It sees nothing from the Oddboro app.
      <a href="/privacy/#analytics" class="text-muted hover:text-ink underline underline-offset-2"
        >Privacy policy</a
      >
    </p>
    <div class="mt-3 flex gap-2">
      <button
        type="button"
        onclick={() => answer(true)}
        class="bg-sea text-night flex-1 rounded-md px-3 py-1.5 text-sm font-semibold hover:opacity-90"
      >
        Allow
      </button>
      <button
        type="button"
        onclick={() => answer(false)}
        class="border-hairline text-ink hover:bg-raise flex-1 rounded-md border px-3 py-1.5 text-sm font-semibold"
      >
        No thanks
      </button>
    </div>
  </div>
{/if}
