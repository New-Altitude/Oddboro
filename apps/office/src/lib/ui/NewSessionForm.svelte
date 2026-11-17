<script module lang="ts">
  /** The terminal Claude Code opened to ask whether it may work in a new folder. */
  export type SetupTerminal = {
    /** The id the office serves the terminal under, and disconnects it by. */
    id: string;
    /** This window's view of it. */
    view: string;
  };
</script>

<script lang="ts">
  import type { ProjectAgent } from '@oddboro/ledger';
  import { PROJECT_WORDS } from '../project-words.ts';
  import MoveConfirm from './MoveConfirm.svelte';
  import ProjectTerminal from './ProjectTerminal.svelte';
  import {
    CHOICE_LABEL,
    choiceState,
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
  // The one exception is which row's move confirm is open: nothing outside the
  // form reads it, and it closes whenever the form does.
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
    /** A list for what the form asks now is on its way. */
    listing: boolean;
    busy: boolean;
    /** The last error's words, and the place it shows. */
    problem: string | undefined;
    place: ErrorPlace | undefined;
    /** The id of the conversation whose row the error shows under. */
    problemRow: string | undefined;
    /** Claude Code's question before it works in a new folder, shown under Start. */
    setup: SetupTerminal | undefined;
    /** The owner typed in the filter. */
    onfilter: () => void;
    /** A change that may list the folder's conversations: typed, committed, the tool, or Refresh list. */
    onchange: (change: FormChange) => void;
    onpick: () => void;
    onpath: (p: SessionPath) => void;
    /** Start, and Start again under Claude Code's question. */
    onstart: () => void;
    onchoose: (c: Choice) => void;
    /** The owner confirmed moving a conversation out of its terminal and into the office. */
    onmove: (c: Choice) => void;
    /** The setup terminal could not send the owner's typing or size. */
    onsetuperror: (text: string) => void;
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
    listing,
    busy,
    problem,
    place,
    problemRow,
    setup,
    onfilter,
    onchange,
    onpick,
    onpath,
    onstart,
    onchoose,
    onmove,
    onsetuperror,
    onhandover
  }: Props = $props();

  const shownCandidates = $derived(candidates.filter((c) => matchesFilter(c, filter)));
  /** Whether the row an error came from is in the list, to show the error under it. */
  const problemRowShown = $derived(shownCandidates.some((c) => c.id === problemRow));
  /** The row whose move confirm is open. */
  let moving = $state<string>();
</script>

<!-- An error on the form, shown only at the place errorPlace gives it. It
     scrolls itself into view as it appears: under a row at the pane's bottom
     edge it would otherwise sit just below what the owner sees. -->
{#snippet alert(at: ErrorPlace)}
  {#if problem && place === at}<p
      role="alert"
      class="text-coral"
      {@attach (n) => n.scrollIntoView({ block: 'nearest' })}
    >
      {problem}
    </p>{/if}
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
    <!-- The account sits on the start path only: a conversation found goes with its own.
         The select clips its own text: WebKit draws a long account on one line past the
         select's edge and can count it as width, which makes the whole form scroll sideways. -->
    {#if fields.account}<label
        >Account <select class="field overflow-hidden" aria-label="Account" bind:value={startIn}
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
    {#if setup}
      <p class="text-ink">{PROJECT_WORDS.trustLine}</p>
      <!-- Never shrinks to fit the form: the form scrolls instead. Squeezed, the
           terminal sends fewer rows than the server takes, and the question is lost. -->
      <div class="flex h-64 shrink-0 flex-col">
        {#key setup.id}<ProjectTerminal
            id={setup.id}
            view={setup.view}
            onerror={onsetuperror}
            onstream={() => {
              // Nothing to attach: a setup terminal is Claude Code's own trust
              // question, with no session whose view the stream would update.
            }}
          />{/key}
      </div>
      <button class="btn self-start" disabled={busy || !folder} onclick={onstart}
        >{PROJECT_WORDS.startAgain}</button
      >
    {/if}
  {/if}
  {#if fields.list}
    {#if fields.refresh}
      <!-- Refresh list sits at the end even while the list is empty or not loaded yet. -->
      <div class="flex items-center gap-2">
        {#if candidates.length}<input
            class="field min-w-0 flex-1"
            type="search"
            aria-label="Filter conversations"
            placeholder="Title, account or ID"
            bind:value={filter}
            oninput={onfilter}
          />{/if}
        <button class="link ms-auto shrink-0" onclick={() => onchange('refresh')}
          >Refresh list</button
        >
      </div>
      {#if listing}<p class="text-xs text-muted">{PROJECT_WORDS.looking}</p>{/if}
    {:else}<p class="text-muted">{NO_FOLDER}</p>{/if}
    <!-- An error from the list itself; a row's own error shows right under that row,
         or here when that row is no longer shown. -->
    {@render alert('list')}
    {#if !problemRowShown}{@render alert('row')}{/if}
    {#if found && !candidates.length}<p class="text-muted">
        No conversations found in this folder.
      </p>{:else if candidates.length && !shownCandidates.length}<p class="text-muted">
        No conversations match.
      </p>{/if}
    {#each shownCandidates as c (c.id)}
      {@const state = choiceState(c, agent)}
      <!-- The move button sits beside the row's button, never inside it: a button in a
           button is not valid, and each must take its own click. -->
      <div class="flex items-start gap-2">
        <button class="btn min-w-0 flex-1 text-start" disabled={busy} onclick={() => onchoose(c)}
          >{c.title}{#if c.mark}{' · '}{c.mark}{/if} · {CHOICE_LABEL[state]} · {new Date(
            c.updated
          ).toLocaleString()} · {c.id.slice(0, 8)}</button
        >{#if state === 'terminal' && c.movable}<button
            class="btn shrink-0"
            disabled={busy}
            onclick={() => (moving = c.id)}>{PROJECT_WORDS.moveButton}</button
          >{/if}
      </div>
      {#if moving === c.id}<MoveConfirm
          {busy}
          onconfirm={() => {
            moving = undefined;
            onmove(c);
          }}
          oncancel={() => (moving = undefined)}
        />{/if}
      {#if c.id === problemRow}{@render alert('row')}{/if}
    {/each}
  {/if}
  {#if fields.handover}{@render alert('list')}
    <p>
      Finish or stop work in the previous Codex window before continuing this conversation here.
    </p>
    <button class="btn self-start" disabled={busy} onclick={onhandover}
      >Hand over this conversation</button
    >{/if}
</div>
