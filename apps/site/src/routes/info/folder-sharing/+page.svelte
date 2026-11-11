<script lang="ts">
  // Why the office refuses some folders and warns before others. The office's
  // folder warning links here (`FolderWarning.svelte`), so keep its words in
  // step with `checkFolder` in the ledger.
  import LegalDoc from '#lib/components/LegalDoc.svelte';
  import Meta from '#lib/components/Meta.svelte';
  import { SITE } from '#lib/site.ts';

  let { data } = $props();
</script>

<Meta
  title="{data.doc.title} · {SITE.name}"
  description="Which folders to give an Odd, which ones {SITE.name} refuses, and why a whole drive warns first."
  path="/info/folder-sharing/"
/>

<LegalDoc doc={data.doc} eyebrow="Safety" />
