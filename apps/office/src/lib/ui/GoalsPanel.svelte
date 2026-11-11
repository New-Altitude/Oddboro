<script lang="ts">
  import ScheduledResults from './ScheduledResults.svelte';
  import GoalProjects from './GoalProjects.svelte';
  import type {
    GoalHorizon,
    GoalStatus,
    GoalsWindow,
    GoalThread,
    GoalView,
    GoalWithThreads,
    ThreadStage
  } from '@oddboro/ledger';
  import {
    GOAL_AREAS,
    GOAL_IS_LIVE,
    goalWhen,
    HEALTH_WORDS,
    HORIZONS,
    STATUS_WORDS
  } from '@oddboro/ledger/goals';
  import { call } from './api.ts';
  import { ago, workLine } from './format.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  // The owner's goals: what they want more of. Setting one sends the Office
  // Manager off to plan it; the plan comes back to the desk. Each goal shows who
  // serves it, its threads and how it is going, and the owner can give it to
  // more staff. Other work, under the goals, is every thread for no goal still
  // in flight, so all of it shows here. `onthread` opens a thread, as the page
  // does from anywhere.
  type Props = { staff: StaffProfile[]; version: number; onthread: (t: GoalThread) => void };
  let { staff, version, onthread }: Props = $props();

  let goals = $state<GoalWithThreads[]>([]);
  let other = $state<GoalThread[]>([]);
  let loaded = $state(false);
  let problem = $state('');
  let busy = $state(false);
  /** The goal open for a closer look. */
  let openId = $state<number | undefined>();
  /** Set while writing a new goal (no id) or rewording one. */
  let draft = $state<
    | {
        id?: number;
        title: string;
        why: string;
        doneWhen: string;
        horizon: GoalHorizon;
        due: string;
        area: string;
      }
    | undefined
  >();
  let invalid = $state('');
  let planning = $state<number | undefined>();
  let addWho = $state('');
  let addPart = $state('');
  let showDone = $state(false);

  const manager = $derived(staff.find((s) => s.role === 'Office Manager'));
  const live = $derived(goals.filter((g) => GOAL_IS_LIVE[g.status]));
  const past = $derived(goals.filter((g) => !GOAL_IS_LIVE[g.status]));
  const areas = $derived([
    ...new Set([...GOAL_AREAS, ...goals.map((g) => g.area)].map((a) => a.toLowerCase()))
  ]);
  const byArea = $derived(
    areas
      .map((area) => ({ area, list: live.filter((g) => g.area === area) }))
      .filter((a) => a.list.length)
  );

  async function load() {
    const r = await call<GoalsWindow>('/api/goals');
    goals = r.goals;
    other = r.other;
    loaded = true;
  }

  $effect(() => {
    void version;
    load().catch((e: unknown) => (problem = e instanceof Error ? e.message : String(e)));
  });

  async function act(fn: () => Promise<unknown>) {
    busy = true;
    problem = '';
    try {
      await fn();
      await load();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function startNew() {
    invalid = '';
    draft = { title: '', why: '', doneWhen: '', horizon: 'ongoing', due: '', area: 'work' };
  }

  function startEdit(g: GoalView) {
    invalid = '';
    draft = {
      id: g.id,
      title: g.title,
      why: g.why ?? '',
      doneWhen: g.doneWhen ?? '',
      horizon: g.horizon,
      due: g.due ?? '',
      area: g.area
    };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.title.trim()) return void (invalid = 'Say what the goal is.');
    if (draft.horizon === 'date' && !draft.due) return void (invalid = 'Pick the date it is for.');
    invalid = '';
    const d = draft;
    await act(async () => {
      if (d.id) await call(`/api/goals/${d.id}`, d, 'PUT');
      else {
        const g = await call<{ id: number }>('/api/goals', d);
        planning = g.id;
        openId = g.id;
      }
      draft = undefined;
    });
  }

  const setStatus = (g: GoalView, status: GoalStatus) =>
    act(() => call(`/api/goals/${g.id}`, { status }, 'PUT'));

  async function addServer(g: GoalView) {
    if (!addWho || !addPart.trim()) return;
    const body = { staff: addWho, part: addPart };
    await act(async () => {
      await call(`/api/goals/${g.id}/staff`, body);
      addWho = '';
      addPart = '';
    });
  }

  const removeServer = (g: GoalView, id: string) =>
    act(() => call(`/api/goals/${g.id}/staff?staff=${encodeURIComponent(id)}`, {}, 'DELETE'));

  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? id;
  const STAGE_TONE: Partial<Record<ThreadStage, string>> = {
    waiting_on_you: 'text-ember',
    failed: 'text-coral'
  };

  const HEALTH_TONE = { on_track: 'text-moss', slipping: 'text-ember', blocked: 'text-coral' };
  const field =
    'w-full rounded-lg bg-raise px-3 py-2 text-sm outline-none placeholder:text-faint focus:ring-1 focus:ring-sea/60';
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="Your goals">
  <header class="flex items-center gap-2 border-b border-hairline p-3">
    <div class="min-w-0 flex-1">
      <div class="font-pixel text-lg leading-none">Goals</div>
      <div class="mt-1 text-xs text-muted">
        What you want more of. {manager ? `${manager.name} plans` : 'The office plans'} each one.
      </div>
    </div>
    {#if !draft}
      <button
        class="rounded-lg bg-sea px-3 py-1.5 text-sm font-medium text-night disabled:opacity-40"
        disabled={busy}
        onclick={startNew}>New goal</button
      >
    {/if}
  </header>

  <div class="flex-1 overflow-y-auto p-3">
    {#if problem}
      <p class="mb-3 rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral" role="alert">{problem}</p>
    {/if}

    {#if draft}
      <form class="mb-4 flex flex-col gap-2 rounded-xl bg-raise/60 p-3" novalidate onsubmit={save}>
        <label class="text-xs text-muted" for="goal-title">The goal</label>
        <input
          id="goal-title"
          class={field}
          maxlength="140"
          placeholder="Read a book a month"
          aria-invalid={invalid.startsWith('Say')}
          bind:value={draft.title}
          {@attach (n) => n.focus()}
        />
        <label class="mt-1 text-xs text-muted" for="goal-why">Why it matters</label>
        <textarea
          id="goal-why"
          rows="2"
          class="{field} resize-y"
          maxlength="1000"
          placeholder="Less screen time at night, and I miss reading."
          bind:value={draft.why}></textarea>
        <label class="mt-1 text-xs text-muted" for="goal-done">What done looks like</label>
        <input
          id="goal-done"
          class={field}
          maxlength="1000"
          placeholder="A book a month, for three months"
          bind:value={draft.doneWhen}
        />
        <div class="mt-1 grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs text-muted" for="goal-when">When</label>
            <select id="goal-when" class="{field} mt-1" bind:value={draft.horizon}>
              {#each HORIZONS as h (h.id)}
                <option value={h.id}>{h.label}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="text-xs text-muted" for="goal-area">Area</label>
            <input
              id="goal-area"
              class="{field} mt-1"
              list="goal-areas"
              maxlength="40"
              bind:value={draft.area}
            />
            <datalist id="goal-areas">
              {#each areas as a (a)}<option value={a}></option>{/each}
            </datalist>
          </div>
        </div>
        {#if draft.horizon === 'date'}
          <label class="text-xs text-muted" for="goal-due">By</label>
          <input
            id="goal-due"
            type="date"
            class={field}
            aria-invalid={invalid.startsWith('Pick')}
            bind:value={draft.due}
          />
        {/if}
        {#if invalid}
          <p class="text-xs text-coral" role="alert">{invalid}</p>
        {/if}
        <div class="mt-2 flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink"
            onclick={() => (draft = undefined)}>Cancel</button
          >
          <span class="flex-1"></span>
          <button
            class="rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
            disabled={busy}>{draft.id ? 'Save' : 'Set the goal'}</button
          >
        </div>
        {#if !draft.id}
          <p class="text-[11px] text-faint">
            {manager?.name ?? 'The office'} plans it next: who does what, and anything only you can do.
            The plan comes to your desk.
          </p>
        {/if}
      </form>
    {/if}

    {#if loaded && !goals.length && !draft}
      <div class="py-10 text-center text-sm text-muted">
        <p>No goals yet.</p>
        <p class="mt-1 text-xs text-faint">
          Set one here, or tell {manager?.name ?? 'your manager'} in chat what you want more of.
        </p>
      </div>
    {/if}

    {#snippet threadRow(t: GoalThread)}
      <li>
        <button
          class="w-full rounded-lg bg-night/30 px-2.5 py-1.5 text-start text-xs hover:bg-sea/10"
          onclick={() => onthread(t)}
        >
          <span class="block text-ink">{t.title}</span>
          <span class="mt-0.5 block {STAGE_TONE[t.stage] ?? 'text-faint'}">
            {workLine({ ...t, lead: nameOf(t.hubId), holder: nameOf(t.holderId) }).text}
          </span>
          {#each t.waiting as w (`${w.kind}-${w.id}`)}
            <span class="mt-0.5 block text-ember">Waits on your {w.kind}: {w.title}</span>
          {/each}
        </button>
      </li>
    {/snippet}

    {#snippet goalRow(g: GoalWithThreads)}
      {@const latest = g.progress[0]}
      {@const isOpen = openId === g.id}
      <li class="rounded-xl bg-raise">
        <button
          class="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-start transition-colors hover:bg-sea/10"
          aria-expanded={isOpen}
          onclick={() => {
            openId = isOpen ? undefined : g.id;
            addWho = '';
            addPart = '';
          }}
        >
          <span class="min-w-0 flex-1">
            <span class="block text-sm text-ink" class:text-muted={g.status !== 'active'}
              >{g.title}</span
            >
            <span class="mt-0.5 block text-[11px] text-faint">
              {goalWhen(g)}{g.status === 'active' ? '' : ` · ${STATUS_WORDS[g.status]}`} · {g.staff
                .length
                ? g.staff.map((s) => s.name).join(', ')
                : planning === g.id
                  ? `${manager?.name ?? 'The office'} is planning it`
                  : 'Nobody on it yet'}
            </span>
          </span>
          {#if latest}
            <span class="shrink-0 text-[11px] {HEALTH_TONE[latest.health]}"
              >{HEALTH_WORDS[latest.health]}</span
            >
          {/if}
        </button>

        {#if isOpen}
          <div class="flex flex-col gap-3 border-t border-hairline px-3 py-3 text-sm">
            <ScheduledResults goalId={g.id} {version} />
            <GoalProjects goalId={g.id} {staff} {version} />
            {#if g.why || g.doneWhen}
              <dl class="flex flex-col gap-2">
                {#if g.why}
                  <div>
                    <dt class="text-xs text-muted">Why it matters</dt>
                    <dd class="mt-0.5">{g.why}</dd>
                  </div>
                {/if}
                {#if g.doneWhen}
                  <div>
                    <dt class="text-xs text-muted">Done when</dt>
                    <dd class="mt-0.5">{g.doneWhen}</dd>
                  </div>
                {/if}
              </dl>
            {/if}

            <div>
              <div class="text-xs text-muted">Who serves it</div>
              {#if g.staff.length}
                <ul class="mt-1 flex flex-col gap-1">
                  {#each g.staff as s (s.staffId)}
                    <li class="flex items-start gap-2 rounded-lg bg-night/30 px-2.5 py-1.5 text-xs">
                      <span class="min-w-0 flex-1">
                        <span class="font-medium text-ink">{s.name}</span>
                        <span class="text-muted">· {s.part}</span>
                      </span>
                      <button
                        class="text-faint hover:text-coral"
                        aria-label={`Take ${s.name} off this goal`}
                        title="Take them off this goal"
                        disabled={busy}
                        onclick={() => removeServer(g, s.staffId)}>✕</button
                      >
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="mt-1 text-xs text-faint">
                  {planning === g.id
                    ? `${manager?.name ?? 'The office'} is planning it. The plan comes to your desk.`
                    : 'Nobody yet. Approve a plan, or add an Odd here.'}
                </p>
              {/if}
              {#if staff.some((p) => !g.staff.some((s) => s.staffId === p.id))}
                <form
                  class="mt-2 flex flex-col gap-1.5"
                  novalidate
                  onsubmit={(e) => {
                    e.preventDefault();
                    void addServer(g);
                  }}
                >
                  <div class="flex gap-1.5">
                    <select
                      class="rounded-lg bg-night/40 px-2 py-1.5 text-xs outline-none"
                      aria-label="Who"
                      bind:value={addWho}
                    >
                      <option value="">Add an Odd to this goal</option>
                      {#each staff.filter((p) => !g.staff.some((s) => s.staffId === p.id)) as p (p.id)}
                        <option value={p.id}>{p.name}</option>
                      {/each}
                    </select>
                    {#if addWho}
                      <input
                        class="min-w-0 flex-1 rounded-lg bg-night/40 px-2.5 py-1.5 text-xs outline-none placeholder:text-faint"
                        placeholder="What they do for it"
                        maxlength="400"
                        aria-label="What they do for it"
                        bind:value={addPart}
                      />
                      <button
                        class="rounded-lg bg-sea px-2.5 py-1.5 text-xs font-medium text-night disabled:opacity-40"
                        disabled={busy || !addPart.trim()}>Add</button
                      >
                    {/if}
                  </div>
                  {#if addWho}
                    <p class="text-[11px] text-faint">
                      They see this goal from their next run, and say how it is going.
                    </p>
                  {/if}
                </form>
              {/if}
            </div>

            {#if g.threads.length}
              <ul class="flex flex-col gap-1">
                {#each g.threads as t (t.id)}
                  {@render threadRow(t)}
                {/each}
              </ul>
            {:else}
              <p class="text-xs text-faint">Not started yet.</p>
            {/if}

            <div>
              <div class="text-xs text-muted">How it is going</div>
              {#if g.progress.length}
                <ul class="mt-1 flex flex-col gap-1">
                  {#each g.progress as p (p.id)}
                    <li class="text-xs leading-snug">
                      <span class={HEALTH_TONE[p.health]}>{HEALTH_WORDS[p.health]}</span>
                      <span class="text-ink">· {p.note}</span>
                      <span class="text-faint">· {p.name}, {ago(String(p.createdAt))}</span>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="mt-1 text-xs text-faint">
                  Nothing yet. Odds log progress as they work on it.
                </p>
              {/if}
            </div>

            <div class="flex flex-wrap gap-1.5">
              <button
                class="rounded-lg bg-night/40 px-2.5 py-1.5 text-xs hover:bg-sea/20 disabled:opacity-40"
                disabled={busy}
                onclick={() => startEdit(g)}>Reword</button
              >
              {#if g.status === 'active'}
                <button
                  class="rounded-lg bg-night/40 px-2.5 py-1.5 text-xs hover:bg-sea/20 disabled:opacity-40"
                  disabled={busy}
                  onclick={() => setStatus(g, 'met')}>Mark met</button
                >
                <button
                  class="rounded-lg bg-night/40 px-2.5 py-1.5 text-xs hover:bg-sea/20 disabled:opacity-40"
                  disabled={busy}
                  onclick={() => setStatus(g, 'paused')}>Pause</button
                >
                <button
                  class="rounded-lg bg-night/40 px-2.5 py-1.5 text-xs hover:bg-coral/25 disabled:opacity-40"
                  disabled={busy}
                  onclick={() => setStatus(g, 'dropped')}>Drop</button
                >
              {:else}
                <button
                  class="rounded-lg bg-night/40 px-2.5 py-1.5 text-xs hover:bg-sea/20 disabled:opacity-40"
                  disabled={busy}
                  onclick={() => setStatus(g, 'active')}>Pick it back up</button
                >
              {/if}
            </div>
          </div>
        {/if}
      </li>
    {/snippet}

    {#each byArea as group (group.area)}
      <h3 class="mt-1 mb-1.5 text-[10px] tracking-[0.16em] text-faint uppercase">{group.area}</h3>
      <ul class="mb-3 flex flex-col gap-1.5">
        {#each group.list as g (g.id)}
          {@render goalRow(g)}
        {/each}
      </ul>
    {/each}

    {#if other.length}
      <h3 class="mt-1 mb-1.5 text-[10px] tracking-[0.16em] text-faint uppercase">Other work</h3>
      <ul class="mb-3 flex flex-col gap-1">
        {#each other as t (t.id)}
          {@render threadRow(t)}
        {/each}
      </ul>
    {/if}

    {#if past.length}
      <button
        class="mt-2 text-xs text-muted hover:text-ink"
        aria-expanded={showDone}
        onclick={() => (showDone = !showDone)}
        >{showDone ? 'Hide' : 'Show'} met and dropped ({past.length})</button
      >
      {#if showDone}
        <ul class="mt-2 flex flex-col gap-1.5">
          {#each past as g (g.id)}
            {@render goalRow(g)}
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</section>
