<script lang="ts">
  import { onMount } from 'svelte';
  import {
    BODY_LIMIT,
    BUG_REPO,
    ISSUES,
    TITLE_LIMIT,
    browserDraft,
    formStart
  } from '../bug-report.ts';
  import { call } from './api.ts';

  let {
    initial,
    staff,
    onclose,
    onfiled
  }: {
    initial: { title?: string; body: string };
    staff: string;
    onclose: () => void;
    onfiled: () => void;
  } = $props();
  const endpoint = $derived(`/api/staff/${staff}/bug-reports` as const);
  let dialog: HTMLDialogElement;
  let title = $state('');
  let body = $state('');
  let cli = $state(false);
  let posting = $state(false);
  let issue = $state(0);
  let message = $state('');
  let copied = $state('');
  const valid = $derived(
    title.trim() && body.trim() && title.length <= TITLE_LIMIT && body.length <= BODY_LIMIT
  );
  const browser = $derived(browserDraft(title.trim(), body.trim()));

  onMount(() => {
    ({ title, body } = formStart(initial));
    dialog.showModal();
    void call<{ cli: boolean }>(endpoint)
      .then((r) => (cli = r.cli))
      .catch(() => {});
  });

  async function post() {
    if (!valid || posting || issue) return;
    posting = true;
    message = '';
    try {
      const result = await call<{ number: number; saved: boolean }>(endpoint, {
        title: title.trim(),
        body: body.trim()
      });
      issue = result.number;
      if (!result.saved) message = 'The office could not save this link in chat.';
      onfiled();
    } catch (err) {
      cli = false;
      message = err instanceof Error ? err.message : 'Check the issue list before filing again.';
    } finally {
      posting = false;
    }
  }

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(body.trim());
      copied = body.trim();
      message = '';
    } catch {
      message = 'Select the details and copy them, then paste them on GitHub.';
    }
  }
</script>

<!-- Keep the office's window shortcuts out of the report while it is open. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions: the dialog owns its keyboard events. -->
<dialog
  bind:this={dialog}
  aria-label="Report an Oddboro bug"
  class="m-auto max-h-[90dvh] w-[min(30rem,92vw)] overflow-y-auto rounded-2xl border border-hairline bg-panel-solid p-5 text-ink shadow-xl backdrop:bg-night/70"
  onkeydown={(e) => e.stopPropagation()}
  oncancel={(e) => {
    if (posting) e.preventDefault();
  }}
  {onclose}
>
  {#if issue}
    <h2 class="font-pixel text-xl">Bug reported</h2>
    <a
      href={`${ISSUES}/${issue}`}
      target="_blank"
      rel="noopener noreferrer"
      class="mt-2 block text-sea underline">View issue #{issue} on GitHub</a
    >
    {#if message}<p class="mt-2 text-sm text-muted">{message}</p>{/if}
    <button class="mt-4 rounded-lg bg-raise px-3 py-2 text-sm" onclick={() => dialog.close()}
      >Done</button
    >
  {:else}
    <h2 class="font-pixel text-xl">Report an Oddboro bug</h2>
    <p class="mt-1 text-sm text-muted">
      Anyone can read issues in {BUG_REPO} on GitHub. Review the title and details before sharing.
    </p>
    <label class="mt-4 block text-sm"
      >Title
      <input
        class="mt-1 block w-full rounded-lg bg-raise px-3 py-2"
        bind:value={title}
        maxlength={TITLE_LIMIT}
        disabled={posting}
      />
    </label>
    <label class="mt-3 block text-sm"
      >What happened?
      <textarea
        class="mt-1 block w-full rounded-lg bg-raise px-3 py-2"
        rows="6"
        bind:value={body}
        maxlength={BODY_LIMIT}
        disabled={posting}></textarea>
    </label>
    {#if body.length > BODY_LIMIT}
      <p class="mt-2 text-sm text-coral">Shorten the details to {BODY_LIMIT} characters.</p>
    {/if}
    {#if message}
      <p role="alert" class="mt-2 text-sm text-coral">
        {message}
        <a class="underline" href={ISSUES} target="_blank" rel="noopener noreferrer">View issues</a>
      </p>
    {/if}
    {#if browser.copyBody}
      <p class="mt-2 text-sm text-muted">
        The details are too long for a browser link. Copy them, then paste them into the issue on
        GitHub.
      </p>
      <button class="text-sm text-sea underline" disabled={posting} onclick={copyDetails}
        >{copied === body.trim() ? 'Details copied' : 'Copy details'}</button
      >
    {/if}
    <p class="mt-4 text-sm">This posts publicly on GitHub. You need a GitHub account.</p>
    <div class="mt-2 flex flex-wrap justify-end gap-2 text-sm">
      <button
        class="rounded-lg bg-raise px-3 py-2"
        disabled={posting}
        onclick={() => dialog.close()}>Cancel</button
      >
      {#if cli}
        <button
          class="rounded-lg bg-raise px-3 py-2 disabled:opacity-40"
          disabled={!valid || posting}
          onclick={post}
        >
          {posting ? 'Posting…' : 'Post with GitHub CLI'}
        </button>
      {/if}
      <button
        class="rounded-lg bg-sea px-3 py-2 font-medium text-night disabled:opacity-40"
        disabled={!valid || posting}
        onclick={() => window.open(browser.url, '_blank', 'noopener,noreferrer')}
        >Open draft on GitHub</button
      >
    </div>
  {/if}
</dialog>
