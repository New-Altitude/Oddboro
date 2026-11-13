<script lang="ts">
  // The sticky glass header: the mark, the section nav, the theme control,
  // GitHub, and Get started. The theme control echoes the office's own light
  // control on the floor: Auto follows the system, the sun and the moon hold it.
  import { SECTIONS, SITE } from '#lib/site.ts';
  import { setPick, theme, type Pick } from '#lib/theme.svelte.ts';
  import GitHubMark from './GitHubMark.svelte';

  // Get started has its own button and Open source has the GitHub link, so
  // neither takes a place in the nav, which keeps it on one line.
  const nav = SECTIONS.filter((s) => s.id !== 'get-started' && s.id !== 'open-source');
  const PICKS: { id: Pick; label: string }[] = [
    { id: 'auto', label: 'Theme follows your system' },
    { id: 'day', label: 'Always day' },
    { id: 'night', label: 'Always night' }
  ];
</script>

<header class="glass border-hairline sticky top-0 z-40 border-b">
  <div class="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
    <a href="/" class="flex items-center gap-2.5 rounded-md" aria-label="{SITE.name} home">
      <img src="/logo.png" alt="" width="28" height="28" class="rounded-[6px]" />
      <span class="font-pixel text-ink hidden text-xl leading-none tracking-wide sm:inline">
        {SITE.name}
      </span>
    </a>

    <nav class="hidden flex-1 items-center justify-center gap-1 xl:flex" aria-label="Sections">
      {#each nav as s (s.id)}
        <a
          href="/#{s.id}"
          class="text-muted hover:text-ink hover:bg-raise rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap"
        >
          {s.label}
        </a>
      {/each}
    </nav>

    <div class="ms-auto flex items-center gap-2 xl:ms-0">
      <div class="bg-raise flex rounded-full p-0.5" role="radiogroup" aria-label="Theme">
        {#each PICKS as p (p.id)}
          {@const on = theme.pick === p.id}
          <button
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={p.label}
            title={p.label}
            class="grid h-7 min-w-7 place-items-center rounded-full px-2 text-xs font-medium {on
              ? 'bg-panel-solid text-ink'
              : 'text-muted hover:text-ink'}"
            onclick={() => setPick(p.id)}
          >
            {#if p.id === 'auto'}
              Auto
            {:else if p.id === 'day'}
              <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
                <circle cx="8" cy="8" r="3" fill="currentColor" />
                <path
                  d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linecap="round"
                />
              </svg>
            {:else}
              <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
                <path d="M10.5 2.5a5.5 5.5 0 1 0 3 9.5 5 5 0 0 1-3-9.5z" fill="currentColor" />
              </svg>
            {/if}
          </button>
        {/each}
      </div>
      <a
        href={SITE.github}
        class="text-muted hover:text-ink hover:bg-raise flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium"
        rel="noopener"
        aria-label="GitHub"
      >
        <GitHubMark class="size-4" />
        <span class="hidden sm:inline">GitHub</span>
      </a>
      <a
        href="/#get-started"
        class="bg-sea text-night rounded-md px-3.5 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90"
      >
        Download
      </a>
    </div>
  </div>
</header>
