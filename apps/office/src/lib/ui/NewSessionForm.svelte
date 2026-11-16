<script lang="ts">
  import type { ProjectAgent } from '@oddboro/ledger';
  import {
    matchesFilter,
    NO_FOLDER,
    type Choice,
    type ErrorPlace,
    type Folder,
    type FormChange,
    type NewSessionFields,
    type SessionPath
  } from './project-form.ts';

  // The Projects window's New session form. ProjectSessions.svelte keeps every
  // piece of state and every action; this only shows them and reports clicks.
  type Props = {
    folder: string;
    agent: ProjectAgent;
    socket: string;
    name: string;
    /** The Claude folder Start uses. */
    startIn: string;
    /** What the owner typed to narrow the conversations found. */
    filter: string;
    path: SessionPath | undefined;
    fields: NewSessionFields;
    folders: Folder[];
    candidates: Choice[];
    found: boolean;
    busy: boolean;
    /** The last error's words, and the place it shows. */
    problem: string | undefined;
    place: ErrorPlace | undefined;
    /** A change that may list the folder's conversations: typed, committed, the tool, or Refresh list. */
    onchange: (change: FormChange) => void;
    onpick: () => void;
    onpath: (p: SessionPath) => void;
    onstart: () => void;
    onchoose: (c: Choice) => void;
    onhandover: () => void;
  };
  let {
    folder = $bindable(),
    agent = $bindable(),
    socket = $bindable(),
    name = $bindable(),
    startIn = $bindable(),
    filter = $bindable(),
    path,
    fields,
    folders,
    candidates,
    found,
    busy,
    problem,
    place,
    onchange,
    onpick,
    onpath,
    onstart,
    onchoose,
    onhandover
  }: Props = $props();

  const shownCandidates = $derived(candidates.filter((c) => matchesFilter(c, filter)));
</script>

<!-- An error on the form, shown only at the place errorPlace gives it. -->
{#snippet alert(at: ErrorPlace)}
  {#if problem && place === at}<p role="alert" class="text-coral">{problem}</p>{/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
  <h3 class="text-xs tracking-[0.16em] text-sea uppercase">New session</h3>
  {@render alert('top')}
  <label
    >Project folder <input
      class="field w-full"
      bind:value={folder}
      oninput={() => onchange('typed')}
      onchange={() => onchange('folder')}
      placeholder="Folder path, such as ~/my-project"
    /></label
  >
  <div class="flex flex-wrap gap-2">
    <button class="btn" onclick={onpick}>Choose folder</button>
    <select
      class="field"
      aria-label="Coding tool"
      bind:value={agent}
      onchange={() => onchange('tool')}
      ><option value="claude">Claude Code</option><option value="codex">Codex</option></select
    >
  </div>
  {@render alert('folder')}
  {#if fields.socket}<details>
      <summary class="cursor-pointer text-muted">Connect to a running Codex server</summary><label
        >Private local socket <input
          class="field w-full"
          bind:value={socket}
          placeholder="/path/to/private/codex.sock"
          oninput={() => onchange('typed')}
        /></label
      >
      <p class="text-xs text-muted">
        Choose the socket used by the original Codex window. Leave it empty to use the office
        server.
      </p>
    </details>{/if}
  <fieldset>
    <legend class="mb-2 text-xs text-muted">What would you like to do?</legend>
    <div class="flex flex-wrap gap-2">
      <button
        class="btn"
        class:on={path === 'start'}
        aria-pressed={path === 'start'}
        onclick={() => onpath('start')}>Start a new conversation</button
      ><button
        class="btn"
        class:on={path === 'continue'}
        aria-pressed={path === 'continue'}
        onclick={() => onpath('continue')}>Continue an earlier one</button
      >
    </div>
  </fieldset>
  {#if fields.start}
    <!-- The account sits on the start path only: a conversation found goes with its own. -->
    {#if fields.account}<label class="max-w-full min-w-0"
        >Account <select class="field max-w-full min-w-0" aria-label="Account" bind:value={startIn}
          >{#each folders as f (f.path)}<option value={f.path}>{f.mark}</option>{/each}</select
        ></label
      >{/if}
    <label
      >Session name <input
        class="field w-full"
        bind:value={name}
        placeholder="Optional"
        maxlength="200"
      /></label
    >
    <button class="btn self-start" disabled={busy || !folder} onclick={onstart}>Start</button>
    {@render alert('start')}
  {/if}
  {#if fields.list}
    {#if fields.refresh}
      <!-- Refresh list sits at the end even while the list is empty, as after /bg. -->
      <div class="flex items-center gap-2">
        {#if candidates.length}<input
            class="field min-w-0 flex-1"
            type="search"
            aria-label="Filter conversations"
            placeholder="Title, account or ID"
            bind:value={filter}
          />{/if}
        <button class="link ms-auto shrink-0" onclick={() => onchange('refresh')}
          >Refresh list</button
        >
      </div>
    {:else}<p class="text-muted">{NO_FOLDER}</p>{/if}
    <!-- Above the rows, so an error from a row near the bottom of a long list is seen. -->
    {@render alert('list')}
    {#if found && !candidates.length}<p class="text-muted">
        No conversations found in this folder.
      </p>{:else if candidates.length && !shownCandidates.length}<p class="text-muted">
        No conversations match.
      </p>{/if}
    {#each shownCandidates as c (c.id)}<button
        class="btn text-start"
        disabled={busy}
        onclick={() => onchoose(c)}
        >{c.title}{#if c.mark}{' · '}{c.mark}{/if} · {c.live ? 'Running' : 'Saved'} · {new Date(
          c.updated
        ).toLocaleString()} · {c.id.slice(0, 8)}</button
      >{/each}
  {/if}
  {#if fields.handover}{@render alert('list')}
    <p>
      Finish or stop work in the previous Codex window before continuing this conversation here.
    </p>
    <button class="btn self-start" disabled={busy} onclick={onhandover}
      >Hand over this conversation</button
    >{/if}
</div>
