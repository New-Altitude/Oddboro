<script lang="ts">
  import { untrack } from 'svelte';
  import { SETTINGS_TAB } from '@oddboro/ledger/access';
  import Pixel from './Pixel.svelte';
  import type { AskRow, Desk } from '@oddboro/ledger';
  import ChatPanel from './ChatPanel.svelte';
  import { chatRequest, type Delivered } from './chat-about.svelte.ts';
  import AccessTab from './AccessTab.svelte';
  import LessonsTab from './LessonsTab.svelte';
  import OddInfo from './OddInfo.svelte';
  import StorageTab from './StorageTab.svelte';
  import type { Work } from '../staff/work.ts';
  import { ACTIVITY_LABEL, type Activity, type StaffProfile } from '../staff/roster.ts';
  import type { Place, PlaceGroup } from '../staff/places.ts';
  import type { HomeRoom } from '../staff/home.ts';

  type Props = {
    profile: StaffProfile;
    desk: Desk;
    staff: StaffProfile[];
    onplan: (hires: AskRow[]) => void;
    activity: Activity;
    /** Bumps when jobs, runs or access change, so those tabs reload. */
    version: number;
    /** The job this staffer is running, if any. */
    working: string | undefined;
    /** Everything it is working on now. */
    work: Work[];
    /** Open the info page at In progress, e.g. from the agents list. `n` changes to ask again. */
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
    /** Every room an Odd can live in, with its seats. */
    homes: HomeRoom[];
    onsend: (place: Place) => void;
    onschedule: () => void;
    onchatstart: () => void;
    onchatend: () => void;
    oncollapse: () => void;
    onclose: () => void;
  };

  let {
    profile,
    desk,
    staff,
    onplan,
    activity,
    version,
    working,
    work,
    show,
    places,
    manual,
    sentTo,
    held,
    homes,
    onsend,
    onschedule,
    onchatstart,
    onchatend,
    oncollapse,
    onclose,
    onitem
  }: Props = $props();

  /** Who fills a place, when every spot there is held by someone else. */
  function fullBy(place: Place): string | undefined {
    const others = place.spots.map((s) => held[s.id]);
    if (others.some((h) => !h || h.id === profile.id)) return undefined;
    return [...new Set(others.map((h) => h!.name))].join(' and ');
  }
  // The chat comes first: the info page is a click away, on the name.
  type Tab = 'card' | 'send' | 'chat' | 'lessons' | 'storage' | 'access';
  let tab = $state<Tab>('chat');
  /** Bumped to open the info page at In progress. */
  let toWork = $state(0);
  function showWork() {
    tab = 'card';
    toWork++;
  }
  $effect(() => {
    if (show) untrack(showWork);
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
  /**
   * Three groups, each an icon and a word (the icon alone when the bar is
   * narrow), and under Data a row of its own tabs. Chat is the chat alone,
   * and Settings holds its own four tabs. The info page, opened from the
   * name, sits in no group: it holds In progress and Jobs.
   */
  const GROUPS = [
    {
      id: 'chat',
      label: 'Chat',
      icon: 'M4 5h16v11H9l-5 4z',
      tabs: [{ id: 'chat', label: 'Chat' }]
    },
    {
      id: 'data',
      label: 'Data',
      // Files, one over another.
      icon: 'M9 3h6l4 4v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 3v4h4M5 7v13a1 1 0 0 0 1 1h9',
      tabs: [
        { id: 'lessons', label: 'Lessons' },
        { id: 'storage', label: 'Storage' }
      ]
    },
    {
      id: 'settings',
      // The Odds are told this name, so they say where the owner finds its switches.
      label: SETTINGS_TAB,
      icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
      tabs: [{ id: 'access', label: SETTINGS_TAB }]
    }
  ] as const satisfies readonly {
    id: string;
    label: string;
    icon: string;
    tabs: readonly { id: Tab; label: string }[];
  }[];
  type Group = (typeof GROUPS)[number];
  const group = $derived(GROUPS.find((g) => g.tabs.some((t) => t.id === tab)));
  /** The tab each group was last on, so going back to it lands there. */
  const last: Partial<Record<Group['id'], Tab>> = {};
  $effect(() => {
    if (group) last[group.id] = tab;
  });
  /**
   * What waits on a tab: guesses for the owner's Keep. Only the tab shows it,
   * never its group, so a closed group never reads as something to do.
   * Work in progress shows by the name.
   */
  const counts: Partial<Record<Tab, number>> = $derived({ lessons: profile.guesses });

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
    <!-- The name opens their info page, which has no tab of its own, so the tabs have room. -->
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2">
        <button
          class="group flex min-w-0 text-start"
          aria-current={tab === 'card' || tab === 'send' ? 'page' : undefined}
          title={`About ${profile.name}`}
          onclick={() => (tab = 'card')}
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <span class="truncate font-medium group-hover:underline group-hover:underline-offset-2"
              >{profile.name}</span
            >
            <svg
              class="size-4 shrink-0 {tab === 'card' || tab === 'send'
                ? 'text-sea'
                : 'text-muted group-hover:text-ink'}"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              aria-hidden="true"
              ><circle cx="8" cy="8" r="6.25" /><path d="M8 7.25v4" stroke-linecap="round" /><circle
                cx="8"
                cy="4.9"
                r="0.4"
                fill="currentColor"
              /></svg
            >
            <span class="sr-only">Open their info</span>
          </span>
        </button>
        <!-- How much is in progress, in a turning ring, only while there is some. -->
        {#if work.length}
          <button
            class="busy"
            aria-label="{work.length} in progress"
            title="{work.length} in progress"
            onclick={showWork}><span>{work.length}</span></button
          >
        {/if}
      </div>
      <span class="block truncate text-xs text-muted">
        {profile.role} · {working ? working : ACTIVITY_LABEL[activity]}
      </span>
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
  <!-- Three sections of one bar, split by thin lines; the one open lights whole. -->
  <nav class="groups flex border-b border-hairline text-sm" aria-label="Odd">
    {#each GROUPS as g, i (g.id)}
      {@const on = group?.id === g.id}
      <button
        class="flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 font-medium whitespace-nowrap transition-colors {i
          ? 'border-s border-hairline'
          : ''} {on ? 'bg-sea/20 text-ink' : 'text-muted hover:bg-raise/60 hover:text-ink'}"
        aria-current={on ? 'page' : undefined}
        aria-label={g.label}
        title={g.label}
        onclick={() => (tab = last[g.id] ?? g.tabs[0].id)}
      >
        <svg
          class="size-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d={g.icon} /></svg
        >
        <span class="word">{g.label}</span>
      </button>
    {/each}
  </nav>
  {#if group && group.tabs.length > 1}
    <nav
      class="flex gap-1 overflow-x-auto border-b border-hairline px-1.5 py-1 text-xs"
      aria-label={group.label}
    >
      {#each group.tabs as t (t.id)}
        <button
          class="flex-1 rounded-full px-2 py-1 whitespace-nowrap transition-colors {tab === t.id
            ? 'bg-raise/70 text-ink'
            : 'text-muted hover:text-ink'}"
          aria-current={tab === t.id ? 'page' : undefined}
          onclick={() => (tab = t.id)}
          >{t.label}{#if counts[t.id]}<span class="ms-1 text-ember">{counts[t.id]}</span
            >{/if}</button
        >
      {/each}
    </nav>
  {/if}

  <div class="relative min-h-0 flex-1">
    {#if tab === 'card'}
      <OddInfo
        {profile}
        {activity}
        {version}
        {working}
        {work}
        focus={toWork}
        {homes}
        onsend={() => (tab = 'send')}
      />
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
    {:else if tab === 'lessons'}
      <LessonsTab {profile} {version} />
    {:else if tab === 'storage'}
      <StorageTab {profile} {version} />
    {:else if tab === 'access'}
      <AccessTab {profile} {version} />
    {/if}
    <!-- The chat stays mounted while the panel is open, so a reply in progress
       survives switching tabs. -->
    <div class="h-full" class:hidden={tab !== 'chat'}>
      <ChatPanel
        {desk}
        {staff}
        {onplan}
        {profile}
        {version}
        onstart={onchatstart}
        onend={onchatend}
        visible={tab === 'chat'}
        {onitem}
        {work}
        onwork={showWork}
      />
    </div>
  </div>
</div>

<style>
  /* The group bar is its own container: too narrow for the words, each shows its icon alone. */
  .groups {
    container-type: inline-size;
  }
  @container (max-width: 18rem) {
    .word {
      display: none;
    }
  }
  /* The in-progress count: a ring that turns while the Odd works, and only then. */
  .busy {
    position: relative;
    display: grid;
    inline-size: 1.375rem;
    block-size: 1.375rem;
    flex-shrink: 0;
    place-items: center;
    border-radius: 9999px;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-ember);
  }
  .busy::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 9999px;
    border: 2px solid color-mix(in srgb, var(--color-ember) 25%, transparent);
    border-block-start-color: var(--color-ember);
    animation: turn 1s linear infinite;
  }
  .busy:hover::before {
    border-color: var(--color-ember);
  }
  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .busy::before {
      animation: none;
    }
  }
</style>
