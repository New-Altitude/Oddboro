<script lang="ts">
  import { onMount } from 'svelte';
  import type { Desk } from '@oddboro/ledger';
  import type { OfficeEvent } from '#lib/server/events.ts';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import { threadTag, type HeldThread } from '#lib/staff/thread-tags.ts';
  import { call } from '#lib/ui/api.ts';
  import {
    oddStatus,
    waitingCount,
    waitingOf,
    waitingForOwner,
    ON_CHANGE,
    type FloorActivity
  } from '#lib/ui/office-status.ts';
  import StripDecisions from '#lib/ui/StripDecisions.svelte';
  import type { ManagerAdvice } from '#lib/server/pressure-watch.ts';
  import { RETURN_TO_STRIP, reviewUrl } from '#lib/ui/strip-review.ts';
  import { FLOOR_CHANNEL } from '#lib/ui/office-link.ts';

  let decisionLine: StripDecisions;
  let lastReview = 'review-hud';
  type Office = {
    staff: StaffProfile[];
    desk: Desk;
    working: Record<string, string>;
    messages: Record<string, number>;
    threads: HeldThread[];
  };
  let pressure = $state<ManagerAdvice | null>(null);
  let office = $state<Office>();
  let activity = $state<Record<string, FloorActivity>>({});
  let problem = $state('');
  let connected = $state(false);
  const waiting = $derived(
    office ? waitingForOwner(office.desk, office.messages) : new Set<string>()
  );
  let reload = $state<() => void>(() => {});

  onMount(() => {
    let disposed = false;
    let reading = false;
    let again = false;
    const controller = new AbortController();
    async function refresh() {
      // Changes during a read get one more read, never stale last-write wins.
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      do {
        again = false;
        try {
          const next = await call<Office>('/api/office', undefined, 'GET', controller.signal);
          if (!disposed) {
            office = next;
            problem = '';
          }
        } catch (e) {
          if (!disposed) problem = e instanceof Error ? e.message : 'Could not read the office.';
        }
      } while (again && !disposed);
      reading = false;
    }
    reload = () => void refresh();
    const events = new EventSource('/api/events');
    events.onopen = () => {
      connected = true;
      void decisionLine?.refresh();
      void refresh();
    };
    events.onerror = () => {
      connected = false;
    };
    events.onmessage = (m) => {
      const event = JSON.parse(m.data) as OfficeEvent;
      if (
        event.type === 'project-questions' ||
        (event.type === 'change' &&
          ['asks', 'project_requests', 'project_sessions', 'staff', 'owner'].includes(event.table))
      )
        void decisionLine?.refresh();
      if (event.type === 'pressure') pressure = event.advice;
      else if (event.type === 'working') {
        if (office) office.working = event.working;
        // A concurrent read must not replace newer work status.
        if (reading) again = true;
      } else if (
        event.type === 'change' &&
        ON_CHANGE.get(event.table)?.some((action) => action === 'refresh' || action === 'reload')
      ) {
        void refresh();
      }
    };
    const channel = new BroadcastChannel(FLOOR_CHANNEL);
    channel.onmessage = (e) => {
      if (e.data?.type === RETURN_TO_STRIP) {
        (document.getElementById(lastReview) ?? document.getElementById('review-hud'))?.focus();
        location.assign('/strip?return=1');
      }
      if (e.data?.type === 'activity') activity = e.data.rows;
    };
    function remember(event: MouseEvent) {
      const link =
        event.target instanceof Element ? event.target.closest('a[id^="review-"]') : null;
      if (link) lastReview = link.id;
    }
    window.addEventListener('click', remember, true);
    channel.postMessage({ type: 'read' });
    return () => {
      disposed = true;
      window.removeEventListener('click', remember, true);
      controller.abort();
      events.close();
      channel.close();
    };
  });
</script>

<svelte:head><title>Office strip · Oddboro</title></svelte:head>
<main class="min-h-screen bg-panel-solid p-3 text-sm text-ink" aria-label="Office strip">
  <header class="mb-2 flex items-center gap-3 border-b border-hairline pb-2">
    <h1 class="flex-1 font-pixel text-lg text-sea">Oddboro</h1>
    <a id="review-hud" class="text-sea" href={reviewUrl('hud')} data-sveltekit-reload>Agent HUD</a>
    <a class="rounded-md bg-raise px-2 py-1 hover:bg-sea/20" href="/?desk=1" data-sveltekit-reload
      >Waiting{#if office}<span class="ms-2 font-semibold text-ember"
          >{waitingCount(office.desk)}</span
        >{/if}</a
    >
  </header>
  {#if pressure}<a
      class="mb-2 block rounded-md bg-raise p-2"
      id={'review-' + pressure.resource}
      href={reviewUrl(pressure.resource)}
      data-sveltekit-reload
    >
      <strong class="block text-xs text-sea">{pressure.manager} · {pressure.heading}</strong>
      <span class="block text-xs">{pressure.detail}</span><span class="text-xs text-sea"
        >Review {pressure.resource === 'cpu' ? 'CPU' : 'memory'}</span
      >
    </a>{/if}
  <StripDecisions bind:this={decisionLine} />
  {#if !connected}<p class="mb-2 text-xs text-muted" role="status">
      Reconnecting to the office.
    </p>{/if}
  {#if problem}<p class="mb-2 text-xs text-coral" role="alert">
      {problem}
      <button class="ms-2 text-sea underline" onclick={reload}>Try again</button>
    </p>{/if}
  {#if office}
    <ul class="flex flex-col gap-1">
      {#each office.staff as odd (odd.id)}
        {@const waits = waitingOf(office.desk, odd.id).length}
        {@const status = oddStatus({
          floor: activity[odd.id],
          message: office.messages[odd.id],
          waiting: waiting.has(odd.id),
          thread: threadTag({
            id: odd.id,
            threads: office.threads,
            working: !!office.working[odd.id],
            nameOf: (id) => office?.staff.find((s) => s.id === id)?.name ?? id
          }),
          working: office.working[odd.id]
        })}
        <li>
          <a
            class="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-sea/10"
            href={`/?odd=${encodeURIComponent(odd.id)}`}
            data-sveltekit-reload
          >
            <span class="min-w-0 flex-1"
              ><strong class="block truncate font-medium">{odd.name}</strong>
              <span class="block truncate text-xs text-muted" title={status}>{status}</span></span
            >
            {#if waits}<span
                class="shrink-0 rounded-full bg-ember/15 px-2 py-0.5 text-xs text-ember"
                aria-label={`${waits} waiting on you`}>{waits}</span
              >{/if}
          </a>
        </li>
      {/each}
    </ul>
    {#if !office.staff.length}<p class="py-3 text-xs text-muted">
        Your Odds will appear here after you hire them.
      </p>{/if}
  {:else if !problem}<p class="text-xs text-muted">Reading the office.</p>{/if}
</main>
