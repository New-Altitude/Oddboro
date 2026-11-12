<script lang="ts" module>
  /** The collapsed panel's width. */
  export const RAIL = 64;
</script>

<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  type Props = {
    /** Which edge it docks to. Logical, so it flips in right-to-left. */
    side: 'start' | 'end';
    label: string;
    width: number;
    collapsed?: boolean;
    min?: number;
    max?: number;
    /** Remembers width and collapse per viewer. */
    storageKey: string;
    children: Snippet;
    /** What shows when collapsed. Without it, the panel cannot collapse. */
    rail?: Snippet;
    /** Space kept free at its edge, in px, for something docked there (the Odds rail). */
    inset?: number;
    /** Paints over the other side panel, where the two overlap. */
    onTop?: boolean;
    /**
     * Stretch across the screen, keeping this many px free at the far edge,
     * never narrower than `width`. Set, the panel cannot be dragged, and a
     * change of it slides.
     */
    reach?: number;
  };
  let {
    side,
    label,
    width = $bindable(),
    collapsed = $bindable(false),
    min = 320,
    max = 960,
    storageKey,
    children,
    rail,
    inset = 0,
    onTop = false,
    reach
  }: Props = $props();
  const size = $derived.by(() => {
    const own = `min(${collapsed && rail ? RAIL : width}px, calc(100vw - ${24 + inset}px))`;
    return reach === undefined ? own : `max(${own}, calc(100vw - ${16 + reach}px))`;
  });

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as {
        width?: number;
        collapsed?: boolean;
      } | null;
      if (saved?.width) width = clamp(saved.width);
      if (rail && typeof saved?.collapsed === 'boolean') collapsed = saved.collapsed;
    } catch {
      // No storage: the default width it is.
    }
  });

  function remember() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ width, collapsed }));
    } catch {
      // Private window: the size lasts this visit only.
    }
  }

  const clamp = (w: number) => Math.round(Math.max(min, Math.min(max, w, window.innerWidth - 96)));

  /** Dragging toward the middle of the screen widens the panel, in either direction. */
  function grows() {
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    return (side === 'end') !== rtl ? -1 : 1;
  }

  let drag: { x: number; w: number; sign: number } | undefined;
  function down(e: PointerEvent) {
    drag = { x: e.clientX, w: width, sign: grows() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (drag) width = clamp(drag.w + (e.clientX - drag.x) * drag.sign);
  }
  function up() {
    if (!drag) return;
    drag = undefined;
    remember();
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 96 : 24;
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    width = clamp(width + dir * step * grows());
    remember();
  }

  $effect(() => {
    void collapsed;
    remember();
  });
</script>

<aside
  class="panel glass pointer-events-auto absolute top-4 bottom-4 flex rounded-2xl max-sm:top-3 max-sm:bottom-3"
  class:start-4={side === 'start'}
  class:end-4={side === 'end' && !inset}
  class:z-10={onTop}
  class:reaching={reach !== undefined}
  style="inline-size: {size}{inset ? `; inset-inline-end: ${16 + inset}px` : ''}"
  aria-label={label}
>
  {#if collapsed && rail}
    {@render rail()}
  {:else if reach === undefined}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions: a focusable separator is the ARIA pattern for a keyboard-resizable pane. -->
    <div
      class="handle"
      class:at-start={side === 'end'}
      class:at-end={side === 'start'}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${label.toLowerCase()}`}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabindex="0"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onkeydown={key}
    ></div>
  {/if}
  <!-- Children stay mounted while collapsed, so nothing in them is lost. -->
  <div class="min-w-0 flex-1" class:hidden={collapsed && rail}>
    {@render children()}
  </div>
</aside>

<style>
  .handle {
    position: absolute;
    inset-block: 16px;
    inline-size: 10px;
    cursor: col-resize;
    touch-action: none;
    z-index: 1;
  }
  .handle.at-start {
    inset-inline-start: -5px;
  }
  .handle.at-end {
    inset-inline-end: -5px;
  }
  .handle::after {
    content: '';
    position: absolute;
    inset-block: 40%;
    inset-inline-start: 4px;
    inline-size: 2px;
    border-radius: 2px;
    background: var(--color-hairline);
    opacity: 0;
    transition: opacity 150ms;
  }
  .handle:hover::after,
  .handle:focus-visible::after {
    opacity: 1;
  }
  .handle:focus-visible {
    outline: none;
  }
  .panel {
    overflow: visible;
  }
  /* The same 200 ms as the Odds rail, so the two move as one. */
  .panel.reaching {
    transition: inline-size 200ms ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .panel.reaching {
      transition: none;
    }
  }
</style>
