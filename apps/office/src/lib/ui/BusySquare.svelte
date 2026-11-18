<script lang="ts">
  // The page's sign that a window is still drawing, beside its tab or its
  // kind on the plate. `class` sets only its spacing.
  let { class: cls = '' }: { class?: string } = $props();
</script>

<span class="busy {cls}" aria-label="drawing"></span>

<style>
  /* A window still drawing: a pixel square that blinks. */
  .busy {
    display: inline-block;
    inline-size: 6px;
    block-size: 6px;
    background: var(--color-sea);
    animation: busy 0.8s steps(1) infinite;
  }
  @keyframes busy {
    50% {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .busy {
      animation: none;
    }
  }
</style>
