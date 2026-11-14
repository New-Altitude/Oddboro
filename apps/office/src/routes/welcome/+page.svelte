<svelte:head><title>Choose your view · Oddboro</title></svelte:head>
<main class="min-h-screen grid place-content-center bg-paper px-6 text-ink">
  <section class="max-w-md">
    <p class="text-sm">Oddboro</p>
    <h1 class="my-4 text-3xl font-semibold">Choose your view</h1>
    <p class="mb-6">Both views open the same conversations and work. You can switch at any time.</p>
    <form method="GET" action="/" data-sveltekit-reload>
      <input type="hidden" name="view" value="office" />
      <button aria-label="Office" class="mb-3 block w-full rounded border border-line p-4 text-start"
        ><strong>Office</strong><span class="block text-sm"
          >Walk around the office and meet your Odds.</span
        ></button
      >
    </form>
    <form method="GET" action="/workspace" data-sveltekit-reload>
      <button aria-label="Workspace" class="block w-full rounded border border-line p-4 text-start"
        ><strong>Workspace</strong><span class="block text-sm"
          >Manage work, decisions, and conversations in a list.</span
        ></button
      >
    </form>
  </section>
</main>
