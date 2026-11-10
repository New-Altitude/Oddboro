<script lang="ts">
  // The page a sign-in comes back to, in the browser that signed in. It needs
  // nothing from the office: the owner may land here in a browser that never
  // opened it.
  type Props = { title: string; message: string };
  let { title, message }: Props = $props();
</script>

<svelte:head>
  <title>{title} · Oddboro</title>
</svelte:head>

<main class="grid h-full place-items-center p-6">
  <div class="glass max-w-md rounded-2xl p-6">
    <div class="font-pixel text-xl">{title}</div>
    <p class="mt-2 text-sm text-muted">{message}</p>
  </div>
</main>
