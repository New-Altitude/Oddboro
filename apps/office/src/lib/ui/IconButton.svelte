<script lang="ts">
  // A pixel icon as a button, with its word shown on hover or focus, beside
  // it on the `side` there is room for. `danger` turns it coral on hover.
  import PixelIcon from './PixelIcon.svelte';

  type Props = {
    icon: 'pencil' | 'refresh' | 'trash';
    /** The word on hover ("Revoke"). */
    word: string;
    /** What a screen reader says, when the word alone is too short. */
    label?: string;
    side?: 'start' | 'end';
    danger?: boolean;
    disabled?: boolean;
    onclick: () => void;
  };
  let {
    icon,
    word,
    label = word,
    side = 'end',
    danger = false,
    disabled = false,
    onclick
  }: Props = $props();
</script>

<button
  class="group/icon relative -m-1 flex items-center p-1 text-muted focus-visible:text-ink disabled:opacity-40 {danger
    ? 'hover:text-coral'
    : 'hover:text-ink'}"
  aria-label={label}
  {disabled}
  {onclick}
>
  <PixelIcon name={icon} />
  <span
    class="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-md bg-night px-1.5 py-0.5 text-[11px] whitespace-nowrap text-ink opacity-0 group-hover/icon:opacity-100 group-focus-visible/icon:opacity-100 {side ===
    'end'
      ? 'start-full ms-1'
      : 'end-full me-1'}"
    aria-hidden="true">{word}</span
  >
</button>
