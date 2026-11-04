// Produces the site's art from the office's own packages, so the hero shows
// a real office and the site build never touches the renderer. The office is
// the one in scripts/hero-office.json, built the way a new owner's is, by
// generateOffice from a spec.
//
//   node scripts/art.ts        writes static/art/*.png (night), static/art/day/*.png,
//                              static/art/releases/ (release-art.ts),
//                              src/lib/hero/scene.json and src/lib/vignettes.json
//
// The hero stacks the output: the lot, then the building's floors, walls and
// props unlit, then the whole scene lit, with the bus and the Odds on top.
// scene.json carries where everything is, in pixels of the crop. Every image
// that depends on the hour is rendered twice, at night (lamps on) and at
// midday (lamps off), and the page picks a set by theme. Portraits, walks and
// the Open Graph card are rendered once.
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { join } from 'node:path';
import { loadSprites } from '@oddboro/sprites/load';
import {
  hexToRgba,
  renderFrame,
  spriteMeta,
  type Palette,
  type SpriteDef
} from '@oddboro/sprites/px';
import { createImage, drawImage, encodePng, scaleImage, type Image } from '@oddboro/sprites/png';
import { writeReleaseArt, type DeskLayers } from './release-art.ts';
import {
  loadLibrary,
  lookFrame,
  LOOKS_ROOT,
  portraitImage,
  type LookSpec
} from '@oddboro/sprites/look';
import {
  BLOOM_REACH,
  bloomAlpha,
  composeWorld,
  findPath,
  generateOffice,
  glowAlpha,
  glowFalloff,
  INDOOR_GLOW,
  lotOf,
  nightTint,
  skyAt,
  TILE,
  type DrawCmd,
  type OfficeSpec,
  type PlacedSpot,
  type SpriteCatalog,
  type World
} from '@oddboro/world';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ART = join(ROOT, 'static', 'art');
const NIGHT = 21;
const DAY = 13;

type Rect = { x: number; y: number; w: number; h: number };

const { palette, sprites, errors } = loadSprites();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const catalog: SpriteCatalog = Object.fromEntries(
  [...sprites.values()].map((d) => [d.name, spriteMeta(d, palette)])
);
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

// Rendering, the way scripts/render.ts in the world package does it.
const frameImage = (() => {
  const cache = new Map<string, Image>();
  return (def: SpriteDef, frame: string, variant?: string, emissiveOnly = false): Image => {
    const key = `${def.name}@${variant ?? ''}/${frame}${emissiveOnly ? '~e' : ''}`;
    let img = cache.get(key);
    if (!img) {
      const f = def.frames.find((x) => x.name === frame) ?? def.frames[0];
      const v = variant ? def.variants.find((x) => x.name === variant)?.map : undefined;
      img = renderFrame(def, f, palette, v, emissiveOnly);
      cache.set(key, img);
    }
    return img;
  };
})();

function cropTo(img: Image, r: Rect): Image {
  const out = createImage(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    const sy = r.y + y;
    if (sy < 0 || sy >= img.height) continue;
    const x0 = Math.max(0, r.x);
    const x1 = Math.min(img.width, r.x + r.w);
    if (x1 <= x0) continue;
    out.data.set(
      img.data.subarray((sy * img.width + x0) * 4, (sy * img.width + x1) * 4),
      (y * r.w + (x0 - r.x)) * 4
    );
  }
  return out;
}

/** Painting and lighting at one hour of the day. */
function lighting(hour: number) {
  const tint = nightTint(hour);
  const mean = (t: number[]) => (t[0] + t[1] + t[2]) / 3;
  // How much of a lamp's warmth a thing above the lit layer should catch:
  // all of it at night, none at midday, when the lamps are off.
  const warmth = Math.max(0, 1 - mean(tint)) / (1 - mean(nightTint(NIGHT)));

  /** Paint a list of draws on a transparent canvas, with the sky behind each window. */
  function paint(draws: DrawCmd[], opaque: boolean, width = W, height = H): Image {
    const canvas = createImage(width, height);
    if (opaque)
      for (let i = 0; i < width * height; i++) canvas.data.set(hexToRgba('#0d0f1a'), i * 4);
    const [skyTop, skyBottom] = skyAt(hour);
    for (const d of draws) {
      const def = sprites.get(d.sprite)!;
      if (def.tags.includes('window'))
        for (let y = 0; y < def.height; y++) {
          const t = y / def.height;
          const c = skyTop.map((v, i) => Math.round(v + (skyBottom[i] - v) * t));
          for (let x = 0; x < def.width; x++)
            canvas.data.set([c[0], c[1], c[2], 255], ((d.y + y) * width + d.x + x) * 4);
        }
      drawImage(canvas, frameImage(def, d.frame, d.variant), d.x, d.y, d.flip);
    }
    return canvas;
  }

  /**
   * Every pixel wears the hour's tint. Alpha stays as it was. `lamp` adds the
   * warm light a thing standing under a lamp would catch, since the Odds and
   * the bus sit above the lit layer and get none of its glow.
   */
  function shade(img: Image, lamp = 0): Image {
    const warm = [0.2, 0.17, 0.1];
    for (let i = 0; i < img.width * img.height; i++)
      for (let ch = 0; ch < 3; ch++)
        img.data[i * 4 + ch] = Math.round(
          Math.min(255, img.data[i * 4 + ch] * (tint[ch] + lamp * warmth * warm[ch]))
        );
    return img;
  }

  /** The tint, then each lamp's glow and bloom cut to its room, then the emissive pixels. */
  function light(img: Image, w: World, draws: DrawCmd[]): Image {
    const { width: iw, height: ih } = img;
    const add = new Float32Array(iw * ih * 3);
    const bloom = bloomAlpha(hour);
    for (const l of w.lights) {
      const [lr, lg, lb] = hexToRgba(l.color);
      const glow = glowAlpha(l.intensity, hour, l.outdoor);
      const lampBloom = bloom * (l.outdoor ? 1 : INDOOR_GLOW);
      const r = l.radius;
      const c = l.clip ?? { x: 0, y: 0, w: iw, h: ih };
      const y0 = Math.max(c.y, Math.floor(l.y - r));
      const y1 = Math.min(c.y + c.h, ih, l.y + r);
      const x0 = Math.max(c.x, Math.floor(l.x - r));
      const x1 = Math.min(c.x + c.w, iw, l.x + r);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const d = Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y);
          const f = glow * glowFalloff(d / r) + lampBloom * glowFalloff(d / (r * BLOOM_REACH));
          if (f <= 0) continue;
          const i = (y * iw + x) * 3;
          add[i] += (lr / 255) * f;
          add[i + 1] += (lg / 255) * f;
          add[i + 2] += (lb / 255) * f;
        }
    }
    for (let i = 0; i < iw * ih; i++)
      for (let ch = 0; ch < 3; ch++) {
        const base = img.data[i * 4 + ch] / 255;
        img.data[i * 4 + ch] = Math.round(Math.min(1, base * tint[ch] + add[i * 3 + ch]) * 255);
      }
    for (const d of draws) {
      if (!catalog[d.sprite].emissive) continue;
      drawImage(
        img,
        frameImage(sprites.get(d.sprite)!, d.frame, d.variant, true),
        d.x,
        d.y,
        d.flip
      );
    }
    return img;
  }

  return { paint, shade, light };
}

mkdirSync(join(ART, 'day'), { recursive: true });
const write = (name: string, img: Image, dir = '') => {
  writeFileSync(join(ART, dir, name), encodePng(img));
  console.log(`static/art/${dir ? `${dir}/` : ''}${name} ${img.width}x${img.height}`);
};

// Odd sheets: one row per animation, four frames wide.
const STAFF: { name: string; sprite: string; variant: string }[] = [
  { name: 'marshall', sprite: 'staff', variant: 'marshall' },
  { name: 'ada', sprite: 'staff-b', variant: 'ada' },
  { name: 'theo', sprite: 'staff', variant: 'theo' },
  { name: 'juno', sprite: 'staff', variant: 'juno' }
];
const ROWS = [
  'walk-side',
  'walk-up',
  'walk-down',
  'idle-side',
  'idle-up',
  'idle-down',
  'sit-up',
  'sit-down'
];
const FRAMES = 4;
const bus = sprites.get('street-bus')!;
const doorDraw = world.draws.find((d) => d.sprite === 'street-front-door')!;
const openDraws = world.draws.map((d) => (d === doorDraw ? { ...d, frame: 'open' } : d));
const doorRect = rectOf(doorDraw);

// The floor states, as vignettes cut from a second office that has a mail
// room: an Odd at a desk, at the sorting table, in an armchair, at the
// lobby's reception desk, on the bench outside the owner's door, and at the
// owner's own desk in a chat. Each is three layers of the same size, so the
// page stacks them with no arithmetic: the lit room, the Odd, and the
// furniture that stands in front of the Odd.
const vSpec = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'vignette-office.json'), 'utf8')
) as OfficeSpec;
const vBuilt = generateOffice(vSpec, catalog, 4);
if (vBuilt.problems.length || !vBuilt.world) {
  console.error(`Vignette problems:\n- ${vBuilt.problems.join('\n- ')}`);
  process.exit(1);
}
const vWorld = vBuilt.world;
const VW = vWorld.width * TILE;
const VH = vWorld.height * TILE;
const V = { w: 8 * TILE, h: 6 * TILE };
const VIGNETTES: {
  id: string;
  staff: (typeof STAFF)[number];
  spot: (s: PlacedSpot) => boolean;
  /**
   * The bench stands in the hall, which is three tiles of floor between two
   * walls: a crop six tiles tall cannot stay inside it, so it is not checked.
   */
  hall?: true;
  /** The one animated prop the card plays beside the Odd, when it is in the crop. */
  prop?: string;
  /** A tempo from the office's range, 0.8 to 1.2, in place of the one hashed from the name. */
  beat?: number;
  /** Dust in the window light, by day, the way the office drifts it. */
  dust?: true;
}[] = [
  { id: 'desk', staff: STAFF[1], spot: (s) => s.activity === 'work' && s.prop === 'desk' },
  // The mail printer stands at the crop's left edge, eight pixels of it, and
  // its blink changes one of them: the mail card plays the Odd only.
  { id: 'mail', staff: STAFF[3], spot: (s) => s.activity === 'intake' },
  { id: 'library', staff: STAFF[2], spot: (s) => s.activity === 'read', prop: 'library-fireplace' },
  {
    id: 'reception',
    staff: STAFF[1],
    spot: (s) => s.activity === 'work' && s.room.startsWith('lobby')
  },
  // The calm card: Marshall breathes at the slowest tempo the office gives anyone.
  { id: 'door', staff: STAFF[0], spot: (s) => s.activity === 'wait', hall: true, beat: 0.8 },
  { id: 'chat', staff: STAFF[2], spot: (s) => s.activity === 'talk', dust: true }
];

/**
 * Opaque pixels inside a crop that come from outside a room: another room's
 * props, or a floor or wall tile that is not the room's own floor or back wall.
 * A tile is the one a draw stands on, its bottom row. Zero means the crop shows
 * only the room's interior to every edge.
 */
function outsideRoom(room: string, r: Rect): number {
  const a = vWorld.rooms.find((x) => x.id === room);
  if (!a) return Infinity;
  let n = 0;
  for (const d of vWorld.draws) {
    const pr = rectOf(d);
    if (pr.x >= r.x + r.w || pr.x + pr.w <= r.x || pr.y >= r.y + r.h || pr.y + pr.h <= r.y)
      continue;
    const tx = Math.floor(pr.x / TILE);
    const ty = Math.floor((pr.y + pr.h - 1) / TILE);
    const inside = d.obj
      ? d.obj.split('/')[0] === room
      : tx > a.x && tx < a.x + a.w - 1 && ty >= a.y && ty < a.y + a.h - 1;
    if (inside) continue;
    const mask = frameImage(sprites.get(d.sprite)!, d.frame, d.variant);
    for (let y = Math.max(0, r.y - pr.y); y < Math.min(pr.h, r.y + r.h - pr.y); y++)
      for (let x = Math.max(0, r.x - pr.x); x < Math.min(pr.w, r.x + r.w - pr.x); x++)
        if (mask.data[(y * pr.w + (d.flip ? pr.w - 1 - x : x)) * 4 + 3]) n++;
  }
  return n;
}

const vignettes = VIGNETTES.map((v) => {
  const found = vWorld.spots.filter(v.spot);
  if (!found.length) throw new Error(`no spot for the ${v.id} vignette`);
  const crops = found.map((s) => {
    const [tx, ty] = s.tile;
    const pose =
      s.activity === 'read' && s.facing === 'down' ? 'read' : s.pose === 'stand' ? 'idle' : s.pose;
    const frame = `${pose}-${s.facing}-0`;
    // The Odd's visible pixels sit dead centre in the crop, whatever the pose.
    const img = frameImage(sprites.get(v.staff.sprite)!, frame, v.staff.variant);
    let [x0, y0, x1, y1] = [img.width, img.height, -1, -1];
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        if (img.data[(y * img.width + x) * 4 + 3]) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    const sx = tx * TILE;
    const sy = ty * TILE - TILE;
    const r: Rect = {
      x: Math.round(sx + (x0 + x1 + 1) / 2 - V.w / 2),
      y: Math.round(sy + (y0 + y1 + 1) / 2 - V.h / 2),
      ...V
    };
    const at = { x: sx - r.x, y: sy - r.y };
    // The top of the head, centred on the visible pixels: where a bubble points.
    const head = { x: at.x + (x0 + x1 + 1) / 2, y: at.y + y0 };
    return { s, r, frame, at, head, outside: v.hall ? 0 : outsideRoom(s.room, r) };
  });
  // The first spot whose crop stays inside its room.
  const c = crops.find((x) => x.outside === 0);
  if (!c)
    throw new Error(
      `the ${v.id} vignette shows outside its room at every spot: ${crops
        .map((x) => `${x.s.tile.join(',')} ${x.outside}px`)
        .join('; ')}. Give the spot more room in scripts/vignette-office.json`
    );
  // The card plays the pose the office plays there, every frame of it, at
  // the Odd's own tempo: the office's 4 fps times a beat hashed from the
  // id (the office hashes the Odd's id; here that is the name).
  const pose = c.frame.replace(/-0$/, '');
  const def = sprites.get(v.staff.sprite)!;
  const frames: string[] = [];
  for (let i = 0; def.frames.some((f) => f.name === `${pose}-${i}`); i++)
    frames.push(`${pose}-${i}`);
  let h = 2166136261;
  for (const ch of v.staff.name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const beat = v.beat ?? 0.8 + ((h >>> 0) % 401) / 1000;
  // The animated prop, if one stands in the crop: its frames from the one
  // drawn, at the prop's own fps.
  const pd = v.prop
    ? vWorld.draws.find((d) => {
        if (d.sprite !== v.prop) return false;
        const pr = rectOf(d);
        return (
          pr.x < c.r.x + c.r.w && pr.x + pr.w > c.r.x && pr.y < c.r.y + c.r.h && pr.y + pr.h > c.r.y
        );
      })
    : undefined;
  if (v.prop && !pd) console.log(`the ${v.id} vignette: no ${v.prop} in the crop, Odd only`);
  let prop: { d: DrawCmd; frames: string[]; fps: number } | undefined;
  if (pd) {
    const m = /^(.*)-(\d+)$/.exec(pd.frame)!;
    const all = catalog[pd.sprite].frames.filter((f) => f.startsWith(`${m[1]}-`));
    const at = all.indexOf(pd.frame);
    prop = {
      d: pd,
      frames: all.map((_, i) => all[(at + i) % all.length]),
      fps: catalog[pd.sprite].fps
    };
  }
  return {
    ...v,
    tile: c.s.tile,
    r: c.r,
    frame: c.frame,
    at: c.at,
    head: c.head,
    frames,
    fps: Math.round(4 * beat * 100) / 100,
    animProp: prop
  };
});

/** Every image the hour changes: one set per theme. Returns the lit scene. */
function renderSet(hour: number, dir: string): Image {
  const { paint, shade, light } = lighting(hour);
  const lit = light(paint(world.draws, true), world, world.draws);

  write('lot.png', cropTo(light(paint(lotWorld.draws, true), lotWorld, lotWorld.draws), crop), dir);
  for (const kind of ['floor', 'wall', 'prop'] as const)
    write(
      `${kind}s.png`,
      cropTo(
        shade(
          paint(
            parts[kind].map((p) => p.d),
            false
          )
        ),
        crop
      ),
      dir
    );
  write('lit.png', cropTo(lit, crop), dir);
  // The standing props alone, lit, with each one's own alpha: an Odd behind a
  // prop shows through its glass and its gaps, and hides only behind what is
  // solid. The page stacks pieces of this layer over a walking Odd.
  const standing = paint(
    world.draws.filter((d) => d.obj && d.pass > 0),
    false
  );
  const pieces = createImage(lit.width, lit.height);
  for (let i = 0; i < lit.width * lit.height; i++) {
    const a = standing.data[i * 4 + 3];
    if (a) pieces.data.set([lit.data[i * 4], lit.data[i * 4 + 1], lit.data[i * 4 + 2], a], i * 4);
  }
  write('pieces.png', cropTo(pieces, crop), dir);
  write('door-open.png', cropTo(light(paint(openDraws, true), world, openDraws), doorRect), dir);

  for (const s of STAFF) {
    const def = sprites.get(s.sprite)!;
    const sheet = createImage(FRAMES * def.width, ROWS.length * def.height);
    ROWS.forEach((row, r) => {
      for (let f = 0; f < FRAMES; f++) {
        const name = `${row}-${f}`;
        if (!def.frames.some((x) => x.name === name)) continue;
        drawImage(sheet, frameImage(def, name, s.variant), f * def.width, r * def.height);
      }
    });
    write(`${s.name}.png`, shade(sheet, 1), dir);
  }

  // The bus: closed with the wheels in two positions, then the door open.
  const busSheet = createImage(3 * bus.width, bus.height);
  ['closed-0', 'closed-1', 'open-0'].forEach((f, i) =>
    drawImage(busSheet, frameImage(bus, f), i * bus.width, 0)
  );
  write('bus.png', shade(busSheet, 1), dir);

  // The same bus in two layers, for the one by What happens next: the body
  // lifts over a bump while the wheels stay on the road. The wheels layer is
  // each wheel's 12 by 9 disc (its top two rows sit inside the arch) and the
  // shadow under the bus; the body is every other pixel. Stacked at rest they
  // are bus.png's first frame to the pixel. The sprite's closed-0 and closed-1
  // are the same pixels, so the second wheel frame is the first mirrored,
  // which moves each tread mark to the other diagonal: the wheel turns.
  const BUS_WHEELS = [12, 58];
  const isWheel = (x: number, y: number) =>
    y >= 38 || (y >= 29 && BUS_WHEELS.some((w) => x >= w && x < w + 12));
  const busBody = createImage(bus.width, bus.height);
  const busWheels = createImage(2 * bus.width, bus.height);
  for (let y = 0; y < bus.height; y++)
    for (let x = 0; x < bus.width; x++) {
      const from = (y * busSheet.width + x) * 4;
      const px = busSheet.data.subarray(from, from + 4);
      if (!isWheel(x, y)) {
        busBody.data.set(px, (y * bus.width + x) * 4);
        continue;
      }
      busWheels.data.set(px, (y * busWheels.width + x) * 4);
      const w = BUS_WHEELS.find((w) => x >= w && x < w + 12);
      const mx = w === undefined ? x : 2 * w + 11 - x;
      busWheels.data.set(px, (y * busWheels.width + bus.width + mx) * 4);
    }
  write('bus-body.png', busBody, dir);
  write('bus-wheels.png', busWheels, dir);

  const vLit = light(paint(vWorld.draws, true, VW, VH), vWorld, vWorld.draws);
  let desk: DeskLayers | undefined;
  for (const v of vignettes) {
    const [tx, ty] = v.tile;
    const def = sprites.get(v.staff.sprite)!;
    // Props drawn after the Odd's row, and over their body, go on the front layer.
    const z = ty * TILE + TILE - 1;
    const body: Rect = { x: tx * TILE, y: ty * TILE - TILE, w: TILE, h: 2 * TILE };
    const front = createImage(V.w, V.h);
    for (const d of vWorld.draws) {
      if (!d.obj || d.pass === 0 || d.z <= z) continue;
      const pr = rectOf(d);
      if (
        pr.x >= body.x + body.w ||
        pr.x + pr.w <= body.x ||
        pr.y >= body.y + body.h ||
        pr.y + pr.h <= body.y
      )
        continue;
      const cut = cropTo(vLit, pr);
      const mask = frameImage(sprites.get(d.sprite)!, d.frame, d.variant);
      for (let y = 0; y < pr.h; y++)
        for (let x = 0; x < pr.w; x++) {
          const mx = d.flip ? pr.w - 1 - x : x;
          if (mask.data[(y * pr.w + mx) * 4 + 3] === 0) continue;
          const fx = pr.x + x - v.r.x;
          const fy = pr.y + y - v.r.y;
          if (fx < 0 || fy < 0 || fx >= V.w || fy >= V.h) continue;
          front.data.set(
            cut.data.subarray((y * pr.w + x) * 4, (y * pr.w + x) * 4 + 4),
            (fy * V.w + fx) * 4
          );
        }
    }
    write(`vignette-${v.id}.png`, cropTo(vLit, v.r), dir);
    write(`vignette-${v.id}-front.png`, front, dir);
    // The Odd's pose as a strip, every frame side by side: frame 0 is the
    // still the card rests on.
    const staffAnim = createImage(V.w * v.frames.length, V.h);
    v.frames.forEach((f, i) =>
      drawImage(staffAnim, shade(frameImage(def, f, v.staff.variant), 1), i * V.w + v.at.x, v.at.y)
    );
    write(`vignette-${v.id}-staff-anim.png`, staffAnim, dir);
    // The releases page builds art on the desk.
    if (v.id === 'desk')
      desk = {
        room: cropTo(vLit, v.r),
        front,
        odd: v.frames.map((f) => {
          const img = createImage(V.w, V.h);
          drawImage(img, shade(frameImage(def, f, v.staff.variant), 1), v.at.x, v.at.y);
          return img;
        }),
        shade: (img) => shade(img, 1)
      };
    // The prop's frames, lit, as a strip of only the pixels each frame
    // changes against the room: frame 0 is empty, so the room shows through.
    if (v.animProp) {
      const { d: pd, frames } = v.animProp;
      const rest = cropTo(vLit, v.r);
      const propAnim = createImage(V.w * frames.length, V.h);
      frames.forEach((f, i) => {
        if (!i) return;
        const draws = vWorld.draws.map((d) => (d === pd ? { ...d, frame: f } : d));
        const img = cropTo(light(paint(draws, true, VW, VH), vWorld, draws), v.r);
        for (let p = 0; p < V.w * V.h; p++) {
          const a = img.data.subarray(p * 4, p * 4 + 4);
          const b = rest.data.subarray(p * 4, p * 4 + 4);
          if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
          const x = p % V.w;
          const y = Math.floor(p / V.w);
          propAnim.data.set(a, (y * propAnim.width + i * V.w + x) * 4);
        }
      });
      write(`vignette-${v.id}-prop-anim.png`, propAnim, dir);
    }
    // By day the office drifts five motes of dust in each window's sunlight:
    // one pixel each, from the window's foot up to 36 pixels into the room,
    // at 0.25 to 0.6 alpha. The page lifts the layer a few pixels as it plays.
    if (v.dust && dir === 'day') {
      const dust = createImage(V.w, V.h);
      let seed = 7;
      const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % 10000) / 10000;
      for (const d of vWorld.draws) {
        if (!sprites.get(d.sprite)!.tags.includes('window')) continue;
        const { width: ww, height: wh } = catalog[d.sprite];
        for (let i = 0; i < 5; i++) {
          const x = Math.round(d.x + 2 + rand() * (ww + 10)) - v.r.x;
          const y = Math.round(d.y + wh + rand() * 36) - v.r.y;
          const a = Math.round(255 * (0.25 + 0.35 * rand()));
          if (x < 0 || y < 0 || x >= V.w || y >= V.h) continue;
          dust.data.set([...hexToRgba('#fff4dc').slice(0, 3), a], (y * V.w + x) * 4);
        }
      }
      write(`vignette-${v.id}-dust.png`, dust, dir);
    }
  }

  // The releases page's art, once per theme like the rest: night in
  // static/art/releases/, day in static/art/day/releases/. The desk comes from
  // the vignettes; the front door is the hero building's own, shut, with the
  // sidewalk below it, and Ada (the desk's Odd) to walk into it.
  if (!desk) throw new Error('the releases art needs the desk vignette');
  const doorAt: Rect = {
    x: Math.round(doorRect.x + doorRect.w / 2 - 64),
    y: doorRect.y + doorRect.h + 48 - 96,
    w: 128,
    h: 96
  };
  const ada = STAFF[1];
  writeReleaseArt(
    {
      desk,
      door: {
        room: cropTo(lit, doorAt),
        door: { ...doorRect, x: doorRect.x - doorAt.x, y: doorRect.y - doorAt.y },
        odd: (frame) => {
          const src = frameImage(sprites.get(ada.sprite)!, frame, ada.variant);
          const img = createImage(src.width, src.height);
          drawImage(img, src, 0, 0);
          return shade(img, 1);
        }
      }
    },
    join(ART, dir, 'releases'),
    dir === 'day' ? 'day' : 'night',
    join(ART, 'releases')
  );
  return lit;
}

const nightLit = renderSet(NIGHT, '');
renderSet(DAY, 'day');

// The Open Graph card: the front of the building and the street at night, at twice the size.
const og = { w: 600, h: 315 };
const ogAt: Rect = {
  x: doorRect.x + doorRect.w / 2 - og.w / 2,
  y: doorRect.y + doorRect.h + 2 * TILE - og.h,
  ...og
};
write('og.png', scaleImage(cropTo(nightLit, ogAt), 2));

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

// The near lane is the first row of road; Odds step off onto the sidewalk above the curb.
const lane = Math.min(
  ...world.draws.filter((d) => d.sprite.startsWith('floor-asphalt')).map((d) => d.y / TILE)
);
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

// The four Office Managers for the cards: a portrait each, and four frames of
// their walk, in daylight. Marshall's portrait is hand drawn in the main
// palette; the other three are drawn looks, painted the way the office paints
// them. Their looks are copied from packages/ledger/src/managers.ts, which the
// site build never loads, so keep scripts/manager-looks.json in step with it.
const lib = loadLibrary();
const looks = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'manager-looks.json'), 'utf8')
) as Record<string, LookSpec>;
const WALK = ['walk-down-0', 'walk-down-1', 'walk-down-2', 'walk-down-3'];

// Each manager's portrait also gets a blink frame, for the card's hover. No
// portrait is drawn with its eyes shut, so the frame is derived from the open
// one: every portrait draws each eye from the same six by three template, a
// lid line of ink over two rows of paper white (=) around the iris. The eyes
// are found as the two clusters of = that are four wide and two tall (a white
// collar is bigger), and each eye box is repainted as a closed lid: skin (f)
// where the white and the lid line were, with a lash line of ink (k) curving
// down, at the box's two ends on the middle row and across the four inner
// cells of the bottom row. The Odd portraits paint skin in their own
// letter, so they name it (Ada d, Theo b; Juno shares Marshall's f).
function blinkRows(rows: string[], who: string, skin = 'f'): string[] {
  const cells: [number, number][] = [];
  rows.forEach((r, y) => [...r].forEach((c, x) => c === '=' && cells.push([x, y])));
  const clusters: [number, number][][] = [];
  for (const cell of cells) {
    const near = clusters.find((cl) =>
      cl.some(([x, y]) => Math.abs(x - cell[0]) <= 2 && Math.abs(y - cell[1]) <= 2)
    );
    if (near) near.push(cell);
    else clusters.push([cell]);
  }
  const eyes = clusters
    .map((cl) => {
      const xs = cl.map(([x]) => x);
      const ys = cl.map(([, y]) => y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    })
    .filter((b) => b.x1 - b.x0 === 3 && b.y1 - b.y0 === 1);
  if (eyes.length !== 2) throw new Error(`portrait-${who}: found ${eyes.length} eyes, not 2`);
  const grid = rows.map((r) => [...r]);
  for (const { x0, x1, y0, y1 } of eyes) {
    for (let x = x0; x <= x1; x++) {
      grid[y0 - 1][x] = skin;
      grid[y0][x] = skin;
      grid[y1][x] = 'k';
    }
    for (const x of [x0 - 1, x1 + 1]) {
      grid[y0 - 1][x] = skin;
      grid[y0][x] = 'k';
    }
  }
  return grid.map((r) => r.join(''));
}
/** The same portrait .px with its default frame's eyes shut. */
function blinkPx(px: string, who: string): string {
  const lines = px.split('\n');
  const at = lines.findIndex((l) => l.trim() === 'frame default') + 1;
  lines.splice(at, 48, ...blinkRows(lines.slice(at, at + 48), who));
  return lines.join('\n');
}

for (const who of ['marshall', 'ada', 'theo', 'juno'])
  write(`portrait-${who}.png`, frameImage(sprites.get(`portrait-${who}`)!, 'default'));
{
  const def = sprites.get('portrait-marshall')!;
  const f = def.frames.find((x) => x.name === 'default')!;
  write(
    'portrait-marshall-blink.png',
    renderFrame(def, { ...f, rows: blinkRows(f.rows, 'marshall') }, palette)
  );
}
// Marshall pointing, for the build /releases/ picks for this computer: his
// side frame from the staff sprite, facing right, with the near arm raised
// straight out from the shoulder in place of hanging at his side.
{
  const def = sprites.get('staff')!;
  const f = def.frames.find((x) => x.name === 'idle-side-0')!;
  const arm = [
    '.....kzzzzzk....',
    '....kzzzzzzzkkk.',
    '....kzzzzzzzzzfk',
    '....kzzzzzzzkkk.',
    '....kzzzzzZzk...',
    '....kZzzzzZzk...',
    '....kZZzzZZZk...',
    '....kZZZZZZZk...',
    '....kkkkkkkkk...'
  ];
  const rows = [...f.rows.slice(0, 15), ...arm, ...f.rows.slice(15 + arm.length)];
  const marshall = def.variants.find((v) => v.name === 'marshall')!.map;
  write('point-marshall.png', renderFrame(def, { ...f, rows }, palette, marshall));
}
// The Odds blink too, in Access's mock tab (Juno) and on Hire's job card.
for (const [who, skin] of [
  ['ada', 'd'],
  ['theo', 'b'],
  ['juno', 'f']
]) {
  const def = sprites.get(`portrait-${who}`)!;
  const f = def.frames.find((x) => x.name === 'default')!;
  write(
    `portrait-${who}-blink.png`,
    renderFrame(def, { ...f, rows: blinkRows(f.rows, who, skin) }, palette)
  );
}
{
  const staffDef = sprites.get('staff')!;
  const strip = createImage(WALK.length * staffDef.width, staffDef.height);
  WALK.forEach((f, i) => drawImage(strip, frameImage(staffDef, f, 'marshall'), i * 16, 0));
  write('walk-marshall.png', strip);
}
for (const [id, look] of Object.entries(looks)) {
  const px = readFileSync(join(LOOKS_ROOT, 'managers', `${id}.px`), 'utf8');
  write(`portrait-${id}.png`, portraitImage(lib, look, px));
  write(`portrait-${id}-blink.png`, portraitImage(lib, look, blinkPx(px, id)));
  const strip = createImage(WALK.length * 16, 32);
  WALK.forEach((f, i) => drawImage(strip, lookFrame(lib, look, f), i * 16, 0));
  write(`walk-${id}.png`, strip);
}

const vFile = join(ROOT, 'src', 'lib', 'vignettes.json');
writeFileSync(
  vFile,
  await prettier.format(
    JSON.stringify({
      w: V.w,
      h: V.h,
      items: vignettes.map((v) => ({
        id: v.id,
        name: v.staff.name,
        staff: v.at,
        head: v.head,
        frame: v.frame,
        // The card's animation: the Odd's strip, and the prop's when there is one.
        staffAnim: { frames: v.frames.length, fps: v.fps },
        ...(v.animProp && {
          propAnim: {
            sprite: v.animProp.d.sprite,
            frames: v.animProp.frames.length,
            fps: v.animProp.fps
          }
        }),
        ...(v.dust && { dust: true })
      }))
    }),
    { ...config, parser: 'json', filepath: vFile }
  )
);
console.log(`src/lib/vignettes.json: ${vignettes.length} vignettes`);
