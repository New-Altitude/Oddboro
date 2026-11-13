// The site's link preview, static/share.png: the pixel O over the name on the
// park's grass, two managers to each side, a tree coming in at the top right,
// and a few plants. Every page shows it when shared, unless it names its own.
// art.ts calls it with the managers' walks.
import { blendPixel, createImage, type Image } from '@oddboro/sprites/png';
import { MARK, MARK_COLOURS } from '@oddboro/sprites/mark';
import { hexToRgba } from '@oddboro/sprites/px';
import { cropTo, frameImage, palette, sprites } from './paint.ts';

const W = 1200;
const H = 630;
/** Grass and plants draw at eight screen pixels per art pixel. */
const SCALE = 8;

// The name, in the letters on the front door's awning (street-front-door.px),
// four squares wide and five tall, on a plate of the mark's teal deep.
const LETTERS: Record<string, string[]> = {
  O: ['.##.', '#..#', '#..#', '#..#', '.##.'],
  D: ['###.', '#..#', '#..#', '#..#', '###.'],
  B: ['###.', '#..#', '###.', '#..#', '###.'],
  R: ['###.', '#..#', '###.', '#.#.', '#..#']
};

/** The letters in glow aqua, with every square that touches one, corners too, in teal deep. */
function namePlate(): string[] {
  const rows = [0, 1, 2, 3, 4].map((r) =>
    [...'ODDBORO'].map((ch) => LETTERS[ch][r].replaceAll('#', 'h')).join('.')
  );
  const at = (x: number, y: number) => rows[y - 1]?.[x - 1] ?? '.';
  return Array.from({ length: rows.length + 2 }, (_, y) =>
    Array.from({ length: rows[0].length + 2 }, (_, x) => {
      if (at(x, y) !== '.') return at(x, y);
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) if (at(x + i, y + j) !== '.') return 'd';
      return '.';
    }).join('')
  );
}

// The far managers stand smaller and higher, the near ones larger and lower,
// so they step up toward the O. Each is the second frame of their walk, the one
// with both feet down.
const ODDS = [
  { who: 'marshall', x: 125, feet: 500, scale: 7 },
  { who: 'cindy', x: 1075, feet: 500, scale: 7 },
  { who: 'jamal', x: 290, feet: 545, scale: 9 },
  { who: 'ziva', x: 910, feet: 545, scale: 9 }
];

const PROPS = [
  { sprite: 'park-tree-large', frame: 'default', x: 950, y: -250 },
  { sprite: 'park-mushrooms', frame: '0', x: 30, y: 505 },
  { sprite: 'park-tuft', frame: '2', x: 250, y: 30 },
  { sprite: 'park-tuft', frame: '0', x: 690, y: 530 },
  { sprite: 'park-fern', frame: '0', x: 1100, y: 525 }
];

/** Where the grass stays plain turf, so no flower touches the O, the name or an Odd. */
const CLEAR = [
  [380, 80, 820, 560],
  [60, 280, 380, 560],
  [820, 280, 1140, 560]
];

/** Blend `src` onto `img` at (x, y), each art pixel `scale` screen pixels square. */
function stamp(img: Image, src: Image, x: number, y: number, scale: number): void {
  for (let sy = 0; sy < src.height; sy++)
    for (let sx = 0; sx < src.width; sx++) {
      const i = (sy * src.width + sx) * 4;
      if (!src.data[i + 3]) continue;
      const rgba = [...src.data.subarray(i, i + 4)];
      for (let j = 0; j < scale; j++)
        for (let k = 0; k < scale; k++)
          blendPixel(img, x + sx * scale + k, y + sy * scale + j, rgba);
    }
}

/** A grid of colour roles, centred across the card, with `.` left as it is. */
function grid(img: Image, rows: string[], cell: number, y: number): void {
  const x = Math.floor((W - rows[0].length * cell) / 2);
  rows.forEach((row, gy) =>
    [...row].forEach((role, gx) => {
      if (role === '.') return;
      const rgba = hexToRgba(palette.colors[MARK_COLOURS[role]].hex);
      for (let j = 0; j < cell; j++)
        for (let i = 0; i < cell; i++)
          img.data.set(rgba, ((y + gy * cell + j) * W + x + gx * cell + i) * 4);
    })
  );
}

export function shareCard(walks: Map<string, Image>): Image {
  const img = createImage(W, H);

  // The grass: plain turf in most cells, a tuft or a flower in some, picked
  // by a fixed sum so every run draws the same lawn.
  const grass = sprites.get('floor-grass')!;
  const tile = 16 * SCALE;
  for (let ty = 0; ty * tile < H; ty++)
    for (let tx = 0; tx * tile < W; tx++) {
      const n = (tx * 7 + ty * 13 + tx * ty * 3) % 11;
      const [x, y] = [tx * tile, ty * tile];
      const busy = CLEAR.some(
        ([x0, y0, x1, y1]) => x < x1 && x + tile > x0 && y < y1 && y + tile > y0
      );
      const frame = busy || n < 6 ? '0' : String((n % 5) + 1);
      stamp(img, frameImage(grass, frame), x, y, SCALE);
    }

  for (const p of PROPS) stamp(img, frameImage(sprites.get(p.sprite)!, p.frame), p.x, p.y, SCALE);

  // The O, with the grass showing through its middle, and the name below it.
  const top = 93;
  const cell = 24;
  grid(img, MARK, cell, top);
  grid(img, namePlate(), cell / 2, top + MARK.length * cell + (3 * cell) / 2);

  for (const o of ODDS) {
    const walk = walks.get(o.who)!;
    const stand = cropTo(walk, { x: 16, y: 0, w: 16, h: 32 });
    stamp(img, stand, o.x - 8 * o.scale, o.feet - 31 * o.scale, o.scale);
  }
  return img;
}
