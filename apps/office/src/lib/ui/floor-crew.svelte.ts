// The floor and every Odd on it: the PixiJS floor, where each Odd goes and
// when, where their name tags and the room signs sit, the bus that brings a hire, and
// what the first run asks of the floor. The page makes one as it starts, so
// the effects here are the page's and stop with it. PixiJS loads as the
// floor mounts; this file imports the floor's types alone.
import { invalidateAll } from '$app/navigation';
import { TILE, type SpriteCatalog, type World } from '@oddboro/world';
import { setZone, zone } from '@oddboro/ledger/time';
import type { Floor } from '../floor/engine.ts';
import type { ArtSheet } from '../floor/art.ts';
import type { StaffActor, Pop } from '../floor/staff.ts';
import type { Beat } from '../floor/reveal.ts';
import type { Stage } from './onboarding/Onboarding.svelte';
import { chatAbout } from './chat-about.svelte.ts';
import { openLessons } from './windows.svelte.ts';
import { floorMode, type OddNow } from '../staff/odd-now.ts';
import type { Activity, StaffProfile } from '../staff/roster.ts';
import type { Place } from '../staff/places.ts';
import { pickActivity, stayFor } from '../staff/wander.ts';

/** `heading` is the room a walking staffer is on its way to. */
export type Tag = {
  id: string;
  name: string;
  activity: Activity;
  heading?: string;
  x: number;
  y: number;
};
export type Label = {
  id: string;
  name: string;
  x: number;
  y: number;
  scale: number;
  width: number;
};
/** A room sign is laid out once at 11px, as it reads at the usual fit, and scales with the floor. */
const SIGN_ZOOM = 1.5;
/** Only a preview goes below 1x, and a sign there would be too small to read. */
const SIGN_MIN_ZOOM = 1;

/**
 * The page's values the crew reads. The page passes each as a getter, so
 * every read is live and an effect tracks only the values it reads.
 */
export type CrewPage = {
  staff: StaffProfile[];
  office: { world: World; catalog: SpriteCatalog; art?: ArtSheet };
  /** The floor with the names the owner gave its rooms. */
  world: World;
  switchedOff: string[];
  selected: string | undefined;
  rightCollapsed: boolean;
  shownHour: number;
  /** The weather the floor shows, as MET Norway's symbol, or undefined for the clock's own sky. */
  sky: string | undefined;
  oddsNow: Record<string, OddNow>;
  /** Screen space each panel takes from the floor, margin included. */
  leftSpace: number;
  rightSpace: number;
};

/** What the crew asks of the page: switch a prop, reload the office, select an Odd. */
export type CrewCalls = {
  flip: (obj: string) => void;
  refresh: () => Promise<void>;
  select: (id: string | undefined) => void;
};

/** Where staff arrive: the home spot by the bus stop, or the bottom edge nearest the middle. */
function arrival(w: World): [number, number] {
  const exit = w.spots.find((s) => s.activity === 'home');
  if (exit) return exit.tile;
  let at: [number, number] = w.spots[0]?.tile ?? [1, 1];
  let best = -Infinity;
  for (let i = 0; i < w.walkable.length; i++) {
    if (!w.walkable[i]) continue;
    const x = i % w.width;
    const y = Math.floor(i / w.width);
    const score = y * 100 - Math.abs(x - w.width / 2);
    if (score > best) {
      best = score;
      at = [x, y];
    }
  }
  return at;
}

export class FloorCrew {
  #page: CrewPage;
  #calls: CrewCalls;
  #disposed = false;

  floor: Floor | undefined;
  /** The floor's PixiJS code (floor/index.ts), loaded as the page mounts, before the floor exists. */
  #F: typeof import('../floor/index.ts') | undefined;
  #atlasCatalog: Record<string, unknown> = {};
  #actors: StaffActor[] = [];
  tags = $state<Tag[]>([]);
  /** Where the floor put each Odd, kept only when one changes activity, so a frame alone changes no Odd's state. */
  placed = $state<Record<string, Activity>>({});
  #placedKey = '';
  labels = $state<Label[]>([]);
  /** Who holds each spot, by spot id, so the Send tab can show a place as taken. */
  held = $state<Record<string, { id: string; name: string }>>({});
  #heldKey = '';
  ready = $state(false);
  floorReady = $state(false);
  failed = $state<string | undefined>();
  /**
   * The camera follows the staffer whose panel is open. A drag lets go until
   * the owner selects someone again or reopens the panel.
   */
  letGo = $state(false);
  /** Staff the owner is directing by hand. Nothing else moves them. */
  manual = $state<Record<string, string>>({});
  /** False until the owner finishes the welcome, which the office opens on. */
  welcomed: boolean;
  /** A new owner's first visit, from the empty lot until their manager says hello. */
  firstRun: boolean;
  /** Room signs show once the walls are up. */
  #signs: boolean;
  /** The owner's name as they type it, for the lot at the top of the panel. */
  lotName = $state('');
  /** The office's name once it stands on the lot. */
  raisedName = $state<string | undefined>();
  /** The first run is over, and the office's last drawn pieces have not landed yet. */
  landing = $state(false);
  /** A staffer the camera follows without opening their card: the manager walking in. */
  #following = $state<string | undefined>();
  /** Odds on the floor or stepping off the bus. Any other hire stays off the floor until the bus brings it. */
  #arrived = new Set<string>();
  /** Hires on a bus that has not pulled up yet, so a second sync books no second seat. */
  #riding = new Set<string>();
  /** One bus at a time: a hire made during a ride takes the next one. */
  #busLine = Promise.resolve();
  /**
   * The camera while a hire comes in: held on the whole office while the bus
   * comes (nothing to follow), then on the hire. The owner taking the camera
   * ends it.
   */
  #watching: (() => [number, number] | undefined) | undefined;
  /** The office keeps its own time zone, wherever the screen is. */
  officeZone = $state(zone());
  // The first run shows the lot, then the office as it goes up on it.
  liveWorld = $state<World | undefined>();

  /** Where a walking staffer is headed: a colleague it visits, the room's name, or home for the way out. */
  #headingOf(a: StaffActor): string | undefined {
    if (a.visiting) return a.visiting.profile.name;
    const to = a.destination;
    if (!to) return undefined;
    if (to.activity === 'home') return 'Home';
    return this.#page.world.rooms.find((r) => r.id === to.room)?.name;
  }

  /** What a staffer running a job does in its room: work, sort mail, or read. */
  #jobActivity(p: StaffProfile): Activity {
    for (const a of ['work', 'intake', 'read'] as Activity[])
      if (
        this.#page.office.world.spots.some(
          (s) => s.activity === a && s.room.startsWith(`${p.room}#`)
        )
      )
        return a;
    return 'work';
  }

  // A field that reads `#page` derives in a closure: fields are set before the
  // constructor gives the crew the page.
  /**
   * The mode the office puts each staffer in: outside the owner's door, at
   * its job, or free. The ticker reads it each frame, so it is worked out
   * only when an Odd's state changes.
   */
  #floorModes = $derived.by(() =>
    Object.fromEntries(
      this.#page.staff.map((p) => [p.id, floorMode(this.#page.oddsNow[p.id], this.#jobActivity(p))])
    )
  );

  #taken = (except?: StaffActor) => {
    const off = new Set(this.#page.switchedOff);
    return new Set([
      ...(this.#actors
        .filter((a) => a !== except)
        .map((a) => a.spotId)
        .filter(Boolean) as string[]),
      // Nobody works at a desk whose screen the owner switched off.
      ...this.#page.office.world.spots
        .filter((s) => s.activity === 'work' && off.has(s.obj))
        .map((s) => s.id)
    ]);
  };

  // What the owner switched off shows on the floor. Anyone working at a screen
  // that just went dark gets up for another desk, or something else to do.
  #shownOff = new Set<string>();

  #start: [number, number] = [1, 1];
  /** The drawn look each staffer wears, once its frames have loaded. */
  #wearing: Record<string, string | undefined> = {};

  /** False until the first sync, which is the office opening. */
  #opened = false;

  /** One sync at a time, so a quick pair of changes never adds a staffer twice. */
  #syncing = Promise.resolve();
  #syncActors(): Promise<void> {
    this.#syncing = this.#syncing.then(this.#syncNow, this.#syncNow);
    return this.#syncing;
  }

  /** Load drawn looks, then put new hires on the floor and take leavers off it. */
  #syncNow = async () => {
    if (!this.floor) return;
    for (const p of this.#page.staff)
      this.#wearing[p.id] = await this.#F!.loadLook(this.floor.atlas, p).catch(() => undefined);
    const w = this.#page.office.world;
    for (const a of this.#actors.filter(
      (a) => !this.#page.staff.some((p) => p.id === a.profile.id)
    ))
      a.destroy();
    this.#actors = this.#actors.filter((a) => this.#page.staff.some((p) => p.id === a.profile.id));
    // A redraw: the staffer changes clothes where they stand.
    for (const a of this.#actors) a.wear(this.#wearing[a.profile.id]);
    const boarding: string[] = [];
    for (const p of this.#page.staff) {
      if (this.#actors.some((a) => a.profile.id === p.id) || !this.#atlasCatalog[p.sprite])
        continue;
      if (this.firstRun && !this.#arrived.has(p.id)) continue;
      // Every hire after the office opened, an Odd or a persona, comes by bus.
      if (this.#opened && !this.#arrived.has(p.id)) {
        if (!this.#riding.has(p.id)) boarding.push(p.id);
        this.#riding.add(p.id);
        continue;
      }
      this.#arrived.add(p.id);
      const a = new this.#F!.StaffActor(this.floor, p, this.#start);
      a.wear(this.#wearing[p.id]);
      a.sprite.on('pointertap', () => this.#calls.select(p.id));
      if (this.#opened) a.assign('work', w.spots, this.#taken(a));
      else {
        // The office is opening: everyone is already somewhere, each in a
        // different spot, instead of all walking in from the lobby at once.
        const want = this.#floorModes[p.id];
        this.#forced[p.id] = want;
        const free = new Set(w.spots.map((s) => s.activity));
        if (!a.assign(want ?? pickActivity(free, 'home'), w.spots, this.#taken(a)))
          a.assign('work', w.spots, this.#taken(a));
        a.arrive();
      }
      this.#actors.push(a);
    }
    this.#opened = true;
    if (boarding.length) this.#busLine = this.#busLine.then(() => this.#ride(boarding));
  };

  /**
   * The bus brings hires in: it pulls up at the stop, they step off and walk
   * to work, and it drives on. As on the first run, the camera shows the
   * whole office while the bus comes, then steps in on the first hire as it
   * gets off and follows it to its spot, unless the owner takes the camera. Nothing waits on
   * them, so each is on the floor, and can be tapped, from the moment it
   * steps off.
   */
  async #ride(ids: string[]) {
    if (!this.floor || !this.#F) return;
    const bus = this.#F.bus(this.floor);
    this.#watching = () => undefined;
    this.floor.overview();
    await bus.arrive();
    bus.open();
    await new Promise((r) => setTimeout(r, 800));
    for (const id of ids) {
      this.#riding.delete(id);
      this.#arrived.add(id);
    }
    await this.#syncActors();
    const hire = this.#actors.find((a) => a.profile.id === ids[0]);
    // Then the hire, to its spot, if the camera is still the ride's.
    const follow = (): [number, number] | undefined => {
      if (hire?.moving && hire.visible) return [hire.x, hire.y - TILE];
      if (this.#watching === follow) this.#watching = undefined;
    };
    // The owner may have taken the camera during the ride (onRelease clears it).
    // TypeScript keeps the field narrowed across the awaits, so compare, not test.
    if (this.#watching !== undefined) this.#watching = follow;
    await new Promise((r) => setTimeout(r, 2500));
    await bus.leave();
  }

  /** The mode the office puts a staffer in: outside the owner's door, at its job, or free. */
  #forced: Record<string, Activity | undefined> = {};

  constructor(page: CrewPage, calls: CrewCalls, welcomed: boolean) {
    this.#page = page;
    this.#calls = calls;
    this.welcomed = $state(welcomed);
    this.firstRun = $state(!welcomed);
    this.#signs = $state(welcomed);

    $effect(() => {
      const off = new Set(this.#page.switchedOff);
      if (!this.floorReady || !this.floor) return;
      for (const obj of new Set([...off, ...this.#shownOff]))
        this.floor.setSwitch(obj, !off.has(obj));
      const dark = [...off].filter((o) => !this.#shownOff.has(o));
      this.#shownOff = off;
      const spots = this.#page.office.world.spots;
      for (const a of this.#actors) {
        const at = a.spotId;
        if (!at || !dark.some((o) => at.startsWith(`${o}/`))) continue;
        if (!a.assign(a.activity, spots, this.#taken(a)))
          a.assign(
            pickActivity(new Set(spots.map((s) => s.activity)), a.activity),
            spots,
            this.#taken(a)
          );
      }
    });

    $effect(() => {
      const h = this.#page.shownHour;
      if (this.floorReady) this.floor?.setHour(h);
    });

    $effect(() => {
      const s = this.#page.sky;
      if (this.floorReady) this.floor?.setWeather(s);
    });

    // The end of the first run is a change too: the Odds it held back walk on then.
    $effect(() => {
      void this.#page.staff;
      void this.firstRun;
      if (this.floorReady) void this.#syncActors();
    });
  }

  /** Build the floor in `host` and start the Odds on it. */
  async mount(host: HTMLDivElement | undefined) {
    try {
      this.#F = await import('../floor/index.ts');
      const atlas = await this.#F.sharedAtlas(this.#page.office.catalog);
      await this.#F.addArt(atlas, this.#page.office.art);
      if (this.#disposed || !host) return;
      this.#atlasCatalog = atlas.catalog;
      this.floor = await this.#F.Floor.create(host, this.#page.office.world, atlas);
      this.floor.setHour(this.#page.shownHour);
      this.floor.setWeather(this.#page.sky);
      // Dev only: lets a browser console poke at the floor.
      if (import.meta.env.DEV) (window as unknown as { floor: Floor }).floor = this.floor;
      this.#start = arrival(this.#page.office.world);
      if (this.firstRun) this.#F.hideBuilding(this.floor);
      // Land on the whole office, centred on the floor the panels leave showing.
      this.floor.viewOffsetX = this.#centreOffset();
      this.floor.viewCover = this.#page.leftSpace + this.#page.rightSpace;
      this.floor.overview(false);
      void this.#syncActors();

      // Name tags and room signs move only when the floor draws.
      this.floor.onRender = () => {
        const holding = this.#actors.filter((a) => a.spotId);
        const key = holding.map((a) => `${a.spotId}=${a.profile.id}`).join('|');
        if (key !== this.#heldKey) {
          this.#heldKey = key;
          this.held = Object.fromEntries(
            holding.map((a) => [a.spotId!, { id: a.profile.id, name: a.profile.name }])
          );
        }
        this.tags = this.#actors
          .filter((a) => a.sprite.visible)
          .map((a) => {
            // A tag rises over an icon playing on the head, and settles once it ends.
            const p = this.floor!.toScreen(a.head.x, a.head.y - a.tagLift);
            return {
              id: a.profile.id,
              name: a.profile.name,
              activity: a.activity,
              heading: this.#headingOf(a),
              ...p
            };
          });
        const at = this.tags.map((t) => `${t.id}=${t.activity}`).join('|');
        if (at !== this.#placedKey) {
          this.#placedKey = at;
          this.placed = Object.fromEntries(this.tags.map((t) => [t.id, t.activity]));
        }
        // A sign scales with the floor, so it sits on the same spot of the wall at
        // the same size against the room at every zoom, and never runs past the room.
        const scale = this.floor!.scale / SIGN_ZOOM;
        this.labels = this.#page.world.rooms
          .filter((r) => this.#signs && r.sign !== false && this.floor!.scale >= SIGN_MIN_ZOOM)
          .map((r) => {
            const p = this.floor!.toScreen((r.x + 1) * TILE, (r.y + 0.6) * TILE);
            return { id: r.id, name: r.name, scale, width: (r.w - 2) * TILE * SIGN_ZOOM, ...p };
          });
      };

      this.floor.onRelease = () => {
        this.letGo = true;
        this.#watching = undefined;
      };
      this.floor.onTap = this.#calls.flip;
      this.floor.onShelf = () => openLessons('all');

      // Each free staffer's own clock: it starts when the staffer gets
      // somewhere, so nobody gets up at the same moment as everyone else.
      const leaveAt: Record<string, number> = {};
      this.floor.app.ticker.add((t) => {
        const dt = Math.min(0.05, t.deltaMS / 1000);
        // The floor can change under the ticker on the first run, so read it fresh.
        const w = this.#page.office.world;
        const available = new Set(w.spots.map((s) => s.activity));
        for (const a of this.#actors) a.update(dt);
        // Real state first: an open ask or task puts a staffer outside
        // the owner's door, and a running job puts it to work in its room.
        // A staffer visiting a colleague finishes the trip first.
        for (const a of this.#actors) {
          const id = a.profile.id;
          if (this.manual[id] || a.onTrip) continue;
          const want = this.#floorModes[id];
          if (want !== this.#forced[id]) {
            this.#forced[id] = want;
            a.assign(want ?? 'work', w.spots, this.#taken(a));
          }
        }
        const now = performance.now();
        for (const a of this.#actors) {
          const id = a.profile.id;
          if (this.manual[id] || this.#forced[id] || a.moving || a.onTrip) {
            delete leaveAt[id];
            continue;
          }
          leaveAt[id] ??= now + stayFor(a.activity);
          if (now < leaveAt[id]) continue;
          delete leaveAt[id];
          a.assign(pickActivity(available, a.activity), w.spots, this.#taken(a));
        }
        if (!this.floor) return;
        const lead = this.#following
          ? this.#actors.find((a) => a.profile.id === this.#following)
          : this.#page.selected && !this.#page.rightCollapsed && !this.letGo
            ? this.#actors.find((a) => a.profile.id === this.#page.selected)
            : undefined;
        // Centre the camera on the floor left between the two panels, and fit the office there.
        this.floor.viewOffsetX = this.#centreOffset();
        this.floor.viewCover = this.#page.leftSpace + this.#page.rightSpace;
        if (this.#watching) {
          const seen = this.#watching();
          if (seen) this.floor.focus(seen[0], seen[1]);
        } else if (lead && lead.visible) this.floor.focus(lead.x, lead.y - TILE);
        this.floor.updateDoors(this.#actors.filter((a) => a.visible).flatMap((a) => a.steps));
      });
      this.ready = true;
      this.floorReady = true;
    } catch (e) {
      this.failed = e instanceof Error ? e.message : String(e);
    }
  }

  /** Take every Odd and the floor down, as the page unmounts. */
  destroy() {
    this.#disposed = true;
    for (const a of this.#actors) a.destroy();
    this.floor?.destroy();
  }

  /** One Odd walks over to another and back: whoever handed work on, or did it. */
  visit(h: { from: string; to: string }) {
    const to = this.#actors.find((a) => a.profile.id === h.to);
    if (to) this.#actors.find((a) => a.profile.id === h.from)?.visit(to);
  }

  /** An icon plays once over an Odd's head. */
  pop(id: string, icon: Pop) {
    this.#actors.find((a) => a.profile.id === id)?.pop(icon);
  }

  /** Screen pixels to shift the camera by, to centre it on the floor between the two panels. */
  #centreOffset(): number {
    const rtl = document.documentElement.dir === 'rtl';
    return ((this.#page.leftSpace - this.#page.rightSpace) / 2) * (rtl ? -1 : 1);
  }

  /** Fit: the whole office in the room the panels leave, and stop following anyone. */
  fitFloor() {
    this.letGo = true;
    this.floor?.overview();
  }

  /** What the first run asks of the floor, while the cards and captions run the story. */
  stage: Stage = {
    bus: () => (this.floor && this.#F ? this.#F.bus(this.floor) : undefined),
    build: async (next: World, name: string, onBeat: (b: Beat) => void, art) => {
      if (!this.floor || !this.#F) return;
      // Art drawn for this office goes in the atlas before the floor asks for it.
      if (art?.sheet) await this.#F.addArt(this.floor.atlas, art.sheet, art.catalog);
      this.#signs = false;
      this.floor.swap(next, { fit: true });
      this.liveWorld = next;
      this.#start = arrival(next);
      // The swap keeps the owner's view, gliding out only if the building would not fit.
      this.#F.hideBuilding(this.floor);
      await this.#F.raise(this.floor, onBeat);
      this.#signs = true;
      this.raisedName = name;
      this.floor.invalidate();
    },
    walkIn: async (id: string, skip: Promise<void>) => {
      this.#arrived.add(id);
      await this.#calls.refresh();
      await this.#syncActors();
      const a = this.#actors.find((x) => x.profile.id === id);
      if (!a || !this.floor) return;
      this.manual = { ...this.manual, [id]: 'chat' };
      this.#following = id;
      this.chatStart(id);
      // Skip: at the owner's desk at once, the end of the walk without walking it.
      void skip.then(() => {
        a.arrive();
        this.floor?.invalidate();
      });
      const ticker = this.floor.app.ticker;
      await new Promise<void>((done) => {
        const check = () => {
          if (a.moving) return;
          ticker.remove(check);
          done();
        };
        ticker.add(check);
      });
      this.#following = undefined;
    },
    reload: async () => {
      await invalidateAll();
      this.liveWorld = undefined;
      this.landing = false;
    },
    finish: (id: string) => {
      this.firstRun = false;
      this.landing = true;
      this.welcomed = true;
      // Their card opens on the chat, where the hello is waiting.
      chatAbout(id, '');
    },
    zone: (z: string) => {
      setZone(z);
      this.officeZone = z;
    },
    name: (n: string) => {
      this.lotName = n;
    }
  };

  /** Send a staffer to a place: a spot there nobody else holds. A full place takes nobody. */
  send(id: string, place: Place) {
    const actor = this.#actors.find((a) => a.profile.id === id);
    if (!actor) return;
    const others = this.#taken(actor);
    const spot = place.spots.find((s) => !others.has(s.id));
    if (spot && actor.sendTo(spot)) this.manual = { ...this.manual, [id]: place.key };
  }

  // Talking with a staffer brings them to the owner's office. When the chat goes
  // quiet for a minute they go back to what they were doing, unless the owner
  // sent them somewhere.
  #chatTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  chatStart(id: string) {
    clearTimeout(this.#chatTimers[id]);
    if (this.manual[id] && this.manual[id] !== 'chat') return;
    const actor = this.#actors.find((a) => a.profile.id === id);
    if (!actor) return;
    // At the owner's desk if it is free, else outside their door: never on top of
    // someone already there.
    const near = (activity: string) => activity === 'talk' || activity === 'wait';
    const here = this.#page.office.world.spots.find((s) => s.id === actor.spotId);
    if (here && near(here.activity)) return;
    const others = this.#taken(actor);
    const free = (activity: string) =>
      this.#page.office.world.spots.find((s) => s.activity === activity && !others.has(s.id));
    const spot = free('talk') ?? free('wait');
    if (spot && actor.sendTo(spot)) this.manual = { ...this.manual, [id]: 'chat' };
  }
  chatEnd(id: string) {
    clearTimeout(this.#chatTimers[id]);
    this.#chatTimers[id] = setTimeout(() => {
      if (this.manual[id] === 'chat') this.backToSchedule(id);
    }, 60_000);
  }

  backToSchedule(id: string) {
    this.manual = Object.fromEntries(Object.entries(this.manual).filter(([k]) => k !== id));
    this.#forced[id] = undefined;
    const actor = this.#actors.find((a) => a.profile.id === id);
    actor?.assign('work', this.#page.office.world.spots, this.#taken(actor));
  }
}
