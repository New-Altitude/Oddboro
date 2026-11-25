<script lang="ts">
  // A count in a circle, centred on the line it sits in: amber for what waits
  // on the owner, teal for what the owner has not read. Screen readers hear
  // the words, not the bare number.
  type Props = { n: number; tone: 'waiting' | 'unread' };
  let { n, tone }: Props = $props();
  const words = $derived(tone === 'waiting' ? `${n} waiting on you` : `${n} unread`);
</script>

<span
  class="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold text-night tabular-nums {tone ===
  'waiting'
    ? 'bg-ember'
    : 'bg-sea'}"
  title={words}><span aria-hidden="true">{n}</span><span class="sr-only">, {words}</span></span
>
