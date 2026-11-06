<script lang="ts">
  import { askAbout } from './file-links.ts';
  import { renderMarkdown } from './markdown.ts';
  import { openInBrowser } from './viewer.ts';
  import { openFile, type FileRef } from './windows.svelte.ts';

  const fileOf = (el: Element, attr: string): FileRef => {
    const [staff, ...rest] = (el.getAttribute(attr) ?? '').split(':');
    return { staff, path: rest.join(':') };
  };

  /**
   * Clicks on a file link open the viewer instead of following it. A page's
   * button asks the office to open it in the browser; when it cannot, the
   * button says why until the text renders again.
   */
  function fileLinks(node: HTMLElement) {
    const click = (e: MouseEvent) => {
      const target = e.target as Element;
      const page = target.closest('button[data-page]');
      if (page instanceof HTMLButtonElement) {
        page.disabled = true;
        openInBrowser(fileOf(page, 'data-page'))
          .catch((err: unknown) => {
            page.textContent = err instanceof Error ? err.message : String(err);
          })
          .finally(() => (page.disabled = false));
        return;
      }
      const a = target.closest('a[data-file]');
      if (!a) return;
      e.preventDefault();
      openFile(fileOf(a, 'data-file'));
    };
    node.addEventListener('click', click);
    return () => node.removeEventListener('click', click);
  }

  let {
    text,
    staff,
    class: cls = ''
  }: {
    text: string;
    /** Who wrote it, so a path inside its folder links. */
    staff?: string;
    class?: string;
  } = $props();
  const rendered = $derived(renderMarkdown(text, staff));
  // Once per render, for names no page has asked about; the answers render it again.
  $effect(() => void askAbout(rendered.unknown));
</script>

<!-- Safe: markdown-it runs with html off, so every tag here is one it made. -->
<div class="md {cls}" {@attach fileLinks}>{@html rendered.html}</div>

<style>
  .md {
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .md :global(:where(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4)) {
    margin-block: 0 0.6em;
  }
  .md :global(:where(p, ul, ol, pre, blockquote, table):last-child) {
    margin-block-end: 0;
  }
  .md :global(:where(h1, h2, h3, h4)) {
    font-weight: 600;
    color: var(--color-ink);
    margin-block-start: 0.9em;
  }
  .md :global(:where(h1, h2, h3, h4):first-child) {
    margin-block-start: 0;
  }
  .md :global(h1) {
    font-size: 1.15em;
  }
  .md :global(h2) {
    font-size: 1.05em;
  }
  .md :global(:where(h3, h4)) {
    font-size: 1em;
  }
  .md :global(:where(ul, ol)) {
    padding-inline-start: 1.25em;
  }
  .md :global(ul) {
    list-style: disc;
  }
  .md :global(ol) {
    list-style: decimal;
  }
  .md :global(li + li) {
    margin-block-start: 0.2em;
  }
  .md :global(li::marker) {
    color: var(--color-muted);
  }
  .md :global(strong) {
    font-weight: 600;
    color: var(--color-ink);
  }
  .md :global(a) {
    color: var(--color-sea);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .md :global(.open-page) {
    margin-inline-start: 0.5em;
    padding: 0 0.5em;
    border: 1px solid var(--color-hairline);
    border-radius: 4px;
    font-size: 0.85em;
    color: var(--color-sea);
  }
  .md :global(code) {
    font-size: 0.9em;
    padding: 0.1em 0.35em;
    border-radius: 4px;
    background: rgb(0 0 0 / 0.3);
  }
  .md :global(pre) {
    padding: 0.6em 0.75em;
    border-radius: 8px;
    background: rgb(0 0 0 / 0.3);
    overflow-x: auto;
  }
  .md :global(pre code) {
    padding: 0;
    background: none;
  }
  .md :global(blockquote) {
    padding-inline-start: 0.75em;
    border-inline-start: 2px solid var(--color-hairline);
    color: var(--color-muted);
  }
  .md :global(hr) {
    border: 0;
    border-block-start: 1px solid var(--color-hairline);
    margin-block: 0.8em;
  }
  .md :global(table) {
    border-collapse: collapse;
    font-size: 0.92em;
  }
  .md :global(:where(th, td)) {
    padding: 0.25em 0.6em;
    border-block-end: 1px solid var(--color-hairline);
    text-align: start;
  }
</style>
