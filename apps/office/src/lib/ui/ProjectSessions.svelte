<script module lang="ts">
  import type { ProjectSession, ProjectStatus } from '@oddboro/ledger';

  export type View = {
    connected: boolean;
    terminal: boolean;
    turn?: string;
    requestId?: string;
    note: string;
    /** The whole sentence telling the owner about this session's Claude folder: a newer copy in another, or a move there. */
    folderNotice: string | null;
    reply: string;
    market?: string;
    account?: string;
    question?: {
      key: string;
      id: string | number;
      method: string;
      params: Record<string, unknown>;
    };
  };
  /** `mark` names a Claude session's folder and its login now; null for Codex, or a folder not known yet. */
  export type Row = ProjectSession & {
    status: ProjectStatus;
    connected: boolean;
    mark: string | null;
  };
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { ProjectAgent, ProjectRequest } from '@oddboro/ledger';
  import type { StaffProfile } from '../staff/roster.ts';
  import { PROJECT_WORDS } from '../project-words.ts';
  import MoveConfirm from './MoveConfirm.svelte';
  import Pixel from './Pixel.svelte';
  import { projectApi } from './project-api.ts';
  import NewSessionForm, { type SetupTerminal } from './NewSessionForm.svelte';
  import './project-sessions.css';
  import {
    choiceState,
    errorPlace,
    errorShows,
    filterClears,
    listAsk,
    listFor,
    lists,
    newSessionFields,
    rowsFor,
    sameAsk,
    type Choice,
    type ErrorSource,
    type Folder,
    type FormChange,
    type Found,
    type ListAsk,
    type ListCount,
    type SessionPath
  } from './project-form.ts';
  import ProjectTerminal from './ProjectTerminal.svelte';
  import ProjectsFrame from './ProjectsFrame.svelte';
  import SessionDetails from './SessionDetails.svelte';
  import { focusRemembered, rememberFocus } from './projects-focus.ts';
  import { LOGOS } from './tool-logos.ts';
  import { advanced, projectsFocus, type ProjectAsk } from './windows.svelte.ts';

  // The Projects window, which widens the side panel while it is in front:
  // every session down the start side as a tab list, and the selected one
  // filling the rest, its native terminal under a slim header. Details fold out over the terminal,
  // so the terminal never moves. "+ New session" opens the start form here.
  type Props = {
    staff: StaffProfile[];
    /** Bumps when the office's records change, so the list reads again. */
    version: number;
    /** A session to open, from the Desk or a chat. `n` bumps on each ask. */
    ask: ProjectAsk;
  };
  let { staff, version, ask }: Props = $props();

  let connections = $state<Row[]>([]),
    currentId = $state<string>(),
    work = $state<ProjectRequest[]>([]),
    view = $state<View>(),
    folders = $state<Folder[]>([]),
    /** The Claude folder Start uses. */
    startIn = $state(''),
    /** The owner's answer to "What would you like to do?" on the New session form. */
    path = $state<SessionPath>(),
    /** What the owner typed to narrow the conversations found. */
    filter = $state('');
  let socket = $state(''),
    folder = $state(''),
    agent = $state<ProjectAgent>('claude'),
    draft = $state(''),
    file = $state(''),
    name = $state(''),
    replies = $state<Record<string, string>>({});
  let busy = $state(false),
    /** The last error, what raised it, which says where it shows, and the row it came from.
     * A list's error keeps what it asked about, and shows only while the form asks the same. */
    problem = $state<{ text: string; from: ErrorSource; row?: string; ask?: ListAsk }>(),
    handover = $state<Choice>(),
    /** The conversations the last list found, with the folder and tool it asked about. */
    found = $state<Found>(),
    /** What the newest list still loading asked about. A list never holds `busy`, so Choose
     * folder and the other actions still work while it loads. */
    loading = $state.raw<ListAsk>(),
    /** Claude Code's terminal asking to trust a new folder, which Start answered with. */
    setup = $state<SetupTerminal>(),
    /** The details drawer, open over the terminal. */
    details = $state(false),
    /** The Odd waiting on the owner's second yes to send without asking. */
    unasked = $state<string>(),
    /** Whether this window's terminal view takes the typing. */
    writable = $state(false),
    copied = $state(false),
    loaded = $state(false),
    /** Remove asks once in place, under the session's Reconnect. */
    removing = $state(false),
    /** Stop asks once in place, above the terminal. */
    stopping = $state(false);
  /** The setup whose question ended while the window was busy: Start waits to run for it. */
  let retryFor: string | undefined;
  /** This window's terminal view. A new one per session opened. */
  let termView = $state(crypto.randomUUID());
  /** The move confirm, in place of Reconnect, for the session opened with `view`. Each opening
   * makes a new view, so the confirm never shows on another session, or this one again. */
  let moving = $state<{ view: string; choice: Choice }>(),
    /** The owner's Focus choice, kept on this computer. */
    focusWanted = $state(false),
    /** While this window lets the session go, its terminal view is closed. */
    closing = $state(false);
  /** This window's terminal while it shows. */
  let terminal = $state<ReturnType<typeof ProjectTerminal>>();
  const selected = $derived(connections.find((s) => s.id === currentId));
  const terminalVisible = $derived(!!view?.connected && !!view.terminal && !closing);
  /** Only while the terminal shows: a session not connected keeps the list in reach. */
  const focused = $derived(focusWanted && terminalVisible);
  /** Remove's confirm. Only removing a Claude session ends it in every window still joined,
   * so a Codex owner is never told that. */
  const removeWarning = $derived(
    selected?.agent === 'claude'
      ? `${PROJECT_WORDS.removeAsk} ${PROJECT_WORDS.removeEnds} ${PROJECT_WORDS.removeDetail}`
      : `${PROJECT_WORDS.removeAsk} ${PROJECT_WORDS.removeDetail}`
  );
  /** What a list asks about now, and the rows found for exactly that. */
  const listNow = $derived(listAsk({ folder, agent, socket }));
  const place = $derived(
    problem && errorShows(problem, listNow) ? errorPlace(problem.from, !!selected) : undefined
  );
  const listed = $derived(rowsFor(found, listNow));
  const fields = $derived(
    newSessionFields({
      path,
      folder,
      agent,
      claudeFolders: folders.length,
      handingOver: !!handover
    })
  );
  const TOOL: Record<ProjectAgent, string> = { claude: 'Claude Code', codex: 'Codex' };
  const STATUS: Record<ProjectStatus, string> = {
    working: 'Working',
    waiting: 'Waiting for you',
    idle: 'Idle',
    done: 'Done'
  };
  const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const oddOf = (id: string | null) => staff.find((p) => p.id === id);
  /** What waits on the owner in the drawer: a native question, proposals and unclear deliveries. */
  const waitingCount = $derived(
    (view?.question ? 1 : 0) +
      work.filter((r) => r.state === 'proposed' || r.state === 'failed' || r.state === 'uncertain')
        .length
  );

  const describe = (e: unknown) => (e instanceof Error ? e.message : 'Could not reach the office.');
  function updates(stream: EventSource, id: string) {
    stream.addEventListener('session', (e) => {
      if (currentId !== id) return;
      const next: View = JSON.parse(e.data);
      // A new question from Codex opens the drawer where it is answered.
      if (next.question && next.question.key !== view?.question?.key) details = true;
      view = next;
    });
    stream.addEventListener('work', () => {
      if (currentId === id)
        void history(id).catch((e) => (problem = { text: describe(e), from: 'session' }));
    });
  }
  // The session's own updates, while no terminal view carries them.
  $effect(() => {
    const id = currentId;
    if (!id || terminalVisible) return;
    const stream = new EventSource('/api/project-sessions/' + id + '/events');
    updates(stream, id);
    return () => stream.close();
  });
  async function load() {
    const [sessions, known] = await Promise.all([
      projectApi<Row[]>('connections'),
      projectApi<Folder[]>('folders')
    ]);
    connections = sessions;
    folders = known;
    // The first is ~/.claude while it is on the disk. A folder no longer listed
    // would be refused as not in Setup, so the choice goes back to the first.
    if (!known.some((f) => f.path === startIn)) startIn = known[0]?.path ?? '';
  }
  /**
   * Runs one owner action, its error shown by what raised it, under `row` when a
   * conversation's row raised it. Most come from the open session.
   */
  async function run(fn: () => Promise<unknown>, from: ErrorSource = 'session', row?: string) {
    if (busy) return;
    busy = true;
    problem = undefined;
    try {
      await fn();
    } catch (e) {
      problem = { text: describe(e), from, row };
    } finally {
      busy = false;
      // Claude Code's question ended while this ran. Start runs for it now, once, but
      // only while it still shows: an action that changed the form closed it.
      const id = retryFor;
      retryFor = undefined;
      if (id && setup?.id === id) start({ after: 'trust' });
    }
  }
  async function history(id: string) {
    const record = await projectApi<{ work: ProjectRequest[]; view: View }>('history', { id });
    if (currentId === id) {
      work = record.work;
      view = record.view;
      if (work.some((r) => r.state === 'failed' || r.state === 'uncertain')) details = true;
    }
  }
  async function select(id: string) {
    if (currentId === id) return;
    closeSetup();
    currentId = id;
    work = [];
    view = undefined;
    draft = '';
    file = '';
    replies = {};
    handover = undefined;
    unasked = undefined;
    removing = false;
    stopping = false;
    writable = false;
    termView = crypto.randomUUID();
    await history(id);
    // Work waiting on the owner shows at once.
    details = work.some(
      (r) => r.state === 'proposed' || r.state === 'failed' || r.state === 'uncertain'
    );
  }
  function startNew() {
    closeSetup();
    currentId = undefined;
    view = undefined;
    work = [];
    found = undefined;
    loading = undefined;
    handover = undefined;
    problem = undefined;
    path = undefined;
  }
  function choosePath(p: SessionPath) {
    path = p;
    changed('path');
  }
  /**
   * Every change on the New session form goes through here: the path, the
   * folder typed or chosen, the tool, the account, the socket and Refresh list.
   * `lists` decides whether it lists, so a list starts once per committed change.
   */
  function changed(change: FormChange) {
    // A hand-over waits for the folder and tool it was found in, and Claude
    // Code's setup question was asked for the form as it was.
    if (change !== 'refresh') {
      handover = undefined;
      closeSetup();
    }
    if (lists(change, { path, now: listNow, found, loading })) list();
  }
  /**
   * Ends the setup terminal the form shows, if any. The office keeps one open
   * until told, so every way off it (a change, another session, a new form, the
   * next Start, closing the window) comes here. Failing to reach the office shows under Start.
   */
  function closeSetup() {
    const id = setup?.id;
    if (!id) return;
    setup = undefined;
    projectApi('disconnect', { id }).catch((e) => (problem = { text: describe(e), from: 'start' }));
  }
  /** Every list this window started, so only the newest one's answer lands. */
  const listCount: ListCount = { started: 0 };
  function list() {
    const ask = listNow;
    void listFor(ask, {
      count: listCount,
      find: (a) => projectApi<Choice[]>('find', a),
      start: () => {
        loading = ask;
        problem = undefined;
      },
      found: (f) => {
        found = f;
        filter = '';
      },
      failed: (e, asked) => (problem = { text: describe(e), from: 'continue', ask: asked })
    }).finally(() => {
      if (loading === ask) loading = undefined;
    });
  }
  /**
   * Opens `choice` here, or starts a new conversation without one. `handedOver`
   * says the owner finished with it in the previous Codex window, `move` that
   * they confirmed ending it in its terminal to open it here, and `after` that
   * Claude Code's question about the folder just ended.
   */
  async function connect(
    choice?: Choice,
    how: { handedOver?: boolean; move?: boolean; after?: 'trust' } = {}
  ) {
    // One source each: a conversation goes with its own folder, or none, so the
    // office finds it; only Start takes the folder chosen for it.
    const configDir = choice ? choice.configDir || undefined : startIn || undefined;
    const sent = { folder, agent, startIn };
    const s = await projectApi<ProjectSession | { setup: string }>('connect', {
      folder,
      agent,
      socket: (agent === 'codex' && socket.trim()) || undefined,
      nativeId: choice?.id,
      handedOver: how.handedOver,
      move: how.move,
      title: choice?.title || name || undefined,
      configDir: agent === 'claude' ? configDir : undefined
    });
    if ('setup' in s) {
      // Claude Code asks before it works in a new folder: its terminal
      // shows under Start, and once the owner answers it, Start runs again.
      // Asked for a folder, tool or account changed since, it is for a form no
      // longer shown, so it ends at once. Asked again right after the owner
      // answered, the answer was no: it ends too, so a no is asked again only
      // when the owner chooses Start.
      setup = { id: s.setup, view: crypto.randomUUID() };
      const shown = folder === sent.folder && agent === sent.agent && startIn === sent.startIn;
      if (!shown || how.after === 'trust') closeSetup();
      if (shown && how.after === 'trust')
        problem = { text: PROJECT_WORDS.notTrusted, from: 'start' };
      return;
    }
    await load();
    await select(s.id);
    // With the view the terminal's stream opens with: the window that opens the terminal
    // takes the typing, not whichever window's stream reaches the office first.
    if (agent === 'claude') await action('terminal', { view: termView });
  }
  async function pick() {
    const r = await fetch('/api/folders/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ for: 'your project session' })
    });
    const b = await r.json();
    if (b.path) {
      folder = b.path;
      changed('folder');
    } else if (b.unavailable) throw new Error(b.unavailable);
  }
  async function action(op: string, fields: Record<string, unknown> = {}) {
    const id = currentId;
    if (!id) return;
    await projectApi(op, { id, ...fields });
    await Promise.all([history(id), load()]);
  }
  /**
   * Closes this window's terminal view first, as closeSetup does, then waits for
   * the keys it already sent to land, so nothing it sends reaches a session being
   * let go. A refusal leaves the session connected, so the terminal shows again.
   */
  async function letGo(op: 'disconnect' | 'end') {
    // Taken while the terminal is still there: closing it takes it away.
    const landed = terminal?.keysLanded();
    closing = true;
    await tick();
    try {
      await landed;
      await action(op);
    } finally {
      closing = false;
    }
  }
  async function reconnect() {
    if (!selected) return;
    // Connecting keeps this session selected, so a Remove asked before would show again
    // the next time it is disconnected.
    removing = false;
    folder = selected.folder;
    agent = selected.agent;
    // A Reconnect lookup, not the form's list: it finds this one conversation.
    const copies = await projectApi<Choice[]>('find', listAsk({ folder, agent, socket }));
    // The session's own folder, never another: one taken out of Setup is refused,
    // and one not known yet is found by the office.
    const choice = {
      ...(copies.find((x) => x.id === selected?.nativeId) ?? {
        id: selected.nativeId,
        title: selected.title,
        live: false,
        updated: 0
      }),
      configDir: selected.configDir
    };
    if (agent === 'codex' && !choice.live) {
      // Back to the New session form, on this folder, to hand the conversation over.
      startNew();
      path = 'continue';
      handover = choice;
    } else if (choiceState(choice, agent) === 'terminal' && choice.movable) {
      // Ending it in its terminal is the owner's call: the confirm shows in place of
      // Reconnect, clear of the drawer.
      details = false;
      moving = { view: termView, choice };
    } else await connect(choice);
  }
  function move(choice: Choice) {
    moving = undefined;
    void run(() => connect(choice, { move: true }));
  }
  function stop() {
    stopping = false;
    void run(() => letGo('end'));
  }
  async function remove() {
    await action('remove');
    // Off the hidden id, so connecting the same conversation again selects it.
    startNew();
  }
  function handOver() {
    const c = handover;
    if (c) void run(() => connect(c, { handedOver: true }), 'handover');
  }
  function choose(c: Choice) {
    if (agent === 'codex' && !c.live) {
      handover = c;
      return;
    }
    void run(() => connect(c), 'row', c.id);
  }
  /**
   * Start, chosen by the owner or run once by itself when Claude Code's
   * question ends. Any question still shown closes first. A question that ends
   * while another action holds the window waits for it, as `run` says.
   */
  function start(how: { after?: 'trust' } = {}) {
    if (how.after === 'trust' && busy) {
      retryFor = setup?.id;
      return;
    }
    void run(() => {
      closeSetup();
      return connect(undefined, how);
    }, 'start');
  }
  async function copyId() {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.nativeId);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  // On mount, since the server has no storage to read it from.
  onMount(() => {
    focusWanted = focusRemembered();
    return closeSetup;
  });
  // The office panel folds its header, tabs and music bar under Focus too. The
  // cleanup unfolds it when this window closes.
  $effect(() => {
    projectsFocus.on = focused;
    return () => {
      projectsFocus.on = false;
    };
  });
  // The list reads again whenever the office's records change, or Setup changes
  // the Claude folders, which live in .env and reach the page no other way.
  $effect(() => {
    void version;
    void advanced.folders;
    untrack(() =>
      load()
        .then(() => (loaded = true))
        .catch((e) => (problem = { text: describe(e), from: 'load' }))
    );
  });
  // The session asked for, else the newest, else the start form.
  $effect(() => {
    void ask.n;
    const want = ask.sessionId;
    if (!loaded) return;
    untrack(() => {
      const id = connections.find((s) => s.id === want)?.id ?? (currentId || connections[0]?.id);
      if (!id) return;
      void run(async () => {
        await select(id);
        // Opened from the Desk: what waits on the owner shows at once.
        if (id === want && waitingCount) details = true;
      });
    });
  });

  /** Up and Down move between sessions; Enter or Space opens one. */
  function rowKey(e: KeyboardEvent, i: number) {
    const rows = [...((e.currentTarget as HTMLElement).parentElement?.children ?? [])];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)] as HTMLElement | undefined;
      next?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (rows.at(e.key === 'Home' ? 0 : -1) as HTMLElement | undefined)?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void run(() => select(connections[i].id));
    }
  }
</script>

{#snippet logo(a: ProjectAgent, cls: string)}
  <svg class={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    ><path fill-rule="evenodd" d={LOGOS[a]} /></svg
  >
{/snippet}

<ProjectsFrame {focused}>
  {#snippet list()}
    <button
      class="m-2 rounded-lg px-3 py-2 text-start text-xs font-medium {selected
        ? 'bg-raise text-ink hover:bg-sea/20'
        : 'bg-sea/25 text-ink'}"
      aria-pressed={!selected}
      onclick={startNew}>+ New session</button
    >
    <div
      class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 pb-2"
      role="listbox"
      aria-label="Project sessions"
    >
      {#each connections as s, i (s.id)}
        {@const odd = oddOf(s.staffId)}
        {@const on = s.id === currentId}
        <div
          class="flex cursor-pointer items-center gap-2 rounded-lg border-s-2 px-2 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-sea {on
            ? 'border-sea bg-sea/20'
            : 'border-transparent hover:bg-raise'}"
          role="option"
          aria-selected={on}
          tabindex={on || (!currentId && i === 0) ? 0 : -1}
          onclick={() => run(() => select(s.id))}
          onkeydown={(e) => rowKey(e, i)}
        >
          {@render logo(s.agent, 'size-4 shrink-0 ' + (on ? 'text-ink' : 'text-muted'))}
          <span class="min-w-0 flex-1" title={s.folder}>
            <span class="block truncate text-[13px] {on ? 'text-ink' : 'text-ink/85'}"
              >{folderName(s.folder)}</span
            >
            <span class="block truncate text-[11px] text-muted">{s.title}</span>
            {#if s.mark}<span class="block truncate text-[10px] text-muted" title={s.mark}
                >{s.mark}</span
              >{/if}
            <span class="sr-only">{TOOL[s.agent]}, {STATUS[s.status]}</span>
          </span>
          {#if odd}
            <Pixel
              src={odd.look?.portrait}
              frame={`${odd.portrait}/default`}
              fallback={`${odd.sprite}@${odd.variant}/idle-down-0`}
              scale={1}
              label={s.sendsUnasked === odd.id
                ? `${odd.name} sends work without asking`
                : `${odd.name} may send work for your yes`}
              class="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sea-deep {s.sendsUnasked ===
              odd.id
                ? 'ring-1 ring-ember'
                : ''}"
            />
          {/if}
          <span class="dot {s.status}" title={STATUS[s.status]} aria-hidden="true"></span>
        </div>
      {/each}
      {#if loaded && !connections.length}
        <p class="px-2 py-1 text-xs text-muted">No sessions yet.</p>
      {/if}
    </div>
  {/snippet}

  <!-- The selected session, or the start form. -->
  <div class="relative flex min-w-0 flex-1 flex-col">
    {#if !selected}
      <NewSessionForm
        bind:folder
        bind:agent
        bind:socket
        bind:name
        bind:startIn
        bind:filter
        {path}
        {fields}
        {folders}
        candidates={listed ?? []}
        found={!!listed}
        listing={sameAsk(loading, listNow)}
        {busy}
        problem={problem?.text}
        {place}
        problemRow={problem?.row}
        bind:setup
        onfilter={() => {
          if (filterClears(place)) problem = undefined;
        }}
        onchange={changed}
        onpick={() => run(pick, 'pick')}
        onpath={choosePath}
        onstart={start}
        onchoose={choose}
        onmove={(c) => run(() => connect(c, { move: true }), 'row', c.id)}
        onsetuperror={(text) => (problem = { text, from: 'start' })}
        onhandover={handOver}
      />
    {:else}
      <!-- A slim header: what this is, and the few controls that act on it. When the
           row cannot give what this is 12rem beside the controls, as in a narrow pane,
           the controls wrap onto a line of their own instead of running past its edge. -->
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline px-3 py-1.5 text-xs"
      >
        <div class="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
          {@render logo(selected.agent, 'size-4 shrink-0 text-muted')}
          <strong class="max-w-56 truncate text-sm font-medium text-ink" title={selected.folder}
            >{folderName(selected.folder)}</strong
          >
          <span class="shrink-0 text-muted">{TOOL[selected.agent]}</span>
          <button
            class="shrink-0 rounded bg-raise px-1.5 py-0.5 font-mono text-[11px] text-muted hover:text-ink"
            title={`Copy the conversation ID ${selected.nativeId}`}
            aria-label="Copy the conversation ID"
            onclick={() => run(copyId)}>{copied ? 'Copied' : selected.nativeId.slice(0, 8)}</button
          >
          <span class="min-w-0 flex-1 truncate text-muted" aria-live="polite"
            >{view?.note ?? 'Loading session'}</span
          >
        </div>
        <div class="ms-auto flex flex-wrap items-center justify-end gap-2">
          {#if terminalVisible && !writable}
            <button
              class="btn shrink-0"
              onclick={() => run(() => projectApi('control', { id: selected?.id, view: termView }))}
              >Take control of terminal</button
            >
          {/if}
          <button
            class="btn shrink-0"
            class:on={details}
            aria-expanded={details}
            aria-controls="project-details"
            onclick={() => (details = !details)}
            >Details{#if waitingCount}<span class="ms-1 text-ember">{waitingCount}</span
              >{/if}</button
          >
          {#if view?.connected}
            <button
              class="btn shrink-0"
              disabled={busy}
              onclick={() => run(() => letGo('disconnect'))}>Disconnect</button
            >
            {#if selected.agent === 'claude'}
              <button
                class="btn shrink-0"
                disabled={busy}
                aria-label={PROJECT_WORDS.stopName}
                onclick={() => (stopping = true)}>{PROJECT_WORDS.stopButton}</button
              >
            {/if}
          {:else if view}
            <button class="btn shrink-0" disabled={busy} onclick={() => run(reconnect)}
              >Reconnect</button
            >
          {/if}
          {#if terminalVisible}
            <button
              class="btn shrink-0"
              class:on={focused}
              aria-pressed={focused}
              aria-label={PROJECT_WORDS.focusName}
              onclick={() => rememberFocus((focusWanted = !focusWanted))}
              >{PROJECT_WORDS.focus}</button
            >
          {/if}
        </div>
      </div>

      <!-- Above the terminal area, outside it, so the drawer never covers it. It wraps
           whole, a long folder mark too, never cut short like the header's note. -->
      {#if view?.folderNotice}
        <p class="mx-3 mt-2 rounded-lg bg-raise p-2 break-words text-ink" role="status">
          {view.folderNotice}
        </p>
      {/if}
      {#if stopping && view?.connected}
        <div
          class="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-ember/10 p-2"
          role="alertdialog"
          aria-labelledby="stop-warning"
        >
          <p id="stop-warning" class="flex-1 text-ink">{PROJECT_WORDS.stopConfirm}</p>
          <div class="flex gap-2">
            <button class="btn" disabled={busy} onclick={stop}>{PROJECT_WORDS.stopButton}</button
            ><button class="btn" onclick={() => (stopping = false)}>{PROJECT_WORDS.cancel}</button>
          </div>
        </div>
      {/if}

      <!-- The terminal fills what is left. The drawer opens over it. -->
      <div class="term relative flex min-h-0 flex-1 flex-col">
        {#if terminalVisible}
          {#key termView}<ProjectTerminal
              bind:this={terminal}
              onstream={updates}
              id={selected.id}
              view={termView}
              bind:writable
              onerror={(s) => (problem = { text: s, from: 'session' })}
            />{/key}
        {:else}
          <div class="grid flex-1 place-items-center p-6 text-center" class:beside={details}>
            <div class="flex flex-col items-center gap-2">
              {#if view?.connected}
                <p class="text-muted">The terminal is closed.</p>
                <button
                  class="btn"
                  disabled={busy}
                  onclick={() => run(() => action('terminal', { view: termView }))}
                  >Open terminal</button
                >
              {:else if view}
                <p class="text-muted">This session is not connected to the office.</p>
                <!-- Only while Details is shut: more than one path opens the drawer
                     over this spot, and a confirmation under it cannot be read or pressed. -->
                {#if removing && !details}<div
                    class="flex max-w-80 flex-col items-center gap-2 rounded-lg bg-ember/10 p-2"
                    role="alertdialog"
                    aria-labelledby="remove-warning"
                  >
                    <p id="remove-warning" class="text-ink">{removeWarning}</p>
                    <div class="flex gap-2">
                      <button class="btn" disabled={busy} onclick={() => run(remove)}>Remove</button
                      ><button class="btn" onclick={() => (removing = false)}
                        >{PROJECT_WORDS.cancel}</button
                      >
                    </div>
                  </div>
                {:else if moving?.view === termView && !details}
                  {@const choice = moving.choice}<MoveConfirm
                    {busy}
                    onconfirm={() => move(choice)}
                    oncancel={() => (moving = undefined)}
                  />
                {:else}<div class="flex flex-wrap justify-center gap-2">
                    <button class="btn" disabled={busy} onclick={() => run(reconnect)}
                      >Reconnect</button
                    ><button
                      class="btn"
                      disabled={busy}
                      onclick={() => {
                        details = false;
                        removing = true;
                      }}>Remove</button
                    >
                  </div>{/if}
              {:else}
                <p class="text-muted">Loading session</p>
              {/if}
            </div>
          </div>
        {/if}
        {#if problem && place === 'session'}
          <div
            role="alert"
            class="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg bg-panel-solid px-3 py-2 text-xs text-coral shadow-float"
          >
            <p class="flex-1">{problem.text}</p>
            <button
              class="text-muted hover:text-ink"
              aria-label="Dismiss"
              onclick={() => (problem = undefined)}>✕</button
            >
          </div>
        {/if}

        {#if details}
          <SessionDetails
            {selected}
            {view}
            {work}
            {staff}
            {busy}
            {run}
            {action}
            {oddOf}
            bind:draft
            bind:file
            bind:replies
            bind:unasked
            onclose={() => (details = false)}
          />
        {/if}
      </div>
    {/if}
  </div>
</ProjectsFrame>

<style>
  /* The terminal area is a container, so the body follows the pane's width, which the
     panel's drag and an open Odd's card change at any window size. */
  .term {
    container-type: inline-size;
    --drawer: 26rem;
  }
  /* A container query cannot read --drawer, so its width is written out: 39rem is the
     drawer, the body's padding both sides (3rem) and Reconnect with Remove on one line
     (154px in Chromium and WebKit on a Mac), rounded up to a whole rem. A font that draws
     the pair too wide for one line wraps Remove under Reconnect, so the body stays beside
     the drawer while the wider button alone fits. Narrower, the body stays centred in the
     whole pane and the drawer covers part or all of it; ✕ shuts it. */
  @container (min-width: 39rem) {
    .beside {
      margin-inline-end: var(--drawer);
    }
  }
</style>
