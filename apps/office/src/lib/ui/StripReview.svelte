<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { FLOOR_CHANNEL } from './office-link.ts';
  import { RETURN_TO_STRIP, reviewTarget, reviewUrl } from './strip-review.ts';

  let target = $state(''),
    dialog = $state<HTMLDialogElement>(),
    frame = $state<HTMLIFrameElement>();
  let channel: BroadcastChannel;
  function close() {
    if (!target) return;
    dialog?.close();
    target = '';
    channel.postMessage({ type: RETURN_TO_STRIP });
  }
  onMount(() => {
    channel = new BroadcastChannel(FLOOR_CHANNEL);
    async function open(event: Event) {
      if (!(event instanceof CustomEvent) || !reviewTarget(event.detail?.review)) return;
      target = event.detail.review;
      await tick();
      if (target && dialog && !dialog.open) dialog.showModal();
      frame?.focus();
    }
    function returned(event: MessageEvent) {
      if (
        event.origin === location.origin &&
        event.source === frame?.contentWindow &&
        event.data === RETURN_TO_STRIP
      )
        close();
    }
    window.addEventListener('oddboro:open', open);
    window.addEventListener('message', returned);
    return () => {
      channel.close();
      window.removeEventListener('oddboro:open', open);
      window.removeEventListener('message', returned);
    };
  });
</script>

<!-- Keep the main page and its unsent edits mounted. The review owns its Workspace state. -->
{#if target}
  <dialog
    bind:this={dialog}
    aria-label="Review from Office strip"
    oncancel={(e) => {
      e.preventDefault();
      close();
    }}
  >
    <button class="self-end px-3 py-1 text-sea" onclick={close}>Back to strip · Esc</button>
    <iframe bind:this={frame} src={reviewUrl(target)} title="Review in Workspace"></iframe>
  </dialog>
{/if}

<style>
  dialog {
    margin: auto;
    inline-size: min(60rem, 96vw);
    block-size: min(54rem, 94dvh);
    background: var(--color-night);
    color: var(--color-ink);
    border: 1px solid var(--color-hairline);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  iframe {
    width: 100%;
    flex: 1;
    min-height: 0;
    border: 0;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.5);
  }
</style>
