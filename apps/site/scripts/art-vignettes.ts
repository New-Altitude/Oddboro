// A stage of art.ts, not an entry point: the desk vignettes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog, frameImage, sprites, type Rect } from './paint.ts';
import {
  generateOffice,
  TILE,
  type DrawCmd,
  type OfficeSpec,
  type PlacedSpot
} from '@oddboro/world';
import { ROOT, rectOf } from './art-office.ts';
import { STAFF } from './art-layers.ts';

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

export { vWorld, VW, VH, V, vignettes };
