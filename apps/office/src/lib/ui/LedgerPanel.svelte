<script lang="ts">
  import type { LedgerKind, LedgerRow } from '@oddboro/ledger';
  import { call } from './api.ts';
  import Markdown from './Markdown.svelte';
  import { when } from './format.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  /** `version` changes when the ledger gets a row, and the search runs again. */
  type Props = { staff: StaffProfile[]; version: number };
  let { staff, version }: Props = $props();

  let q = $state('');
  let kind = $state<LedgerKind | ''>('');
  let who = $state('');
  let rows = $state<LedgerRow[]>([]);
  let loading = $state(false);

  const KINDS: { value: LedgerKind | ''; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'decision', label: 'Decisions' },
    { value: 'work', label: 'Work' },
    { value: 'report', label: 'Reports' },
    { value: 'hire', label: 'Hires' },
    { value: 'access', label: 'Access' }
  ];

  // Search when the words settle, not on every key.
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void version;
    const params = new URLSearchParams({ q, kind, who });
    clearTimeout(timer);
    timer = setTimeout(async () => {
      loading = true;
      try {
        rows = await call<LedgerRow[]>(`/api/ledger?${params}`);
      } finally {
        loading = false;
      }
    }, 250);
    return () => clearTimeout(timer);
  });

  const name = (id: string) =>
    id === 'owner' ? 'You' : (staff.find((p) => p.id === id)?.name ?? id);
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="The ledger">
  <header class="border-b border-hairline p-3">
    <div class="flex items-center">
      <div class="flex-1">
        <div class="font-pixel text-lg leading-none">The ledger</div>
        <div class="mt-1 text-xs text-muted">
          Every decision and every piece of work, by your Odds and by you.
        </div>
      </div>
    </div>
    <input
      class="mt-3 w-full rounded-lg bg-raise px-3 py-2 text-sm outline-none placeholder:text-faint"
      placeholder="Search by meaning, e.g. newsletters I said no to"
      bind:value={q}
    />
    <div class="mt-2 flex flex-wrap items-center gap-1">
      {#each KINDS as k (k.value)}
        <button
          class="rounded-full px-2.5 py-1 text-xs transition-colors {kind === k.value
            ? 'bg-sea/25 text-ink'
            : 'text-muted hover:bg-raise'}"
          onclick={() => (kind = k.value)}>{k.label}</button
        >
      {/each}
      <select
        class="ms-auto rounded-lg bg-raise px-2 py-1 text-xs text-ink outline-none"
        bind:value={who}
      >
        <option value="">Anyone</option>
        <option value="owner">You</option>
        {#each staff as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
    </div>
  </header>
  <ul class="flex flex-1 flex-col gap-1.5 overflow-y-auto p-3" aria-busy={loading}>
    {#if !rows.length && !loading}
      <li class="py-8 text-center text-sm text-muted">
        {q ? 'Nothing matches.' : 'Nothing in the ledger yet.'}
      </li>
    {/if}
    {#each rows as r (r.id)}
      <li class="rounded-xl bg-raise px-3 py-2.5 text-sm">
        <div class="flex items-center gap-2 text-[10px] tracking-[0.16em] uppercase">
          <span class={r.actor === 'owner' ? 'text-ember' : 'text-sea'}>{name(r.actor)}</span>
          <span class="text-faint">{r.kind} · {when(r.createdAt)}</span>
        </div>
        <div class="mt-0.5">{r.title}</div>
        {#if r.reason}
          <div class="mt-1 text-xs text-muted">Reason: {r.reason}</div>
        {:else if r.kind === 'decision'}
          <div class="mt-1 text-xs text-faint">No reason given</div>
        {/if}
        {#if r.body && r.kind !== 'decision'}
          <details class="mt-1 text-xs text-muted">
            <summary class="cursor-pointer text-faint">Details</summary>
            <Markdown
              text={r.body}
              staff={r.actor === 'owner' ? undefined : r.actor}
              class="mt-1"
            />
          </details>
        {/if}
      </li>
    {/each}
  </ul>
</section>
