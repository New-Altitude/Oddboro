<script lang="ts">
  import { PROJECT_WORDS } from '../project-words.ts';

  // Asks once, in place, before the office ends a conversation in its terminal
  // and opens it here. The same confirm shows under a listed row and in place
  // of a session's Reconnect, so its words and buttons live here once.
  type Props = {
    /** An action is under way, so the confirming button waits for it. */
    busy: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  };
  let { busy, onconfirm, oncancel }: Props = $props();
  const id = $props.id();
</script>

<div
  class="flex max-w-80 flex-col items-center gap-2 rounded-lg bg-ember/10 p-2"
  role="alertdialog"
  aria-labelledby="move-{id}"
>
  <p id="move-{id}" class="text-ink">{PROJECT_WORDS.moveConfirm}</p>
  <div class="flex gap-2">
    <button class="btn" disabled={busy} onclick={onconfirm}>{PROJECT_WORDS.moveButton}</button
    ><button class="btn" onclick={oncancel}>{PROJECT_WORDS.moveCancel}</button>
  </div>
</div>
