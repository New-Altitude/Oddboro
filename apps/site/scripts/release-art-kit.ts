// What every release's animation draws with: the palette, sprites, the screen's
// glyphs, the speech bubble, a frame's timing and the front door's leaves.
import { readFileSync } from 'node:fs';
import { createImage, drawImage, type Image } from '@oddboro/sprites/png';
import { hexToRgba } from '@oddboro/sprites/px';
import type { DeskLayers } from './release-art.ts';

const PALETTE = JSON.parse(
  readFileSync(new URL('../../../packages/sprites/src/palette.json', import.meta.url), 'utf8')
).colors as Record<string, { hex: string }>;

/** A place in the art's pixels: a sprite's top-left corner. */
type Point = { x: number; y: number };

/** A sprite drawn in palette keys, one character per pixel, `.` see-through. */
function sprite(rows: string[]): Image {
  const img = createImage(rows[0].length, rows.length);
  rows.forEach((row, y) =>
    [...row].forEach((key, x) => {
      if (key !== '.') img.data.set(hexToRgba(PALETTE[key].hex), (y * img.width + x) * 4);
    })
  );
  return img;
}

// The screen of the left desk's monitor, in the vignette's pixels.
const SCREEN = { x: 58, y: 22, w: 10, h: 6 };

/** A 5-pixel-high capital font, enough for the hello. */
const GLYPHS: Record<string, string[]> = {
  H: ['x.x', 'x.x', 'xxx', 'x.x', 'x.x'],
  E: ['xxx', 'x..', 'xx.', 'x..', 'xxx'],
  L: ['x..', 'x..', 'x..', 'x..', 'xxx'],
  O: ['.x.', 'x.x', 'x.x', 'x.x', '.x.'],
  W: ['x...x', 'x...x', 'x.x.x', 'x.x.x', '.x.x.'],
  R: ['xx.', 'x.x', 'xx.', 'x.x', 'x.x'],
  D: ['xx.', 'x.x', 'x.x', 'x.x', 'xx.'],
  ',': ['.', '.', '.', 'x', 'x'],
  '!': ['x', 'x', 'x', '.', 'x'],
  '?': ['xx.', '..x', '.x.', '...', '.x.'],
  C: ['.xx', 'x..', 'x..', 'x..', '.xx'],
  I: ['xxx', '.x.', '.x.', '.x.', 'xxx'],
  J: ['..x', '..x', '..x', 'x.x', '.x.'],
  K: ['x.x', 'x.x', 'xx.', 'x.x', 'x.x'],
  A: ['.x.', 'x.x', 'xxx', 'x.x', 'x.x'],
  B: ['xx.', 'x.x', 'xx.', 'x.x', 'xx.'],
  F: ['xxx', 'x..', 'xx.', 'x..', 'x..'],
  G: ['.xx', 'x..', 'x.x', 'x.x', '.xx'],
  M: ['x...x', 'xx.xx', 'x.x.x', 'x...x', 'x...x'],
  N: ['x..x', 'xx.x', 'x.xx', 'x..x', 'x..x'],
  P: ['xx.', 'x.x', 'xx.', 'x..', 'x..'],
  S: ['.xx', 'x..', '.x.', '..x', 'xx.'],
  T: ['xxx', '.x.', '.x.', '.x.', '.x.'],
  U: ['x.x', 'x.x', 'x.x', 'x.x', 'xxx'],
  X: ['x.x', 'x.x', '.x.', 'x.x', 'x.x'],
  V: ['x.x', 'x.x', 'x.x', 'x.x', '.x.'],
  '-': ['..', '..', 'xx', '..', '..'],
  '.': ['.', '.', '.', '.', 'x'],
  ' ': ['..', '..', '..', '..', '..']
};
const HELLO = 'HELLO, WORLD!';

const width = (text: string) =>
  [...text].reduce((w, ch, i) => w + GLYPHS[ch][0].length + (i ? 1 : 0), 0);

/**
 * A bubble with the first `shown` letters of `text`, its tail down at column
 * `tail` (its start, unless a bubble near the art's edge moves it).
 */
function bubble(shown: number, text = HELLO, tail = 3): Image {
  const w = width(text) + 6;
  const h = 11;
  const t = tail;
  const rows: string[] = [];
  for (let y = 0; y < h + 3; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
      const edge = x === 0 || x === w - 1 || y === 0 || y === h - 1;
      if (y < h) row += corner ? '.' : edge ? 'k' : '=';
      // The tail: three rows narrowing toward the bubble's start.
      else if (y === h)
        row += x === t ? 'k' : x === t + 1 || x === t + 2 ? '=' : x === t + 3 ? 'k' : '.';
      else if (y === h + 1) row += x === t ? 'k' : x === t + 1 ? '=' : x === t + 2 ? 'k' : '.';
      else row += x === t || x === t + 1 ? 'k' : '.';
    }
    rows.push(row);
  }
  // Opening the bubble's bottom edge over the tail.
  rows[h - 1] = rows[h - 1].slice(0, t + 1) + '==' + rows[h - 1].slice(t + 3);
  const img = sprite(rows);
  let x = 3;
  [...text].slice(0, shown).forEach((ch) => {
    const glyph = GLYPHS[ch];
    glyph.forEach((row, gy) =>
      [...row].forEach((on, gx) => {
        if (on === 'x') img.data.set(hexToRgba(PALETTE.k.hex), ((3 + gy) * img.width + x + gx) * 4);
      })
    );
    x += glyph[0].length + 1;
  });
  return img;
}

/** One frame: the room, the Odd at frame `t`, what stands in front, then `extra` on top. */
function frame(layers: DeskLayers, t: number, extra: (img: Image) => void): Image {
  const img = createImage(layers.room.width, layers.room.height);
  drawImage(img, layers.room, 0, 0);
  // The Odd types at about 3.7 frames a second: a new pose every third GIF frame.
  drawImage(img, layers.odd[Math.floor(t / 3) % layers.odd.length], 0, 0);
  drawImage(img, layers.front, 0, 0);
  extra(img);
  return img;
}

const DELAY = 9;

// The bonk: a paper burst, outlined in ink so it shows on a lit door by
// night and on a sunny one by day.
const BONK = sprite(['...k...', '.k.=.k.', '..k=k..', 'k==.==k', '..k=k..', '.k.=.k.', '...k...']);

// The two leaves of the front door, in the door sprite's pixels: the full
// height of the doorway, rows 13 to 30, inside the jamb from column 11 to 36,
// meeting in the middle. Each is 13 columns wide.
const LEAF = { top: 13, bottom: 30, left: 11, right: 36, w: 13 };

/** The door's pixels from `src` at (x, y). */
function doorAt(src: Image, x: number, y: number): Image {
  const w = 48;
  const h = 32;
  const img = createImage(w, h);
  for (let r = 0; r < h; r++) {
    const s = ((y + r) * src.width + x) * 4;
    img.data.set(src.data.subarray(s, s + w * 4), r * w * 4);
  }
  return img;
}

/**
 * The door part way shut, over the open doorway: each leaf, whole and full
 * height, slid in from its side of the jamb, `slid` of the way from open (0)
 * to shut (1). The part still in the wall does not show.
 */
function leaves(shut: Image, opened: Image, slid: number): Image {
  const img = createImage(opened.width, opened.height);
  drawImage(img, opened, 0, 0);
  const off = Math.round(LEAF.w * (1 - slid));
  for (let i = 0; i < LEAF.w - off; i++) {
    // The leaf's inner edge leads: column i from the jamb shows the shut
    // leaf's column i + off.
    for (const [dx, sx] of [
      [LEAF.left + i, LEAF.left + i + off],
      [LEAF.right - i, LEAF.right - i - off]
    ])
      for (let y = LEAF.top; y <= LEAF.bottom; y++) {
        const src = (y * shut.width + sx) * 4;
        img.data.set(shut.data.subarray(src, src + 4), (y * img.width + dx) * 4);
      }
  }
  return img;
}

export {
  PALETTE,
  type Point,
  sprite,
  SCREEN,
  GLYPHS,
  HELLO,
  width,
  bubble,
  frame,
  DELAY,
  BONK,
  LEAF,
  doorAt,
  leaves
};
