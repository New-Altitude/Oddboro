// The floor's sprites: one per draw command from the atlas, and the soft
// additive glow each lamp casts, cut to its room.
import { Rectangle, Sprite, Texture } from 'pixi.js';
import { GLOW_STOPS, type DrawCmd, type PlacedLight } from '@oddboro/world';
import type { Atlas } from './engine.ts';
import type { Anim } from './hits.ts';

export const toHex = (rgb: readonly number[]) =>
  (Math.round(rgb[0]) << 16) | (Math.round(rgb[1]) << 8) | Math.round(rgb[2]);

export function glowTexture(): Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, v] of GLOW_STOPS) g.addColorStop(t, `rgba(255,255,255,${v})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'linear';
  return tex;
}

/**
 * One additive glow for a light, cut to the room it is in so it never shines
 * through a wall. `reach` scales the radius (the bloom uses a tighter one).
 */
export function glowSprite(tex: Texture, l: PlacedLight, reach: number): Sprite | undefined {
  const r = l.radius * reach;
  let x0 = l.x - r;
  let y0 = l.y - r;
  let x1 = l.x + r;
  let y1 = l.y + r;
  if (l.clip) {
    x0 = Math.max(x0, l.clip.x);
    y0 = Math.max(y0, l.clip.y);
    x1 = Math.min(x1, l.clip.x + l.clip.w);
    y1 = Math.min(y1, l.clip.y + l.clip.h);
  }
  if (x1 <= x0 || y1 <= y0) return undefined;
  const k = tex.width / (2 * r);
  const frame = new Rectangle(
    (x0 - (l.x - r)) * k,
    (y0 - (l.y - r)) * k,
    (x1 - x0) * k,
    (y1 - y0) * k
  );
  const s = new Sprite(new Texture({ source: tex.source, frame }));
  s.position.set(x0, y0);
  s.width = x1 - x0;
  s.height = y1 - y0;
  s.tint = l.color;
  s.blendMode = 'add';
  return s;
}

/**
 * Build one sprite for a draw command. When its sprite animates, its frames
 * go on `anims` for the ambient clock to turn. `suffix` "~e" picks the
 * emissive-only frames, which line up with the normal ones because the start
 * frame comes from the position.
 */
export function makeSprite(
  atlas: Atlas,
  d: DrawCmd,
  anims: Anim[],
  suffix = ''
): Sprite | undefined {
  const meta = atlas.catalog[d.sprite];
  const prefix = d.variant ? `${d.sprite}@${d.variant}` : d.sprite;
  const m = /^(.*)-(\d+)$/.exec(d.frame);
  const frames =
    m && meta.fps > 0 ? atlas.sheet.animations[`${prefix}/${m[1]}${suffix}`] : undefined;
  let s: Sprite;
  if (frames && frames.length > 1) {
    const start = (Math.abs(d.x * 7 + d.y * 13) >> 4) % frames.length;
    s = new Sprite(frames[start]);
    anims.push({ s, frames, fps: meta.fps, start, box: [d.x, d.y, meta.width, meta.height] });
  } else {
    const tex = atlas.sheet.textures[`${prefix}/${d.frame}${suffix}`];
    if (!tex) return undefined;
    s = new Sprite(tex);
  }
  s.x = d.x;
  s.y = d.y;
  if (d.flip) {
    s.scale.x = -1;
    s.x += meta.width;
  }
  s.zIndex = d.z;
  return s;
}
