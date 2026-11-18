// The meadow past the world's own grounds: its grass, the street and the river
// carried out to its edges, and plants scattered over it.
import { Container, Sprite, TilingSprite, type Application, type Texture } from 'pixi.js';
import { PASS, TILE, type DrawCmd, type World } from '@oddboro/world';
import type { Atlas } from './engine.ts';
import type { Anim, Box } from './hits.ts';
import { makeSprite } from './sprites.ts';

/**
 * Plain grass laid past the world's own grounds, in tiles on every side, so
 * the camera can pull back far enough to see the whole office beside open
 * panels without showing the edge of the world.
 */
export const MEADOW = 48;
/** What grows on the meadow, the common ones listed more than once. */
const PLANTS = [
  'park-tree',
  'park-tree',
  'park-tree-large',
  'park-pine',
  'park-pine',
  'park-pine-large',
  'park-tree-small',
  'park-bush',
  'park-bush',
  'park-bush-large',
  'park-tuft',
  'park-tuft',
  'park-flowers',
  'park-rock'
];

/**
 * A 16 by 16 tile patch of grass for the meadow to repeat, mixed the way the
 * world mixes its grass: plain about 70% of the time, flecked the rest.
 */
export function meadowPatch(atlas: Atlas, app: Application): Texture | undefined {
  const frames = atlas.catalog['floor-grass']?.frames ?? [];
  if (!frames.length) return undefined;
  const patch = new Container();
  const N = 16;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let h = (x * 374761393 + y * 668265263) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      h = (h ^ (h >>> 16)) >>> 0;
      const frame =
        frames.length > 1 && h % 100 >= 70
          ? frames[1 + ((h >>> 8) % (frames.length - 1))]
          : frames[0];
      const tex = atlas.sheet.textures[`floor-grass/${frame}`];
      if (!tex) continue;
      const sp = new Sprite(tex);
      sp.position.set(x * TILE, y * TILE);
      patch.addChild(sp);
    }
  const grass = app.renderer.generateTexture({ target: patch, resolution: 1 });
  patch.destroy({ children: true });
  return grass;
}

/**
 * The meadow's own things: the street's road rows and the river carried out
 * to its edges, and trees, bushes and tufts scattered over the grass, kept
 * clear of the road, the water and the world's own grounds. Drawn once per world, in
 * the same order every time.
 */
export function countryside({
  world,
  atlas,
  shaded,
  anims,
  addToBlock
}: {
  world: World;
  atlas: Atlas;
  shaded: (Sprite | TilingSprite)[];
  anims: Anim[];
  addToBlock: (item: Container, box: Box) => void;
}): Container {
  const out = new Container();
  // Back to front, so a tree in front covers the one behind.
  out.sortableChildren = true;
  const add = (s: Sprite | TilingSprite) => {
    out.addChild(s);
    shaded.push(s);
  };
  const material = (x: number, y: number) => {
    const c = world.cells[y * world.width + x];
    return c?.kind === 'floor' ? c.material : undefined;
  };
  // The street's rows, whatever a theme paves them with: cobbles and a dirt
  // road carry on as far as asphalt does. The grass between stays meadow.
  const street = world.rooms.find((r) => r.id.startsWith('street'));
  const grass = material(0, 0);
  const texture = (m: string) => {
    const name = `floor-${m}`;
    const frame = atlas.catalog[name]?.frames.includes('0') ? '0' : atlas.catalog[name]?.frames[0];
    return frame ? atlas.sheet.textures[`${name}/${frame}`] : undefined;
  };
  const road = new Set<number>();
  for (let y = street?.y ?? 0; y < (street ? street.y + street.h : 0); y++)
    for (const [edge, from] of [
      [0, -MEADOW],
      [world.width - 1, world.width]
    ]) {
      const m = material(edge, y);
      const tex = m && m !== grass && texture(m);
      if (!tex) continue;
      road.add(y);
      const strip = new TilingSprite({ texture: tex, width: MEADOW * TILE, height: TILE });
      strip.position.set(from * TILE, y * TILE);
      add(strip);
    }
  const W = world.width;
  const H = world.height;
  // Any other ground at the world's edge that is not grass (the river) runs
  // straight on to the meadow's edge, tile by tile from the edge cell's own
  // draws, so the water keeps its ripple and its banks. Only a bank along
  // the way it runs carries on.
  const edgeDraws = new Map<number, DrawCmd[]>();
  for (const d of world.draws) {
    const [x, y] = [d.x / TILE, d.y / TILE];
    if (d.pass !== PASS.floor || (x > 0 && x < W - 1 && y > 0 && y < H - 1)) continue;
    const key = y * W + x;
    edgeDraws.set(key, [...(edgeDraws.get(key) ?? []), d]);
  }
  const wet = new Set<string>();
  const sides = [
    { cells: H, at: (i: number) => [0, i], step: [-1, 0], banks: ['n', 's'] },
    { cells: H, at: (i: number) => [W - 1, i], step: [1, 0], banks: ['n', 's'] },
    { cells: W, at: (i: number) => [i, 0], step: [0, -1], banks: ['e', 'w'] },
    { cells: W, at: (i: number) => [i, H - 1], step: [0, 1], banks: ['e', 'w'] }
  ];
  for (const { cells, at, step, banks } of sides)
    for (let i = 0; i < cells; i++) {
      const [x, y] = at(i);
      const m = material(x, y);
      if (!m || m === grass || (step[1] === 0 && road.has(y))) continue;
      const draws = (edgeDraws.get(y * W + x) ?? []).filter(
        (d) => d.sprite === `floor-${m}` || (d.sprite === `fx-edge-${m}` && banks.includes(d.frame))
      );
      for (let k = 1; k <= MEADOW; k++) {
        const [tx, ty] = [x + step[0] * k, y + step[1] * k];
        wet.add(`${tx},${ty}`);
        for (const d of draws) {
          const s = makeSprite(atlas, { ...d, x: tx * TILE, y: ty * TILE }, anims);
          if (!s) continue;
          // Under every tree, whatever row it stands in.
          s.zIndex = -Number.MAX_SAFE_INTEGER;
          add(s);
          addToBlock(s, [s.x, s.y, TILE, TILE]);
        }
      }
    }
  // Scatter, deterministic by tile so the meadow never changes between visits.
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h ^ (h >>> 16)) / 4294967296;
  };
  const near = (y: number) => [...road].some((r) => Math.abs(r - y) <= 2);
  // A tree stands a tile clear of the water, its trunk and its width.
  const ashore = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -2; dx <= 3; dx++) if (wet.has(`${x + dx},${y + dy}`)) return false;
    return true;
  };
  for (let y = -MEADOW + 2; y < H + MEADOW - 1; y++)
    for (let x = -MEADOW; x < W + MEADOW - 2; x++) {
      // Stay off the world itself and a few tiles from it, so nothing tall
      // reaches over its edge, and off the road and the water.
      if (x > -4 && x < W + 1 && y > -1 && y < H + 4) continue;
      if (near(y) || !ashore(x, y)) continue;
      const r = hash(x, y);
      if (r > 0.05) continue;
      const name = PLANTS[Math.floor((r / 0.05) * PLANTS.length)];
      const meta = atlas.catalog[name];
      const frame = meta?.frames.includes('default') ? 'default' : meta?.frames[0];
      const tex = frame && atlas.sheet.textures[`${name}/${frame}`];
      if (!meta || !tex) continue;
      const sp = new Sprite(tex);
      sp.position.set(x * TILE - meta.origin[0], y * TILE - meta.origin[1]);
      sp.zIndex = (y + 1) * TILE;
      add(sp);
    }
  return out;
}
