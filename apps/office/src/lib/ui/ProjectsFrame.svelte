<script lang="ts">
  import type { Snippet } from 'svelte';

  // The Projects window's frame: the title row, and the sessions list beside the
  // open session or the start form. Focus folds the title row and the list away,
  // so a session's terminal fills the window.
  type Props = {
    /** The owner chose Focus, and a connected session's terminal shows. */
    focused: boolean;
    /** What the sessions list holds. */
    list: Snippet;
    /** The open session, or the start form. */
    children: Snippet;
  };
  let { focused, list, children }: Props = $props();
</script>

<section class="projects-window flex h-full min-h-0 flex-col text-sm" aria-label="Projects">
  {#if !focused}
    <header class="flex items-center gap-3 border-b border-hairline px-3 py-2">
      <h2 class="font-pixel text-lg leading-none">Projects</h2>
      <span class="min-w-0 flex-1 truncate text-xs text-muted"
        >Claude Code and Codex in your own folders, with your permissions</span
      >
    </header>
  {/if}
  <div class="panes flex min-h-0 flex-1">
    <!-- The sessions, down the start side. The list scrolls on its own. -->
    {#if !focused}
      <nav
        class="flex w-60 shrink-0 flex-col border-e border-hairline max-sm:w-40"
        aria-label="Sessions"
      >
        {@render list()}
      </nav>
    {/if}
    {@render children()}
  </div>
</section>

<style>
  /* The window is a container, so the list's place follows the window's own width,
     which the panel's drag and the screen's width change. */
  .projects-window {
    container-type: inline-size;
  }
  /* Too narrow for the list beside the form, the list stacks above it as a strip and
     the panes scroll. The form needs about 12.5rem: its widest button that cannot wrap,
     "Start a new conversation" (about 10.5rem at the buttons' size), and its padding
     both sides (2rem). Beside it the list takes w-60 (15rem), or max-sm:w-40 (10rem) on
     a narrow screen. 27.5rem is the wider list plus the form, so a narrow panel on a
     wide screen never squeezes the form; on a narrow screen the list stacks a little
     early (a 22.5rem to 27.5rem window), which only costs the strip. At a 340px or 390px
     screen the window is 236px or 286px wide beside the closed rail, so it stacks. */
  @container (max-width: 27.5rem) {
    .panes {
      flex-direction: column;
      overflow-y: auto;
    }
    nav {
      inline-size: auto;
      max-block-size: calc(100% / 3);
      border-inline-end-width: 0;
      border-block-end: 1px solid var(--color-hairline);
    }
  }
</style>
