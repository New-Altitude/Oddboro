<script lang="ts">
  // A long document, readable: a contents list from its ## headings, and the
  // body set in a measure that suits a legal text.
  import type { LegalDoc } from '#lib/server/legal.ts';
  import { SITE } from '#lib/site.ts';

  /** `eyebrow` is the small label over the title. */
  let { doc, eyebrow = 'Legal' }: { doc: LegalDoc; eyebrow?: string } = $props();
</script>

<article class="mx-auto max-w-7xl px-4 pt-14 pb-24 sm:px-6 lg:px-8">
  <header class="border-hairline max-w-3xl border-b pb-8">
    <p class="text-sea mb-3 text-sm font-semibold tracking-wide uppercase">{eyebrow}</p>
    <h1 class="font-pixel text-ink text-4xl leading-[1.05] sm:text-5xl">
      {doc.title}
    </h1>
  </header>

  {#if doc.missing}
    <p class="text-muted mt-10 max-w-3xl text-lg leading-relaxed">
      This document is on its way. Until it lands here, write to us through
      <a
        href={SITE.github}
        class="text-ink underline decoration-[color:var(--color-sea)]"
        rel="noopener">GitHub</a
      >.
    </p>
  {:else}
    <div class="mt-10 gap-12 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
      {#if doc.toc.length}
        <nav aria-label="Contents" class="mb-10 lg:sticky lg:top-24 lg:mb-0 lg:self-start">
          <p class="text-faint mb-3 text-xs font-semibold tracking-wide uppercase">Contents</p>
          <ol class="border-hairline flex flex-col gap-1 border-s">
            {#each doc.toc as item (item.id)}
              <li>
                <a
                  href="#{item.id}"
                  class="text-muted hover:text-ink hover:border-sea -ms-px block border-s border-transparent ps-4 py-1 text-sm leading-snug"
                >
                  {item.text}
                </a>
              </li>
            {/each}
          </ol>
        </nav>
      {/if}
      <!-- Safe: markdown-it runs with html off, so every tag here is one it made from our own file. -->
      <div class="legal max-w-3xl">{@html doc.html}</div>
    </div>
  {/if}
</article>

<style>
  .legal {
    color: var(--color-muted);
    font-size: 1.0625rem;
    line-height: 1.7;
  }
  .legal :global(h2) {
    color: var(--color-ink);
    font-family: var(--font-pixel);
    font-size: 1.75rem;
    line-height: 1.15;
    margin-block: 2.5rem 1rem;
    scroll-margin-top: 6rem;
  }
  .legal :global(h3) {
    color: var(--color-ink);
    font-size: 1.125rem;
    font-weight: 600;
    margin-block: 2rem 0.5rem;
    scroll-margin-top: 6rem;
  }
  .legal :global(h2:first-child) {
    margin-block-start: 0;
  }
  .legal :global(p) {
    margin-block: 0 1.1rem;
  }
  .legal :global(ul),
  .legal :global(ol) {
    margin-block: 0 1.1rem;
    padding-inline-start: 1.5rem;
  }
  .legal :global(ul) {
    list-style: disc;
  }
  .legal :global(ol) {
    list-style: decimal;
  }
  .legal :global(li) {
    margin-block: 0.35rem;
  }
  .legal :global(li::marker) {
    color: var(--color-faint);
  }
  .legal :global(strong) {
    color: var(--color-ink);
    font-weight: 600;
  }
  .legal :global(a) {
    color: var(--color-ink);
    text-decoration: underline;
    text-decoration-color: var(--color-sea);
    text-underline-offset: 3px;
  }
  .legal :global(a:hover) {
    color: var(--color-sea);
  }
  .legal :global(code) {
    background: var(--color-raise);
    border-radius: 4px;
    font-size: 0.9em;
    padding: 0.1em 0.35em;
  }
  .legal :global(blockquote) {
    border-inline-start: 2px solid var(--color-hairline);
    margin: 0 0 1.1rem;
    padding-inline-start: 1rem;
  }
  .legal :global(table) {
    border-collapse: collapse;
    margin-block: 0 1.5rem;
    width: 100%;
    font-size: 0.95em;
  }
  .legal :global(th),
  .legal :global(td) {
    border-bottom: 1px solid var(--color-hairline);
    padding: 0.5rem 0.75rem 0.5rem 0;
    text-align: start;
    vertical-align: top;
  }
  .legal :global(th) {
    color: var(--color-ink);
    font-weight: 600;
  }
  .legal :global(hr) {
    border: 0;
    border-top: 1px solid var(--color-hairline);
    margin-block: 2.5rem;
  }
</style>
