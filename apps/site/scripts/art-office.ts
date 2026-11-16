// The first stage of art.ts, not an entry point: the hero office, its crop and
// the helper that writes each file. art.ts runs the stages in order.
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng, type Image } from '@oddboro/sprites/png';
import { catalog, type Rect } from './paint.ts';
import {
  composeWorld,
  generateOffice,
  lotOf,
  TILE,
  type DrawCmd,
  type OfficeSpec
} from '@oddboro/world';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ART = join(ROOT, 'static', 'art');
const spec = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'hero-office.json'), 'utf8')
) as OfficeSpec;
const built = generateOffice(spec, catalog, 4);
if (built.problems.length || !built.world) {
  console.error(`Problems:\n- ${built.problems.join('\n- ')}`);
  process.exit(1);
}
const world = built.world;
const lot = lotOf(built.plan, built.templates);
const lotWorld = composeWorld(lot.plan, lot.templates, catalog);
if (world.missing.length) {
  console.error(`Missing sprites: ${world.missing.join(', ')}`);
  process.exit(1);
}

const W = world.width * TILE;
const H = world.height * TILE;
const areas = [...world.rooms, ...world.halls];
const indoors = areas.filter((a) => !a.outdoor);
const street = world.rooms.find((r) => r.id.startsWith('street#'))!;

/** Which indoor area a tile sits in, if any. */
const indoorAt = (tx: number, ty: number) =>
  indoors.find((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h)?.id;
const isIndoor = (id: string) => id === 'plan' || indoors.some((r) => r.id === id);

const rectOf = (d: DrawCmd): Rect => ({
  x: d.x,
  y: d.y,
  w: catalog[d.sprite].width,
  h: catalog[d.sprite].height
});

/** The building's draws sorted into floors, walls and props, each with its area. */
type Kind = 'floor' | 'wall' | 'prop';
const parts: Record<Kind, { d: DrawCmd; area: string }[]> = { floor: [], wall: [], prop: [] };
for (const d of world.draws) {
  const r = rectOf(d);
  const tx = Math.floor((r.x + r.w / 2) / TILE);
  const ty = Math.floor((r.y + r.h - 1) / TILE);
  let area = indoorAt(tx, ty);
  if (d.obj) {
    const of = d.obj.split('/')[0];
    if (!isIndoor(of)) continue;
    area = of === 'plan' ? (area ?? 'plan') : of;
  }
  if (!area) continue;
  const kind: Kind = d.obj ? 'prop' : d.pass === 0 ? 'floor' : 'wall';
  parts[kind].push({ d, area });
}

/** The crop: the building with a tile of air each side, and the street below it. */
const union = (rects: Rect[]): Rect => {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const building = union([...parts.floor, ...parts.wall, ...parts.prop].map((p) => rectOf(p.d)));
const crop: Rect = {
  x: building.x - TILE,
  y: building.y - TILE / 2,
  w: building.w + 2 * TILE,
  h: (street.y + street.h) * TILE - (building.y - TILE / 2)
};
const local = (r: Rect): Rect => ({ x: r.x - crop.x, y: r.y - crop.y, w: r.w, h: r.h });

mkdirSync(join(ART, 'day'), { recursive: true });
const write = (name: string, img: Image, dir = '') => {
  writeFileSync(join(ART, dir, name), encodePng(img));
  console.log(`static/art/${dir ? `${dir}/` : ''}${name} ${img.width}x${img.height}`);
};

export {
  ROOT,
  ART,
  world,
  lotWorld,
  W,
  H,
  indoors,
  rectOf,
  type Kind,
  parts,
  union,
  crop,
  local,
  write
};
