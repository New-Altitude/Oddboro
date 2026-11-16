<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { Desk, GoalThread } from '@oddboro/ledger';
  import type { Pop } from '#lib/floor/staff.ts';
  import WeatherPill from '#lib/ui/WeatherPill.svelte';
  import { askWeather, weather } from '#lib/ui/weather.svelte.ts';
  import FloorControls, { type Light } from '#lib/ui/FloorControls.svelte';
  import { music, musicEnded, startMusic } from '#lib/ui/music.svelte.ts';
  import { chatAbout, chatRequest, type Delivered } from '#lib/ui/chat-about.svelte.ts';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import type { HeldThread } from '#lib/staff/thread-tags.ts';
  import { oddNow, runsChanged, type Snapshot } from '#lib/staff/odd-now.ts';
  import { ODDS_RAIL, ODDS_RAIL_OPEN } from '#lib/ui/OddsRail.svelte';
  import type { Work } from '#lib/staff/work.ts';
  import type { LessonEvent, OfficeEvent } from '#lib/server/events.ts';
  import { account } from '#lib/ui/account.svelte.ts';
  import { personaNews } from '#lib/ui/persona-offers.svelte.ts';
  import { diagnostics } from '#lib/ui/diagnostics.svelte.ts';
  import { serviceNames } from '#lib/ui/service-names.svelte.ts';
  import { FloorCrew, type Label } from '#lib/ui/floor-crew.svelte.ts';
  import RoomSign from '#lib/ui/RoomSign.svelte';
  import NameTag from '#lib/ui/NameTag.svelte';
  import OfficePlate, { type Section } from '#lib/ui/OfficePlate.svelte';
  import OfficePanel, { loadDeskDrawer } from '#lib/ui/OfficePanel.svelte';
  import CardColumn, { loadStaffCard } from '#lib/ui/CardColumn.svelte';
  import { actCheck } from '#lib/ui/act-check.svelte.ts';
  import {
    advanced,
    close,
    deskRequest,
    open,
    openHire,
    openLessons,
    openProject,
    openReport,
    wins
  } from '#lib/ui/windows.svelte.ts';
  import type { AskRow } from '@oddboro/ledger';
  import SidePanel from '#lib/ui/SidePanel.svelte';
  import { placesFor } from '#lib/staff/places.ts';
  import { call, type ApiUrl } from '#lib/ui/api.ts';
  import { setZone } from '@oddboro/ledger/time';
  import { LIVE_TABLES, type LiveTable } from '@oddboro/ledger/live-tables';

  // Panels and dialogs that open on a click load when they open, so the first
  // page carries only what shows at start. These three load early as well: the
  // first run's guide beside the floor, and the card and the Desk once it draws
  // (`loadStaffCard` in CardColumn.svelte, `loadDeskDrawer` in OfficePanel.svelte).
  const loadOnboarding = () => import('#lib/ui/onboarding/Onboarding.svelte');

  let { data } = $props();
  // Every time on the page is in the office's zone, which only the server knows.
  // It is fixed for the life of the page: a new zone takes a restart.
  setZone(untrack(() => data.zone));
  // Whether the office can send reports, whether they need a New Altitude
  // sign-in, and the owner's answer. Answering updates it from then on.
  Object.assign(
    diagnostics,
    untrack(() => data.diagnostics)
  );
  // The New Altitude sign-in. The live line keeps it current from then on.
  account.status = untrack(() => data.account);

  let host: HTMLDivElement | undefined = $state();
  let selected = $state<string | undefined>();
  let now = $state(new Date());

  // Live office state: the staff, the owner's desk, and who is running a job.
  // svelte-ignore state_referenced_locally
  let staff = $state<StaffProfile[]>(data.staff);
  // svelte-ignore state_referenced_locally
  let desk = $state<Desk>(data.desk);
  // svelte-ignore state_referenced_locally
  let roomNames = $state<Record<string, string>>(data.roomNames);
  /** The lamps, screens and fires the owner switched off, by placed prop id. */
  // svelte-ignore state_referenced_locally
  let switchedOff = $state<string[]>(data.switchedOff);
  /** Pokes that landed and the owner has not read, counted by staffer. */
  // svelte-ignore state_referenced_locally
  let messages = $state<Record<string, number>>(data.messages);
  /** Threads a colleague holds for the Odd that leads them. */
  // svelte-ignore state_referenced_locally
  let threads = $state<HeldThread[]>(data.threads);
  // Advanced mode as the server says; Setup changes it on this page as the owner answers.
  $effect.pre(() => {
    advanced.on = data.advanced;
  });
  // Whether the owner passed the Act check; passing it on this page sets it from then on.
  $effect.pre(() => {
    if (data.actChecked) actCheck.passed = true;
  });
  // Off, nothing offers Projects, and an open Projects window closes.
  $effect(() => {
    if (!advanced.on) for (const w of wins.list) if (w.kind === 'projects') close(w.id, true);
  });
  /** The light on the floor: the office's clock, or held at day or night for this viewer. */
  let light = $state<Light>('auto');
  const openSetup = () => open({ id: 'setup', kind: 'setup' });
  /** Each staffer's runs going, or waiting for a slot: every `working` event brings them. */
  let inProgress = $state<Record<string, Work[]>>({});
  /** The Odds replying to the owner in chat: every `working` event brings them. */
  let chatting = $state<string[]>([]);
  /** Each staffer's follow-ups yet to start, read with the office. */
  let toStart = $state<Record<string, Work[]>>({});
  /** A request for the card to open on a tab, from the Odds rail's list. */
  let cardShow = $state<{ id: string; tab: 'work'; n: number } | undefined>();
  /** Bumps when jobs, runs, access, goals, threads or lessons change, so the card's tabs and the Goals and Lessons windows reload. */
  let version = $state(0);
  /** Bumped on a change to the ledger's rows, so the Ledger window searches again. */
  let ledgerVersion = $state(0);
  /** What the page does when each table changes, by the name the event carries. */
  const ON_CHANGE = new Map<string, LiveTable['page']>(
    Object.entries(LIVE_TABLES).map(([table, live]) => [table, live.page])
  );
  /** The start panel is open while it holds windows and the owner has not folded it away. */
  const leftOpen = $derived(wins.shown && wins.list.length > 0);
  const front = $derived(wins.list.find((w) => w.id === wins.active));
  let deskFocus = $state<string | undefined>();
  let notify = $state(false);
  // The two side panels. Widths are remembered per viewer by SidePanel.
  let leftWidth = $state(400);
  let rightWidth = $state(460);
  let rightCollapsed = $state(false);
  let innerWidth = $state(1280);
  /** Below this the panels cover the floor instead of sitting beside it. */
  const wide = $derived(innerWidth > 720);

  /** Select a staffer, opening its panel if it was folded away. */
  function select(id: string | undefined) {
    selected = id;
    railAsked = false;
    crew.letGo = false;
    wins.raised = !id;
    if (id) rightCollapsed = false;
  }

  $effect(() => {
    void selected;
    if (!rightCollapsed) crew.letGo = false;
  });

  // "Chat about this" from a report: open that staffer, whose chat takes the draft.
  $effect(() => {
    const id = chatRequest.staff;
    if (!id) return;
    chatRequest.staff = undefined;
    select(id);
  });

  // An item a window put on the desk, such as a service's Change: reload the desk, then open it.
  $effect(() => {
    const focus = deskRequest.focus;
    if (!focus) return;
    deskRequest.focus = undefined;
    void refresh().then(() => openDesk(focus));
  });

  // svelte-ignore state_referenced_locally
  serviceNames.byId = data.services;

  // The floor and every Odd on it. Getters, not values: the crew reads each
  // page value live, and an effect of it tracks only the values it reads.
  // svelte-ignore state_referenced_locally
  // Typed, since its getters read `office`, which reads the crew.
  const crew: FloorCrew = new FloorCrew(
    {
      get staff() {
        return staff;
      },
      get office() {
        return office;
      },
      get world() {
        return world;
      },
      get switchedOff() {
        return switchedOff;
      },
      get selected() {
        return selected;
      },
      get rightCollapsed() {
        return rightCollapsed;
      },
      get shownHour() {
        return shownHour;
      },
      get sky() {
        return sky;
      },
      get oddsNow() {
        return oddsNow;
      },
      get leftSpace() {
        return leftSpace;
      },
      get rightSpace() {
        return rightSpace;
      }
    },
    { flip, refresh, select },
    data.welcomed
  );

  const PT = $derived({ timeZone: crew.officeZone });
  const hour = $derived.by(() => {
    const [h, m] = new Intl.DateTimeFormat('en-US', {
      ...PT,
      hourCycle: 'h23',
      hour: 'numeric',
      minute: 'numeric'
    })
      .format(now)
      .split(':')
      .map(Number);
    return h + m / 60;
  });
  /** The weather outside, as MET Norway's symbol, unless the viewer holds the floor at day or night. */
  const sky = $derived(
    light === 'auto' && weather.setting && weather.report ? weather.report.symbol : undefined
  );
  /** The hour the floor shows: the office's own, unless the viewer holds it at day or night. */
  const shownHour = $derived(light === 'day' ? 13 : light === 'night' ? 22 : hour);
  const office = $derived(crew.liveWorld ? { ...data.office, world: crew.liveWorld } : data.office);
  /** The name at the top of the panel: the lot, then the office. */
  const plateName = $derived(
    crew.firstRun
      ? (crew.raisedName ?? (crew.lotName.trim() ? `${crew.lotName.trim()}'s Lot` : 'Your Lot'))
      : office.name
  );
  /** The floor with the names the owner gave its rooms. */
  const world = $derived({
    ...office.world,
    rooms: office.world.rooms.map((r) => ({ ...r, name: roomNames[r.id] ?? r.name }))
  });
  const places = $derived(placesFor(world));
  const profile = $derived(staff.find((p) => p.id === selected));
  /** Screen space each panel takes from the floor, margin included. */
  // The first run's cards live in the start panel too.
  const leftSpace = $derived((leftOpen || crew.firstRun) && wide ? leftWidth + 16 : 0);
  /** An Odd's panel is open (not folded away). */
  const cardOpen = $derived(!!profile && !rightCollapsed);
  /** ⌘K while a card is open brings the rail back over it, until an Odd is picked or the list closes. */
  let railAsked = $state(false);
  /**
   * The Odds rail, beside the floor once the office has an Odd. It slides off
   * the screen while an Odd's panel is open, and back when it closes or folds.
   */
  const showRail = $derived(!crew.firstRun && staff.length > 0 && (!cardOpen || railAsked));
  const rightSpace = $derived(
    (showRail && !cardOpen ? ODDS_RAIL + 16 : 0) + (cardOpen && wide ? rightWidth + 8 : 0)
  );
  /** The Odds rail is wide now: hovered, in the keyboard's path, or opened with ⌘K. */
  let railOpen = $state(false);
  /**
   * Projects in front widens the start panel to the Odd's panel, else to the
   * Odds rail: px kept free at the end edge, 8 of them a gap. While the rail
   * is wide, the panel steps back to its edge, so every Odd stays in view.
   */
  const projectsReach = $derived.by(() => {
    if (!wide || !leftOpen || front?.kind !== 'projects') return undefined;
    if (cardOpen) return rightWidth + 24;
    if (showRail) return (railOpen ? ODDS_RAIL_OPEN : ODDS_RAIL) + 24;
    return 16;
  });
  const selectedActivity = $derived(crew.tags.find((t) => t.id === selected)?.activity ?? 'home');
  const clock = $derived(
    now.toLocaleTimeString('en-US', { ...PT, hour: 'numeric', minute: '2-digit' })
  );
  /** The office as the page holds it, which every screen's words for an Odd come from. */
  const snapshot = $derived.by((): Snapshot => {
    // An Odd the floor still shows after it left keeps its tag until the floor drops it.
    const ids = [...new Set([...staff.map((p) => p.id), ...Object.keys(crew.placed)])];
    return {
      ids,
      inProgress,
      toStart,
      chatting,
      desk,
      staff,
      messages,
      threads,
      // An Odd not on the floor yet reads as at home, as the card always read it.
      activity: Object.fromEntries(ids.map((id) => [id, crew.placed[id] ?? 'home'])),
      nameOf: (id) => staff.find((s) => s.id === id)?.name ?? id
    };
  });
  /** Every Odd's state, derived once, so the floor, the rail, the card and the chat agree. */
  const oddsNow = $derived(oddNow(snapshot));
  /** Each Odd on the floor, to the room it walks to, if any. */
  const headings = $derived(Object.fromEntries(crew.tags.map((t) => [t.id, t.heading])));

  // The While you were away card counts once, however many jobs it lists.
  const deskCount = $derived(
    desk.asks.length +
      desk.tasks.length +
      desk.reports.length +
      desk.projectWork.length +
      (desk.away.length ? 1 : 0)
  );

  /** Rooms a new hire can work in: any with a place to work, read or sort mail. */
  const hireRooms = $derived.by(() => {
    const out = new Map<string, string>();
    for (const r of world.rooms) {
      const id = r.id.split('#')[0];
      const works = office.world.spots.some(
        (s) => s.room === r.id && ['work', 'intake', 'read'].includes(s.activity)
      );
      if (works && !out.has(id)) out.set(id, r.name);
    }
    return [...out].map(([id, name]) => ({ id, name }));
  });

  /** Switch a lamp, screen or fire. The floor changes at once; the ledger keeps it. */
  function flip(obj: string) {
    const on = switchedOff.includes(obj);
    switchedOff = on ? switchedOff.filter((o) => o !== obj) : [...switchedOff, obj];
    call('/api/switches', { obj, on }, 'PUT').catch(() => refresh());
  }

  let refreshing: Promise<void> | undefined;
  let seen = new Set<string>();
  const keys = (d: Desk) =>
    new Set([
      ...d.asks.map((a) => `ask-${a.id}`),
      ...d.tasks.map((t) => `task-${t.id}`),
      ...d.reports.map((r) => `report-${r.id}`)
    ]);

  /** Fetch the office once per burst of changes. */
  function refresh(): Promise<void> {
    return (refreshing ??= (async () => {
      await new Promise((r) => setTimeout(r, 50));
      refreshing = undefined;
      const next = await call<{
        staff: StaffProfile[];
        desk: Desk;
        chatting: string[];
        inProgress: Record<string, Work[]>;
        toStart: Record<string, Work[]>;
        roomNames: Record<string, string>;
        switchedOff: string[];
        messages: Record<string, number>;
        threads: HeldThread[];
        services: Record<string, string>;
      }>('/api/office');
      const fresh = [...keys(next.desk)].filter((k) => !seen.has(k));
      if (
        notify &&
        fresh.length &&
        document.visibilityState !== 'visible' &&
        'Notification' in window
      ) {
        const first = [...next.desk.asks, ...next.desk.tasks, ...next.desk.reports].find((i) =>
          fresh.some((k) => k.endsWith(`-${i.id}`))
        );
        new Notification(`${keys(next.desk).size} waiting on you in ${office.name}`, {
          body: first?.title ?? 'Something new is on your desk.'
        });
      }
      seen = keys(next.desk);
      staff = next.staff;
      desk = next.desk;
      chatting = next.chatting;
      inProgress = next.inProgress;
      toStart = next.toStart;
      roomNames = next.roomNames;
      switchedOff = next.switchedOff;
      messages = next.messages;
      threads = next.threads;
      serviceNames.byId = next.services;
    })());
  }

  function setNotify(on: boolean) {
    notify = on;
    try {
      localStorage.setItem('oddboro.notify', on ? '1' : '');
    } catch {
      // Private window: the switch lasts this visit only.
    }
    if (on && 'Notification' in window && Notification.permission === 'default')
      void Notification.requestPermission();
  }

  /** Fold the panel away. Its windows stay open behind it. */
  function hide() {
    wins.shown = false;
  }

  async function openDesk(focus?: string) {
    // Cleared first, so asking for the item already open still brings it back.
    deskFocus = undefined;
    open({ id: 'desk', kind: 'desk' });
    await tick();
    deskFocus = focus;
  }

  /**
   * Something a staffer delivered, from its chat: on the desk while it waits,
   * else a report on its own. False when there is nothing to open.
   */
  function openDelivered(staffId: string, d: Delivered): boolean {
    const waiting = (rows: { id: number }[]) => {
      const found = rows.some((r) => r.id === d.id);
      if (found) void openDesk(`${d.kind}-${d.id}`);
      return found;
    };
    switch (d.kind) {
      case 'ask':
        return waiting(desk.asks);
      case 'task':
        return waiting(desk.tasks);
      case 'report':
        if (!waiting(desk.reports)) openReport({ id: d.id, staff: staffId, title: d.title });
        return true;
      default: {
        const missed: never = d.kind;
        throw new Error(`Nothing opens a ${String(missed)}`);
      }
    }
  }

  /** A thread from the Goals window: the oldest thing it waits on, else its hub's chat, which shows it as a card. */
  function openThread(t: GoalThread) {
    const first = t.waiting[0];
    if (!(first && openDelivered(t.hubId, first))) select(t.hubId);
  }

  /** A section's button: brings its window forward, or folds the panel when it already is. */
  function toggle(id: Section) {
    if (leftOpen && front?.kind === id) return hide();
    if (id === 'desk') return void openDesk();
    if (id === 'ledger') return open({ id: 'ledger', kind: 'ledger' });
    if (id === 'projects') return openProject();
    if (id === 'services') return open({ id: 'services', kind: 'services' });
    if (id === 'goals') return open({ id: 'goals', kind: 'goals' });
    if (id === 'lessons') return openLessons();
    if (id === 'office') return open({ id: 'office', kind: 'office' });
    const hire = wins.list.findLast((w) => w.kind === 'hire');
    if (hire) open(hire);
    else openHire();
  }

  function hireProposal(a: AskRow) {
    if (a.hire) openHire({ askId: a.id, staff: a.staffId, proposal: a.hire });
  }

  /** An approved goal plan's hires, each in its own hire window, the first in front. */
  function planHires(hires: AskRow[]) {
    for (const a of [...hires].reverse()) hireProposal(a);
  }

  /** The icon over an Odd that keeps a lesson, or uses one. */
  const LESSON_POP: Record<LessonEvent['kind'], Pop> = { kept: 'notebook', used: 'note' };

  onMount(() => {
    seen = keys(desk);
    // A new owner's first visit opens on its own song; later visits play if the owner left the music on.
    startMusic(crew.firstRun);
    try {
      notify = localStorage.getItem('oddboro.notify') === '1';
      const held = localStorage.getItem('oddboro.light');
      if (held === 'day' || held === 'night') light = held;
    } catch {
      // No storage: notifications stay off.
    }
    // The page's one clock. The weather rides on it: asked only when due and only while seen.
    void askWeather();
    const timer = setInterval(() => {
      now = new Date();
      void askWeather();
    }, 15_000);
    const catchUp = () => void askWeather();
    document.addEventListener('visibilitychange', catchUp);

    // One live line from the server. Changes arrive as they happen.
    const events = new EventSource('/api/events' satisfies ApiUrl);
    events.onmessage = (m) => {
      const e = JSON.parse(m.data) as OfficeEvent;
      if (e.type === 'account') {
        account.status = e.status;
        return;
      }
      if (e.type === 'weather') return void askWeather(true);
      if (e.type === 'working') {
        // Every tool call a staffer makes updates its work in progress; only
        // a run starting or ending reloads the card's tabs.
        const before = oddsNow;
        inProgress = e.inProgress;
        chatting = e.chatting;
        if (runsChanged(before, oddsNow)) version++;
        return;
      }
      // Whoever handed work on, or did it, walks over to the other and back.
      if (e.type === 'hand-off') {
        crew.visit(e);
        return;
      }
      if (e.type === 'lesson') {
        crew.pop(e.staff, LESSON_POP[e.kind]);
        return;
      }
      // Only the persona offers hear this: the floor meets a persona Odd, or
      // sees it go quiet, through the staff table's change, as any hire.
      if (e.type === 'persona') return void personaNews(e);
      const page = e.table === 'chat' ? ['version'] : (ON_CHANGE.get(e.table) ?? []);
      // A move into another layout rebuilds the whole floor.
      // During the first run, and until its last drawn pieces land, the floor
      // already shows the office being moved into.
      if (page.includes('reload'))
        return crew.firstRun || crew.landing ? void refresh() : location.reload();
      if (page.includes('refresh')) refresh();
      if (page.includes('version')) version++;
      if (page.includes('ledger')) ledgerVersion++;
    };

    // The first run's guide shows as soon as the floor does, so fetch both at once.
    if (crew.firstRun) loadOnboarding().catch(() => {});
    void crew.mount(host).then(() => {
      if (!crew.floorReady) return;
      // The card and the Desk are the panels opened most. Fetch them once,
      // after the floor is up, so they open at once. A failed fetch here
      // stays quiet: it is only a head start.
      setTimeout(() => {
        loadStaffCard().catch(() => {});
        loadDeskDrawer().catch(() => {});
      }, 0);
    });

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', catchUp);
      events.close();
      crew.destroy();
    };
  });

  /** A waiting staffer's tag opens its first item on the desk. */
  function tagClick(id: string) {
    // A message waiting: open their chat, where it is.
    if (messages[id]) return chatAbout(id, '');
    const a = desk.asks.find((x) => x.staffId === id);
    const t = desk.tasks.find((x) => x.staffId === id);
    if (a || t) void openDesk(a ? `ask-${a.id}` : `task-${t!.id}`);
    else select(id);
  }

  /** The room the owner is renaming, and the name as the owner types it. */
  let renaming = $state<string | undefined>();
  let roomDraft = $state('');
  let roomProblem = $state('');

  function startRename(l: Label) {
    renaming = l.id;
    roomDraft = l.name;
    roomProblem = '';
  }

  async function saveRename() {
    const id = renaming;
    if (!id) return;
    const was = world.rooms.find((r) => r.id === id)?.name;
    if (roomDraft.trim() === was) return void (renaming = undefined);
    try {
      const r = await call<{ name: string }>('/api/rooms', { room: id, name: roomDraft }, 'PUT');
      roomNames = { ...roomNames, [id]: r.name };
      renaming = undefined;
      crew.floor?.invalidate();
    } catch (e) {
      roomProblem = e instanceof Error ? e.message : String(e);
    }
  }

  function renameKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    renaming = undefined;
  }

  /** Bumps to open the Odds list on the rail with the cursor in its search. */
  let findAgent = $state(0);

  function onkey(e: KeyboardEvent) {
    // Cmd+K finds an Odd from anywhere, the box included.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !crew.firstRun) {
      e.preventDefault();
      railAsked = true;
      findAgent++;
      return;
    }
    const el = e.target as HTMLElement | null;
    if (el?.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'd' || e.key === 'D') toggle('desk');
  }

  $effect(() => {
    const l = light;
    try {
      localStorage.setItem('oddboro.light', l);
    } catch {
      // Private window: held for this visit only.
    }
  });
</script>

<svelte:window onkeydown={onkey} bind:innerWidth />

<svelte:head>
  <title
    >{crew.firstRun ? 'Welcome' : `${deskCount ? `(${deskCount}) ` : ''}${office.name}`} · Oddboro</title
  >
</svelte:head>

<main class="fixed inset-0 overflow-clip">
  <div
    bind:this={host}
    class="absolute inset-0 transition-opacity duration-700"
    class:opacity-0={!crew.ready}
  ></div>

  <!-- Room signs and name tags ride above the floor. -->
  <div class="pointer-events-none absolute inset-0">
    {#each crew.labels as l (l.id)}
      <RoomSign
        label={l}
        renaming={renaming === l.id}
        draft={roomDraft}
        problem={roomProblem}
        oninput={(v) => (roomDraft = v)}
        onsave={() => void saveRename()}
        onkeydown={renameKey}
        onrename={() => startRename(l)}
      />
    {/each}
    {#each crew.tags as t (t.id)}
      <NameTag
        tag={t}
        now={oddsNow[t.id]}
        active={selected === t.id}
        onclick={() => tagClick(t.id)}
      />
    {/each}
  </div>

  {#snippet plate(open: boolean)}
    <OfficePlate
      {open}
      {plateName}
      {office}
      {clock}
      computer={data.computer}
      restored={data.restored}
      firstRun={crew.firstRun}
      {leftOpen}
      {front}
      {deskCount}
      onsetup={openSetup}
      onhide={hide}
      ontoggle={toggle}
    />
  {/snippet}

  <audio
    bind:this={music.audio}
    preload="auto"
    onplay={() => (music.playing = true)}
    onpause={() => {
      if (!music.focus) music.playing = false;
    }}
    ontimeupdate={(e) => (music.time = e.currentTarget.currentTime)}
    ondurationchange={(e) => (music.duration = e.currentTarget.duration || 0)}
    onended={musicEnded}
  ></audio>

  <!-- The start side: the office plate, which opens into a full-height bar
       holding the desk, the ledger, or hiring. The first run keeps it away. -->
  {#if crew.firstRun}
    <!-- The first run happens here, so the owner meets the command center first. -->
    <SidePanel
      side="start"
      label="Welcome"
      bind:width={leftWidth}
      min={340}
      max={Math.max(760, Math.round(innerWidth * 0.4))}
      storageKey="oddboro.panel.start"
    >
      <div class="flex h-full min-h-0 flex-col">
        {@render plate(true)}
        {#if crew.floorReady}
          {#await loadOnboarding() then { default: Onboarding }}
            <Onboarding stage={crew.stage} sample={data.sample} />
          {/await}
        {/if}
        <div class="mt-auto border-t border-hairline px-3 py-2">
          <FloorControls
            bind:light
            onfit={() => crew.fitFloor()}
            onzoom={(d) => crew.floor?.zoomBy(d)}
          />
        </div>
      </div>
    </SidePanel>
  {:else if leftOpen}
    <OfficePanel
      bind:width={leftWidth}
      bind:light
      {crew}
      {plate}
      {innerWidth}
      reach={projectsReach}
      {desk}
      {deskCount}
      {deskFocus}
      {staff}
      {version}
      {ledgerVersion}
      {notify}
      {office}
      {hireRooms}
      onhire={hireProposal}
      onplan={planHires}
      onselect={select}
      onthread={openThread}
      onnotify={setNotify}
      onrefresh={refresh}
    />
  {:else}
    <header
      class="glass absolute start-4 top-4 rounded-2xl px-4 py-3 max-sm:start-3 max-sm:px-3 max-sm:py-2"
    >
      {@render plate(false)}
      <div class="mt-2 border-t border-hairline pt-2">
        <FloorControls
          bind:light
          onfit={() => crew.fitFloor()}
          onzoom={(d) => crew.floor?.zoomBy(d)}
        />
      </div>
    </header>
  {/if}

  <!-- The desk pill, centred on the floor between the two panels, and the
       weather at its end once the owner turns weather on. Projects covers the
       floor, and the plate's Desk button carries the count. -->
  <div
    class="pointer-events-none absolute top-4 flex justify-center max-sm:top-24"
    class:hidden={crew.firstRun || projectsReach !== undefined}
    style="inset-inline: {leftSpace}px {rightSpace}px"
  >
    <!-- The weather hangs off the desk pill's end, so the desk pill keeps its centre. -->
    <div class="relative">
      <button
        class="glass pointer-events-auto flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm"
        class:desk-due={deskCount > 0}
        onclick={() => toggle('desk')}
        aria-keyshortcuts="D"
      >
        {#if deskCount}
          <span
            class="flex size-5 items-center justify-center rounded-full bg-ember font-pixel text-xs text-night"
            >{deskCount}</span
          >
          <span class="text-ink">waiting on you</span>
        {:else}
          <span class="text-muted">Desk clear</span>
        {/if}
      </button>
      <div class="absolute start-full top-0 ms-2">
        <WeatherPill onsetup={openSetup} />
      </div>
    </div>
  </div>

  <CardColumn
    bind:width={rightWidth}
    {crew}
    {showRail}
    {profile}
    {rightCollapsed}
    {selected}
    {selectedActivity}
    {staff}
    {version}
    {places}
    {cardShow}
    {findAgent}
    {railAsked}
    {oddsNow}
    {snapshot}
    {headings}
    oncollapse={() => (rightCollapsed = true)}
    onleave={() => (railAsked = false)}
    onwiden={(w) => (railOpen = w)}
    onselect={select}
    onplan={planHires}
    onitem={openDelivered}
  />

  {#if crew.failed}
    <div class="absolute inset-0 grid place-items-center p-6">
      <div class="glass max-w-md rounded-2xl p-6">
        <div class="font-pixel text-xl">The office did not open</div>
        <p class="mt-2 text-sm text-muted">{crew.failed}</p>
        <ol class="mt-4 list-decimal space-y-1 ps-5 text-sm text-muted">
          <li>Run <code class="text-ink">npm run sprites</code> from the repo root.</li>
          <li>Reload this page.</li>
        </ol>
      </div>
    </div>
  {:else if !crew.ready}
    <div class="absolute inset-0 grid place-items-center">
      <div class="font-pixel text-lg text-muted">
        {crew.firstRun ? 'Welcome' : `Opening ${office.name}`}
      </div>
    </div>
  {/if}
  {#if actCheck.asking}
    {#await import('#lib/ui/ActCheck.svelte') then { default: ActCheck }}<ActCheck />{/await}
  {/if}
  {#if actCheck.choosing}
    {#await import('#lib/ui/HandOffChoice.svelte') then { default: HandOffChoice }}
      <HandOffChoice name={actCheck.choosing} />
    {/await}
  {/if}
</main>

<style>
  .desk-due {
    box-shadow:
      var(--shadow-float),
      0 0 0 1px var(--color-ember);
  }
</style>
