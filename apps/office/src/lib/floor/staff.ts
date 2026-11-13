// Staff on the floor. Each one walks to a spot that matches what it is doing
// and plays the pose for it. Where a staffer stands is its status.
import { Graphics, Sprite, type Texture } from 'pixi.js';
import {
  findPath,
  TILE,
  type Facing,
  type PathRules,
  type PlacedSpot,
  type SpriteMeta
} from '@oddboro/world';
import type { Floor } from './engine.ts';
import type { Activity, StaffProfile } from '../staff/roster.ts';
import { posesFor } from '../staff/places.ts';

const SPEED = 46; // pixels per second, about three tiles
/** Activities a staffer does in its own room when it can. */
const WORK: Activity[] = ['work', 'intake', 'read'];
/** How long a visit to a colleague lasts once there, in seconds. */
const VISIT_STAY = 2;
/** Visits that wait behind the one under way: a manager hands on several pieces in one run. */
const VISIT_QUEUE = 3;
/**
 * How many times the way out turns after a colleague who set off somewhere
 * else while it walked. Past that it keeps to where it was going, so a
 * colleague who keeps moving is never chased round the floor.
 */
const REAIMS = 3;
/** The icon's sprite in the atlas: `fx-pop/<icon>` is each one's animation. */
const POP = 'fx-pop';
/** Pixels between the top of the head and the bottom of an icon over it. */
const POP_GAP = 1;
/** Icons draw over everything standing: an object's depth is its feet's y, in the low thousands. */
const POP_Z = 1e6;

/** An icon that plays once over an Odd. Each is an animation of `fx-pop`. */
export type Pop = 'notebook' | 'note';

const dirOf = (f: Facing) => (f === 'left' || f === 'right' ? 'side' : f);
/** Which way to face to look along (dx, dy). */
const facingAlong = (dx: number, dy: number): Facing =>
  Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';

export class StaffActor {
  /** The Odd as the office last told the page: its home changes with it. */
  profile: StaffProfile;
  readonly sprite: Sprite;
  private shadow = new Graphics().ellipse(0, 0, 5, 1.6).fill({ color: 0x000000, alpha: 0.28 });
  activity: Activity = 'home';
  since = Date.now();
  /** Feet position in world pixels: the centre-bottom of the tile it stands on. */
  x = 0;
  y = 0;
  private tile: [number, number];
  private path: [number, number][] = [];
  private spot: PlacedSpot | undefined;
  private facing: Facing = 'down';
  private current = '';
  private frameList: Texture[] = [];
  private fps = 6;
  /**
   * Each staffer's own tempo and starting point, from its id, so people sitting
   * or standing about never breathe and type in step with each other.
   */
  private beat = 1;
  private phase = 0;
  private clock = 0;
  private floor: Floor;
  /**
   * A walk over to a colleague and back, which leaves `spot` alone, so the
   * place stays held for the way back. `aim` is where the way out leads, and
   * `reaims` counts the times it turned after the colleague.
   */
  private trip:
    | {
        phase: 'out' | 'stay' | 'back';
        to: StaffActor;
        left: number;
        aim: [number, number];
        reaims: number;
      }
    | undefined;
  /** A colleague who stopped it mid-walk to talk: it stands still until that talk ends. */
  private heldBy: StaffActor | undefined;
  /** The icon playing over the head, and how long it has played, in seconds. */
  private popping:
    { sprite: Sprite; frames: Texture[]; meta: SpriteMeta; clock: number } | undefined;
  /** Colleagues to visit after this trip, each found where it is when its trip starts. */
  private visits: StaffActor[] = [];

  constructor(floor: Floor, profile: StaffProfile, start: [number, number]) {
    this.floor = floor;
    this.profile = profile;
    this.tile = start;
    this.x = start[0] * TILE + TILE / 2;
    this.y = (start[1] + 1) * TILE;
    let h = 2166136261;
    for (const ch of profile.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    this.beat = 0.8 + ((h >>> 0) % 401) / 1000;
    this.phase = ((h >>> 12) % 1000) / 1000;
    this.frameList = this.frames('idle-down');
    this.sprite = new Sprite(this.frameList[0]);
    this.sprite.eventMode = 'static';
    this.sprite.cursor = 'pointer';
    floor.objects.addChild(this.sprite);
    floor.shadows.addChild(this.shadow);
    this.place();
  }

  /** A drawn look's variant, worn over the profile's own. */
  private look: string | undefined;

  /** Wear a drawn look's frames. The next frame drawn uses them. */
  wear(variant: string | undefined) {
    if (variant === this.look) return;
    this.look = variant;
    this.current = '';
  }

  private key(anim: string) {
    return `${this.profile.sprite}@${this.look ?? this.profile.variant}/${anim}`;
  }

  private frames(anim: string): Texture[] {
    const a = this.floor.atlas.sheet.animations;
    return a[this.key(anim)] ?? a[`${this.profile.sprite}/${anim}`] ?? a[this.key('idle-down')];
  }

  private has(anim: string) {
    const a = this.floor.atlas.sheet.animations;
    return !!(a[this.key(anim)] ?? a[`${this.profile.sprite}/${anim}`]);
  }

  private play(anim: string, flip: boolean) {
    const id = `${anim}:${flip}`;
    if (this.current !== id) {
      this.current = id;
      this.frameList = this.frames(anim);
      // A walk keeps its pace with the steps; anything else runs at the
      // staffer's own tempo, from its own point in the loop.
      const walking = anim.startsWith('walk');
      this.fps = walking ? 8 : 4 * this.beat;
      this.clock = walking ? 0 : this.phase * (this.frameList.length / this.fps);
    }
    this.sprite.scale.x = flip ? -1 : 1;
  }

  /**
   * Send the staffer somewhere that fits the activity. Returns false if no spot
   * fits, and then any trip under way goes on: only a move that happens ends it.
   * `within` keeps it to one room, as a meeting does.
   */
  assign(activity: Activity, spots: PlacedSpot[], taken: Set<string>, within?: string): boolean {
    this.activity = activity;
    this.since = Date.now();
    const exit = spots.find((s) => s.activity === 'home');
    if (activity === 'home' && !exit) {
      this.endTrips();
      this.hide();
      return true;
    }
    this.sprite.visible = true;
    this.shadow.visible = true;
    this.floor.invalidate();
    let options = spots.filter(
      (s) => s.activity === activity && !taken.has(s.id) && (!within || s.room === within)
    );
    // Work happens at the staffer's home seat when it is free, else in its own
    // room when that room has a spot for it.
    const home = this.profile.room;
    const inRoom = (s: PlacedSpot) => s.room.startsWith(`${home}#`);
    if (WORK.includes(activity) && options.some(inRoom)) options = options.filter(inRoom);
    if (!options.length) return false;
    const w = this.floor.world;
    const seat = WORK.includes(activity) && options.find((s) => s.id === this.profile.seat);
    const toSeat = seat && findPath(w.walkable, w.width, this.tile, seat.tile, this.rules(seat));
    if (seat && toSeat) {
      this.endTrips();
      this.spot = seat;
      this.path = toSeat.slice(1);
      return true;
    }
    let best: { spot: PlacedSpot; path: [number, number][] } | undefined;
    for (const spot of options) {
      const path = findPath(w.walkable, w.width, this.tile, spot.tile, this.rules(spot));
      if (path && (!best || path.length < best.path.length)) best = { spot, path };
    }
    if (!best) return false;
    this.endTrips();
    this.spot = best.spot;
    this.path = best.path.slice(1);
    return true;
  }

  private hide() {
    this.sprite.visible = false;
    this.shadow.visible = false;
    this.spot = undefined;
    this.endPop();
    this.floor.invalidate();
  }

  /** The tile the staffer stands on and the next two it will step to. */
  get steps(): [number, number][] {
    return [this.tile, ...this.path.slice(0, 2)];
  }

  /** True while walking somewhere. */
  get moving() {
    return this.path.length > 0;
  }

  /** On the floor: shown, and not taken off it for good. */
  get visible() {
    return !this.sprite.destroyed && this.sprite.visible;
  }

  /** Enter the target spot from its approach, and stand up from the current one the way we sat down. */
  private rules(target?: PlacedSpot): PathRules {
    const here =
      this.spot && this.spot.tile[0] === this.tile[0] && this.spot.tile[1] === this.tile[1];
    return { enter: target?.approach, leave: here ? this.spot!.approach : undefined };
  }

  /** Walk to one particular spot and do what it is for. False if no path reaches it, and any trip goes on. */
  sendTo(spot: PlacedSpot): boolean {
    const w = this.floor.world;
    this.sprite.visible = true;
    this.shadow.visible = true;
    this.floor.invalidate();
    const path = findPath(w.walkable, w.width, this.tile, spot.tile, this.rules(spot));
    if (!path) return false;
    this.endTrips();
    this.activity = spot.activity as Activity;
    this.since = Date.now();
    this.spot = spot;
    this.path = path.slice(1);
    if (!this.path.length && this.activity === 'home') this.hide();
    return true;
  }

  /** Be where the current walk ends, without walking it: for a staffer already there when the office opens. */
  arrive() {
    this.endTrips();
    const end = this.path.at(-1);
    if (!end) return;
    this.path = [];
    this.stand(end);
    if (this.activity === 'home') this.hide();
    this.place();
  }

  get spotId() {
    return this.spot?.id;
  }

  /** The spot it is walking to, while it walks. */
  get destination(): PlacedSpot | undefined {
    return this.path.length ? this.spot : undefined;
  }

  /** Where a colleague stands to meet this one: beside its seat, never on it. */
  get meetAt(): [number, number] {
    return (this.destination ?? this.spot)?.approach ?? this.tile;
  }

  /** True from setting off to a colleague until back at the spot. */
  get onTrip(): boolean {
    return !!this.trip;
  }

  /** The colleague it is on its way to or standing with. */
  get visiting(): StaffActor | undefined {
    return this.trip && this.trip.phase !== 'back' ? this.trip.to : undefined;
  }

  /**
   * Walk over to a colleague, stand with it a moment, and walk back to the
   * same spot, which stays held the whole time. During a trip it waits its
   * turn, up to `VISIT_QUEUE`. False when either is off the floor, it is on its
   * way out or has no spot to come back to, the queue is full, or no path
   * reaches the colleague.
   */
  visit(target: StaffActor): boolean {
    if (!this.visible || !target.visible || target === this) return false;
    if (!this.spot || this.activity === 'home') return false;
    if (!this.trip) return this.setOff(target);
    if (this.visits.length >= VISIT_QUEUE) return false;
    this.visits.push(target);
    return true;
  }

  private setOff(to: StaffActor): boolean {
    const path = this.pathTo(to.meetAt);
    if (!path) return false;
    this.trip = { phase: 'out', to, left: VISIT_STAY, aim: to.meetAt, reaims: 0 };
    this.path = path.slice(1);
    return true;
  }

  /** A path to a tile that is no spot, getting up from the spot it is at the way it sat down. */
  private pathTo(at: [number, number]): [number, number][] | undefined {
    const w = this.floor.world;
    return findPath(w.walkable, w.width, this.tile, at, this.rules());
  }

  /** The owner or the office moved it on: any trip, the visits behind it, and any talk on the way are off. */
  private endTrips() {
    this.trip = undefined;
    this.visits = [];
    this.heldBy = undefined;
  }

  /** Stopped mid-walk while a colleague talks to it, and let go once that colleague moves on. */
  private get held(): boolean {
    const by = this.heldBy;
    if (by?.visible && by.trip?.phase === 'stay' && by.trip.to === this) return true;
    this.heldBy = undefined;
    return false;
  }

  /**
   * A step of the way out is done. A colleague on the move within a tile
   * stops with it to talk, wherever the two are. One that set off somewhere
   * else is followed there, up to `REAIMS` times. A seated colleague is met
   * beside its seat, at the end of the walk.
   */
  private onTheWay(trip: NonNullable<StaffActor['trip']>) {
    const to = trip.to;
    if (to.moving && to.visible && this.near(to)) return this.meet(trip);
    const at = to.meetAt;
    if ((at[0] === trip.aim[0] && at[1] === trip.aim[1]) || trip.reaims >= REAIMS) return;
    const path = this.pathTo(at);
    if (!path) return;
    trip.reaims++;
    trip.aim = at;
    this.path = path.slice(1);
  }

  /** Within a tile of a colleague: beside, or across a corner someone could walk round. */
  private near(o: StaffActor): boolean {
    const dx = Math.abs(o.tile[0] - this.tile[0]);
    const dy = Math.abs(o.tile[1] - this.tile[1]);
    if (dx + dy <= 1) return true;
    if (dx !== 1 || dy !== 1) return false;
    const w = this.floor.world;
    return (
      w.walkable[this.tile[1] * w.width + o.tile[0]] ||
      w.walkable[o.tile[1] * w.width + this.tile[0]]
    );
  }

  /** Stop here to talk: the stay starts, and a colleague on the move stops for it too. */
  private meet(trip: NonNullable<StaffActor['trip']>) {
    this.path = [];
    trip.phase = 'stay';
    this.facing = facingAlong(trip.to.x - this.x, trip.to.y - this.y);
    const to = trip.to;
    if (!to.moving) return;
    to.heldBy = this;
    to.facing = facingAlong(this.x - to.x, this.y - to.y);
  }

  /** The next queued visit a colleague still on the floor can take, or none. */
  private nextVisit() {
    for (let to = this.visits.shift(); to; to = this.visits.shift())
      if (to.visible && this.setOff(to)) return;
  }

  /** A trip with no walk under way moves on: the way out ended, the stay runs, or the way back ended. */
  private tripStep(trip: NonNullable<StaffActor['trip']>, dt: number) {
    if (trip.phase === 'back') {
      this.trip = undefined;
      this.nextVisit();
    } else if (trip.phase === 'stay') {
      trip.left -= dt;
      if (trip.left <= 0) this.headBack(trip);
    } else {
      // The colleague may have moved on while this one walked: go after it.
      const at = trip.to.meetAt;
      const moved = at[0] !== this.tile[0] || at[1] !== this.tile[1];
      const path = moved && trip.reaims < REAIMS ? this.pathTo(at) : undefined;
      if (path && path.length > 1) {
        trip.reaims++;
        trip.aim = at;
        this.path = path.slice(1);
      } else this.meet(trip);
    }
  }

  /** The stay is over: back to its spot, or onto it at once when the floor changed and no path leads there. */
  private headBack(trip: NonNullable<StaffActor['trip']>) {
    const spot = this.spot;
    if (!spot) return this.endTrips();
    const w = this.floor.world;
    const path = findPath(w.walkable, w.width, this.tile, spot.tile, this.rules(spot));
    trip.phase = 'back';
    if (path) this.path = path.slice(1);
    else this.stand(spot.tile);
  }

  /** Stand on a tile at once. */
  private stand(at: [number, number]) {
    this.tile = at;
    this.x = at[0] * TILE + TILE / 2;
    this.y = (at[1] + 1) * TILE;
  }

  update(dt: number) {
    if (!this.sprite.visible) return;
    const held = this.held;
    if (!held && this.trip && !this.path.length) this.tripStep(this.trip, dt);
    const next = held ? undefined : this.path[0];
    if (next) {
      const tx = next[0] * TILE + TILE / 2;
      const ty = (next[1] + 1) * TILE;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.hypot(dx, dy);
      const step = SPEED * dt;
      this.facing = facingAlong(dx, dy);
      if (dist <= step) {
        this.stand(next);
        this.path.shift();
        // Going home ends at the exit: step out of sight.
        if (!this.path.length && this.activity === 'home') this.hide();
        else if (this.trip?.phase === 'out') this.onTheWay(this.trip);
      } else {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
      }
      this.play(`walk-${dirOf(this.facing)}`, this.facing === 'left');
    } else if (this.trip || held) {
      // Standing with the colleague, facing it.
      this.play(`idle-${dirOf(this.facing)}`, this.facing === 'left');
    } else {
      const facing = this.spot?.facing ?? 'down';
      const dir = dirOf(facing);
      const pose = posesFor(this.activity, this.spot).find((p) => this.has(p)) ?? `idle-${dir}`;
      this.play(pose, facing === 'left');
    }
    this.clock += dt;
    this.place();
    this.turnPop(dt);
  }

  /**
   * Play an icon once over the head. One that arrives while another plays is
   * dropped, and so is one for an Odd off the floor.
   */
  pop(icon: Pop) {
    if (this.popping || !this.visible) return;
    // An atlas compiled before the icon was drawn has no frames or meta for it: show nothing.
    const frames = this.floor.atlas.sheet.animations[`${POP}/${icon}`] as Texture[] | undefined;
    const meta = this.floor.atlas.catalog[POP] as SpriteMeta | undefined;
    if (!frames?.length || !meta) return;
    const sprite = new Sprite(frames[0]);
    sprite.zIndex = POP_Z;
    this.floor.objects.addChild(sprite);
    this.popping = { sprite, frames, meta, clock: 0 };
    this.turnPop(0);
  }

  /** How far the name tag rises, in world pixels, to sit above an icon while one plays. */
  get tagLift(): number {
    return this.popping ? this.popping.meta.height + POP_GAP : 0;
  }

  /**
   * Turn the icon's frame on the Odd's own clock, as its walk turns, and keep
   * it over the head. Asks for a draw only when that changed what shows, and
   * takes the icon off after its last frame.
   */
  private turnPop(dt: number) {
    const p = this.popping;
    if (!p) return;
    p.clock += dt;
    const tex = p.frames[Math.floor(p.clock * p.meta.fps)];
    if (!tex) return this.endPop();
    const s = p.sprite;
    const x = Math.round(this.head.x - p.meta.width / 2);
    const y = Math.round(this.head.y) - this.tagLift;
    if (s.x === x && s.y === y && s.texture === tex && s.tint === this.floor.nightTint) return;
    s.texture = tex;
    s.position.set(x, y);
    s.tint = this.floor.nightTint;
    this.floor.invalidate();
  }

  /** Take the icon off, if one plays. */
  private endPop() {
    if (!this.popping) return;
    this.popping.sprite.destroy();
    this.popping = undefined;
    this.floor.invalidate();
  }

  /** Put the sprite where the staffer is, and ask for a draw only if that changed what shows. */
  private place() {
    const s = this.sprite;
    const meta = this.floor.atlas.catalog[this.profile.sprite];
    const left = Math.round(this.x - TILE / 2);
    const x = s.scale.x < 0 ? left + meta.width : left;
    const y = Math.round(this.y) - meta.height;
    const tex = this.frameList[Math.floor(this.clock * this.fps) % this.frameList.length];
    // Sitting on a chair that faces away paints the chair back over the body.
    const z = Math.round(this.y) - (this.path.length === 0 ? 1 : 0);
    if (
      s.x === x &&
      s.y === y &&
      s.zIndex === z &&
      s.texture === tex &&
      s.tint === this.floor.nightTint
    )
      return;
    s.texture = tex;
    s.position.set(x, y);
    s.tint = this.floor.nightTint;
    this.shadow.position.set(Math.round(this.x), Math.round(this.y) - 1);
    s.zIndex = z;
    this.floor.invalidate();
  }

  /** Top-centre of the head, for the name tag. */
  get head(): { x: number; y: number } {
    const meta = this.floor.atlas.catalog[this.profile.sprite];
    return { x: this.x, y: this.y - meta.height + 2 };
  }

  destroy() {
    this.endPop();
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
