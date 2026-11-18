// A stage of art.ts, not an entry point: the office scene file, with its walkers and errands.
import { mkdirSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { join } from 'node:path';
import { NIGHT, type Rect } from './paint.ts';
import { findPath, TILE, type PlacedSpot } from '@oddboro/world';
import {
  ROOT,
  world,
  indoors,
  rectOf,
  type Kind,
  parts,
  union,
  crop,
  local
} from './art-office.ts';
import { ROWS, FRAMES, bus, doorRect, lane } from './art-layers.ts';
import './art-render.ts';

// Where everything is, for the hero.
const bounds = (kind: Kind) => {
  const byArea = new Map<string, Rect[]>();
  for (const p of parts[kind]) byArea.set(p.area, [...(byArea.get(p.area) ?? []), rectOf(p.d)]);
  return [...byArea.entries()].map(([area, rects]) => ({ area, ...local(union(rects)) }));
};
const front = (a: { y: number; h: number }) => a.y + a.h;
const pieces = {
  // Front to back: the rows nearest the street first.
  floors: bounds('floor').sort((a, b) => front(b) - front(a)),
  walls: bounds('wall').sort((a, b) => front(b) - front(a)),
  // Back to front, the way the office furnishes.
  props: bounds('prop').sort((a, b) => a.y - b.y)
};

const toPx = ([tx, ty]: [number, number]): [number, number] => [
  tx * TILE - crop.x,
  ty * TILE - crop.y
];
const spot = (test: (s: PlacedSpot) => boolean) => {
  const s = world.spots.find(test);
  if (!s) throw new Error('no such spot');
  return s;
};
const reception = spot((s) => s.prop === 'lobby-reception');
const bench = spot((s) => s.activity === 'wait');
// The workspace's desks, west to east. Ada and Theo sit a desk apart so their bubbles clear.
const desks = world.spots
  .filter((s) => s.activity === 'work' && s.prop === 'desk')
  .sort((a, b) => a.tile[0] - b.tile[0]);
if (desks.length < 4) throw new Error('the hero office needs four desks');

const sidewalk = lane - 2;
const shelter = world.draws.find((d) => d.sprite === 'street-bus-shelter')!;
const stopX = shelter.x - 8;
const doorTile: [number, number] = [
  Math.floor((doorRect.x + doorRect.w / 2) / TILE),
  Math.floor((doorRect.y + doorRect.h - 1) / TILE)
];

/** A walk between spots, as pixel waypoints, leaving and entering the way the office does. */
function walk(
  from: [number, number],
  to: PlacedSpot,
  leave?: [number, number]
): [number, number][] {
  const path = findPath(world.walkable, world.width, from, to.tile, { enter: to.approach, leave });
  if (!path) throw new Error(`no path from ${from} to ${to.id}`);
  return path.map(toPx);
}

/** Props that stand in front of a seated Odd, to draw over them. */
function overlays(s: PlacedSpot): Rect[] {
  const [px, py] = toPx(s.tile);
  const body: Rect = { x: px, y: py - TILE, w: TILE, h: 2 * TILE };
  const z = s.tile[1] * TILE + TILE - 1;
  return world.draws
    .filter((d) => d.obj && d.pass > 0 && d.z > z)
    .map((d) => local(rectOf(d)))
    .filter(
      (r) =>
        r.x < body.x + body.w && r.x + r.w > body.x && r.y < body.y + body.h && r.y + r.h > body.y
    );
}

/**
 * Props a walking Odd passes, so it goes behind the ones that stand in front
 * of it on the way (the bus shelter, a desk). The page stacks each piece by
 * its bottom row against the Odd's, so a piece behind the Odd stays behind.
 */
function along(path: [number, number][]): Rect[] {
  return world.draws
    .filter((d) => d.obj && d.pass > 0)
    .map((d) => local(rectOf(d)))
    .filter((r) =>
      path.some(
        ([px, py]) => r.x < px + TILE && r.x + r.w > px && r.y < py + TILE && r.y + r.h > py - TILE
      )
    );
}

/** Every piece once. */
const merged = (...lists: Rect[][]): Rect[] => {
  const seen = new Map<string, Rect>();
  for (const r of lists.flat()) seen.set(`${r.x},${r.y},${r.w},${r.h}`, r);
  return [...seen.values()];
};

const poseOf = (s: PlacedSpot) => `${s.pose}-${s.facing}`;
/** Where an Odd steps off the bus: the sidewalk by its front door. */
const busDoor: [number, number] = [Math.floor((stopX + 56) / TILE), sidewalk];

// The story: two Odds are at their desks when the lamps come on, the Office
// Manager arrives on the bus and walks to reception, and one Odd gets up
// to wait at the owner's door with a question. The bubbles are the copy
// deck's; `ask` marks the one the owner has to answer.
const walkers = [
  {
    name: 'ada',
    role: 'Writer',
    from: 'here',
    path: [toPx(desks[0].tile)],
    pose: poseOf(desks[0]),
    bubble: 'Drafting the Friday report',
    ask: false,
    overlays: overlays(desks[0])
  },
  {
    name: 'theo',
    role: 'Researcher',
    from: 'here',
    path: [toPx(desks[3].tile)],
    pose: poseOf(desks[3]),
    bubble: 'Searching the ledger',
    ask: false,
    overlays: overlays(desks[3])
  },
  {
    name: 'marshall',
    role: 'Office Manager',
    from: 'bus',
    path: walk(busDoor, reception),
    pose: poseOf(reception),
    bubble: 'Back from lunch',
    ask: false,
    overlays: overlays(reception) as Rect[]
  },
  {
    name: 'juno',
    role: 'Planner',
    from: 'seat',
    seated: poseOf(desks[1]),
    path: walk(desks[1].tile, bench, desks[1].approach),
    pose: poseOf(bench),
    bubble: 'Waiting on your yes',
    ask: true,
    overlays: overlays(bench)
  }
];

// After the story, the office keeps living: now and then one of the settled
// Odds gets up, walks to a spot the office really has for reading, resting or
// play, stays a while under a bubble that says so, and walks back. Each trip
// out leaves the way the seat is left and each trip back enters it the same
// way, so the walk is the office's own. The Odd waiting on the owner stays.
const AWAY: Record<string, string> = {
  read: 'Looking something up',
  rest: 'Taking a break',
  play: 'Taking a break'
};
/** A spot's pose as a row the staff sheet has, and whether to mirror it. */
function rowOf(s: PlacedSpot): { pose: string; flip: boolean } {
  const dir = s.facing === 'up' || s.facing === 'down' ? s.facing : 'side';
  const base = s.pose === 'stand' ? 'idle' : s.pose;
  const pose = ROWS.includes(`${base}-${dir}`) ? `${base}-${dir}` : `idle-${dir}`;
  return { pose, flip: s.facing === 'left' };
}
const seats = [desks[0], desks[3], reception];
const errands = (seat: PlacedSpot) =>
  Object.keys(AWAY).flatMap((activity) => {
    const dest = world.spots.find((s) => s.activity === activity);
    if (!dest) return [];
    try {
      return [
        {
          out: walk(seat.tile, dest, seat.approach),
          back: walk(dest.tile, seat, dest.approach),
          ...rowOf(dest),
          bubble: AWAY[activity],
          overlays: overlays(dest)
        }
      ];
    } catch {
      return [];
    }
  });
seats.forEach((seat, i) => Object.assign(walkers[i], { errands: errands(seat) }));
// The page draws only a walker's own pieces, so each takes the pieces of its
// walk, its errands' walks and their destinations too.
for (const w of walkers as ((typeof walkers)[number] & { errands?: ReturnType<typeof errands> })[])
  w.overlays = merged(
    w.overlays,
    along(w.path),
    ...(w.errands ?? []).flatMap((e) => [e.overlays, along(e.out), along(e.back)])
  );

const scene = {
  hour: NIGHT,
  tile: TILE,
  width: crop.w,
  height: crop.h,
  areas: indoors.map((a) => ({
    id: a.id,
    name: a.name,
    ...local({ x: a.x * TILE, y: a.y * TILE, w: a.w * TILE, h: a.h * TILE })
  })),
  pieces,
  door: { ...local(doorRect), tile: toPx(doorTile) },
  bus: {
    w: bus.width,
    h: bus.height,
    y: lane * TILE - bus.origin[1] - crop.y,
    stop: stopX - crop.x
  },
  staff: { w: 16, h: 32, rows: ROWS, frames: FRAMES },
  walkers
};
const sceneFile = join(ROOT, 'src', 'lib', 'hero', 'scene.json');
mkdirSync(join(ROOT, 'src', 'lib', 'hero'), { recursive: true });
const config = (await prettier.resolveConfig(sceneFile)) ?? {};
writeFileSync(
  sceneFile,
  await prettier.format(JSON.stringify(scene), { ...config, parser: 'json', filepath: sceneFile })
);
console.log(
  `src/lib/hero/scene.json: ${crop.w}x${crop.h}, ${walkers.length} walkers, ${walkers.reduce((n, w) => n + ((w as { errands?: unknown[] }).errands?.length ?? 0), 0)} errands`
);

export { config };
