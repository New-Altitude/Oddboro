<script lang="ts">
  import type { ManagerAdvice } from '#lib/server/pressure-watch.ts';
  let { advice, onreview }: { advice: ManagerAdvice; onreview?: () => void } = $props();
</script>

<aside
  aria-label="Office Manager recommendation"
  class="rounded-md border border-hairline bg-panel-solid p-3 text-sm text-ink"
>
  <div role="status">
    <small class="text-muted">{advice.manager} · Office Manager</small>
    <h2 class="font-pixel">{advice.heading}</h2>
    <p>{advice.detail} {advice.action}</p>
  </div>
  {#if onreview}<button class="text-sea" onclick={onreview}>Review agent processes</button>
  {:else}<a
      class="text-sea"
      href={'/workspace?from=office#pressure-' + advice.resource}
      data-sveltekit-reload>Review agent processes</a
    >{/if}
</aside>
