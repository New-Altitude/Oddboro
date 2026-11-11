<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProjectAgent, ProjectSession, ProjectRequest } from '@oddboro/ledger';
  import { projectApi } from './project-api.ts';
  import ProjectReviews from './ProjectReviews.svelte';
  import ProjectTerminal from './ProjectTerminal.svelte';
  type View = {
    connected: boolean;
    terminal: boolean;
    turn?: string;
    requestId?: string;
    note: string;
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
  type Choice = { id: string; title: string; live: boolean; updated: number; job?: string };
  let { staff, sessionId }: { sessionId?: string; staff: { id: string; name: string }[] } =
    $props();
  let reviewVersion = $state(0);
  let connections = $state<ProjectSession[]>([]),
    selected = $state<ProjectSession>(),
    candidates = $state<Choice[]>([]),
    work = $state<ProjectRequest[]>([]),
    view = $state<View>();
  let socket = $state(''),
    folder = $state(''),
    agent = $state<ProjectAgent>('claude'),
    draft = $state(''),
    file = $state(''),
    name = $state(''),
    replies = $state<Record<string, string>>({});
  let busy = $state(false),
    problem = $state(''),
    showTerminal = $state(false),
    handover = $state<Choice>(),
    found = $state(false);
  const selectedId = $derived(selected?.id);
  const terminalVisible = $derived(showTerminal && !!view?.terminal);
  function updates(stream: EventSource, id: string) {
    stream.addEventListener('session', (e) => {
      if (selectedId === id) view = JSON.parse(e.data);
    });
    stream.addEventListener('work', () => {
      if (selectedId === id) void history(id).catch((e) => (problem = describe(e)));
    });
  }
  $effect(() => {
    const id = selectedId;
    if (!id || terminalVisible) return;
    const stream = new EventSource('/api/project-sessions/' + id + '/events');
    updates(stream, id);
    return () => stream.close();
  });
  const describe = (e: unknown) => (e instanceof Error ? e.message : 'Could not reach the office.');
  async function load() {
    connections = await projectApi<ProjectSession[]>('connections');
  }
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      await fn();
    } catch (e) {
      problem = describe(e);
    } finally {
      busy = false;
    }
  }
  async function history(id: string) {
    const record = await projectApi<{
      session: ProjectSession;
      work: ProjectRequest[];
      view: View;
    }>('history', { id });
    if (selected?.id === id) {
      selected = record.session;
      work = record.work;
      reviewVersion += 1;
      view = record.view;
    }
  }
  async function select(s: ProjectSession) {
    selected = s;
    work = [];
    view = undefined;
    draft = '';
    file = '';
    replies = {};
    showTerminal = false;
    handover = undefined;
    await history(s.id);
  }
  async function connect(choice?: Choice, handedOver = false) {
    const s = await projectApi<ProjectSession>('connect', {
      folder,
      agent,
      socket: (agent === 'codex' && socket.trim()) || undefined,
      nativeId: choice?.id,
      handedOver,
      title: choice?.title || name || undefined
    });
    await load();
    await select(s);
    if (agent === 'claude') {
      await projectApi('terminal', { id: s.id });
      showTerminal = true;
    }
  }
  async function search() {
    candidates = await projectApi<Choice[]>('find', {
      folder,
      agent,
      socket: (agent === 'codex' && socket.trim()) || undefined
    });
    found = true;
  }
  async function pick() {
    const r = await fetch('/api/folders/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ for: 'your project session' })
    });
    const b = await r.json();
    if (b.path) folder = b.path;
    else if (b.unavailable) throw new Error(b.unavailable);
  }
  async function action(op: string, fields: Record<string, unknown> = {}) {
    if (!selected) return;
    await projectApi(op, { id: selected.id, ...fields });
    await history(selected.id);
  }
  async function send() {
    const text = draft.trim();
    if (!text || !selected) return;
    const turn = view?.turn || (selected.agent === 'claude' ? view?.requestId : undefined);
    if (turn) await action('steer', { turn, prompt: text, file: file.trim() || undefined });
    else
      await action('send', {
        key: crypto.randomUUID(),
        prompt: text,
        file: file.trim() || undefined
      });
    draft = '';
    file = '';
  }
  function choose(c: Choice) {
    if (agent === 'codex' && !c.live) {
      handover = c;
      return;
    }
    void run(() => connect(c));
  }
  onMount(() => {
    void load()
      .then(async () => {
        const linked = connections.find((s) => s.id === sessionId);
        if (linked) await select(linked);
      })
      .catch((e) => (problem = describe(e)));
  });
</script>

<div class="flex flex-col gap-3 p-3">
  <h2 class="text-base font-semibold">Project sessions</h2>
  <div class="flex flex-wrap gap-2">
    {#each connections as s (s.id)}<button class="btn" onclick={() => run(() => select(s))}
        >{s.title} · {s.nativeId.slice(0, 8)}</button
      >{/each}
    {#if selected}<button
        class="btn"
        onclick={() => {
          selected = undefined;
          found = false;
          handover = undefined;
          problem = '';
        }}>Other sessions</button
      >{/if}
  </div>
  {#if !selected}
    <label
      >Project folder <input
        class="field w-full"
        bind:value={folder}
        oninput={() => {
          found = false;
          candidates = [];
          handover = undefined;
        }}
        placeholder="Absolute folder path"
      /></label
    >
    <div class="flex flex-wrap gap-2">
      <button class="btn" onclick={() => run(pick)}>Choose folder</button>
      <select
        class="field"
        aria-label="Coding tool"
        bind:value={agent}
        onchange={() => {
          found = false;
          candidates = [];
          handover = undefined;
        }}><option value="claude">Claude Code</option><option value="codex">Codex</option></select
      >
    </div>
    {#if agent === 'codex'}<details>
        <summary>Connect to a running Codex server</summary><label
          >Private local socket <input
            class="field w-full"
            bind:value={socket}
            placeholder="/path/to/private/codex.sock"
            oninput={() => {
              found = false;
              candidates = [];
              handover = undefined;
            }}
          /></label
        >
        <p>
          Choose the socket used by the original Codex window. Leave it empty to use the office
          server.
        </p>
      </details>{/if}
    <label
      >Session name <input
        class="field w-full"
        bind:value={name}
        placeholder="Optional"
        maxlength="200"
      /></label
    >
    <div class="flex gap-2">
      <button class="btn" disabled={busy || !folder} onclick={() => run(() => connect())}
        >Start new</button
      ><button class="btn" disabled={busy || !folder} onclick={() => run(search)}
        >Find existing</button
      >
    </div>
    {#if found && !candidates.length}<p>No conversations found in this folder.</p>{/if}
    {#each candidates as c (c.id)}<button
        class="btn text-start"
        disabled={busy}
        onclick={() => choose(c)}
        >{c.title} · {c.live ? 'Running' : 'Saved'} · {new Date(c.updated).toLocaleString()} · {c.id.slice(
          0,
          8
        )}</button
      >{/each}
    {#if handover}<p>
        Finish or stop work in the previous Codex window before continuing this conversation here.
      </p>
      <button class="btn" disabled={busy} onclick={() => run(() => connect(handover, true))}
        >Hand over this conversation</button
      >{/if}
  {:else}
    <div>
      <strong>{selected.title}</strong>
      <div class="break-all text-xs">
        {selected.agent === 'claude' ? 'Claude Code' : 'Codex'} · {selected.folder} · {selected.nativeId}
      </div>
    </div>
    {#if view?.account}<p class="text-xs">Codex sign-in at connection: {view.account}</p>{/if}
    <p aria-live="polite">{view?.note ?? 'Loading session'}</p>
    {#if !view?.connected}
      <button
        class="btn"
        disabled={busy}
        onclick={() =>
          run(async () => {
            if (!selected) return;
            folder = selected.folder;
            agent = selected.agent;
            const rows = await projectApi<Choice[]>('find', {
              folder,
              agent,
              socket: (agent === 'codex' && socket.trim()) || undefined
            });
            const choice = rows.find((x) => x.id === selected?.nativeId) ?? {
              id: selected.nativeId,
              title: selected.title,
              live: false,
              updated: 0
            };
            if (agent === 'codex' && !choice.live) {
              selected = undefined;
              handover = choice;
            } else await connect(choice);
          })}>Reconnect</button
      >
    {:else}
      <div class="flex gap-2">
        <button
          class="btn"
          disabled={busy}
          onclick={() =>
            run(async () => {
              if (!showTerminal) await action('terminal');
              showTerminal = !showTerminal;
            })}>{showTerminal ? 'Hide terminal' : 'Open terminal'}</button
        ><button
          class="btn"
          disabled={busy}
          onclick={() =>
            run(async () => {
              await action('disconnect');
              showTerminal = false;
            })}>Disconnect</button
        >
      </div>
      {#if showTerminal && view.terminal}{#key selected.id}<ProjectTerminal
            onstream={updates}
            id={selected.id}
            onerror={(s) => (problem = s)}
          />{/key}{/if}
      <label
        >Odd allowed to send work with this session’s project tools
        <select
          class="field w-full"
          value={selected.staffId ?? ''}
          onchange={(e) =>
            run(() => action('share', { staffId: (e.target as HTMLSelectElement).value || null }))}
        >
          <option value="">Only me</option>{#each staff as s (s.id)}<option value={s.id}
              >{s.name}</option
            >{/each}
        </select>
      </label>
      {#if selected.agent === 'claude' && view.market}
        <details>
          <summary>Connect an existing Claude terminal to office assignments</summary>
          <p>
            In that conversation, add the local marketplace, install its plugin, then reload
            plugins. New sessions opened here load it at launch.
          </p>
          <pre class="whitespace-pre-wrap break-all">/plugin marketplace add {JSON.stringify(
              view.market
            )} --scope local{'\n'}/plugin install oddboro-project-{selected.id}@oddboro-{selected.id} --scope local{'\n'}/reload-plugins</pre>
        </details>
      {/if}
      {#if view.question}<div class="border p-2">
          <strong>Codex needs your answer</strong>
          <pre class="max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(
              view.question.params,
              null,
              2
            )}</pre>
          {#if ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'].includes(view.question.method)}
            <button
              class="btn"
              onclick={() =>
                run(() =>
                  action('answer', {
                    request: view?.question?.id,
                    key: view?.question?.key,
                    pick: 'accept'
                  })
                )}>Allow once</button
            ><button
              class="btn"
              onclick={() =>
                run(() =>
                  action('answer', {
                    request: view?.question?.id,
                    key: view?.question?.key,
                    pick: 'decline'
                  })
                )}>Decline</button
            >
          {:else if view.question.method === 'item/tool/requestUserInput'}
            {#each view.question.params.questions as { id: string; question: string; options?: { label: string }[]; isSecret?: boolean }[] as q (q.id)}
              <label
                >{q.question}<input
                  class="field w-full"
                  type={q.isSecret ? 'password' : 'text'}
                  bind:value={replies[q.id]}
                  placeholder={q.options?.map((o) => o.label).join(' / ')}
                /></label
              >
            {/each}
            <button
              class="btn"
              onclick={() =>
                run(async () => {
                  await action('answer', {
                    request: view?.question?.id,
                    key: view?.question?.key,
                    pick: 'accept',
                    answers: Object.fromEntries(Object.entries(replies).map(([k, v]) => [k, [v]]))
                  });
                  replies = {};
                })}>Send answers</button
            >
          {:else}<p>Use the native terminal to review this request.</p>{/if}
        </div>{/if}
      {#if view.reply}<pre class="whitespace-pre-wrap text-sm">{view.reply}</pre>{/if}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void run(send);
        }}
      >
        <label
          >Instruction <textarea class="field w-full" rows="3" bind:value={draft}></textarea></label
        >
        <label
          >Project file (optional)<input
            class="field w-full"
            bind:value={file}
            placeholder="Path inside this project"
          /></label
        >
        <div class="flex gap-2">
          <button class="btn" disabled={busy || !draft.trim()}
            >{view.turn || (selected.agent === 'claude' && view.requestId)
              ? 'Send correction'
              : 'Send instruction'}</button
          >
          {#if view.turn || view.requestId}<button
              class="btn"
              type="button"
              onclick={() => run(() => action('stop', { expected: view?.turn || view?.requestId }))}
              >Stop</button
            >{/if}
        </div>
      </form>
    {/if}
    {#key selected.id}<ProjectReviews session={selected} version={reviewVersion} />{/key}
    {#each work as r (r.id)}<div class="border-t pt-2">
        <strong>{r.state}</strong>
        <p class="whitespace-pre-wrap">{r.prompt}</p>
        {#if r.file}<p>Project file: {r.file}</p>{/if}
        {#if r.answer}<p class="whitespace-pre-wrap">{r.answer}</p>{/if}
        {#if r.state === 'proposed'}<p>This will run with your native project permissions.</p>
          <button
            class="btn"
            onclick={() => run(() => action('decide', { key: r.id, approve: true }))}
            >Take over and send</button
          ><button
            class="btn"
            onclick={() => run(() => action('decide', { key: r.id, approve: false }))}
            >Decline</button
          >{/if}
        {#if r.state === 'uncertain'}<button
            class="btn"
            onclick={() => run(() => action('resolve', { key: r.id }))}
            >I checked the native conversation</button
          >{/if}
      </div>{/each}
  {/if}
  {#if problem}<p role="alert" class="text-ember">{problem}</p>{/if}
</div>
