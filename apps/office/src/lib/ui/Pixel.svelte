<script lang="ts">
  import { getContext } from 'svelte';
  const textOnly = getContext<boolean>('text-only-office');
  import { paint, paintImage } from './atlas.ts';

  type Props = {
    /** An image URL to draw instead of an atlas frame: a drawn portrait or look. */
    src?: string;
    /** Atlas frame key, e.g. "portrait-marshall/default". */
    frame?: string;
    /** Fallback frame if the first is missing. */
    fallback?: string;
    scale?: number;
    crop?: { x: number; y: number; w: number; h: number };
    label: string;
    class?: string;
  };

  let { src, frame, fallback, scale = 2, crop, label, class: cls = '' }: Props = $props();
  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    if (textOnly || !canvas) return;
    const c = canvas;
    const atlasArt = () =>
      (frame ? paint(c, frame, scale, crop) : Promise.resolve(false)).then((ok) => {
        if (!ok && fallback) void paint(c, fallback, scale, crop);
      });
    if (src)
      void paintImage(c, src, scale, crop).then((ok) => {
        if (!ok) void atlasArt();
      });
    else void atlasArt();
  });
</script>

{#if !textOnly}
  <span role="img" aria-label={label} class={cls}
    ><canvas bind:this={canvas} aria-hidden="true" class="block max-h-full max-w-full"
    ></canvas></span
  >
{/if}
