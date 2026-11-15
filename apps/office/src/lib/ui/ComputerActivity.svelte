<script lang="ts">
  import { formatMemory } from '../format-memory.ts';
  import PressureNotice from '#lib/ui/PressureNotice.svelte';
  import type { ManagerAdvice } from '#lib/server/pressure-watch.ts';
  import { onMount, tick } from 'svelte';
  import { AGENT_NAMES } from '@oddboro/ledger/agents';
  import type { ComputerActivity, ActivityRun } from '#lib/server/computer-activity.ts';
  import { call } from './api.ts';
  import { chatAbout } from './chat-about.svelte.ts';
  import PixelIcon from './PixelIcon.svelte';
  import { LOGOS } from './tool-logos.ts';

  import type { agentAttention } from '#lib/server/agent-attention.ts';
  import {
    codexChatUrl,
    hudItems,
    type HudOffice,
    type HudLinks,
    type HudItem
  } from './hud-items.ts';
  import { chord, type HudKeys } from './hud-keys.ts';
  import HudQueue from './HudQueue.svelte';
  import HudCapacity from './HudCapacity.svelte';
  import HudShortcuts from './HudShortcuts.svelte';

  let {
    office,
    links,
    onrefresh,
    onexit,
    pressure,
    initialResource,
    keys,
    onkeys,
    position = $bindable()
  }: {
    office: HudOffice;
    links: HudLinks;
    onrefresh: () => Promise<void>;
    onexit: () => void;
    pressure: ManagerAdvice | null;
    initialResource?: ManagerAdvice['resource'];
    keys: HudKeys;
    onkeys: (keys: HudKeys) => void;
    position: { id: string; index: number };
  } = $props();
  let dialog: HTMLDialogElement, closeButton: HTMLButtonElement, queue: HudQueue;
  const staff = $derived(office.staff),
    sessions = $derived(office.sessions);
  let sample = $state<ComputerActivity>(),
    busy = $state(true),
    problem = $state('');
  let order = $state<'cpu' | 'bytes'>('cpu');
  let processes: HTMLDetailsElement;
  function reviewProcesses(resource: ManagerAdvice['resource']) {
    order = resource === 'memory' ? 'bytes' : 'cpu';
    processes.open = true;
    processes.querySelector('summary')?.focus();
  }
  let request: AbortController | undefined;
  let attention = $state<Awaited<ReturnType<typeof agentAttention>>>();
  let noticeError = $state('');
  async function refresh() {
    request?.abort();
    const controller = (request = new AbortController());
    busy = true;
    problem = noticeError = '';
    const read = <T,>(url: '/api/agent-attention' | '/api/computer-activity') =>
      call<T>(url, undefined, 'GET', controller.signal);
    await Promise.all([
      onrefresh(),
      read<ComputerActivity>('/api/computer-activity')
        .then((value) => {
          if (!controller.signal.aborted) sample = value;
        })
        .catch(() => {
          if (!controller.signal.aborted) problem = 'Computer readings unavailable.';
        }),
      read<Awaited<ReturnType<typeof agentAttention>>>('/api/agent-attention')
        .then((value) => {
          if (!controller.signal.aborted) attention = value;
        })
        .catch(() => {
          if (!controller.signal.aborted) noticeError = 'Agent status unavailable.';
        })
    ]);
    if (!controller.signal.aborted) busy = false;
  }
  onMount(() => {
    dialog.showModal();
    closeButton.focus();
    if (initialResource) {
      reviewProcesses(initialResource);
      void refresh();
    } else if (!queue.focusSelected())
      void refresh().then(async () => {
        await tick();
        if (document.activeElement === closeButton) queue?.focusSelected();
      });
    else void refresh();
    function visible() {
      if (!document.hidden && !busy) void refresh();
    }
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      request?.abort();
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  });
  const manager = $derived(staff.find((s) => s.manager));
  const byCpu = $derived(sample?.runs ?? []);
  const byMemory = $derived([...byCpu].sort((a, b) => b.bytes - a.bytes));
  const sorted = $derived(order === 'cpu' ? byCpu : byMemory);
  const items = $derived(hudItems(office, sample, attention?.items ?? [], links));
  const needs = $derived(items.needs),
    running = $derived(items.running),
    review = $derived(items.review);
  const coverage = $derived(
    [
      ...(attention && !attention.claude ? ['Claude status unavailable.'] : []),
      ...(attention && !attention.codex
        ? ['Codex live status covers connected projects only.']
        : []),
      ...(attention && !attention.receipts ? ['Codex unread status unavailable.'] : []),
      ...(attention?.codex
        ? ['Codex live status covers the local daemon and connected projects.']
        : [])
    ].join(' ')
  );
  const percent = (n: number | null) =>
    n === null ? 'Unavailable' : (n < 1 && n > 0 ? '<1' : Math.round(n)) + '%';
  function linked(run: ActivityRun) {
    return sessions.filter(
      (s) =>
        s.agent === run.agent && (s.terminalPid === run.pid || run.sessions.includes(s.nativeId))
    );
  }
  function title(run: ActivityRun) {
    const project = linked(run);
    const shared = run.shared || run.sessions.length > 1;
    if (run.task) return run.task;
    if (shared) return AGENT_NAMES[run.agent] + ' shared server';
    return (
      project[0]?.title || sample?.titles[run.sessions[0]] || run.project || AGENT_NAMES[run.agent]
    );
  }
  function ask(run?: ActivityRun) {
    if (!manager) return;
    const lines = [
      'Which agent needs me first and what should I do? Prioritize questions and approvals. Distinguish unread replies from blocked work. Give advice only.',
      noticeError || coverage,
      ...(needs.length
        ? needs.slice(0, 10).map((n) => [n.source, n.title, n.reason].join(' · '))
        : ['No confirmed requests in this snapshot.']),
      ...review.slice(0, 5).map((n) => 'Ready to review: ' + n.source + ' · ' + n.title),
      ...running.slice(0, 5).map((n) => n.source + ' · ' + n.title + ' · ' + n.reason),
      sample
        ? 'Measured ' +
          sample.measured +
          '. Computer CPU ' +
          percent(sample.cpu) +
          ', memory ' +
          formatMemory(sample.used) +
          ' of ' +
          formatMemory(sample.total) +
          '. Run CPU is per core. Memory includes child processes.'
        : 'Computer readings unavailable.'
    ];
    const rows = run ? [run] : [...new Set([...byCpu.slice(0, 6), ...byMemory.slice(0, 6)])];
    lines.push(
      run
        ? 'Selected run:'
        : 'Showing ' +
            rows.length +
            ' of ' +
            sorted.length +
            ' detected agent processes, including the highest CPU and memory readings.'
    );
    for (const r of rows) {
      const projects = linked(r);
      const odd = staff.find((s) => s.id === r.staffId);
      const labels = r.sessions
        .slice(0, 5)
        .map(
          (id) =>
            sample?.titles[id] ?? projects.find((s) => s.nativeId === id)?.title ?? id.slice(-8)
        );
      lines.push(
        [
          title(r),
          AGENT_NAMES[r.agent] + ' PID ' + r.pid,
          percent(r.cpu) + ' CPU',
          formatMemory(r.bytes),
          odd?.name,
          r.project,
          ...projects.slice(0, 5).map((s) => s.title + ' (' + s.status + ')'),
          labels.length ? 'Open conversations: ' + labels.join(', ') : '',
          r.shared || r.sessions.length > 1 ? 'Usage is shared across this process.' : ''
        ]
          .filter(Boolean)
          .join(' · ')
      );
    }
    chatAbout(manager.id, lines.join('\n'));
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="hud-heading"
  oncancel={(e) => {
    e.preventDefault();
    onexit();
  }}
  onkeydown={(e) => {
    if (e.defaultPrevented || e.repeat || e.isComposing) return;
    const key = chord(e);
    if (!key) return;
    if ((key === keys.back || key === 'Escape') && queue.backFromDetail(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (key === keys.open || key === keys.back) {
      e.preventDefault();
      e.stopPropagation();
      onexit();
    }
  }}
>
  <section class="activity">
    <div class="top">
      <h1 id="hud-heading"><span class="pixel-mark" aria-hidden="true"></span>Agent HUD</h1>
      <div class="links">
        <button class="choice" onclick={refresh} disabled={busy}
          ><PixelIcon name="refresh" />{busy ? 'Checking…' : 'Refresh'}</button
        >
        <button class="choice" bind:this={closeButton} onclick={onexit}>Close HUD</button>
      </div>
    </div>
    {#snippet action(n: HudItem)}
      {#if n.open}<button class="jump" onclick={n.open}>{n.action} ↗</button>
      {:else if n.url}<a class="jump" href={n.url}>{n.action} ↗</a>
      {:else}<details><summary>{n.action}</summary><small>{n.hint}</small></details>{/if}
    {/snippet}
    {#snippet row(n: HudItem)}
      <div class="notice">
        <div>
          <small>{n.source}</small>
          <h3>{n.title}</h3>
          <p>{n.reason}</p>
        </div>
        {@render action(n)}
      </div>
    {/snippet}
    {#if pressure}<PressureNotice
        advice={pressure}
        onreview={() => pressure && reviewProcesses(pressure.resource)}
      />{/if}
    <HudCapacity {needs} {running} {attention} {row} />
    <HudQueue bind:this={queue} items={needs} {keys} bind:position {busy} {action} />
    {#if noticeError}<p role="alert">
        {noticeError}{attention ? ' Showing the previous agent check.' : ''}
      </p>{/if}
    <div class="top">
      {#if manager}<button class="manager" onclick={() => ask()}
          ><PixelIcon name="pencil" />Ask {manager.name} what to do first</button
        >{/if}
      {#if attention}<small>Checked {new Date(attention.measured).toLocaleTimeString()}</small>{/if}
    </div>
    <details>
      <summary>Ready to review · {review.length}</summary>
      {#each review as item}{@render row(item)}{:else}<small>No unread items reported.</small
        >{/each}
    </details>
    <div class="key-settings"><HudShortcuts {keys} onchange={onkeys} /></div>
    <details class="computer" bind:this={processes}>
      <summary
        >Computer activity {#if sample}<span
            >CPU {percent(sample.cpu)} · Memory {formatMemory(sample.used)} of {formatMemory(
              sample.total
            )}</span
          >{/if}</summary
      >
      {#if problem}<p role="alert">
          {problem}{sample ? ' Showing the previous measurement.' : ''}
        </p>{/if}
      {#if sample}
        <div class="top">
          <h2>Agent processes <small>{sorted.length}</small></h2>
          <label
            >Sort by <select bind:value={order}
              ><option value="cpu">CPU</option><option value="bytes">Memory</option></select
            ></label
          >
        </div>
        <p class="legend">100% CPU uses one core. Each row includes its child processes.</p>
        <div class="runs">
          {#each sorted as r (r.pid)}
            {@const projects = linked(r)}
            {@const odd = staff.find((s) => s.id === r.staffId)}
            <article>
              <div class="run">
                <svg class="mark" aria-hidden="true" viewBox="0 0 24 24"
                  ><path d={LOGOS[r.agent]} fill="currentColor" /></svg
                >
                <div class="identity">
                  <h3>{title(r)}</h3>
                  <small
                    >{AGENT_NAMES[r.agent]} · PID {r.pid}{r.project && title(r) !== r.project
                      ? ' · ' + r.project
                      : ''}</small
                  >
                </div>
                <div class="reading"><strong>{percent(r.cpu)}</strong><small>CPU</small></div>
                <div class="reading">
                  <strong>{formatMemory(r.bytes)}</strong><small>Memory</small>
                </div>
              </div>
              {#if r.sessions.length}<details>
                  <summary
                    >{r.sessions.length} open {r.sessions.length === 1
                      ? 'conversation'
                      : 'conversations'}{r.shared || r.sessions.length > 1
                      ? ' · shared usage'
                      : ''}</summary
                  >
                  <ul>
                    {#each r.sessions as id}<li>
                        <a class="jump" href={codexChatUrl(id)}
                          >{sample.titles[id] ??
                            projects.find((s) => s.nativeId === id)?.title ??
                            'Conversation ' + id.slice(-8)} ↗</a
                        >
                      </li>{/each}
                  </ul>
                </details>
              {:else if r.shared}<small>Shared server usage</small>{/if}
              <div class="links">
                {#each projects as s}<button onclick={() => links.onproject(s.id)}
                    >{s.title} · {s.status}{s.staffId
                      ? ' · ' + (staff.find((p) => p.id === s.staffId)?.name ?? s.staffId)
                      : ''}</button
                  >{/each}
                {#if odd}<button onclick={() => links.onstaff(odd.id)}>{odd.name}</button>{/if}
                {#if manager}<button onclick={() => ask(r)}>Ask about this run</button>{/if}
              </div>
            </article>
          {:else}<p>
              No Claude Code, Codex, Gemini or Grok processes found for this account.
            </p>{/each}
        </div>
      {:else if busy}<p role="status">Reading CPU and memory…</p>{/if}
    </details>
    {#if coverage}<small>{coverage}</small>{/if}
  </section>
</dialog>

<style>
  dialog {
    color: var(--color-ink);
    background: var(--color-panel-solid);
    border: 1px solid var(--color-hairline);
    border-block-start: 3px solid var(--color-sea);
    border-radius: 0.45rem;
    inline-size: min(54rem, calc(100vw - 1.5rem));
    max-block-size: calc(100dvh - 2rem);
    margin: auto;
    padding: clamp(0.8rem, 2vw, 1.25rem);
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--color-night) 70%, transparent);
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .pixel-mark {
    inline-size: 0.85rem;
    block-size: 0.85rem;
    background: conic-gradient(
      var(--color-sea) 25%,
      transparent 0 50%,
      var(--color-sea) 0 75%,
      var(--color-ink) 0
    );
  }
  .computer > summary {
    font-weight: 600;
    color: var(--color-ink);
  }
  .computer > summary span {
    font-weight: 400;
    margin-inline-start: 0.5rem;
  }
  .computer[open] > .top {
    margin-block-start: 0.75rem;
  }

  .activity {
    max-inline-size: 56rem;
    margin-inline: auto;
    display: grid;
    gap: 0.7rem;
  }
  .top,
  .links,
  .run {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .top {
    justify-content: space-between;
  }
  h1 {
    font: 1.5rem var(--font-pixel);
  }
  h2,
  h3 {
    font-weight: 650;
  }
  h3 {
    overflow-wrap: anywhere;
  }
  p,
  small,
  label,
  .legend,
  summary {
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .top .choice {
    width: auto;
    justify-content: center;
  }
  article {
    border: 1px solid var(--color-hairline);
    border-radius: 0.35rem;
    padding: 0.75rem;
  }
  .links button,
  .jump,
  .manager {
    color: var(--color-sea);
    font-size: 0.82rem;
  }
  .manager {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    padding-block: 0.65rem;
    border-block-start: 1px solid var(--color-hairline);
  }
  .notice > div {
    min-inline-size: 0;
  }
  .notice small {
    font-size: 0.7rem;
  }
  .notice p {
    margin-block-start: 0.1rem;
    overflow-wrap: anywhere;
  }
  .notice .jump {
    flex-shrink: 0;
  }
  button:hover,
  a:hover {
    text-decoration: underline;
  }
  select {
    background: var(--color-panel-solid);
    border: 1px solid var(--color-hairline);
    border-radius: 0.4rem;
    padding: 0.25rem;
  }
  .runs {
    display: grid;
    gap: 0.5rem;
  }
  .legend {
    margin-block-start: -0.6rem;
  }
  .mark {
    width: 1.5rem;
    height: 1.5rem;
    color: var(--color-sea);
  }
  .identity {
    flex: 1 1 10rem;
    min-inline-size: 0;
  }
  .reading {
    min-inline-size: 4.6rem;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  .reading small {
    display: block;
  }
  summary {
    cursor: pointer;
  }
  details,
  .links {
    margin-block-start: 0.55rem;
  }
  li {
    margin-inline-start: 1.2rem;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
</style>
