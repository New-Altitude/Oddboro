<script lang="ts">
  import type { Snippet } from 'svelte';
  import Pixel from './Pixel.svelte';
  import { chatAbout } from './chat-about.svelte.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  // Select text inside, and a Chat button offers to talk it over with any
  // staffer: the one who wrote it first. Their chat opens with the passage
  // quoted, for the owner to add their question.
  type Props = {
    staff: StaffProfile[];
    /** Who wrote the text. */
    author: string | null;
    /** What the text is, e.g. 'report "Weekly inbox sweep"'. */
    what: string;
    children: Snippet;
  };
  let { staff, author, what, children }: Props = $props();

  /** The selected text and where its button sits, relative to the root. */
  let picked = $state<{ text: string; x: number; y: number } | undefined>();
  let choosing = $state(false);

  function track(node: HTMLDivElement) {
    const changed = () => {
      if (choosing) return;
      const sel = document.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (
        !sel ||
        !text ||
        !sel.rangeCount ||
        !node.contains(sel.getRangeAt(0).commonAncestorContainer)
      ) {
        picked = undefined;
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const box = node.getBoundingClientRect();
      picked = {
        text,
        x: Math.min(Math.max(0, r.left - box.left + r.width / 2), box.width),
        y: r.bottom - box.top
      };
    };
    document.addEventListener('selectionchange', changed);
    return () => document.removeEventListener('selectionchange', changed);
  }

  const people = $derived(
    [...staff].sort((a, b) => Number(b.id === author) - Number(a.id === author))
  );

  function start(p: StaffProfile) {
    if (!picked) return;
    const writer = staff.find((s) => s.id === author);
    const whose = p.id === author ? 'your' : writer ? `${writer.name}'s` : 'the';
    const quote = picked.text
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    chatAbout(p.id, `About ${whose} ${what}:\n\n${quote}\n\n`);
    close();
    document.getSelection()?.removeAllRanges();
  }

  function close() {
    choosing = false;
    picked = undefined;
  }

  function keys(e: KeyboardEvent) {
    if (e.key === 'Escape' && picked) {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window onkeydown={keys} />

<div class="relative" {@attach track}>
  {@render children()}
  {#if picked}
    <div
      class="absolute z-10 -translate-x-1/2 pt-1.5"
      style:inset-inline-start={`${picked.x}px`}
      style:inset-block-start={`${picked.y}px`}
    >
      {#if !choosing}
        <button
          class="rounded-full bg-sea px-3 py-1 text-xs font-medium text-night shadow-lg"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => (choosing = true)}>Chat</button
        >
      {:else}
        <div
          class="w-56 rounded-xl border border-hairline bg-night p-1.5 shadow-lg"
          role="menu"
          aria-label="Chat with"
        >
          <div class="px-2 py-1 text-[11px] text-muted">Chat about this with</div>
          {#each people as p (p.id)}
            <button
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-sea/20"
              role="menuitem"
              onclick={() => start(p)}
            >
              <Pixel
                src={p.look?.portrait}
                frame={`${p.portrait}/default`}
                fallback={`${p.sprite}@${p.variant}/idle-down-0`}
                scale={1}
                label={p.name}
                class="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-sea-deep"
              />
              <span class="min-w-0 flex-1">
                <span class="block text-sm text-ink">{p.name}</span>
                <span class="block truncate text-[11px] text-faint"
                  >{p.id === author ? 'Wrote this' : p.role}</span
                >
              </span>
            </button>
          {/each}
          <button
            class="mt-0.5 w-full rounded-lg px-2 py-1 text-start text-[11px] text-muted hover:text-ink"
            onclick={close}>Cancel</button
          >
        </div>
      {/if}
    </div>
  {/if}
</div>
