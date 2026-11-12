<script lang="ts">
  // A task's response: the words its Odd gets when the owner finishes it. The
  // same editor shows on the Desk and on the task's card in chat, the one place
  // the chat takes a typed answer. A draft belongs to the task, so it survives
  // moving between tasks; a save names the version it opened, so a stale save
  // never overwrites newer words.
  import type { AttachmentRow, TaskRow } from '@oddboro/ledger';
  import { shownPath, workPath } from '@oddboro/ledger/work-paths';
  import { call } from './api.ts';
  import { stepsToGo } from './task-steps.ts';
  import { openFile, wins } from './windows.svelte.ts';
  import {
    current,
    drafts,
    finishWithResponse,
    saved,
    saveResponse,
    staleDraft,
    writing,
    type SavedResponse
  } from './task-response.svelte.ts';

  type Props = {
    task: TaskRow;
    files?: AttachmentRow[];
    /** Show the editor before there is a response: this task's answer is typed here. */
    open?: boolean;
    /** On the task's chat card: Save and finish is here, and the Odd replies in the chat. */
    inChat?: boolean;
    /** The chat is busy, so finishing waits. */
    held?: boolean;
    onfinish?: () => void;
  };
  let { task, files = [], open = false, inChat = false, held = false, onfinish }: Props = $props();
  const row = $derived(current(task));
  const draft = $derived(drafts[task.id]);
  const text = $derived(draft?.text ?? row.response ?? '');
  const stale = $derived(staleDraft(draft, row));
  let pending = $state(false);
  const busy = $derived(writing[task.id] || pending);
  let problem = $state('');
  const field = $derived(`task-response-${task.id}-${inChat ? 'chat' : 'desk'}`);

  function edit(value: string) {
    drafts[task.id] = { text: value, version: draft?.version ?? row.responseVersion };
  }

  async function attempt(work: () => Promise<unknown>) {
    pending = true;
    problem = '';
    try {
      await work();
      return true;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      pending = false;
    }
  }

  /** Start the response from a shared list attached to the task. */
  const startFrom = (f: AttachmentRow) =>
    attempt(async () => {
      saved[task.id] = await call<SavedResponse>(`/api/tasks/${task.id}`, {
        op: 'start-response',
        from: f.path
      });
    });

  const save = () =>
    attempt(() => saveResponse(task.id, { text, version: draft?.version ?? row.responseVersion }));

  async function finish() {
    if (await attempt(() => finishWithResponse(task, { chat: true }))) onfinish?.();
  }
</script>

<section class="{inChat ? 'mt-2' : 'mt-4'} flex flex-col gap-2" aria-label="Task response">
  {#if open || row.response !== null || draft}
    <label for={field} class="text-xs text-muted">Your response</label>
    {#if stale}
      <details open class="rounded-lg bg-raise p-2 text-sm">
        <summary>Saved response · version {row.responseVersion}</summary>
        <pre class="whitespace-pre-wrap">{row.response}</pre>
      </details>
      <button
        class="choice"
        disabled={busy}
        onclick={() => (drafts[task.id] = { text, version: row.responseVersion })}
        >Keep my edit over this version</button
      >
    {/if}
    <textarea
      id={field}
      class="rounded-lg bg-raise p-3 text-sm text-ink"
      rows={inChat ? 4 : 8}
      value={text}
      disabled={busy}
      oninput={(e) => edit(e.currentTarget.value)}></textarea>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      {#if inChat}
        <button
          class="rounded-lg bg-sea px-3 py-2 font-medium text-night disabled:opacity-40"
          disabled={busy || held || stale || !text.trim() || stepsToGo(task.steps) > 0}
          onclick={finish}>Save and finish</button
        >
      {/if}
      <button
        class="rounded-lg bg-raise px-3 py-2 disabled:opacity-40"
        disabled={busy || stale || !text.trim() || (!draft && row.responseVersion > 0)}
        onclick={save}>Save</button
      >
      {#if draft}
        <button
          class="text-muted"
          disabled={busy}
          onclick={() => {
            delete drafts[task.id];
            problem = '';
          }}>Discard draft</button
        >
      {:else if row.responseVersion}
        <span class="text-muted">Saved · version {row.responseVersion}</span>
      {/if}
    </div>
  {:else}
    <div class="flex flex-wrap gap-2 text-xs">
      <button class="rounded-lg bg-raise px-3 py-2" disabled={busy} onclick={() => edit('')}
        >Add a response</button
      >
      {#each files.filter((f) => workPath(f.path) && ['text/markdown', 'text/plain'].includes(f.mediaType)) as f (f.id)}
        <button
          class="rounded-lg bg-raise px-3 py-2"
          disabled={busy || wins.dirty.desk}
          onclick={() => startFrom(f)}>Start response from {shownPath(f.path)}</button
        >
      {/each}
    </div>
  {/if}
  {#if inChat && files.length}
    <!-- Files beside a response are only to read; the answer is the response. -->
    <div class="flex flex-wrap gap-1.5 text-xs">
      {#each files as f (f.id)}
        <button
          class="rounded-lg bg-raise px-2 py-1 text-muted hover:text-ink"
          onclick={() => openFile({ staff: f.staffId, path: f.path, readOnly: true })}
          >Read {shownPath(f.path)}</button
        >
      {/each}
    </div>
  {/if}
  {#if problem}<p role="alert" class="text-xs text-coral">{problem}</p>{/if}
</section>
