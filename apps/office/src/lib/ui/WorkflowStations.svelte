<script lang="ts">
  import type { GoalThread, Station, WorkflowBoard } from '@oddboro/ledger';
  import type { StaffProfile } from '../staff/roster.ts';
  import { call } from './api.ts';
  import { workLine } from './format.ts';

  let {
    staff,
    version,
    onthread
  }: { staff: StaffProfile[]; version: number; onthread: (t: GoalThread) => void } = $props();
  type Workflow = WorkflowBoard['workflows'][number];
  let board = $state<WorkflowBoard>({ workflows: [], jobs: [] });
  let draft = $state<{ id?: number; name: string; stations: Station[] }>();
  let job = $state<{ workflow: number; title: string; requestId: string }>();
  let busy = $state(false);
  let problem = $state('');
  let read = 0;
  const manager = $derived(staff.find((s) => s.role === 'Office Manager'));
  const colleagues = $derived(staff.filter((s) => s.id !== manager?.id));
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? id;
  const field = 'w-full rounded-lg bg-night/50 px-2.5 py-1.5 text-sm text-ink';
  const action = 'rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40';
  async function load() {
    const n = ++read;
    const next = await call<WorkflowBoard>('/api/workflows');
    if (n === read) board = next;
  }
  $effect(() => {
    void version;
    load().catch((e) => (problem = e.message));
  });
  function blank(name = ''): Station {
    return { name, odd: '', doneWhen: '' };
  }
  function edit(workflow?: Workflow) {
    problem = '';
    job = undefined;
    draft = workflow
      ? { id: workflow.id, name: workflow.name, stations: workflow.stations.map((s) => ({ ...s })) }
      : { name: '', stations: [blank('Production'), blank('QA')] };
  }
  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    problem = '';
    try {
      if (draft) {
        await call('/api/workflows', draft);
        draft = undefined;
      } else if (job) {
        await call(`/api/workflows/${job.workflow}/jobs`, {
          job: job.title,
          requestId: job.requestId
        });
        job = undefined;
      }
      await load();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section aria-label="Workflow stations" class="my-3 border-y border-hairline py-3">
  <div class="flex items-center justify-between gap-2">
    <h3 class="font-pixel text-base">Workflow stations</h3>
    {#if !draft}<button
        type="button"
        class="text-xs text-sea disabled:opacity-40"
        disabled={busy || !manager || !colleagues.length}
        onclick={() => edit()}>New workflow</button
      >{/if}
  </div>
  {#if !manager || !colleagues.length}<p class="my-1 text-xs text-muted">
      Hire an Office Manager and a colleague to run stations.
    </p>{/if}
  {#if problem}<p role="alert" class="my-1 text-xs text-coral">{problem}</p>{/if}
  {#if draft}
    <form class="mt-2 grid gap-2 rounded-xl bg-raise p-3" onsubmit={submit}>
      <label class="text-xs text-muted"
        >Workflow name<input class={field} required maxlength="80" bind:value={draft.name} /></label
      >
      {#each draft.stations as station, i (i)}
        <fieldset class="grid gap-1.5 border-s-2 border-sea/40 ps-3">
          <legend class="px-1 text-xs text-muted">Station {i + 1}</legend>
          <label class="text-xs"
            >Station name<input
              class={field}
              required
              maxlength="60"
              bind:value={station.name}
            /></label
          >
          <label class="text-xs"
            >Assigned Odd<select class={field} required bind:value={station.odd}>
              <option value="" disabled>Choose an Odd</option>
              {#each colleagues as odd (odd.id)}<option value={odd.id}>{odd.name}</option>{/each}
            </select></label
          >
          <label class="text-xs"
            >Done when<input
              class={field}
              required
              maxlength="500"
              bind:value={station.doneWhen}
            /></label
          >
          {#if i > 0}<label class="text-xs"
              >If revisions are needed<select class={field} bind:value={station.reviseTo}>
                <option value={undefined}>Stop for review</option>
                {#each draft.stations.slice(0, i) as back, j (j)}<option value={j}
                    >Return to {back.name || 'station ' + (j + 1)}</option
                  >{/each}
              </select></label
            >{/if}
        </fieldset>
      {/each}
      <div class="flex flex-wrap gap-3 text-xs text-sea">
        {#if draft.stations.length < 12}<button
            type="button"
            onclick={() => draft?.stations.push(blank())}>Add station</button
          >{/if}
        {#if draft.stations.length > 2}<button type="button" onclick={() => draft?.stations.pop()}
            >Remove last station</button
          >{/if}
      </div>
      <div class="flex items-center gap-3">
        <button class={action} disabled={busy}>Save workflow</button>
        <button class="text-xs" type="button" disabled={busy} onclick={() => (draft = undefined)}
          >Cancel</button
        >
      </div>
    </form>
  {:else}
    {#each board.workflows as flow (flow.id)}
      <div class="mt-2 rounded-xl bg-raise p-3">
        <div class="flex items-center justify-between gap-2">
          <strong class="text-sm">{flow.name}</strong><button
            class="text-xs text-sea"
            type="button"
            onclick={() => edit(flow)}>Edit workflow</button
          >
        </div>
        <ol class="my-2 flex flex-wrap items-start gap-1">
          {#each flow.stations as station, i (i)}
            <li class="flex items-center gap-1 text-xs">
              {#if i}<span aria-hidden="true" class="text-faint">→</span>{/if}<span
                class="rounded bg-night/40 px-2 py-1"
                >{station.name}<small class="block text-muted">{nameOf(station.odd)}</small></span
              >
            </li>
          {/each}
        </ol>
        {#if job?.workflow === flow.id && job}
          <form class="grid gap-2" onsubmit={submit}>
            <label class="text-xs"
              >Job description<input
                class={field}
                required
                maxlength="140"
                bind:value={job.title}
              /></label
            >
            <div class="flex gap-3">
              <button class={action} disabled={busy}>Start job</button><button
                type="button"
                class="text-xs"
                disabled={busy}
                onclick={() => (job = undefined)}>Cancel</button
              >
            </div>
          </form>
        {:else}
          <button
            type="button"
            class="text-xs text-sea"
            onclick={() => {
              problem = '';
              job = { workflow: flow.id, title: '', requestId: crypto.randomUUID() };
            }}>New job</button
          >
        {/if}
        {#each board.jobs.filter((j) => j.workflowId === flow.id) as item (item.thread.id)}
          {@const t = item.thread}
          <button
            class="mt-2 block w-full rounded-lg bg-night/40 p-2 text-start text-xs"
            onclick={() => onthread(t)}
          >
            <span class="block">{t.title}</span>
            <span class="text-muted"
              >{item.stations[item.at].name} · {workLine({
                ...t,
                lead: nameOf(t.hubId),
                holder: nameOf(t.holderId)
              }).text}</span
            >
            {#if item.reason}<span class="block line-clamp-2 text-coral">{item.reason}</span>{/if}
            {#each t.waiting as w}<span class="block text-ember"
                >Waits on your {w.kind}: {w.title}</span
              >{/each}
          </button>
        {/each}
      </div>
    {/each}
  {/if}
</section>
