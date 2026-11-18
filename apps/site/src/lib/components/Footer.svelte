<script lang="ts">
  import { SITE } from '#lib/site.ts';
  import GitHubMark from './GitHubMark.svelte';
  import { askAgain } from '#lib/analytics.svelte.ts';

  const year = new Date().getFullYear();
  const link = 'text-muted hover:text-ink rounded-md text-sm';
</script>

<footer class="border-hairline border-t">
  <div
    class="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8"
  >
    <div>
      <div class="flex items-center gap-2.5">
        <img src="/logo.png" alt="" width="24" height="24" class="rounded-[5px]" />
        <span class="font-pixel text-ink text-lg leading-none">{SITE.name}</span>
      </div>
      <p class="text-muted mt-3 text-sm">{SITE.tagline}</p>
    </div>

    <nav class="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Footer">
      <a href="/releases/" class={link}>Releases</a>
      <a href="/privacy/" class={link}>Privacy</a>
      <a href="/terms/" class={link}>Terms</a>
      <button type="button" onclick={askAgain} class={link}>Cookie settings</button>
      <a href="{SITE.github}/blob/main/LICENSE" class={link} rel="noopener">License</a>
      <a href={SITE.github} class="{link} flex items-center gap-1.5" rel="noopener">
        <GitHubMark class="size-4" />
        GitHub
      </a>
    </nav>
  </div>
  <div class="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
    <p class="text-faint max-w-3xl text-xs leading-relaxed">
      The code is open source under the Apache License 2.0. That license does not cover the music
      that ships with the office: see
      <a
        href="{SITE.github}/blob/main/LICENSE-ASSETS"
        class="hover:text-muted underline"
        rel="noopener"
      >
        LICENSE-ASSETS</a
      >. It also grants no rights to the Oddboro name.
    </p>
    <p class="text-faint mt-3 text-xs">© {year} {SITE.company}</p>
  </div>
</footer>
