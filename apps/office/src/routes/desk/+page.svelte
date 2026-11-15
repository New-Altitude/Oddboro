<script lang="ts">
  // The phone app. Four tabs: Home (`PhoneHome.svelte`), Goals (`PhoneGoals.svelte`,
  // and a goal's page, `PhoneGoal.svelte`),
  // Messages (each Odd's last line and its chat, `PhoneMessages.svelte`) and Desk
  // (`PhoneDesk.svelte`, whose Open shows the office's own Desk window,
  // `DeskDrawer.svelte`, `away`). It hears the office's one live line, as the
  // floor does, and reloads on a change and whenever the line opens again, such
  // as when the phone wakes. Nothing polls. A call (`PhoneCall.svelte`) opens
  // over any tab from Home, Messages, the Desk and a goal's page, and Back returns to it. Home's header holds the switch for
  // a buzz on this phone (`phone-buzz.ts`), whose tap opens `/desk#desk`.
  import { tick, untrack } from 'svelte';
  import type { Desk } from '@oddboro/ledger';
  import { LIVE_TABLES } from '@oddboro/ledger/live-tables';
  import { setZone } from '@oddboro/ledger/time';
  import DeskDrawer from '#lib/ui/DeskDrawer.svelte';
  import FileViewer from '#lib/ui/FileViewer.svelte';
  import ReportView from '#lib/ui/ReportView.svelte';
  import { call, type ApiUrl } from '#lib/ui/api.ts';
  import { chatRequest, replyAbout, type Delivered } from '#lib/ui/chat-about.svelte.ts';
  import { close, openReport, wins } from '#lib/ui/windows.svelte.ts';
  import { buzzOff, buzzOn, buzzState, type BuzzState } from '#lib/ui/phone-buzz.ts';
  import { waitingKey } from '#lib/desk.ts';
  import PhoneCall from '#lib/ui/phone/PhoneCall.svelte';
  import PhoneDesk from '#lib/ui/phone/PhoneDesk.svelte';
  import PhoneGoal from '#lib/ui/phone/PhoneGoal.svelte';
  import PhoneGoals from '#lib/ui/phone/PhoneGoals.svelte';
  import PhoneHome from '#lib/ui/phone/PhoneHome.svelte';
  import PhoneMessages from '#lib/ui/phone/PhoneMessages.svelte';
  import PhoneTabs from '#lib/ui/phone/PhoneTabs.svelte';
  import type { Tab } from '#lib/ui/phone/phone-home.ts';
  import type { LastLine } from '#lib/ui/phone/phone-messages.ts';
  import type { PhoneHome as HomeData } from '#lib/server/phone-home.ts';
  import type { PhoneGoal as GoalData, PhoneGoalCard } from '#lib/server/phone-goals.ts';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import type { Work } from '#lib/staff/work.ts';
  import type { OfficeEvent } from '#lib/server/events.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  setZone(untrack(() => data.zone));
  let staff = $state<StaffProfile[]>(untrack(() => data.staff));
  let desk = $state<Desk>(untrack(() => data.desk));
  let home = $state<HomeData>(untrack(() => data.home));
  let lastLines = $state<Record<string, LastLine>>(untrack(() => data.messages));
  let working = $state<Record<string, string>>({});
  let inProgress = $state<Record<string, Work[]>>({});
  let toStart = $state<Record<string, Work[]>>({});
  /** Bumps on a change an open chat reloads for, as on the computer. */
  let version = $state(0);
  const waiting = $derived(desk.asks.length + desk.tasks.length + desk.reports.length);

  const TABS: Tab[] = ['home', 'goals', 'messages', 'desk'];
  let tab = $state<Tab>('home');
  $effect(() => {
    const asked = location.hash.slice(1) as Tab;
    if (TABS.includes(asked)) tab = asked;
  });
  /** The call on screen, if any: the Odd, and the name of where it was opened from for Back. */
  let calling = $state<{ id: string; from: string } | undefined>();
  const callWith = $derived(calling && staff.find((p) => p.id === calling?.id));
  const TAB_NAMES: Record<Tab, string> = {
    home: 'Home',
    goals: 'Goals',
    messages: 'Messages',
    desk: 'Desk'
  };
  /** The Odd whose chat is open on Messages, if any. */
  let chatting = $state<string | undefined>();
  /** The item the Desk window opens next, and whether it shows over the Desk list. */
  let deskFocus = $state<string | undefined>();
  let drawer = $state(false);

  /** A file or a report an item opened, shown over the page, which stays as it was beneath. */
  const front = $derived(
    wins.list.find((w) => w.id === wins.active && (w.kind === 'file' || w.kind === 'report'))
  );

  const pageOf = (kind: 'refresh' | 'reload' | 'version') =>
    new Set(
      Object.entries(LIVE_TABLES)
        .filter(([, live]) => live.page.includes(kind))
        .map(([table]) => table)
    );
  /** The tables whose change the desk shows, and those an open chat reloads for. */
  const RELOADS = new Set([...pageOf('refresh'), ...pageOf('reload')]);
  const VERSIONS = pageOf('version');
  /** The tables Home's next jobs and goals moving today come from. */
  const HOME = new Set(['jobs', 'threads', 'follow_ups', 'goals', 'staff_goals']);
  /**
   * The tables whose change comes with a line the office writes into a chat
   * itself: a poke landing, a new Odd's hello. A reply on the phone reloads
   * on its own (`onsaid`), and one at the computer shows when Messages opens.
   */
  const CHAT_LINES = new Set(['pokes', 'staff']);

  /** The Goals tab, and the goal whose page is open, if any. */
  let goals = $state<PhoneGoalCard[]>(untrack(() => data.goals));
  let goalOpen = $state<GoalData | undefined>();
  /** The tables a goal's card and page come from. */
  const GOALS = new Set([
    'goals',
    'staff_goals',
    'goal_progress',
    'threads',
    'follow_ups',
    'asks',
    'tasks'
  ]);
  async function reloadGoals() {
    try {
      goals = await call<PhoneGoalCard[]>('/api/phone/goals');
      const id = goalOpen?.id;
      if (id === undefined) return;
      const next = await call<GoalData>(`/api/phone/goals/${id}`);
      // Only if that goal's page is still the one open: the owner may have moved on.
      if (goalOpen?.id === id) goalOpen = next;
    } catch {
      // The office is out of reach, or the goal is gone; the next change tries again.
    }
  }
  async function openGoal(id: number) {
    pick('goals');
    try {
      goalOpen = await call<GoalData>(`/api/phone/goals/${id}`);
    } catch {
      goalOpen = undefined;
    }
  }

  async function reload() {
    try {
      const next = await call<{
        staff: StaffProfile[];
        desk: Desk;
        working: Record<string, string>;
        inProgress: Record<string, Work[]>;
        toStart: Record<string, Work[]>;
      }>('/api/office');
      staff = next.staff;
      desk = next.desk;
      working = next.working;
      inProgress = next.inProgress;
      toStart = next.toStart;
    } catch {
      // The office is out of reach; the next change or reconnect tries again.
    }
  }
  async function reloadMessages() {
    try {
      lastLines = await call<Record<string, LastLine>>('/api/phone/messages');
    } catch {
      // As below.
    }
  }
  async function reloadHome() {
    try {
      home = await call<HomeData>('/api/phone/home');
    } catch {
      // As above.
    }
  }

  $effect(() => {
    const events = new EventSource('/api/events' satisfies ApiUrl);
    // The line opens again on its own after the phone sleeps: catch up then.
    events.onopen = () => {
      version++;
      void reload();
      void reloadHome();
      void reloadGoals();
      void reloadMessages();
    };
    events.onmessage = (m) => {
      const e = JSON.parse(m.data) as OfficeEvent;
      if (e.type === 'working') {
        working = e.working;
        inProgress = e.inProgress;
        return;
      }
      if (e.type !== 'change') return;
      if (RELOADS.has(e.table)) void reload();
      if (VERSIONS.has(e.table)) version++;
      if (CHAT_LINES.has(e.table)) void reloadMessages();
      if (HOME.has(e.table)) void reloadHome();
      if (GOALS.has(e.table)) void reloadGoals();
    };
    return () => events.close();
  });

  function pick(t: Tab) {
    if (t === 'messages' && t !== tab) void reloadMessages();
    tab = t;
    if (t === 'desk') drawer = false;
    history.replaceState(history.state, '', `#${t}`);
  }

  function openChat(id: string) {
    chatting = id;
    pick('messages');
  }

  /** Opens a call with an Odd, over the tab it was opened from, which Back names. */
  function openCall(id: string) {
    calling = { id, from: TAB_NAMES[tab] };
  }

  /** Opens one item in the Desk window, over the Desk list. */
  async function openOnDesk(key: string) {
    pick('desk');
    drawer = true;
    // Cleared first, so asking for the item already open still brings it back.
    deskFocus = undefined;
    await tick();
    deskFocus = key;
  }

  // A report's Reply, or a chat about something, opens that Odd's chat here.
  // Opening any item also points the chat at it (`showInChat`), which on the
  // computer selects it beside the desk; on a phone that alone opens nothing.
  $effect(() => {
    const id = chatRequest.staff;
    if (!id) return;
    chatRequest.staff = undefined;
    if (chatRequest.reply?.staff === id || chatRequest.drafts[id] !== undefined) openChat(id);
  });

  /** Something an Odd delivered, tapped in its chat: on the desk while it waits, else a report on its own. */
  function openItem(staffId: string, d: Delivered) {
    const key = waitingKey(desk, d);
    if (key) void openOnDesk(key);
    else if (d.kind === 'report') openReport({ id: d.id, staff: staffId, title: d.title });
  }

  const nothing = () => {};

  /** This phone's buzz, once the page knows it. */
  let buzz = $state<BuzzState | undefined>();
  let buzzBusy = $state(false);
  let buzzProblem = $state('');
  $effect(() => {
    buzzState()
      .then((s) => (buzz = s))
      .catch(() => (buzz = 'cannot'));
  });
  async function flipBuzz() {
    buzzBusy = true;
    buzzProblem = '';
    try {
      buzz = buzz === 'on' ? await buzzOff() : await buzzOn();
    } catch (e) {
      buzzProblem = e instanceof Error ? e.message : String(e);
    } finally {
      buzzBusy = false;
    }
  }
  const BUZZ_LINE: Record<Exclude<BuzzState, 'off' | 'on'>, string> = {
    cannot:
      'To get a buzz when something lands, add the desk to your home screen and open it from there.',
    blocked:
      "Notifications are off for the desk in this phone's settings. Turn them on there to get a buzz."
  };
</script>

<svelte:head>
  <title>{waiting ? `Desk (${waiting})` : 'Desk'}</title>
  <link rel="manifest" href="/desk.webmanifest" />
  <link rel="apple-touch-icon" href="/desk-256.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Desk" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</svelte:head>

<main class="phone-desk mx-auto flex h-dvh max-w-xl flex-col">
  <div class="relative min-h-0 flex-1" class:hidden={!!front || !!callWith}>
    <div class="flex h-full flex-col" class:hidden={tab !== 'home'}>
      {#if buzz === 'on' || buzz === 'off'}
        <button
          class="absolute end-4 top-5 z-10 rounded-lg px-3 text-xs {buzz === 'on'
            ? 'bg-sea/25 text-ink'
            : 'bg-raise text-muted'} disabled:opacity-40"
          aria-pressed={buzz === 'on'}
          disabled={buzzBusy}
          onclick={flipBuzz}>{buzz === 'on' ? 'Buzz on' : 'Buzz me'}</button
        >
      {/if}
      {#if buzz === 'cannot' || buzz === 'blocked' || buzzProblem}
        <p class="border-b border-hairline px-5 py-2 text-xs text-muted">
          {buzzProblem || (buzz === 'cannot' || buzz === 'blocked' ? BUZZ_LINE[buzz] : '')}
        </p>
      {/if}
      <div class="min-h-0 flex-1">
        <PhoneHome
          office={data.office}
          {staff}
          {desk}
          {working}
          {inProgress}
          {home}
          onopen={openOnDesk}
          oncall={openCall}
          ongoals={openGoal}
        />
      </div>
    </div>

    <div class="h-full" class:hidden={tab !== 'goals'}>
      {#if goalOpen}
        {#key goalOpen.id}
          <PhoneGoal
            goal={goalOpen}
            {desk}
            {staff}
            onback={() => (goalOpen = undefined)}
            oncall={(id) => (calling = { id, from: goalOpen?.title ?? TAB_NAMES.goals })}
            onchat={openChat}
            onopen={openOnDesk}
          />
        {/key}
      {:else}
        <PhoneGoals {goals} {staff} onopen={openGoal} />
      {/if}
    </div>

    <div class="h-full" class:hidden={tab !== 'messages'}>
      <PhoneMessages
        {staff}
        {chatting}
        onchat={(id) => (chatting = id)}
        oncall={openCall}
        {version}
        visible={tab === 'messages' && !front && !callWith}
        {desk}
        {working}
        {inProgress}
        {toStart}
        {lastLines}
        onitem={openItem}
        onsaid={reloadMessages}
      />
    </div>

    <div class="h-full" class:hidden={tab !== 'desk' || drawer}>
      <PhoneDesk
        {desk}
        {staff}
        onopen={openOnDesk}
        oncall={openCall}
        onreply={(c) =>
          c.row.staffId &&
          replyAbout(c.row.staffId, { kind: 'report', id: c.row.id, title: c.row.title })}
      />
    </div>

    <div class="flex h-full flex-col" class:hidden={tab !== 'desk' || !drawer}>
      <div class="border-b border-hairline px-3 py-1.5">
        <button
          class="flex items-center gap-1.5 rounded-lg bg-raise px-3 text-sm text-ink"
          onclick={() => (drawer = false)}
        >
          <svg
            class="size-3 rtl:-scale-x-100"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg
          >
          Desk
        </button>
      </div>
      <div class="min-h-0 flex-1">
        <DeskDrawer
          {desk}
          {staff}
          away
          focus={deskFocus}
          onhire={nothing}
          onplan={nothing}
          onstaff={openChat}
        />
      </div>
    </div>
  </div>

  {#if callWith && calling}
    <!-- A file or report a caption opened shows over the call, which stays beneath. -->
    {#key callWith.id}
      <div class="min-h-0 flex-1" class:hidden={!!front}>
        <PhoneCall
          odd={callWith}
          from={calling.from}
          {desk}
          work={inProgress[callWith.id]}
          {version}
          onend={() => (calling = undefined)}
          onopen={(key) => {
            calling = undefined;
            void openOnDesk(key);
          }}
          ondesk={() => {
            calling = undefined;
            pick('desk');
          }}
          onsaid={reloadMessages}
        />
      </div>
    {/key}
  {/if}
  {#if front?.kind === 'file'}
    <div class="min-h-0 flex-1">
      <FileViewer
        id={front.id}
        file={front.file}
        nameOf={(id) => staff.find((p) => p.id === id)?.name ?? id}
      />
    </div>
  {:else if front?.kind === 'report'}
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="border-b border-hairline px-3 py-1.5">
        <button class="rounded-lg bg-raise px-2.5 text-xs text-ink" onclick={() => close(front.id)}
          >Back</button
        >
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <ReportView report={front.report} {staff} />
      </div>
    </div>
  {/if}

  {#if !callWith}
    <PhoneTabs {tab} {waiting} onpick={pick} />
  {/if}
</main>

<style>
  /* Room for a thumb: every control on the phone is at least 44px tall. */
  .phone-desk :global(button),
  .phone-desk :global(select) {
    min-height: 2.75rem;
  }
  /* 16px text in a field, so a phone does not zoom the page when it gets focus. */
  .phone-desk :global(textarea),
  .phone-desk :global(input:not([type='checkbox'])) {
    font-size: 1rem;
  }
  .phone-desk :global(input[type='checkbox']) {
    width: 1.25rem;
    height: 1.25rem;
  }
  .phone-desk {
    padding-block-start: env(safe-area-inset-top);
  }
</style>
