<script lang="ts">
  import LegalDoc from '#lib/components/LegalDoc.svelte';
  import Meta from '#lib/components/Meta.svelte';
  import { SITE } from '#lib/site.ts';

  let { data } = $props();
</script>

<Meta
  title="{data.doc.title} · {SITE.name}"
  description="How {SITE.name} treats your data. The short version: the office runs on your computer, and this site asks before PostHog counts your visit."
  path="/privacy/"
/>

<LegalDoc doc={data.doc} />
