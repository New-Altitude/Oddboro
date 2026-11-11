<script lang="ts">
  import { isPicture, sizeWords } from '#lib/attachments.ts';

  // Files on a chat message. On a sent message they wrap in a row: a picture
  // as a thumbnail, anything else as a chip with its size, each opening in
  // the browser. In the tray beside the box (`stack`) they stand in one
  // column of small squares, each with a ✕.
  type Shown = { key: string | number; tag: string; mediaType: string; size: number; url?: string };
  type Props = {
    files: Shown[];
    onremove?: (key: string | number) => void;
    /** On the owner's side of the chat. */
    end?: boolean;
    /** One column of small squares, for the tray. */
    stack?: boolean;
  };
  let { files, onremove, end = false, stack = false }: Props = $props();

  const ext = (f: Shown) => (f.tag.includes('.') ? f.tag.split('.').pop()! : 'file');
</script>

{#snippet doc(cls: string)}
  <svg
    class={cls}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.3"
    stroke-linejoin="round"
    aria-hidden="true"><path d="M4 1.5h5.5L13 5v9.5H4z" /><path d="M9.5 1.5V5H13" /></svg
  >
{/snippet}

<div class={stack ? 'flex flex-col gap-2' : `flex flex-wrap gap-2 ${end ? 'justify-end' : ''}`}>
  {#each files as f (f.key)}
    <div class="relative" title={`${f.tag} · ${sizeWords(f.size)}`}>
      <svelte:element
        this={onremove || !f.url ? 'div' : 'a'}
        href={onremove ? undefined : f.url}
        target={onremove ? undefined : '_blank'}
        rel={onremove ? undefined : 'noopener'}
        class="block"
      >
        {#if stack}
          <figure class="flex w-12 flex-col gap-0.5">
            {#if isPicture(f.mediaType) && f.url}
              <img
                src={f.url}
                alt={f.tag}
                class="size-12 rounded-lg border border-hairline bg-raise object-cover"
              />
            {:else}
              <div
                class="flex size-12 flex-col items-center justify-center gap-0.5 rounded-lg border border-hairline bg-raise text-muted"
              >
                {@render doc('size-4')}
                <span class="max-w-11 truncate text-[9px] uppercase">{ext(f)}</span>
              </div>
            {/if}
            <figcaption class="truncate text-[10px] text-faint">{f.tag}</figcaption>
          </figure>
        {:else if isPicture(f.mediaType) && f.url}
          <figure class="flex w-16 flex-col gap-0.5">
            <img
              src={f.url}
              alt={f.tag}
              class="size-16 rounded-lg border border-hairline bg-raise object-cover"
            />
            <figcaption class="truncate text-[10px] text-faint">{f.tag}</figcaption>
          </figure>
        {:else}
          <div
            class="flex max-w-52 items-center gap-2 rounded-lg border border-hairline bg-raise py-1.5 ps-2 pe-3"
          >
            {@render doc('size-4 shrink-0 text-muted')}
            <span class="min-w-0">
              <span class="block truncate text-xs text-ink">{f.tag}</span>
              <span class="block text-[10px] text-faint">{sizeWords(f.size)}</span>
            </span>
          </div>
        {/if}
      </svelte:element>
      {#if onremove}
        <button
          type="button"
          class="absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-hairline bg-panel-solid text-[10px] text-muted hover:text-coral"
          aria-label={`Remove ${f.tag}`}
          onclick={() => onremove(f.key)}>✕</button
        >
      {/if}
    </div>
  {/each}
</div>
