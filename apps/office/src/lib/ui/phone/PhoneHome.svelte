<script lang="ts">
  // The phone's Home: what waits on the owner's yes or no, the goals with work
  // moving today, and who is around. Each Odd's line comes from the live line
  // (`working`, `inProgress`), its desk items and its next job. Minutes move
  // once a minute, and only while someone is at work.
  import type { Desk } from '@oddboro/ledger';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import type { Work } from '#lib/staff/work.ts';
  import type { PhoneHome } from '#lib/server/phone-home.ts';
  import { ago } from '#lib/ui/format.ts';
  import OddFace from './OddFace.svelte';
  import { waitingOnYou } from './phone-desk.ts';
  import { aroundLine, waitingOdds, type Presence } from './phone-home.ts';

  type Props = {
    office: string;
    staff: StaffProfile[];
    desk: Desk;
    working: Record<string, string>;
    inProgress: Record<string, Work[]>;
    home: PhoneHome;
    /** Opens a desk item, by its key, on the Desk tab. */
    onopen: (key: string) => void;
    /** Opens a call with an Odd. */
    oncall: (id: string) => void;
    /** Opens a goal's page. */
    ongoals: (id: number) => void;
  };
  let { office, staff, desk, working, inProgress, home, onopen, oncall, ongoals }: Props = $props();

  let now = $state(new Date());
  const busy = $derived(
    Object.values(inProgress).some((ws) => ws.some((w) => !w.queued && !w.toStart))
  );
  $effect(() => {
    now = new Date();
    if (!busy) return;
    const t = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(t);
  });

  const asks = $derived(waitingOnYou(desk));
  const waiting = $derived(waitingOdds(desk));
  const who = (id: string | null) => staff.find((p) => p.id === id);
  const around = $derived(
    staff.map((p) => ({
      odd: p,
      ...aroundLine(
        {
          working: working[p.id],
          work: inProgress[p.id],
          waiting: waiting.has(p.id),
          next: home.next[p.id]
        },
        now
      )
    }))
  );
  const workingCount = $derived(around.filter((a) => a.presence === 'working').length);
  const DOT: Record<Presence, string> = {
    working: 'bg-sea',
    waiting: 'bg-ember',
    free: 'bg-faint'
  };
  const PRESENCE: Record<Presence, string> = {
    working: 'working',
    waiting: 'waiting on you',
    free: 'free'
  };
</script>

<div class="flex h-full flex-col overflow-y-auto">
  <header class="border-b border-hairline px-5 pt-6 pb-4">
    <h1 class="text-2xl font-semibold text-ink">{office}</h1>
    <p class="mt-0.5 text-sm text-muted">
      {workingCount === 1 ? '1 Odd working' : `${workingCount} Odds working`}
    </p>
  </header>

  <section class="px-4 pt-5" aria-labelledby="waiting-head">
    <h2 id="waiting-head" class="head">Waiting on you</h2>
    <ul class="mt-2 flex flex-col gap-2">
      {#each asks as c (c.key)}
        {@const from = who(c.row.staffId)}
        <li>
          <button
            class="flex w-full items-center gap-3 rounded-2xl bg-raise px-4 py-3 text-start"
            onclick={() => onopen(c.key)}
          >
            <OddFace odd={from} name={from?.name} />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-ink">{c.row.title}</span>
              <span class="block truncate text-sm text-muted"
                >{from?.name ?? 'The office'} · {c.kind === 'ask' && c.row.kind === 'call'
                  ? 'held call'
                  : 'ask'} · {ago(c.row.createdAt)}</span
              >
            </span>
            <span class="rounded-full bg-ember px-2.5 py-0.5 text-sm font-medium text-night"
              >{c.kind === 'ask' && c.row.kind === 'call' ? 'Call' : 'Ask'}</span
            >
          </button>
        </li>
      {:else}
        <li class="py-3 text-sm text-muted">Nothing waiting on you.</li>
      {/each}
    </ul>
  </section>

  <section class="px-4 pt-5" aria-labelledby="happening-head">
    <h2 id="happening-head" class="head">Happening now</h2>
    <ul class="mt-2 flex flex-col gap-2">
      {#each home.happening as h (h.goalId)}
        <li>
          <button
            class="flex w-full items-center gap-3 rounded-2xl border border-sea/30 bg-sea-night px-4 py-3 text-start"
            onclick={() => ongoals(h.goalId)}
          >
            <span class="flex shrink-0">
              {#each h.faces as id, n (id)}
                <OddFace
                  odd={who(id)}
                  class="size-9 rounded-full ring-2 ring-sea-night {n ? '-ms-3' : ''}"
                />
              {/each}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-ink">{h.title}</span>
              <span class="line-clamp-2 text-sm text-muted">{h.line}</span>
            </span>
          </button>
        </li>
      {:else}
        <li class="py-3 text-sm text-muted">Nothing happening today.</li>
      {/each}
    </ul>
  </section>

  <section class="px-4 pt-5 pb-6" aria-labelledby="around-head">
    <h2 id="around-head" class="head">Who's around</h2>
    <ul class="mt-2 flex flex-col gap-2">
      {#each around as a (a.odd.id)}
        <li class="flex items-center gap-3 rounded-2xl bg-raise px-4 py-3">
          <span class="relative shrink-0">
            <OddFace odd={a.odd} />
            <span
              class="absolute -end-1 -bottom-1 size-3.5 rounded-full ring-2 ring-night {DOT[
                a.presence
              ]}"
            ></span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-ink">{a.odd.name}</span>
            <span class="block truncate text-sm text-muted"
              ><span class="sr-only">{PRESENCE[a.presence]}: </span>{a.line}</span
            >
          </span>
          <button
            class="flex size-12 shrink-0 items-center justify-center rounded-full bg-raise text-sea"
            aria-label={`Call ${a.odd.name}`}
            onclick={() => oncall(a.odd.id)}
          >
            <svg
              class="size-6"
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
        </li>
      {:else}
        <li class="py-3 text-sm text-muted">No Odds in the office yet.</li>
      {/each}
    </ul>
  </section>
</div>

<style>
  .head {
    font-size: 0.75rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-muted);
  }
</style>
