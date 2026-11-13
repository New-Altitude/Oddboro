<script lang="ts">
  import '../app.css';
  import Header from '#lib/components/Header.svelte';
  import Footer from '#lib/components/Footer.svelte';
  import { onMount } from 'svelte';
  import { startTheme } from '#lib/theme.svelte.ts';
  import { startAnalytics } from '#lib/analytics.svelte.ts';
  import ConsentBanner from '#lib/components/ConsentBanner.svelte';
  let { children } = $props();
  onMount(startTheme);
  onMount(startAnalytics);
</script>

<a
  href="#main"
  class="bg-sea text-night fixed start-4 top-4 z-50 -translate-y-24 rounded-md px-4 py-2 font-semibold transition-transform focus-visible:translate-y-0"
>
  Skip to content
</a>
<Header />
<main id="main" tabindex="-1" class="outline-none">
  {@render children()}
</main>
<Footer />
<ConsentBanner />
