<script lang="ts">
  import LegalDoc from '#lib/components/LegalDoc.svelte';
  import Meta from '#lib/components/Meta.svelte';
  import { SITE } from '#lib/site.ts';

  let { data } = $props();
</script>

<Meta
  title="{data.doc.title} · {SITE.name}"
  description="Save a copy of your Odds, files and work history, and reopen it if your office needs recovery."
  path="/info/backup-and-restore/"
/>
<LegalDoc doc={data.doc} eyebrow="Your office" />
