<script lang="ts">
  import Pixel from './Pixel.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import { chatRequest, type Delivered } from './chat-about.svelte.ts';
  import JobsTab from './JobsTab.svelte';
  import AccessTab from './AccessTab.svelte';
  import LessonsTab from './LessonsTab.svelte';
  import UsageStats from './UsageStats.svelte';
  import LookStudio from './LookStudio.svelte';
  import WorkTab from './WorkTab.svelte';
  import type { Work } from '../staff/work.ts';
  import { call } from './api.ts';
  import { ACTIVITY_LABEL, type Activity, type StaffProfile } from '../staff/roster.ts';
  import type { Place, PlaceGroup } from '../staff/places.ts';

  type Props = {
    profile: StaffProfile;
    activity: Activity;
    /** Bumps when jobs, runs or access change, so those tabs reload. */
    version: number;
    /** The job this staffer is running, if any. */
    working: string | undefined;
    /** Everything it is working on now. */
    work: Work[];
    /** Open on this tab, e.g. from the agents list. `n` changes to ask again. */
    show?: { tab: 'work'; n: number };
    /** Opens something the staffer delivered, on the start side. */
    onitem: (item: Delivered) => void;
    /** Every place on the floor, for the Send tab. */
    places: PlaceGroup[];
    /** True while the owner is directing this staffer instead of the schedule. */
    manual: boolean;
    /** The place the owner last sent this staffer to. */
    sentTo: string | undefined;
    /** Who holds each spot on the floor, by spot id. */
    held: Record<string, { id: string; name: string }>;
    onsend: (place: Place) => void;
    onschedule: () => void;
    onchatstart: () => void;
    onchatend: () => void;
    oncollapse: () => void;
    onclose: () => void;
  };

  let {
    profile,
    activity,
    version,
    working,
    work,
    show,
    places,
    manual,
    sentTo,
    held,
    onsend,
    onschedule,
    onchatstart,
    onchatend,
    oncollapse,
    onclose,
    onitem
  }: Props = $props();
  let flipped = $state(false);

  /** Who fills a place, when every spot there is held by someone else. */
  function fullBy(place: Place): string | undefined {
    const others = place.spots.map((s) => held[s.id]);
    if (others.some((h) => !h || h.id === profile.id)) return undefined;
    return [...new Set(others.map((h) => h!.name))].join(' and ');
  }
  /** Redrawing this staffer's look, under the card. */
  let redrawing = $state(false);
  let appearance = $state('');
  // The chat comes first: the card is a click away.
  let tab = $state<'card' | 'send' | 'chat' | 'work' | 'jobs' | 'lessons' | 'access'>('chat');
  $effect(() => {
    if (show) tab = show.tab;
  });
  // The id, not the profile: every office reload brings a new profile, and an
  // effect that read it would send the owner back to Chat from any tab.
  const id = $derived(profile.id);
  // A chat started from elsewhere, e.g. a report, opens on the Chat tab.
  $effect(() => {
    if (chatRequest.drafts[id] !== undefined) tab = 'chat';
  });
  // So does one with a delivery selected in it.
  $effect(() => {
    if (chatRequest.focus?.staff === id) tab = 'chat';
  });
  const TABS = [
    { id: 'chat', label: 'Chat' },
    { id: 'card', label: 'Card' },
    { id: 'work', label: 'In progress' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'lessons', label: 'Lessons' },
    { id: 'access', label: 'Access' }
  ] as const;
  /** What waits on a tab: work in progress, and guesses for the owner's Keep. */
  const counts: Partial<Record<(typeof TABS)[number]['id'], number>> = $derived({
    work: work.length,
    lessons: profile.guesses
  });

  const PERMISSION = {
    read: 'Reads and reports',
    draft: 'Drafts for your yes',
    act: 'Acts on its own'
  } as const;

  const hired = $derived(
    new Date(`${profile.hired}T12:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  );

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="flex h-full min-h-0 flex-col">
  <header class="flex items-center gap-3 border-b border-hairline p-3">
    <Pixel
      src={profile.look?.portrait}
      frame={`${profile.portrait}/default`}
      fallback={`${profile.sprite}@${profile.variant}/idle-down-0`}
      scale={1}
      label={profile.name}
      class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sea-deep"
    />
    <div class="min-w-0 flex-1">
      <div class="truncate font-medium">{profile.name}</div>
      <div class="truncate text-xs text-muted">
        {profile.role} · {working ? working : ACTIVITY_LABEL[activity]}
      </div>
    </div>
    <button
      class="rounded-full px-2 py-1 text-muted hover:text-ink"
      aria-label="Collapse the panel"
      title="Collapse"
      onclick={oncollapse}>»</button
    >
    <button
      class="rounded-full px-2 py-1 text-muted hover:text-ink"
      aria-label="Close"
      onclick={onclose}>✕</button
    >
  </header>
  <nav class="flex gap-1 border-b border-hairline p-1.5 text-sm" aria-label="Odd">
    {#each TABS as t (t.id)}
      <button
        class="flex-1 rounded-full px-2 py-1.5 font-medium whitespace-nowrap transition-colors {tab ===
          t.id ||
        (t.id === 'card' && tab === 'send')
          ? 'bg-raise text-ink'
          : 'text-muted hover:text-ink'}"
        aria-current={tab === t.id ? 'page' : undefined}
        onclick={() => (tab = t.id)}
        >{t.label}{#if counts[t.id]}<span class="ms-1 text-ember">{counts[t.id]}</span>{/if}</button
      >
    {/each}
  </nav>

  <div class="relative min-h-0 flex-1">
    {#if tab === 'card'}
      <div class="h-full overflow-y-auto p-4">
        <div class="card-scene mx-auto max-w-[340px] text-start">
          <div class="card" class:flipped>
            <!-- Front -->
            <div class="face front">
              <div
                class="flex items-center justify-between px-4 pt-3 text-[10px] tracking-[0.18em] uppercase"
              >
                <span class="text-sea">Oddboro</span>
                <span class="text-muted">{profile.office}</span>
              </div>
              <div class="portrait mx-4 mt-2">
                <Pixel
                  src={profile.look?.portrait}
                  frame={`${profile.portrait}/default`}
                  fallback={`${profile.sprite}@${profile.variant}/idle-down-0`}
                  scale={4}
                  label={`Portrait of ${profile.name}`}
                  class="flex justify-center"
                />
              </div>
              <div class="px-4 pt-3">
                <div class="font-pixel text-3xl leading-none">{profile.name}</div>
                <div class="mt-1 text-sm text-ember">{profile.role}</div>
                <p class="mt-3 text-xs leading-relaxed text-muted">{profile.remit}</p>
              </div>
              <div class="mt-auto flex items-center justify-between px-4 pb-4 text-xs">
                <span class="flex items-center gap-1.5">
                  <span class="dot" class:live={activity !== 'home'}></span>
                  {ACTIVITY_LABEL[activity]}
                </span>
                <span class="text-faint">Hired {hired}</span>
              </div>
            </div>

            <!-- Back -->
            <div class="face back">
              <div class="px-4 pt-4 pb-2">
                <div class="font-pixel text-xl">{profile.name}</div>
                <div class="text-xs text-muted">
                  {profile.role} · {PERMISSION[profile.permission]}
                </div>
              </div>
              {#if flipped}
                <UsageStats staffId={profile.id} {version} />
              {/if}
            </div>
          </div>
        </div>
        <div class="mx-auto mt-3 flex max-w-[340px] items-center justify-between gap-2">
          <button
            class="rounded-full bg-raise px-3 py-1 text-xs text-ink"
            onclick={() => (flipped = !flipped)}>{flipped ? 'Show the front' : 'Show stats'}</button
          >
          <button
            class="rounded-full bg-raise px-3 py-1 text-xs text-ink"
            aria-expanded={redrawing}
            onclick={() => (redrawing = !redrawing)}>Redraw look</button
          >
          <button
            class="rounded-full bg-raise px-3 py-1 text-xs text-ink"
            onclick={() => (tab = 'send')}>Send to a place</button
          >
        </div>
        {#if redrawing}
          <div class="mx-auto mt-3 max-w-[340px]">
            <LookStudio
              name={profile.name}
              role={profile.role}
              staffId={profile.id}
              current={profile.look?.spec}
              bind:description={appearance}
              keepLabel="Keep and save"
              onkeep={async (d) => {
                await call(`/api/staff/${profile.id}/look`, d, 'PUT');
                redrawing = false;
              }}
            />
          </div>
        {/if}
      </div>
    {:else if tab === 'send'}
      <div class="flex h-full min-h-0 flex-col">
        <div class="border-b border-hairline p-3">
          <div class="text-sm font-medium">Send {profile.name} somewhere</div>
          <div class="mt-0.5 text-xs text-muted">
            {manual
              ? 'You are directing. The schedule waits.'
              : 'On the schedule. Pick a place to take over.'}
          </div>
          {#if manual}
            <button
              class="mt-2 w-full rounded-lg bg-raise px-3 py-1.5 text-xs font-medium text-ink hover:bg-sea/20"
              onclick={onschedule}>Back to the schedule</button
            >
          {/if}
        </div>
        <div class="flex-1 overflow-y-auto p-2">
          {#each places as group (group.room)}
            <div
              class="px-2 pt-2 pb-1 font-pixel text-[11px] tracking-[0.18em] text-faint uppercase"
            >
              {group.room}
            </div>
            {#each group.places as place (place.key)}
              {@const full = fullBy(place)}
              <button
                class="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-start text-sm transition-colors enabled:hover:bg-raise disabled:opacity-50"
                class:bg-raise={sentTo === place.key}
                disabled={!!full}
                onclick={() => onsend(place)}
              >
                <span>
                  <span class="block text-ink">{place.label}</span>
                  <span class="block text-[11px] text-muted"
                    >{full ? `Taken by ${full}` : ACTIVITY_LABEL[place.activity]}</span
                  >
                </span>
                <code class="rounded bg-night/60 px-1.5 py-0.5 text-[10px] text-sea"
                  >{place.animation}</code
                >
              </button>
            {/each}
          {/each}
        </div>
      </div>
    {:else if tab === 'work'}
      <WorkTab {profile} items={work} />
    {:else if tab === 'jobs'}
      <JobsTab {profile} {version} {working} />
    {:else if tab === 'lessons'}
      <LessonsTab {profile} {version} />
    {:else if tab === 'access'}
      <AccessTab {profile} {version} />
    {/if}
    <!-- The chat stays mounted while the panel is open, so a reply in progress
       survives switching tabs. -->
    <div class="h-full" class:hidden={tab !== 'chat'}>
      <ChatPanel
        {profile}
        {version}
        onstart={onchatstart}
        onend={onchatend}
        visible={tab === 'chat'}
        {onitem}
      />
    </div>
  </div>
</div>

<style>
  .card-scene {
    perspective: 1200px;
    display: block;
    width: 100%;
  }
  .card {
    position: relative;
    width: 100%;
    aspect-ratio: 5 / 7;
    transform-style: preserve-3d;
    transition: transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .card.flipped {
    transform: rotateY(180deg);
  }
  .face {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-card);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    background:
      radial-gradient(120% 80% at 20% 0%, rgb(47 179 166 / 0.22), transparent 60%),
      radial-gradient(90% 60% at 100% 100%, rgb(242 180 90 / 0.16), transparent 60%),
      var(--color-panel-solid);
    box-shadow:
      var(--shadow-float),
      inset 0 0 0 2px rgb(47 179 166 / 0.55),
      inset 0 0 0 6px var(--color-panel-solid),
      inset 0 0 0 7px rgb(242 180 90 / 0.35);
    overflow: hidden;
  }
  .face::after {
    /* A foil sheen sweeps across once as the card opens. Transform only, and
       never on a loop: an endless one recomposites the card every frame. */
    content: '';
    position: absolute;
    inset: -50%;
    background: linear-gradient(
      115deg,
      transparent 40%,
      rgb(255 255 255 / 0.07) 48%,
      rgb(255 255 255 / 0.02) 52%,
      transparent 60%
    );
    animation: sheen 1.8s ease-in-out both;
    pointer-events: none;
  }
  .back {
    transform: rotateY(180deg);
  }
  .portrait {
    border-radius: 10px;
    padding: 12px 0;
    background:
      radial-gradient(70% 70% at 50% 35%, rgb(47 179 166 / 0.35), transparent 70%),
      linear-gradient(#0f3b3a, #0b1a22);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 99px;
    background: var(--color-faint);
  }
  .dot.live {
    background: var(--color-moss);
    box-shadow: 0 0 8px var(--color-moss);
  }
  @keyframes sheen {
    from {
      transform: translateX(-30%);
    }
    to {
      transform: translateX(30%);
    }
  }
</style>
