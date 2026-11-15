<script lang="ts">
  import { onMount } from 'svelte';
  import { AGENT_NAMES } from '@oddboro/ledger/agents';
  import type { ComputerActivity, ActivityRun } from '#lib/server/computer-activity.ts';
  import type { workspace } from '#lib/server/workspace.ts';
  import { call } from './api.ts';
  import { chatAbout } from './chat-about.svelte.ts';
  import PixelIcon from './PixelIcon.svelte';
  import { LOGOS } from './tool-logos.ts';

  import type { agentAttention, AgentNotice } from '#lib/server/agent-attention.ts';
  type Notice = {
    source: string;
    title: string;
    reason: string;
    action: string;
    open?: () => void;
    url?: string;
    hint?: string;
  };
  type Office = Awaited<ReturnType<typeof workspace>>;
  let {
    staff,
    sessions,
    desk,
    unread,
    inProgress,
    onreport,
    onrefresh,
    onproject,
    onstaff,
    ondesk
  }: Pick<Office, 'staff' | 'sessions' | 'desk' | 'unread' | 'inProgress'> & {
    onrefresh: () => Promise<void>;
    onreport: (id: number, staffId: string, title: string) => void;
    onproject: (id: string) => void;
    onstaff: (id: string) => void;
    ondesk: (key: string) => void;
  } = $props();
  let sample = $state<ComputerActivity>(),
    busy = $state(true),
    problem = $state('');
  let order = $state<'cpu' | 'bytes'>('cpu');
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
    void refresh();
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
  const waiting = $derived(sessions.filter((s) => s.status === 'waiting'));
  const who = (id: string | null) => staff.find((s) => s.id === id)?.name ?? 'Office';
  function external(r: AgentNotice): Notice {
    const s = sessions.find((s) => s.agent === r.agent && s.nativeId === r.id);
    const base = { source: AGENT_NAMES[r.agent], title: r.title, reason: r.reason };
    if (s) return { ...base, action: 'Open project', open: () => onproject(s.id) };
    if (r.agent === 'codex')
      return { ...base, action: 'Open chat', url: 'codex://threads/' + encodeURIComponent(r.id) };
    return {
      ...base,
      action: 'Find session',
      hint:
        r.job && /^[a-zA-Z0-9_-]+$/.test(r.job) && !r.job.startsWith('-')
          ? 'In your terminal: claude attach ' + r.job
          : 'Select this conversation in claude agents.'
    };
  }
  const remote = $derived(attention?.items ?? []);
  const remoteWaits = $derived(remote.filter((r) => r.state === 'waiting'));
  const needs = $derived<Notice[]>([
    ...desk.asks.map((a) => ({
      source: 'Oddboro · ' + who(a.staffId),
      title: a.title,
      reason: a.why || 'Needs a decision',
      action: 'Decide',
      open: () => ondesk('ask-' + a.id)
    })),
    ...remoteWaits.map(external),
    ...waiting
      .filter((s) => !remoteWaits.some((r) => r.agent === s.agent && r.id === s.nativeId))
      .map((s) => ({
        source: AGENT_NAMES[s.agent],
        title: s.title,
        reason: 'Project waiting for you',
        action: 'Open project',
        open: () => onproject(s.id)
      })),
    ...desk.tasks.map((t) => ({
      source: 'Oddboro · ' + who(t.staffId),
      title: t.title,
      reason: 'Assigned to you',
      action: 'View task',
      open: () => ondesk('task-' + t.id)
    })),
    ...desk.projectWork.map((p) => ({
      source: 'Oddboro · ' + who(p.staffId),
      title: p.title,
      reason: 'Proposed project work',
      action: 'Review proposal',
      open: () => onproject(p.sessionId)
    }))
  ]);
  const review = $derived<Notice[]>([
    ...staff
      .filter((s) => unread[s.id])
      .map((s) => ({
        source: 'Oddboro',
        title: s.name,
        reason: unread[s.id] === 1 ? 'Left you a message' : unread[s.id] + ' unread messages',
        action: 'Read message',
        open: () => onstaff(s.id)
      })),
    ...desk.reports.map((r) => ({
      source: 'Oddboro · ' + who(r.staffId),
      title: r.title,
      reason: 'New report',
      action: 'Read report',
      open: () => onreport(r.id, r.staffId, r.title)
    })),
    ...remote.filter((r) => r.state === 'review').map(external)
  ]);
  const running = $derived<Notice[]>([
    ...Object.entries(inProgress).flatMap(([id, jobs]) =>
      jobs.map((w) => ({
        source: 'Oddboro · ' + who(id),
        title: w.label,
        reason: 'Working',
        action: 'Open chat',
        open: () => onstaff(id)
      }))
    ),
    ...(sample?.openTurns ?? [])
      .filter(
        (id) =>
          !remote.some((r) => r.agent === 'codex' && r.id === id && r.state !== 'review') &&
          !sessions.some(
            (s) =>
              s.agent === 'codex' &&
              s.nativeId === id &&
              (s.status === 'waiting' || s.status === 'working')
          )
      )
      .map((id) =>
        external({
          agent: 'codex',
          id,
          title: sample?.titles[id] ?? 'Chat ' + id.slice(-8),
          state: 'working',
          reason: 'Turn in progress · check chat for live requests'
        })
      ),
    ...remote.filter((r) => r.state === 'working').map(external),
    ...sessions
      .filter(
        (s) =>
          s.status === 'working' &&
          !remote.some((r) => r.state !== 'review' && r.agent === s.agent && r.id === s.nativeId)
      )
      .map((s) => ({
        source: AGENT_NAMES[s.agent],
        title: s.title,
        reason: 'Working',
        action: 'Open project',
        open: () => onproject(s.id)
      }))
  ]);
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
          memory(sample.used) +
          ' of ' +
          memory(sample.total) +
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
      <h1>Agent HUD</h1>
      <p>
        {attention
          ? 'Agent status checked ' + new Date(attention.measured).toLocaleTimeString()
          : 'On the computer running your office'}
      </p>
    </div>
    <button class="choice refresh" onclick={refresh} disabled={busy}
      ><PixelIcon name="refresh" />{busy ? 'Measuring…' : 'Refresh'}</button
    >
  </div>
  {#snippet row(n: Notice)}
    <div class="notice">
      <div>
        <small class="source">
          {#if n.source === AGENT_NAMES.claude || n.source === AGENT_NAMES.codex}
            <svg aria-hidden="true" viewBox="0 0 24 24"
              ><path
                fill="currentColor"
                d={LOGOS[n.source === AGENT_NAMES.codex ? 'codex' : 'claude']}
              /></svg
            >
          {/if}{n.source}
        </small>
        <h3>{n.title}</h3>
        <p>{n.reason}</p>
      </div>
      {#if n.open}<button class="jump" onclick={n.open}>{n.action} ↗</button>
      {:else if n.url}<a class="jump" href={n.url}>{n.action} ↗</a>
      {:else}<details><summary>{n.action}</summary><small>{n.hint}</small></details>{/if}
    </div>
  {/snippet}
  <section class="attention">
    <div class="top">
      <div><h2>Who needs me? <span class="count">{needs.length}</span></h2></div>
      {#if manager}<button class="manager" onclick={() => ask()}>
          <PixelIcon name="pencil" />Ask {manager.name}
        </button>{/if}
    </div>
    {#each needs as n}{@render row(n)}{:else}<p class="clear">
        {busy && !attention ? 'Checking for requests…' : 'No confirmed requests waiting on you.'}
      </p>{/each}
    {#if noticeError}<p role="alert">
        {noticeError}{attention ? ' Showing the previous agent check.' : ''}
      </p>{/if}
    {#if coverage}<p class="coverage">{coverage}</p>{/if}
  </section>
  <div class="lanes">
    <section class="lane">
      <h2>Ready to review <span class="count">{review.length}</span></h2>
      {#each review.slice(0, 3) as n}{@render row(n)}{:else}<p>No unread items reported.</p>{/each}
      {#if review.length > 3}<details>
          <summary>{review.length - 3} more to review</summary
          >{#each review.slice(3) as n}{@render row(n)}{/each}
        </details>{/if}
    </section>
    <section class="lane">
      <h2>In progress <span class="count">{running.length}</span></h2>
      {#each running.slice(0, 3) as n}{@render row(n)}{:else}<p>
          No active work reported by connected sources.
        </p>{/each}
      {#if running.length > 3}<details>
          <summary>{running.length - 3} more working</summary
          >{#each running.slice(3) as n}{@render row(n)}{/each}
        </details>{/if}
    </section>
  </div>
  <div class="top">
    <h2>Computer activity</h2>
    {#if sample}<small>Measured {new Date(sample.measured).toLocaleTimeString()}</small>{/if}
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
  .count {
    color: var(--color-muted);
    font: 0.8rem var(--font-pixel);
    margin-inline-start: 0.4rem;
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
  .source {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .source svg {
    inline-size: 1rem;
    block-size: 1rem;
  }
  .attention .source {
    color: var(--color-ember);
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
  .attention h2 {
    font: 1.3rem var(--font-pixel);
  }
  .attention {
    background: var(--color-panel-solid);
  }
  .coverage {
    margin-block-start: 0.55rem;
    font-size: 0.72rem;
  }
  .clear {
    color: var(--color-ink);
    margin-block: 0.5rem;
  }
  .lanes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
    gap: 0.75rem;
    align-items: start;
  }
  .lane {
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-card);
    padding: 0.85rem 1rem;
    background: var(--color-panel-solid);
  }
  .lane h2 {
    margin-block-end: 0.45rem;
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
