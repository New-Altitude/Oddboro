// Renders a floor plan or a single room to a PNG, straight from the .px
// sources, so art can be checked in place without starting the office.
//
//   node scripts/render.ts main-street           the Main Street floor plan, daytime
//   node scripts/render.ts main-street --hour 21 the same at 9 PM, lamps on
//   node scripts/render.ts room:break-room       one room template on its own
//   node scripts/render.ts main-street --scale 2
//   node scripts/render.ts spec:path/to/spec.json   an office generated from a spec
//   node scripts/render.ts spec:spec.json --art art.json   with art the office drew
//
// Writes out/<name>[-h<hour>].png and lists any sprite the space asks for that
// does not exist yet.
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSprites } from '@oddboro/sprites/load';
import { checkArt, type DrawnArt } from '@oddboro/sprites/art';
import { hexToRgba, renderFrame, spriteMeta } from '@oddboro/sprites/px';
import { createImage, drawImage, encodePng, scaleImage } from '@oddboro/sprites/png';
import { composeWorld } from '../src/compose.ts';
import { paintWorld } from '../src/render.ts';
import { generateOffice, type OfficeSpec } from '../src/generate.ts';
import { TILE, type FloorPlan, type SpriteCatalog } from '../src/types.ts';
import {
  BLOOM_REACH,
  bloomAlpha,
  glowAlpha,
  glowFalloff,
  INDOOR_GLOW,
  nightTint
} from '../src/light.ts';
import { loadSpaces } from '../src/load.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--') && !/^-?\d+$/.test(a)) ?? 'main-street';
const flag = (name: string, fallback: number) =>
  args.includes(`--${name}`) ? Number(args[args.indexOf(`--${name}`) + 1]) : fallback;
const scale = flag('scale', 3);
const hour = flag('hour', 13);

const spaces = loadSpaces();
const { plans } = spaces;
let templates = spaces.rooms;
let plan: FloorPlan | undefined = target.startsWith('room:')
  ? { id: target.slice(5), name: target.slice(5), rooms: [{ room: target.slice(5), at: [1, 1] }] }
  : target.startsWith('spec:')
    ? {
        id: target
          .slice(5)
          .replace(/^.*\//, '')
          .replace(/\.json$/, ''),
        name: '',
        rooms: []
      }
    : plans[target];
if (!plan) {
  console.error(`No plan "${target}". Plans: ${Object.keys(plans).join(', ') || 'none'}`);
  process.exit(1);
}

const { palette, sprites, errors } = loadSprites();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
if (args.includes('--art'))
  for (const art of JSON.parse(
    readFileSync(args[args.indexOf('--art') + 1], 'utf8')
  ) as DrawnArt[]) {
    const r = checkArt(art, palette, (name) => sprites.has(name));
    if (r.problems.length) console.error(r.problems.join('\n'));
    for (const d of r.sprites) sprites.set(d.name, d);
  }
const catalog: SpriteCatalog = Object.fromEntries(
  [...sprites.values()].map((d) => [d.name, spriteMeta(d, palette)])
);

if (target.startsWith('spec:')) {
  const spec = JSON.parse(readFileSync(target.slice(5), 'utf8')) as OfficeSpec;
  const built = generateOffice(spec, catalog);
  if (built.problems.length) console.error(`Problems:\n- ${built.problems.join('\n- ')}`);
  if (!built.world) process.exit(1);
  plan = { ...built.plan, id: plan.id };
  templates = built.templates;
}
const world = composeWorld(plan, templates, catalog);
const W = world.width * TILE;
const H = world.height * TILE;
const canvas = paintWorld(world, sprites, palette, hour);

// Lighting, the way the office does it: every pixel wears the night tint,
// then each lamp adds its glow and bloom, cut to its own room.
const tint = nightTint(hour);
const add = new Float32Array(W * H * 3);
const bloom = bloomAlpha(hour);
for (const l of world.lights) {
  const [lr, lg, lb] = hexToRgba(l.color);
  const glow = glowAlpha(l.intensity, hour, l.outdoor);
  const lampBloom = bloom * (l.outdoor ? 1 : INDOOR_GLOW);
  const r = l.radius;
  const c = l.clip ?? { x: 0, y: 0, w: W, h: H };
  const y0 = Math.max(c.y, Math.floor(l.y - r));
  const y1 = Math.min(c.y + c.h, H, l.y + r);
  const x0 = Math.max(c.x, Math.floor(l.x - r));
  const x1 = Math.min(c.x + c.w, W, l.x + r);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y);
      const f = glow * glowFalloff(d / r) + lampBloom * glowFalloff(d / (r * BLOOM_REACH));
      if (f <= 0) continue;
      const i = (y * W + x) * 3;
      add[i] += (lr / 255) * f;
      add[i + 1] += (lg / 255) * f;
      add[i + 2] += (lb / 255) * f;
    }
  }
}
for (let i = 0; i < W * H; i++) {
  for (let ch = 0; ch < 3; ch++) {
    const base = canvas.data[i * 4 + ch] / 255;
    canvas.data[i * 4 + ch] = Math.round(Math.min(1, base * tint[ch] + add[i * 3 + ch]) * 255);
  }
}

// Emissive pixels (screens, lamp bulbs) give off their own light, so they
// paint over the darkened scene at full brightness.
for (const d of world.draws) {
  const def = sprites.get(d.sprite)!;
  if (!catalog[d.sprite].emissive) continue;
  const f = def.frames.find((x) => x.name === d.frame) ?? def.frames[0];
  const v = d.variant ? def.variants.find((x) => x.name === d.variant)?.map : undefined;
  drawImage(canvas, renderFrame(def, f, palette, v, true), d.x, d.y, d.flip);
}

// --lights marks every light: a magenta cross at its centre and a dotted
// ring at its radius, so a light that floats away from its lamp shows.
if (args.includes('--lights')) {
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) canvas.data.set([255, 40, 220, 255], (y * W + x) * 4);
  };
  for (const l of world.lights) {
    const cx = Math.round(l.x);
    const cy = Math.round(l.y);
    for (let k = -2; k <= 2; k++) {
      mark(cx + k, cy);
      mark(cx, cy + k);
    }
    for (let a = 0; a < 64; a += 2) {
      const t = (a / 64) * Math.PI * 2;
      mark(Math.round(l.x + Math.cos(t) * l.radius), Math.round(l.y + Math.sin(t) * l.radius));
    }
  }
}

// --crop x y w h (in tiles) renders a close-up.
let out = canvas;
if (args.includes('--crop')) {
  const i = args.indexOf('--crop');
  const [cx, cy, cw, ch] = args.slice(i + 1, i + 5).map(Number);
  out = createImage(cw * TILE, ch * TILE);
  for (let y = 0; y < out.height; y++)
    out.data.set(
      canvas.data.subarray(
        ((cy * TILE + y) * W + cx * TILE) * 4,
        ((cy * TILE + y) * W + (cx + cw) * TILE) * 4
      ),
      y * out.width * 4
    );
}

mkdirSync(join(ROOT, 'out'), { recursive: true });
const file = join(
  ROOT,
  'out',
  `${plan.id}${args.includes('--hour') ? `-h${hour}` : ''}${args.includes('--crop') ? '-crop' : ''}${args.includes('--lights') ? '-lights' : ''}.png`
);
writeFileSync(file, encodePng(scaleImage(out, scale)));
console.log(
  `${file}\n${world.width}x${world.height} tiles, ${world.draws.length} draws, ${world.spots.length} spots, ${world.lights.length} lights`
);
if (world.missing.length) console.log(`Missing sprites: ${world.missing.join(', ')}`);
