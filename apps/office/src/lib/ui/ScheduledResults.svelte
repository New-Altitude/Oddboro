<script lang="ts">
  import type { JobRow, ResultEdition, ScheduledResult } from '@oddboro/ledger';
  import { call } from './api.ts';
  import Markdown from './Markdown.svelte';
  let { producerId, goalId, version }: { producerId?: number; goalId?: number; version: number } =
    $props();
  type Plan = ScheduledResult & { goalId: number | null; editions: ResultEdition[] };
  type Data = {
    plans: Plan[];
    jobs: JobRow[];
    staff: { id: string; name: string }[];
    connectors: { id: string; name: string }[];
    zone: string;
  };
  let data = $state<Data>(),
    problem = $state(''),
    editing = $state(false);
  let reviewerId = $state(0),
    responsibleId = $state(''),
    title = $state(''),
    deadline = $state('06:30'),
    zone = $state(''),
    repairs = $state(2),
    kind = $state('desk'),
    connector = $state(''),
    to = $state('');
  let busy = $state(false);
  const plans = $derived(
    data?.plans.filter((p) => (producerId ? p.producerId === producerId : p.goalId === goalId)) ??
      []
  );
  const producer = $derived(data?.jobs.find((j) => j.id === producerId));
  const reviewers = $derived(
    data?.jobs.filter(
      (j) =>
        j.id !== producerId &&
        j.files?.thread === producer?.files?.thread &&
        j.files?.input === `${producer?.staffId}/${producer?.files?.output}`
    ) ?? []
  );
  const when = (at: Date | string | null) => (at ? new Date(at).toLocaleString() : 'Not verified');
  async function load() {
    data = await call<Data>('/api/scheduled-results');
  }
  $effect(() => {
    void version;
    void load().catch((e) => (problem = String(e)));
  });
  async function act(body: unknown) {
    busy = true;
    problem = '';
    try {
      await call('/api/scheduled-results', body);
      await load();
      editing = false;
    } catch (e) {
      problem = String(e);
    } finally {
      busy = false;
    }
  }
  function edit() {
    const p = plans[0];
    reviewerId = p?.reviewerId ?? reviewers[0]?.id ?? 0;
    responsibleId = p?.responsibleId ?? reviewers[0]?.staffId ?? '';
    title = p?.title ?? producer?.name ?? '';
    deadline = p?.deadline ?? '06:30';
    zone = p?.zone ?? data?.zone ?? '';
    repairs = p?.repairs ?? 2;
    kind = p?.destination.kind ?? 'desk';
    connector = p?.destination.kind === 'gmail' ? p.destination.connector : '';
    to = p?.destination.kind === 'gmail' ? p.destination.to : '';
    editing = true;
  }
</script>

<section aria-label="Required scheduled result" class="space-y-2 text-xs">
  {#if producerId && producer?.files}<button class="text-sea" onclick={edit}
      >{plans.length ? 'Edit required result' : 'Require a reviewed result'}</button
    >{/if}
  {#if editing}
    <div class="space-y-2 rounded border border-hairline p-3">
      <p>Keep these existing jobs. Require one reviewed edition each day by this deadline.</p>
      <label class="block">Result title <input class="bg-night p-1" bind:value={title} /></label>
      <label class="block"
        >Reviewer job <select class="bg-night p-1" bind:value={reviewerId}
          >{#each reviewers as j (j.id)}<option value={j.id}>{j.name}</option>{/each}</select
        ></label
      >
      <label class="block"
        >Responsible Odd <select class="bg-night p-1" bind:value={responsibleId}
          >{#each data?.staff ?? [] as p (p.id)}<option value={p.id}>{p.name}</option
            >{/each}</select
        ></label
      >
      <label class="block"
        >Daily deadline <input type="time" class="bg-night p-1" bind:value={deadline} /></label
      >
      <label class="block">Time zone <input class="bg-night p-1" bind:value={zone} /></label>
      <label class="block"
        >Maximum recovery runs per edition <select class="bg-night p-1" bind:value={repairs}
          >{#each [0, 1, 2] as n}<option value={n}>{n}</option>{/each}</select
        ></label
      >
      <label class="block"
        >Delivery <select class="bg-night p-1" bind:value={kind}
          ><option value="desk">Office Desk</option><option value="gmail"
            >Gmail and Office Desk</option
          ></select
        ></label
      >
      {#if kind === 'gmail'}
        <label class="block"
          >Gmail account <select class="bg-night p-1" bind:value={connector}
            ><option value="">Choose an account</option
            >{#each data?.connectors ?? [] as c (c.id)}<option value={c.id}>{c.name}</option
              >{/each}</select
          ></label
        >
        <label class="block"
          >Recipient <input type="email" class="bg-night p-1" bind:value={to} /></label
        >
        <p>
          Act with Gmail write access sends each reviewed edition here. Draft waits for your
          approval of each exact message. Read cannot send. Gmail acceptance does not prove
          recipient arrival.
        </p>
      {/if}
      <p>
        Saving a changed requirement holds an existing unsent edition. The next day uses the new
        settings. Pausing this requirement leaves the job timers unchanged.
      </p>
      <button
        class="btn"
        disabled={busy || !reviewerId}
        onclick={() =>
          act({
            op: 'save',
            plan: {
              producerId,
              reviewerId,
              responsibleId,
              title,
              deadline,
              zone,
              repairs,
              destination: kind === 'desk' ? { kind: 'desk' } : { kind: 'gmail', connector, to }
            }
          })}>Save requirement</button
      >
      <button class="btn" onclick={() => (editing = false)}>Cancel</button>
    </div>
  {/if}
  {#each plans as p (p.id)}
    <div class="space-y-2 rounded border border-hairline p-3">
      <strong>{p.title}</strong>
      <p>
        Daily by {p.deadline} ({p.zone}). Responsible: {data?.staff.find(
          (s) => s.id === p.responsibleId
        )?.name ?? p.responsibleId}.
      </p>
      <button
        class="text-sea"
        disabled={busy}
        onclick={() => act({ op: 'pause', id: p.id, enabled: !p.enabled })}
        >{p.enabled ? 'Pause requirement' : 'Resume requirement'}</button
      >
      {#each p.editions as e (e.id)}
        <details open={e === p.editions[0]}>
          <summary
            >{e.day} · {e.delivery === 'accepted'
              ? 'Gmail accepted'
              : e.delivery === 'uncertain' || e.delivery === 'sending'
                ? 'Delivery uncertain'
                : e.deskAt
                  ? 'Available on Desk'
                  : e.reason
                    ? 'Needs attention'
                    : 'Waiting for current work'}</summary
          >
          <p>Deadline: {when(e.deadline)}</p>
          <p>
            Saved: {when(e.evidence.savedAt ?? null)} · Reviewed: {when(
              e.evidence.reviewedAt ?? null
            )}
          </p>
          <p>On Desk: {when(e.deskAt)} · Gmail acceptance: {when(e.acceptedAt)}</p>
          {#if e.receipt}<p class="break-all">
              Gmail receipt: {e.receipt}. Recipient arrival is not established.
            </p>{/if}
          <p>Recovery runs: {e.attempts}/{p.repairs}</p>
          {#if e.reason}<p>{e.reason}</p>{/if}
          {#if e.evidence.gaps.length}<p>
              Clock gaps remain in this edition. Later research cannot establish coverage during
              them.
            </p>{/if}
          {#if e.evidence.payload}
            <details>
              <summary
                >Exact reviewed message{e.destination.kind === 'gmail'
                  ? ` to ${e.destination.to}`
                  : ''}</summary
              >
              <p>{e.evidence.payload.subject}</p>
              <Markdown text={e.evidence.payload.body} />
              <p class="break-all">Reviewed file SHA-256: {e.evidence.sha256}</p>
              {#if e.destination.kind === 'gmail' && e.delivery === 'ready' && !e.approvedHash}<button
                  class="btn"
                  disabled={busy}
                  onclick={() => act({ op: 'approve', id: e.id, hash: e.evidence.payload?.hash })}
                  >Approve this exact delivery</button
                >{/if}
            </details>
          {/if}
        </details>
      {/each}
    </div>
  {/each}
  {#if problem}<p role="alert">{problem}</p>{/if}
</section>
