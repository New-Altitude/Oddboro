<script lang="ts">
  import { onMount, setContext, untrack } from 'svelte';
  import type { PageData } from './$types';
  import type { AskRow } from '@oddboro/ledger';
  import type { OfficeEvent } from '#lib/server/events.ts';
  import ChatPanel from '#lib/ui/ChatPanel.svelte';
  import DeskDrawer from '#lib/ui/DeskDrawer.svelte';
  import ProjectSessions from '#lib/ui/ProjectSessions.svelte';
  import ReportView from '#lib/ui/ReportView.svelte';
  import FileViewer from '#lib/ui/FileViewer.svelte';
  import WorkspaceSettings from '#lib/ui/WorkspaceSettings.svelte';
  import { call } from '#lib/ui/api.ts';
  import {
    advanced,
    open,
    openProject,
    openReport,
    wins,
    type Win
  } from '#lib/ui/windows.svelte.ts';
  import { chatRequest, type Delivered } from '#lib/ui/chat-about.svelte.ts';
  let { data }: { data: PageData } = $props();
  setContext('text-only-office', true);
  let office = $state(untrack(() => data));
  let tab = $state('inbox'),
    focus = $state(''),
    problem = $state(''),
    connected = $state(true),
    version = $state(0);
  let selected = $state(''),
    visited = $state<string[]>([]),
    saving = $state(false),
    toolsReady = $state(false);
  let owner = $state(''),
    manager = $state(untrack(() => data.managers[0]?.id ?? '')),
    zone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);
  let name = $state(''),
    role = $state(''),
    remit = $state(''),
    hireFrom = $state<AskRow[]>([]);
  const current = $derived(wins.list.find((w) => w.id === wins.active));
  const count = $derived(office.desk.asks.length + office.desk.tasks.length);
  function pick(id: string) {
    selected = id;
    tab = 'chat';
    if (!visited.includes(id)) visited = [...visited, id];
    wins.shown = false;
  }
  function panel(w: Win) {
    open(w);
    tab = 'panel';
  }
  function desk(key: string) {
    focus = key;
    panel({ id: 'desk', kind: 'desk' });
  }
  function item(id: string, d: Delivered) {
    if (d.kind === 'report') {
      openReport({ id: d.id, staff: id, title: d.title });
      tab = 'panel';
    } else desk(d.kind + '-' + d.id);
  }
  function hires(rows: AskRow[]) {
    hireFrom = rows;
    const h = rows[0]?.hire;
    name = h?.name ?? '';
    role = h?.role ?? '';
    remit = h?.remit ?? '';
    wins.shown = false;
    tab = 'hire';
  }
  let serial = 0;
  async function refresh() {
    const n = ++serial;
    try {
      const fresh = await call<PageData>('/api/workspace');
      if (n !== serial) return;
      office = fresh;
      version++;
    } catch (e) {
      if (n === serial) problem = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    advanced.on = office.advanced;
  });
  $effect(() => {
    if (chatRequest.staff) {
      const id = chatRequest.staff;
      chatRequest.staff = undefined;
      pick(id);
    }
  });
  $effect(() => {
    if (wins.shown && wins.active) tab = 'panel';
  });
  onMount(() => {
    const events = new EventSource('/api/events');
    let pending = false,
      dirty = false,
      ended = false;
    const changed = async () => {
      dirty = true;
      if (pending) return;
      pending = true;
      while (dirty && !ended) {
        dirty = false;
        await refresh();
      }
      pending = false;
    };
    events.onopen = () => {
      connected = true;
      void changed();
    };
    events.onerror = () => {
      connected = false;
    };
    events.onmessage = (m) => {
      const e: OfficeEvent = JSON.parse(m.data);
      if (e.type === 'working') {
        office.working = e.working;
        office.inProgress = e.inProgress;
        return;
      }
      if ('table' in e) void changed();
    };
    return () => {
      ended = true;
      serial++;
      events.close();
    };
  });
  async function save() {
    if (saving) return;
    saving = true;
    problem = '';
    try {
      if (!office.welcomed) {
        const r = await call<{ manager: { id: string } }>('/api/onboarding', {
          name: owner,
          zone,
          manager: { preset: manager }
        });
        await refresh();
        pick(r.manager.id);
      } else {
        const r = await call<{ id: string }>('/api/staff', {
          plain: true,
          name,
          role,
          remit,
          desk: remit,
          permission: 'read',
          askId: hireFrom[0]?.id
        });
        const rest = hireFrom.slice(1);
        await refresh();
        if (rest.length) hires(rest);
        else pick(r.id);
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
  function switchByKey(e: KeyboardEvent) {
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && office.staff.length) {
      e.preventDefault();
      const i = office.staff.findIndex((x) => x.id === selected);
      pick(
        office.staff[
          (i + (e.key === 'ArrowDown' ? 1 : -1) + office.staff.length) % office.staff.length
        ].id
      );
    }
  }
  function view(t: string) {
    wins.shown = false;
    tab = t;
  }
</script>

<svelte:head><title>Workspace · Oddboro</title></svelte:head>
<svelte:window onkeydown={switchByKey} />
<main class="shell text-ink">
  <header>
    <strong>Oddboro <span>Workspace</span></strong><a href="/?view=office" data-sveltekit-reload
      >Open Office</a
    >
  </header>
  {#if !connected}<p role="status">Reconnecting to the office…</p>{/if}
  {#if problem}<p role="alert">
      {problem} <button onclick={() => (problem = '')}>Dismiss</button>
    </p>{/if}
  {#if !office.welcomed}
    <section class="setup">
      <h1>Set up your office</h1>
      <WorkspaceSettings bind:ready={toolsReady} />
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>Your name<input required maxlength="30" bind:value={owner} /></label>
        <label>Time zone<input required bind:value={zone} /></label>
        <label
          >Office Manager<select bind:value={manager}
            >{#each office.managers as m}<option value={m.id}>{m.name} · {m.trait}</option
              >{/each}</select
          ></label
        >
        <button disabled={saving || !toolsReady}>Start working</button>
      </form>
    </section>
  {:else}
    <div class="body">
      <nav aria-label="Workspace">
        <button class:chosen={tab === 'inbox'} onclick={() => view('inbox')}
          >Inbox <small>{count}</small></button
        >
        {#if advanced.on}<button
            onclick={() => {
              openProject();
              tab = 'panel';
            }}>Project sessions</button
          >{/if}
        <h2>Odds</h2>
        {#each office.staff as p (p.id)}<button
            class:chosen={tab === 'chat' && selected === p.id}
            onclick={() => pick(p.id)}
            >{p.name}<small>{office.working[p.id] ? 'Working' : p.role}</small></button
          >{/each}
        <button onclick={() => hires([])}>Hire an Odd</button><button
          onclick={() => view('settings')}>Settings</button
        >
      </nav>
      <section class="content">
        {#if tab === 'inbox'}
          <h1>Needs you</h1>
          {#each office.desk.asks as a}<button class="row" onclick={() => desk('ask-' + a.id)}
              >{a.title}<small>{a.why}</small></button
            >{/each}
          {#each office.desk.tasks as t}<button class="row" onclick={() => desk('task-' + t.id)}
              >{t.title}</button
            >{/each}
          {#if !count}<p>No decisions waiting.</p>{/if}
          <h2>Results</h2>
          {#each office.desk.reports as r}<button
              class="row"
              onclick={() => item(r.staffId, { kind: 'report', id: r.id, title: r.title })}
              >{r.title}<small>{office.staff.find((s) => s.id === r.staffId)?.name}</small></button
            >{:else}<p>No reports waiting.</p>{/each}
          <h2>Running</h2>
          {#each Object.entries(office.inProgress) as [id, work]}{#each work as w}<button
                class="row"
                onclick={() => pick(id)}
                >{w.label}<small>{office.staff.find((p) => p.id === id)?.name}</small></button
              >{/each}{/each}
          {#if !Object.keys(office.working).length}<p>No active jobs.</p>{/if}
        {:else if tab === 'settings'}<h1>Settings</h1>
          <WorkspaceSettings />
        {:else if tab === 'hire'}<h1>Hire an Odd</h1>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>Name<input required bind:value={name} /></label><label
              >Role<input required bind:value={role} /></label
            >
            <label>Work this Odd owns<textarea required bind:value={remit}></textarea></label
            ><button disabled={saving}>Hire</button>
          </form>
        {:else if tab === 'panel' && current}
          {#if current.kind === 'desk'}<h1>Desk</h1>
            <DeskDrawer
              selectChat={false}
              desk={office.desk}
              staff={office.staff}
              {focus}
              onhire={(a) => hires([a])}
              onplan={hires}
              onstaff={pick}
            />
          {:else if current.kind === 'report'}<ReportView
              report={current.report}
              staff={office.staff}
            />
          {:else if current.kind === 'file'}<FileViewer
              id={current.id}
              file={current.file}
              nameOf={(id) => office.staff.find((p) => p.id === id)?.name ?? id}
            />
          {/if}
        {/if}
        {#if advanced.on && wins.list.some((w) => w.kind === 'projects')}
          {@const projects = wins.list.find((w) => w.kind === 'projects')}
          {#if projects}<div class="pane" hidden={tab !== 'panel' || current?.kind !== 'projects'}>
              <ProjectSessions staff={office.staff} {version} ask={projects.ask} />
            </div>{/if}
        {/if}
        {#each office.staff.filter((p) => visited.includes(p.id)) as p (p.id)}
          <div class="pane chat" hidden={tab !== 'chat' || selected !== p.id}>
            <h1>{p.name}</h1>
            <ChatPanel
              profile={p}
              desk={office.desk}
              staff={office.staff}
              {version}
              onplan={hires}
              onstart={() => {}}
              onend={() => void refresh()}
              visible={tab === 'chat' && selected === p.id}
              onitem={(d) => item(p.id, d)}
              work={office.inProgress[p.id] ?? []}
              onwork={() => view('inbox')}
            />
          </div>
        {/each}
      </section>
    </div>
  {/if}
</main>

<style>
  .shell {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--color-night);
    font-family: Inter, system-ui, sans-serif;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.8rem 1.25rem;
    border-block-end: 1px solid var(--color-hairline);
  }
  header span,
  small,
  .content p {
    color: var(--color-muted);
  }
  header span {
    margin-inline-start: 0.65rem;
  }
  .body {
    display: grid;
    grid-template-columns: minmax(9rem, 15rem) minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }
  nav {
    border-inline-end: 1px solid var(--color-hairline);
    overflow: auto;
    padding: 0.75rem;
  }
  nav button,
  .row {
    display: block;
    text-align: start;
    width: 100%;
    border-radius: 0.4rem;
    padding: 0.55rem 0.7rem;
  }
  nav button:hover,
  .row:hover,
  .chosen {
    background: var(--color-raise);
  }
  small {
    display: block;
    font-size: 0.77rem;
  }
  .content,
  .setup {
    min-height: 0;
    overflow: auto;
    padding: 1rem 1.25rem;
  }
  .setup {
    width: min(100%, 43rem);
    align-self: center;
  }
  h1 {
    font-size: 1.3rem;
    font-weight: 650;
    margin-block-end: 0.8rem;
  }
  h2 {
    font-size: 0.9rem;
    font-weight: 650;
    margin-block: 1.1rem 0.45rem;
  }
  form {
    display: grid;
    gap: 0.8rem;
    max-inline-size: 34rem;
    margin-block-start: 1rem;
  }
  label {
    display: grid;
    gap: 0.25rem;
  }
  input,
  select,
  textarea,
  form button {
    background: var(--color-raise);
    padding: 0.6rem;
    border-radius: 0.4rem;
  }
  form button {
    justify-self: start;
    color: var(--color-sea);
  }
  button:disabled {
    opacity: 0.5;
  }
  .pane {
    height: 100%;
    min-height: 0;
  }
  .chat:not([hidden]) {
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 650px) {
    .body {
      grid-template-columns: 8rem minmax(0, 1fr);
    }
    .content,
    nav {
      padding: 0.5rem;
    }
    header {
      padding: 0.75rem;
    }
  }
</style>
