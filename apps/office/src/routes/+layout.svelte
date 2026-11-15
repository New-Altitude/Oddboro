<script lang="ts">
  import '../app.css';
  import StripReview from '#lib/ui/StripReview.svelte';
  import { page } from '$app/state';
  let { children } = $props();
</script>

{@render children()}

{#if (page.url.pathname === '/' || page.url.pathname === '/workspace') && page.url.searchParams.get('from') !== 'strip'}<StripReview
  />{/if}
