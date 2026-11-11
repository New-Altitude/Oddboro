// The first run: the office goes up on the owner's lot in front of them, once
// every piece drawn for it is in. The floor shows the building with every part
// hidden, then lays it in a beat at a time: chalk lines, the floors row by row
// from the front, the walls rising from their base, the furniture dropping into
// each room with its lamps coming on. A bus pulls up along the street, as one
// does for every hire after. Under reduced motion every beat is a cut.
import { Graphics, Sprite, type Container } from 'pixi.js';
import type { DrawCmd, World } from '@oddboro/world';
import type { Floor } from './engine.ts';

const TILE = 16;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run `fn` from 0 to 1 over `ms`, eased, drawing a frame each step. */
function tween(floor: Floor, ms: number, fn: (k: number) => void): Promise<void> {
  if (reduced() || ms <= 0) {
    fn(1);
    floor.invalidate();
    return Promise.resolve();
  }
  return new Promise((done) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(1 - (1 - t) ** 3);
      floor.invalidate();
      if (t < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}

const wait = (ms: number) =>
  reduced() ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms));

type Part = { d: DrawCmd; s: Sprite; e?: Sprite; y0: number; room?: string };
type Kind = 'floor' | 'wall' | 'prop';

/** Which room a tile sits in, if an indoor one does. */
function indoorAt(world: World, tx: number, ty: number): string | undefined {
  for (const r of [...world.rooms, ...world.halls])
    if (!r.outdoor && tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r.id;
  return undefined;
}

/** Whether a prop's room, from its id, is part of the building. */
const indoor = (world: World, room: string) =>
  room === 'plan' || [...world.rooms, ...world.halls].some((r) => r.id === room && !r.outdoor);

/** The building's parts, sorted into floors, walls and props. The street and grounds stay out. */
function partsOf(floor: Floor): Record<Kind, Part[]> {
  const { world, atlas } = floor;
  const out: Record<Kind, Part[]> = { floor: [], wall: [], prop: [] };
  world.draws.forEach((d, i) => {
    const made = floor.drawSprites[i];
    if (!made) return;
    const meta = atlas.catalog[d.sprite];
    const tx = Math.floor((d.x + meta.width / 2) / TILE);
    const ty = Math.floor((d.y + meta.height - 1) / TILE);
    let room = indoorAt(world, tx, ty);
    if (d.obj) {
      const of = d.obj.split('/')[0];
      if (!indoor(world, of)) return;
      // The plan's own props hang on the building: lamps by the door, shop windows.
      room = of === 'plan' ? (room ?? 'plan') : of;
    }
    if (!room) return;
    const kind: Kind = d.obj ? 'prop' : d.pass === 0 ? 'floor' : 'wall';
    out[kind].push({ d, s: made.s, e: made.e, y0: made.s.y, room });
  });
  return out;
}

const both = (p: Part, fn: (s: Sprite) => void) => {
  fn(p.s);
  if (p.e) fn(p.e);
};

/** Hide the building, so the lot looks empty until the reveal raises it. */
export function hideBuilding(floor: Floor): void {
  const parts = partsOf(floor);
  floor.showWindows(false);
  for (const p of [...parts.floor, ...parts.wall, ...parts.prop]) both(p, (s) => (s.alpha = 0));
  for (const l of floor.lightParts)
    if (l.obj && indoor(floor.world, l.obj.split('/')[0])) l.s.renderable = false;
  floor.invalidate();
}

/** Chalk the plan out on the ground: a dashed line round each room. */
function chalk(floor: Floor): Graphics {
  const g = new Graphics();
  const dash = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let t = 0; t < len; t += 5) {
      const a = t / len;
      const b = Math.min(1, (t + 3) / len);
      g.moveTo(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a).lineTo(
        x0 + (x1 - x0) * b,
        y0 + (y1 - y0) * b
      );
    }
  };
  for (const r of [...floor.world.rooms, ...floor.world.halls]) {
    if (r.outdoor) continue;
    const [x, y, w, h] = [r.x * TILE + 0.5, r.y * TILE + 0.5, r.w * TILE - 1, r.h * TILE - 1];
    dash(x, y, x + w, y);
    dash(x + w, y, x + w, y + h);
    dash(x + w, y + h, x, y + h);
    dash(x, y + h, x, y);
  }
  // Faint, like chalk on grass: a hint of the plan, not a drawing of it.
  g.stroke({ width: 0.5, color: 0xfbf6ea, alpha: 0.35 });
  g.alpha = 0;
  floor.stage.addChildAt(g, 1);
  return g;
}

/** The beats, in order, for the caption to name. */
export type Beat = 'chalk' | 'floors' | 'walls' | 'furniture' | 'done';

/** Raise the building that `hideBuilding` hid. */
export async function raise(floor: Floor, onBeat: (b: Beat) => void = () => {}): Promise<void> {
  const parts = partsOf(floor);
  const byRow = (list: Part[]) => {
    const rows = new Map<number, Part[]>();
    for (const p of list) {
      const row = Math.floor((p.d.y + floor.atlas.catalog[p.d.sprite].height - 1) / TILE);
      rows.set(row, [...(rows.get(row) ?? []), p]);
    }
    // Front to back: the rows nearest the street first.
    return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, ps]) => ps);
  };

  onBeat('chalk');
  const lines = chalk(floor);
  await tween(floor, 400, (k) => (lines.alpha = k));
  await wait(300);

  onBeat('floors');
  let pending: Promise<void>[] = [];
  for (const row of byRow(parts.floor)) {
    pending.push(tween(floor, 240, (k) => row.forEach((p) => both(p, (s) => (s.alpha = k)))));
    await wait(60);
  }
  await Promise.all(pending);

  onBeat('walls');
  pending = [];
  for (const row of byRow(parts.wall)) {
    pending.push(
      tween(floor, 300, (k) =>
        row.forEach((p) =>
          both(p, (s) => {
            // Rise from the base: grow upward, the bottom edge holding still.
            const h = s.texture.height;
            s.alpha = Math.min(1, k * 1.5);
            s.scale.y = 0.2 + 0.8 * k;
            s.y = p.y0 + h * (1 - s.scale.y);
          })
        )
      )
    );
    await wait(60);
  }
  await Promise.all(pending);
  // The walls stand: the windows fill with sky.
  floor.showWindows(true);
  await tween(floor, 300, (k) => (lines.alpha = 1 - k));
  lines.destroy();

  onBeat('furniture');
  const rooms = new Map<string, Part[]>();
  for (const p of parts.prop) rooms.set(p.room!, [...(rooms.get(p.room!) ?? []), p]);
  const top = (id: string) =>
    [...floor.world.rooms, ...floor.world.halls].find((r) => r.id === id)?.y ?? 0;
  for (const [room, list] of [...rooms.entries()].sort((a, b) => top(a[0]) - top(b[0]))) {
    pending = [];
    for (const p of list.sort((a, b) => a.d.y - b.d.y)) {
      pending.push(drop(floor, p));
      await wait(45);
    }
    await Promise.all(pending);
    for (const l of floor.lightParts) if (l.obj?.startsWith(`${room}/`)) l.s.renderable = true;
    floor.invalidate();
    await wait(80);
  }
  // Lamps on the building that belong to no room, like the sconces by the door.
  // The street's lamps were never put out: they keep to the daylight.
  for (const l of floor.lightParts)
    if (l.obj && indoor(floor.world, l.obj.split('/')[0])) l.s.renderable = true;
  onBeat('done');
}

/** One prop falling a tile into place. */
function drop(floor: Floor, p: Part): Promise<void> {
  return tween(floor, 160, (k) =>
    both(p, (s) => {
      s.alpha = k;
      s.y = p.y0 - TILE * (1 - k);
    })
  );
}

/** The bus that brings each new hire: drives up the street and stops at the shelter. */
export function bus(floor: Floor): {
  arrive(): Promise<void>;
  open(): void;
  leave(): Promise<void>;
  /** Gone at once, wherever it was: the owner skipped the arrival. */
  gone(): void;
} {
  const { world, atlas } = floor;
  const shelter = world.draws.find((d) => d.sprite === 'street-bus-shelter');
  const street = world.rooms.find((r) => r.id.startsWith('street#'));
  const tex = (frame: string) => atlas.sheet.textures[`street-bus/${frame}`];
  const s = new Sprite(tex('closed-0'));
  const meta = atlas.catalog['street-bus'];
  // The near lane: three rows of sidewalk and the curb, then the road.
  const lane = (street?.y ?? Math.floor((shelter?.y ?? 0) / TILE)) + 4;
  s.y = lane * TILE - (meta?.origin[1] ?? 24);
  s.zIndex = (lane + 1) * TILE;
  s.x = -(meta?.width ?? 80);
  s.tint = floor.nightTint;
  const stop = (shelter?.x ?? world.width * 4) - 8;
  (floor.objects as Container).addChild(s);
  let wheel = 0;
  let cut = false;
  const drive = (to: number, ms: number) => {
    const from = s.x;
    return tween(floor, ms, (k) => {
      if (cut) return;
      s.x = Math.round(from + (to - from) * k);
      wheel = (wheel + 1) % 8;
      s.texture = tex(wheel < 4 ? 'closed-0' : 'closed-1');
      s.tint = floor.nightTint;
    });
  };
  return {
    arrive: () => drive(stop, 2600),
    open: () => {
      if (cut) return;
      s.texture = tex('open-0');
      floor.invalidate();
    },
    leave: async () => {
      if (cut) return;
      await drive(world.width * TILE + 40, 2600);
      if (cut) return;
      cut = true;
      s.destroy();
      floor.invalidate();
    },
    gone: () => {
      if (cut) return;
      cut = true;
      s.destroy();
      floor.invalidate();
    }
  };
}
