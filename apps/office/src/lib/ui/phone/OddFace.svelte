<script lang="ts">
  // An Odd's face on the phone: its drawn portrait, else its atlas portrait,
  // else its sprite, as `Pixel.svelte` tries them. When none draws, the first
  // letter of its name on the square, in the office's tokens.
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import { paint, paintImage } from '#lib/ui/atlas.ts';

  type Props = { odd?: StaffProfile; name?: string; class?: string };
  let { odd, name, class: cls = 'size-10 rounded-lg' }: Props = $props();
  const label = $derived(name ?? odd?.name ?? '?');
  let canvas: HTMLCanvasElement | undefined = $state();
  let drawn = $state(true);

  $effect(() => {
    const c = canvas;
    const o = odd;
    if (!c || !o) {
      drawn = false;
      return;
    }
    void (async () => {
      const ok =
        (o.look?.portrait ? await paintImage(c, o.look.portrait, 1) : false) ||
        (await paint(c, `${o.portrait}/default`, 1)) ||
        (await paint(c, `${o.sprite}@${o.variant}/idle-down-0`, 1));
      drawn = ok;
    })();
  });
</script>

<span
  role="img"
  aria-label={label}
  class="flex shrink-0 items-center justify-center overflow-hidden bg-sea-deep {cls}"
>
  {#if odd}
    <canvas
      bind:this={canvas}
      aria-hidden="true"
      class="size-full object-contain [image-rendering:pixelated]"
      style:display={drawn ? undefined : 'none'}
    ></canvas>
  {/if}
  {#if !drawn || !odd}
    <span aria-hidden="true" class="text-lg font-medium text-ink"
      >{label.trim().charAt(0).toUpperCase() || '?'}</span
    >
  {/if}
</span>
