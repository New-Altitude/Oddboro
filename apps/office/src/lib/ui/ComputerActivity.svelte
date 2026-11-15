<script lang="ts">
  import { onMount } from 'svelte';
  import { AGENT_NAMES } from '@oddboro/ledger/agents';
  import type { ComputerActivity, ActivityRun } from '#lib/server/computer-activity.ts';
  import type { workspace } from '#lib/server/workspace.ts';
  import { call } from './api.ts';
  import { chatAbout } from './chat-about.svelte.ts';
  import PixelIcon from './PixelIcon.svelte';
  import { LOGOS } from './tool-logos.ts';

  type Office = Awaited<ReturnType<typeof workspace>>;
  let {
    staff,
    sessions,
    desk,
    onproject,
    onstaff,
    ondesk
  }: Pick<Office, 'staff' | 'sessions' | 'desk'> & {
    onproject: (id: string) => void;
    onstaff: (id: string) => void;
    ondesk: (key: string) => void;
  } = $props();
  let sample = $state<ComputerActivity>(),
    busy = $state(true),
    problem = $state('');
  let order = $state<'cpu' | 'bytes'>('cpu');
  let request: AbortController | undefined;
  async function refresh() {
    request?.abort();
    const controller = (request = new AbortController());
    busy = true;
    problem = '';
    try {
      sample = await call<ComputerActivity>(
        '/api/computer-activity',
        undefined,
        'GET',
        controller.signal
      );
    } catch (e) {
      if (!controller.signal.aborted)
        problem = e instanceof Error ? e.message : 'Could not read computer activity.';
    } finally {
      if (!controller.signal.aborted) busy = false;
    }
  }
  onMount(() => {
    void refresh();
    return () => request?.abort();
  });
  const manager = $derived(staff.find((s) => s.manager));
  const byCpu = $derived(sample?.runs ?? []);
  const byMemory = $derived([...byCpu].sort((a, b) => b.bytes - a.bytes));
  const sorted = $derived(order === 'cpu' ? byCpu : byMemory);
  const waiting = $derived(sessions.filter((s) => s.status === 'waiting'));
  function memory(n: number) {
    return n >= 1024 ** 3
      ? (n / 1024 ** 3).toFixed(1) + ' GiB'
      : Math.round(n / 1024 ** 2) + ' MiB';
  }
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
    if (!sample || !manager) return;
    const lines = [
      'What needs my attention first? Use this computer activity snapshot and the office decisions below. Recommend what to inspect and explain why. Please give advice only.',
      'Measured ' +
        sample.measured +
        '. Computer CPU ' +
        percent(sample.cpu) +
        ', memory ' +
        memory(sample.used) +
        ' of ' +
        memory(sample.total) +
        '. Run CPU is per core. Memory includes child processes.',
      ...[...desk.asks, ...desk.tasks].slice(0, 5).map((a) => 'Waiting on me: ' + a.title),
      ...waiting.slice(0, 5).map((s) => 'Project waiting on me: ' + s.title)
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
          memory(r.bytes),
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

<section class="activity">
  <div class="top">
    <div>
      <h1>Computer activity</h1>
      <p>
        {sample
          ? 'Measured ' + new Date(sample.measured).toLocaleTimeString()
          : 'On the computer running your office'}
      </p>
    </div>
    <button class="choice refresh" onclick={refresh} disabled={busy}
      ><PixelIcon name="refresh" />{busy ? 'Measuring…' : 'Refresh'}</button
    >
  </div>
  {#if problem}<p role="alert">
      {problem}{sample ? ' Showing the previous measurement.' : ''}
    </p>{/if}
  {#if sample}
    <div class="meters">
      <div class="meter">
        <span>Computer CPU</span><strong>{percent(sample.cpu)}</strong>
        {#if sample.cpu !== null}<progress
            max="100"
            value={sample.cpu}
            aria-label="Computer CPU used"
          ></progress>{/if}
      </div>
      <div class="meter">
        <span>Memory in use</span><strong
          >{memory(sample.used)} <small>of {memory(sample.total)}</small></strong
        >
        <progress max={sample.total} value={sample.used} aria-label="Computer memory used"
        ></progress>
      </div>
    </div>
    <section class="attention">
      <div class="top">
        <h2>Needs your attention</h2>
        {#if manager}<button class="action" onclick={() => ask()}>Ask Office Manager</button>{/if}
      </div>
      {#each desk.asks as a}<button class="waiting" onclick={() => ondesk('ask-' + a.id)}
          >{a.title}<small>Needs your decision</small></button
        >{/each}
      {#each desk.tasks as t}<button class="waiting" onclick={() => ondesk('task-' + t.id)}
          >{t.title}<small>Owner task</small></button
        >{/each}
      {#each waiting as s}<button class="waiting" onclick={() => onproject(s.id)}
          >{s.title}<small>Project waiting for you</small></button
        >{/each}
      {#if !desk.asks.length && !desk.tasks.length && !waiting.length}<p>
          No office decisions waiting.
        </p>{/if}
      {#if byMemory[0]}<button class="waiting" onclick={() => ask(byMemory[0])} disabled={!manager}>
          {title(byMemory[0])}<small>Largest agent memory use · {memory(byMemory[0].bytes)}</small
          ></button
        >{/if}
    </section>
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
            <div class="reading"><strong>{memory(r.bytes)}</strong><small>Memory</small></div>
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
                    {sample.titles[id] ??
                      projects.find((s) => s.nativeId === id)?.title ??
                      'Conversation ' + id.slice(-8)}
                  </li>{/each}
              </ul>
            </details>
          {:else if r.shared}<small>Shared server usage</small>{/if}
          <div class="links">
            {#each projects as s}<button onclick={() => onproject(s.id)}
                >{s.title} · {s.status}{s.staffId
                  ? ' · ' + (staff.find((p) => p.id === s.staffId)?.name ?? s.staffId)
                  : ''}</button
              >{/each}
            {#if odd}<button onclick={() => onstaff(odd.id)}>{odd.name}</button>{/if}
            {#if manager}<button onclick={() => ask(r)}>Ask about this run</button>{/if}
          </div>
        </article>
      {:else}<p>No Claude Code, Codex, Gemini or Grok processes found for this account.</p>{/each}
    </div>
  {:else if busy}<p role="status">Reading CPU and memory…</p>{/if}
</section>

<style>
  .activity {
    max-inline-size: 56rem;
    margin-inline: auto;
    display: grid;
    gap: 1rem;
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
  .refresh {
    width: auto;
    justify-content: center;
  }
  .meters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr));
    gap: 0.75rem;
  }
  .meter,
  article,
  .attention {
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-card);
    background: var(--color-panel-solid);
    padding: 1rem;
  }
  .meter {
    display: grid;
    gap: 0.3rem;
  }
  .meter span {
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .meter strong {
    font: 1.7rem var(--font-pixel);
  }
  progress {
    width: 100%;
    height: 0.35rem;
    accent-color: var(--color-sea);
    margin-block-start: 0.3rem;
  }
  .attention {
    border-inline-start: 3px solid var(--color-ember);
  }
  .attention .top {
    margin-block-end: 0.4rem;
  }
  .action,
  .links button {
    color: var(--color-sea);
    font-size: 0.8rem;
  }
  button:hover {
    text-decoration: underline;
  }
  .waiting {
    display: block;
    text-align: start;
    padding-block: 0.35rem;
  }
  .waiting small {
    margin-inline-start: 0.65rem;
    color: var(--color-ember);
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
