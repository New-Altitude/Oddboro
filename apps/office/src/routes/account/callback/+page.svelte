<script lang="ts">
  import CallbackCard from '#lib/ui/CallbackCard.svelte';

  let { data } = $props();
</script>

<CallbackCard title={data.title} message={data.message} />
