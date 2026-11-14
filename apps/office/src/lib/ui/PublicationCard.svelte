<script lang="ts">
  import type { PublicationCard } from '@oddboro/ledger';
  let {
    card,
    name,
    discuss,
    markRead
  }: { card: PublicationCard; name: string; discuss: () => void; markRead: (id: number) => void } =
    $props();
  let element: HTMLElement;
  $effect(() => {
    if (!element || card.read) return;
    const id = card.id;
    let onScreen = false;
    function seen() {
      if (onScreen && document.visibilityState === 'visible') markRead(id);
    }
    const observer = new IntersectionObserver(([e]) => {
      onScreen = !!e?.isIntersecting;
      seen();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', seen);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', seen);
    };
  });
</script>

<article bind:this={element} class="me-auto grid max-w-[85%] gap-1 rounded-xl bg-raise p-3 text-sm">
  <p class="text-xs text-muted">
    New from {name} · {card.kind === 'article' ? 'Article' : 'Video'} · {new Date(
      card.publishedAt
    ).toLocaleDateString()}
  </p>
  <strong>{card.title}</strong>
  {#if card.withdrawn}<p>This publication is no longer available.</p>{:else}<div class="flex gap-3">
      <a class="text-sea underline" href={card.url} target="_blank" rel="noopener noreferrer"
        >{card.kind === 'article' ? 'Read article' : 'Watch video'}</a
      ><button class="text-sea" type="button" onclick={discuss}>Discuss</button>
    </div>{/if}
</article>
