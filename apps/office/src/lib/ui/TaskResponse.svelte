<script lang="ts">
  import type { AttachmentRow, TaskRow } from '@oddboro/ledger';
  import { shownPath, workPath } from '@oddboro/ledger/work-paths';
  import { call } from './api.ts';
  import { stepsToGo } from './task-steps.ts';
  import { wins } from './windows.svelte.ts';
  import { showInChat } from './chat-about.svelte.ts';
  import {
    corrections,
    current,
    drafts,
    saved,
    saveResponse,
    staleDraft,
    writing,
    type SavedResponse
  } from './task-response.svelte.ts';

  let {
    task,
    files = [],
    inChat = false
  }: { task: TaskRow; files?: AttachmentRow[]; inChat?: boolean } = $props();
  const row = $derived(current(task));
  const draft = $derived(drafts[task.id]);
  const text = $derived(draft?.text ?? row.response ?? '');
  const correction = $derived(task.staffId ? corrections[task.staffId] : undefined);
  const held = $derived(writing[task.id] || correction?.id === task.id);
  const stale = $derived(staleDraft(draft, row));
  let problem = $state('');
  let box: HTMLTextAreaElement | undefined = $state();
  const field = $derived(`task-response-${task.id}-${inChat ? 'chat' : 'desk'}`);
  let pending = $state(false);
  async function finish() {
    pending = true;
    problem = '';
    try {
      await call(`/api/tasks/${task.id}`, { op: 'finish', version: row.responseVersion });
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      pending = false;
    }
  }

  function edit(value: string) {
    drafts[task.id] = { text: value, version: draft?.version ?? row.responseVersion };
  }

  async function startFrom(f?: AttachmentRow) {
    writing[task.id] = true;
    problem = '';
    try {
      saved[task.id] = await call<SavedResponse>(`/api/tasks/${task.id}`, {
        op: 'start-response',
        from: f?.path
      });
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      delete writing[task.id];
    }
  }

  async function save() {
    problem = '';
    try {
      await saveResponse(task.id, { text, version: draft?.version ?? row.responseVersion });
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  function correct() {
    if (!task.staffId || !box) return;
    const start = box.selectionStart;
    const end = box.selectionEnd;
    const selected = end > start;
    corrections[task.staffId] = {
      id: task.id,
      title: task.title,
      version: draft?.version ?? row.responseVersion,
      before: selected ? text.slice(0, start) : text + (text ? '\n\n' : ''),
      after: selected ? text.slice(end) : '',
      passage: selected ? text.slice(start, end) : '',
      words: ''
    };
    showInChat(task.staffId, { kind: 'task', id: task.id, title: task.title });
  }
</script>

<section class="mt-4 flex flex-col gap-2" aria-label="Task response">
  {#if row.response !== null || draft}
    <label for={field} class="text-xs text-muted">Your response</label>
    {#if stale && !inChat}
      <details open class="rounded-lg bg-raise p-2 text-sm">
        <summary>Saved response · version {row.responseVersion}</summary>
        <pre class="whitespace-pre-wrap">{row.response}</pre>
      </details>
      <button
        class="choice"
        disabled={held}
        onclick={() => (drafts[task.id] = { text, version: row.responseVersion })}
        >Keep my edit over this version</button
      >
    {/if}
    <textarea
      id={field}
      readonly={inChat || task.status !== 'open'}
      class="rounded-lg bg-raise p-3 text-sm"
      rows={inChat ? 4 : 8}
      value={text}
      disabled={held || pending}
      oninput={(e) => edit(e.currentTarget.value)}
      bind:this={box}></textarea>
    {#if task.status === 'open'}
      <div class="flex flex-wrap items-center gap-2 text-xs">
        {#if !inChat}<button
            class="rounded-lg bg-sea px-3 py-2 text-night disabled:opacity-40"
            disabled={held || stale || !text.trim() || (!draft && row.responseVersion > 0)}
            onclick={save}>Save response</button
          >{/if}
        {#if task.staffId}
          <button
            class="rounded-lg bg-raise px-3 py-2 disabled:opacity-40"
            disabled={held || pending || stale || !!correction}
            onclick={correct}>Change in chat</button
          >
        {/if}
        {#if inChat && row.responseVersion}
          <button
            class="rounded-lg bg-raise px-3 py-2 disabled:opacity-40"
            disabled={pending || held || !!draft || wins.dirty.desk || stepsToGo(task.steps) > 0}
            onclick={finish}>Mark done</button
          >
        {/if}
        {#if draft && !inChat}
          <button
            class="text-muted"
            disabled={held || pending}
            onclick={() => {
              delete drafts[task.id];
              problem = '';
            }}>Discard draft</button
          >
        {:else if row.responseVersion}
          <span class="text-muted">Saved · version {row.responseVersion}</span>
        {/if}
      </div>
      {#if task.staffId}
        <p class="text-xs text-faint">Select words to replace in chat, or add a paragraph.</p>
      {/if}
    {/if}
  {:else}
    <div class="flex flex-wrap gap-2 text-xs">
      <button
        class="rounded-lg bg-raise px-3 py-2"
        disabled={held || wins.dirty.desk}
        onclick={() => startFrom()}>Add a response</button
      >
      {#each files.filter((f) => workPath(f.path) && ['text/markdown', 'text/plain'].includes(f.mediaType)) as f (f.id)}
        <button
          class="rounded-lg bg-raise px-3 py-2"
          disabled={held || wins.dirty.desk}
          onclick={() => startFrom(f)}>Start response from {shownPath(f.path)}</button
        >
      {/each}
    </div>
  {/if}
  {#if problem}<p role="alert" class="text-xs text-coral">{problem}</p>{/if}
</section>
