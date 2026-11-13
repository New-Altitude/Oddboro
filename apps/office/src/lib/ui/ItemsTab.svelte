<script lang="ts">
  // An Odd's Items tab: everything it put in front of the owner, without the
  // chat. Open first, then done, or what the owner deleted. A click goes one
  // level down to the item; ticking several clears or deletes them at once.
  // Nothing here reaches outside the office.
  import type { Delivery, ItemRef } from '@oddboro/ledger';
  import type { StaffProfile } from '../staff/roster.ts';
  import type { Delivered } from './chat-about.svelte.ts';
  import { call } from './api.ts';
  import { ago } from './format.ts';
  import { CLEARED } from '@oddboro/ledger/desk-order';

  type Props = {
    profile: StaffProfile;
    /** Bumps when the desk changes, so the list reads again. */
    version: number;
    onitem: (item: Delivered) => void;
  };
  let { profile, version, onitem }: Props = $props();

  type Row = Omit<Delivery, 'at'> & { at: string };
  type Filter = 'open' | 'done' | 'all' | 'deleted';
  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'open', label: 'Open' },
    { id: 'done', label: 'Done' },
    { id: 'all', label: 'All' },
    { id: 'deleted', label: 'Deleted' }
  ];
  /** What the list calls each kind, in the owner's words. */
  const KIND = { ask: 'Needs your yes', task: 'Needs your hands', report: 'To read' } as const;
  const isOpen = (r: Row) => r.status === 'open' || r.status === 'new';

  let filter = $state<Filter>('open');
  let rows = $state<Row[]>([]);
  let picked = $state<Record<string, boolean>>({});
  let busy = $state(false);
  let problem = $state('');

  const key = (r: Pick<Row, 'kind' | 'id'>) => `${r.kind}:${r.id}`;
  const id = $derived(profile.id);

  async function load() {
    const deleted = filter === 'deleted';
    const r = await call<{ items: Row[] }>(
      deleted ? `/api/staff/${id}/items?deleted` : `/api/staff/${id}/items`
    );
    rows = r.items.reverse();
  }
  $effect(() => {
    void [id, version, filter];
    picked = {};
    load().catch((e: unknown) => (problem = e instanceof Error ? e.message : String(e)));
  });

  const shown = $derived(
    filter === 'open'
      ? rows.filter(isOpen)
      : filter === 'done'
        ? rows.filter((r) => !isOpen(r))
        : rows
  );
  const chosen = $derived(shown.filter((r) => picked[key(r)]));

  async function act(op: 'clear' | 'delete' | 'restore') {
    busy = true;
    problem = '';
    try {
      const refs: ItemRef[] = chosen.map((r) => ({ kind: r.kind, id: r.id }));
      await call('/api/items', { op, refs });
      await load();
      picked = {};
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  /** Where an item stands, in a word. */
  const STATUS: Record<string, string> = {
    open: 'Waiting on you',
    new: 'Unread',
    read: 'Read',
    approved: 'Approved',
    denied: 'Declined',
    revise: 'Sent back',
    done: 'Done',
    dropped: 'Dropped'
  };
  /** A cleared item reads as set aside, not as the owner's no. */
  const statusOf = (r: Row) =>
    (r.kind === 'ask' && r.note?.startsWith('Set aside')) ||
    (r.kind === 'task' && r.note === CLEARED)
      ? 'Set aside'
      : (STATUS[r.status] ?? r.status);
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="{profile.name}'s items">
  <nav class="flex gap-1 border-b border-hairline px-1.5 py-1 text-xs" aria-label="Show">
    {#each FILTERS as f (f.id)}
      <button
        class="flex-1 rounded-full px-2 py-1 whitespace-nowrap transition-colors {filter === f.id
          ? 'bg-raise/70 text-ink'
          : 'text-muted hover:text-ink'}"
        aria-current={filter === f.id ? 'page' : undefined}
        onclick={() => (filter = f.id)}>{f.label}</button
      >
    {/each}
  </nav>

  {#if chosen.length}
    <div class="flex items-center gap-2 border-b border-hairline bg-raise/40 px-3 py-2 text-xs">
      <span class="flex-1 text-ink">{chosen.length} selected</span>
      {#if filter === 'deleted'}
        <button
          class="rounded-lg bg-raise px-2.5 py-1 hover:bg-sea/25 disabled:opacity-40"
          disabled={busy}
          onclick={() => act('restore')}>Restore</button
        >
      {:else}
        <button
          class="rounded-lg bg-raise px-2.5 py-1 hover:bg-sea/25 disabled:opacity-40"
          disabled={busy || !chosen.some(isOpen)}
          title="Close without an answer. Nothing leaves the office."
          onclick={() => act('clear')}>Clear</button
        >
        <button
          class="rounded-lg bg-raise px-2.5 py-1 hover:bg-coral/25 disabled:opacity-40"
          disabled={busy}
          title="Clear it and hide it. You can restore it for 30 days under Deleted."
          onclick={() => act('delete')}>Delete</button
        >
      {/if}
    </div>
  {/if}
  {#if problem}
    <p class="border-b border-hairline px-3 py-2 text-xs text-coral">{problem}</p>
  {/if}

  <div class="flex-1 overflow-y-auto p-2">
    {#if !shown.length}
      <p class="py-10 text-center text-sm text-muted">
        {filter === 'open'
          ? `Nothing from ${profile.name} is waiting on you.`
          : filter === 'deleted'
            ? 'Nothing deleted in the last 30 days.'
            : 'Nothing here yet.'}
      </p>
    {/if}
    <ul class="flex flex-col gap-1">
      {#each shown as r (key(r))}
        <li class="flex items-start gap-2 rounded-xl px-2 py-2 hover:bg-raise/60">
          <input
            type="checkbox"
            class="mt-1 accent-sea"
            aria-label="Select {r.title}"
            bind:checked={picked[key(r)]}
          />
          <button
            class="min-w-0 flex-1 text-start disabled:cursor-default"
            disabled={filter === 'deleted'}
            onclick={() => onitem({ kind: r.kind, id: r.id, title: r.title })}
          >
            <span class="flex items-center gap-2 text-[10px] tracking-[0.16em] uppercase">
              <span class={r.kind === 'report' ? 'text-sea' : 'text-ember'}>{KIND[r.kind]}</span>
              <span class="text-faint">{ago(r.at)}</span>
            </span>
            <span class="mt-0.5 block text-sm text-ink">{r.title}</span>
            <span class="mt-0.5 block text-xs {isOpen(r) ? 'text-ember' : 'text-muted'}"
              >{statusOf(r)}</span
            >
          </button>
        </li>
      {/each}
    </ul>
  </div>
</section>
