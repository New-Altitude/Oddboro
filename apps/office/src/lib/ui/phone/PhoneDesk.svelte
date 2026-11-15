<script lang="ts">
  // The phone's Desk: everything waiting on the owner as cards, newest first,
  // with All, Asks, Tasks and Reports chips. Each card's buttons come from
  // `cardButtons` (`phone-desk.ts`). A one-tap button posts what the Desk
  // window's button posts. Open shows that Desk window's item, `away`, in full.
  // A card from an Odd has Call, which opens a call with that Odd.
  import type { Desk } from '@oddboro/ledger';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import { call, type ApiUrl } from '#lib/ui/api.ts';
  import { ago } from '#lib/ui/format.ts';
  import OddFace from './OddFace.svelte';
  import {
    CHIPS,
    cardButtons,
    cardLine,
    chipCounts,
    deskCards,
    kindWord,
    taskProgress,
    type CardButton,
    type Chip,
    type DeskCard
  } from './phone-desk.ts';

  type Props = {
    desk: Desk;
    staff: StaffProfile[];
    /** Opens an item in the Desk window, by its key. */
    onopen: (key: string) => void;
    /** A report's Reply: opens its writer's chat about it. */
    onreply: (c: DeskCard & { kind: 'report' }) => void;
    /** Opens a call with an Odd. */
    oncall: (id: string) => void;
  };
  let { desk, staff, onopen, onreply, oncall }: Props = $props();

  let chip = $state<Chip>('all');
  const counts = $derived(chipCounts(desk));
  const cards = $derived(deskCards(desk, chip));
  const who = (id: string | null) => staff.find((p) => p.id === id);

  /** The card a tap is posting for, and each card's last problem, by key. */
  let busy = $state<string | undefined>();
  let problems = $state<Record<string, string>>({});

  async function tap(c: DeskCard, b: CardButton) {
    if (b.id === 'open') return onopen(c.key);
    if (b.id === 'reply') return c.kind === 'report' && onreply(c);
    busy = c.key;
    delete problems[c.key];
    try {
      // The live line reloads the desk, which takes the card off.
      await call(b.post.url as ApiUrl, b.post.body);
    } catch (e) {
      problems[c.key] = e instanceof Error ? e.message : String(e);
    } finally {
      busy = undefined;
    }
  }
  const style = (b: CardButton) =>
    b.id === 'yes' || b.id === 'read'
      ? 'bg-sea text-night'
      : b.id === 'deny'
        ? 'bg-raise text-ink hover:bg-coral/25'
        : 'bg-raise text-ink';
</script>

<div class="flex h-full flex-col">
  <header class="border-b border-hairline px-5 pt-6 pb-4">
    <h1 class="text-2xl font-semibold text-ink">Desk</h1>
    <p class="mt-0.5 text-sm text-muted">
      {counts.all ? `${counts.all} waiting on you` : 'Nothing waiting on you'}
    </p>
  </header>

  <div class="flex gap-2 overflow-x-auto px-4 pt-4" role="group" aria-label="Show">
    {#each CHIPS as c (c.id)}
      <button
        class="shrink-0 rounded-full px-3.5 text-base {chip === c.id
          ? 'bg-ink text-night'
          : 'bg-raise text-muted'}"
        aria-pressed={chip === c.id}
        onclick={() => (chip = c.id)}>{c.label} {counts[c.id]}</button
      >
    {/each}
  </div>

  <ul class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    {#each cards as c (c.key)}
      {@const from = who(c.row.staffId)}
      {@const line = c.kind === 'task' ? '' : cardLine(c)}
      <li class="rounded-2xl bg-raise p-4">
        <div class="flex items-start gap-3">
          <OddFace odd={from} name={from?.name ?? 'Oddboro'} class="size-10 rounded-lg" />
          <div class="min-w-0 flex-1">
            <p
              class="text-xs tracking-[0.18em] uppercase {c.kind === 'report'
                ? 'text-sea'
                : 'text-ember'}"
            >
              {kindWord(c)} · {from?.name ?? 'Oddboro'} · {ago(c.row.createdAt)}
            </p>
            <h2 class="mt-0.5 text-lg leading-snug font-medium text-ink">{c.row.title}</h2>
          </div>
          {#if from}
            <button
              class="flex size-11 shrink-0 items-center justify-center rounded-full bg-raise text-sea"
              aria-label={`Call ${from.name}`}
              onclick={() => oncall(from.id)}
            >
              <svg
                class="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linejoin="round"
                aria-hidden="true"
                ><path
                  d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
                /></svg
              >
            </button>
          {/if}
        </div>
        {#if line}
          <p class="mt-2 line-clamp-2 text-muted">{line}</p>
        {/if}
        {#if c.kind === 'task'}
          {@const p = taskProgress(c.row)}
          <div
            class="mt-3 h-1.5 overflow-hidden rounded-full bg-hairline"
            role="progressbar"
            aria-label="Steps done"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(p.done * 100)}
          >
            <div class="h-full rounded-full bg-sea" style:inline-size={`${p.done * 100}%`}></div>
          </div>
          <p class="mt-2 text-muted">{p.line}</p>
          {#if p.signIn}
            <p class="mt-2 rounded-lg bg-ember/15 px-3 py-2 text-ember">Sign in at the office</p>
          {/if}
        {/if}
        <div class="mt-3 flex gap-2">
          {#each cardButtons(c) as b (b.id)}
            <button
              class="flex-1 rounded-xl px-3 py-2.5 font-medium disabled:opacity-40 {style(b)}"
              disabled={busy === c.key}
              onclick={() => tap(c, b)}>{b.label}</button
            >
          {/each}
        </div>
        {#if problems[c.key]}
          <p class="mt-2 text-sm text-coral" role="alert">{problems[c.key]}</p>
        {/if}
      </li>
    {:else}
      <li class="py-10 text-center text-muted">
        {chip === 'all' ? 'Nothing on your desk.' : `No ${chip} waiting.`}
      </li>
    {/each}
  </ul>
</div>
