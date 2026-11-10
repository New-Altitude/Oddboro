// The art on /releases/: one looping GIF per release that has one, built on
// the desk vignette (an Odd typing at its desk), the office's front door, a
// hallway or the gym, and a still of its last frame for visitors who ask for reduced motion. art.ts calls this once per
// theme, with the vignette's layers lit for night or for day, so every
// animation added here comes in both. Every colour added here is the house
// palette's, and `shade` lights it the way the room is lit.
//
//   hello-world   the screen answers the Odd's typing: "HELLO, WORLD!" fills
//                 a speech bubble one letter at a time (0.0.1)
//   stuck-sign-in Ada walks into the shut front door, three times, backs off
//                 and wonders why (0.0.2, the stuck sign-in fix)
//   linux         the screen flashes and a penguin jumps out of it, arcs over
//                 the desk and lands on the floor (0.0.3)
//   locked-door   the open front door's two leaves slide shut together in
//                 front of Ada, she locks it, CLICK, steps back with a
//                 padlock on it and faces the street (0.0.4, the office
//                 takes actions only from its own page)
//   windows       Ada walks an endless hallway, a window in every other
//                 tile: windows, on Windows, on Windows (0.0.5, the Windows
//                 app). The loop has no start: its last frame leads into its
//                 first.
//   hand-off      a relay in the same hall, one pun a hand-off: HAND-OFF!,
//                 HANDS ON!, FOLDER AND WISER, CODEX MARKS THE SPOT, GROK ON!,
//                 LESSON? IT STUCK., NO BRAINER!, BACKSIES! (0.0.6: hand-offs,
//                 folders, Codex and Grok, lessons, keys for hosted tools, and
//                 the Revoke fix)
//   loop          Ada walks the hall, off the end and in again at the start:
//                 UPDATING!, AGAIN?, AND AGAIN?. The fourth time she stops
//                 and turns to you: OUT OF THE LOOP! (0.0.7, the Windows
//                 update that installed itself over and over)
//   gym           Theo jogs round the office's gym: the treadmill, the bike,
//                 curls at the dumbbells, the bar off the rack, and presses
//                 on the bench (0.0.8)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createImage, drawImage, encodePng, scaleImage, type Image } from '@oddboro/sprites/png';
import { hexToRgba } from '@oddboro/sprites/px';
import { encodeGif, type GifFrame } from './gif.ts';

export type DeskLayers = {
  /** The room, lit, without the Odd. */
  room: Image;
  /** What stands in front of the Odd. */
  front: Image;
  /** The Odd typing, one image per frame, already lit and placed. */
  odd: Image[];
  /** Lights an added sprite the way the room's lamp lights the Odd. */
  shade: (img: Image) => Image;
};

const PALETTE = JSON.parse(
  readFileSync(new URL('../../../packages/sprites/src/palette.json', import.meta.url), 'utf8')
).colors as Record<string, { hex: string }>;

/** The office's front door, shut, and the sidewalk below it. */
export type DoorLayers = {
  /** The street and the building's front, lit, with no Odd. */
  room: Image;
  /** The door, in the room's pixels. */
  door: { x: number; y: number; w: number; h: number };
  /** The door open, lit, the size of `door`, to draw over the shut one. */
  open: Image;
  /** Ada in one sprite frame, like `walk-up-2`, lit, 16 by 32. */
  odd: (frame: string) => Image;
};

/** A hallway that repeats, to walk along forever. */
export type HallLayers = {
  /** The hall, lit, wider than the view on both sides, repeating every `period` pixels. */
  room: Image;
  period: number;
  /** The view's size. It starts one period in. */
  view: { w: number; h: number };
  /** Ada in one sprite frame, like `walk-side-2`, lit, 16 by 32. */
  odd: (frame: string) => Image;
  /** Theo, the same way, for the art that needs a colleague. */
  mate: (frame: string) => Image;
  /** Lights an added sprite the way the hall is lit. */
  shade: (img: Image) => Image;
};

/** A place in the art's pixels: a sprite's top-left corner. */
type Point = { x: number; y: number };

/** The office's gym, packed into one view, with Theo to work out in it. */
export type GymLayers = {
  /** The gym, lit, one image per frame of the treadmill's belt. */
  room: Image[];
  /** The same gym with the bar lifted off the rack. */
  unracked: Image;
  view: { w: number; h: number };
  /** Where Theo stands at each station, as his sprite's top-left. */
  at: Record<'run' | 'cycle' | 'curl' | 'rack' | 'bench', Point>;
  /** The rack's loaded bar, lit, where it rests on the rack, and its middle row. */
  bar: { img: Image; x: number; y: number; mid: number };
  /** Theo in one sprite frame, like `exercise-run-2`, lit, 16 by 32. */
  odd: (frame: string) => Image;
};

export type Layers = { desk: DeskLayers; door: DoorLayers; hall: HallLayers; gym: GymLayers };

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

// The penguin: ink body, paper belly and eyes, amber beak and feet. Wings up
// in the air, at its sides on the ground, and its eyes shut for a blink.
const PENGUIN = [
  '...kkkk...',
  '..kkkkkk..',
  '..k=kk=k..',
  '..kkkkkk..',
  '..kkyykk..',
  '.kk=yy=kk.',
  '.k======k.',
  'kk======kk',
  'kk======kk',
  '.k======k.',
  '.kk====kk.',
  '..kkkkkk..',
  '.yyy..yyy.'
];
const PENGUIN_FLY = PENGUIN.map((r, y) =>
  y === 5 ? 'kkk=yy=kkk' : y === 7 || y === 8 ? '.k======k.' : r
);
const PENGUIN_BLINK = PENGUIN.map((r, y) => (y === 2 ? '..kkkkkk..' : r));

// The screen of the left desk's monitor, in the vignette's pixels.
const SCREEN = { x: 58, y: 22, w: 10, h: 6 };
const FLASH = 'g';

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

function helloWorld(layers: DeskLayers): GifFrame[] {
  const tip = bubble(0);
  const at = { x: SCREEN.x - 2, y: SCREEN.y - tip.height - 1 };
  const frames: GifFrame[] = [];
  // Typing, then a letter a frame, a long hold, and a pause before it loops.
  const shown = [
    ...Array(8).fill(-1),
    ...[...HELLO].map((_, i) => i + 1),
    ...Array(26).fill(HELLO.length),
    ...Array(6).fill(-1)
  ];
  shown.forEach((n, t) =>
    frames.push({
      image: frame(layers, t, (img) => {
        if (n >= 0) drawImage(img, bubble(n), at.x, at.y);
      }),
      delay: DELAY
    })
  );
  // The still: the whole hello.
  frames.push({
    image: frame(layers, 0, (img) => drawImage(img, bubble(HELLO.length), at.x, at.y)),
    delay: 0
  });
  return frames;
}

function linux(layers: DeskLayers): GifFrame[] {
  const stand = layers.shade(sprite(PENGUIN));
  const fly = layers.shade(sprite(PENGUIN_FLY));
  const blink = layers.shade(sprite(PENGUIN_BLINK));
  const flash = sprite(Array(SCREEN.h).fill(FLASH.repeat(SCREEN.w)));
  const from = { x: SCREEN.x, y: SCREEN.y - 4 };
  const to = { x: 80, y: 64 };
  const frames: GifFrame[] = [];
  let t = 0;
  const add = (extra: (img: Image) => void, delay = DELAY) =>
    frames.push({ image: frame(layers, t++, extra), delay });

  for (let i = 0; i < 9; i++) add(() => {});
  // The screen flashes twice.
  for (const on of [true, false, true])
    add((img) => on && drawImage(img, flash, SCREEN.x, SCREEN.y));
  // Out of the screen, up, and over: a parabola from the screen to the floor.
  const STEPS = 11;
  for (let i = 1; i <= STEPS; i++) {
    const s = i / STEPS;
    const x = Math.round(from.x + (to.x - from.x) * s);
    const y = Math.round(from.y + (to.y - from.y) * s - 28 * Math.sin(Math.PI * s));
    add((img) => {
      if (i === 1) drawImage(img, flash, SCREEN.x, SCREEN.y);
      drawImage(img, i % 2 ? fly : stand, x, y);
    });
  }
  // The landing: a squash for a frame, then standing, with one blink.
  const squash = createImage(stand.width, stand.height);
  drawImage(squash, stand, 0, 1);
  add((img) => drawImage(img, squash, to.x, to.y));
  for (let i = 0; i < 28; i++)
    add((img) => drawImage(img, i === 12 || i === 13 ? blink : stand, to.x, to.y));
  // The still: the penguin on the floor beside the desk.
  frames.push({ image: frame(layers, 0, (img) => drawImage(img, stand, to.x, to.y)), delay: 0 });
  return frames;
}

// The bonk: a paper burst, outlined in ink so it shows on a lit door by
// night and on a sunny one by day.
const BONK = sprite(['...k...', '.k.=.k.', '..k=k..', 'k==.==k', '..k=k..', '.k.=.k.', '...k...']);

function stuckSignIn({ room, door, odd }: DoorLayers): GifFrame[] {
  const x = Math.round(door.x + door.w / 2 - 8);
  // Ada's sprite top: at the door, standing on the row below it, and where
  // she starts and ends, a tile and a half back on the sidewalk.
  const at = door.y + door.h - 16;
  const start = at + 24;
  const frames: GifFrame[] = [];
  const add = (pose: string, y: number, extra?: (img: Image) => void) => {
    const img = createImage(room.width, room.height);
    drawImage(img, room, 0, 0);
    drawImage(img, odd(pose), x, y);
    extra?.(img);
    frames.push({ image: img, delay: DELAY });
  };
  const walk = (from: number, to: number) => {
    const steps = Math.ceil(Math.abs(to - from) / 2);
    for (let i = 1; i <= steps; i++)
      add(`walk-up-${Math.floor(i / 2) % 4}`, Math.round(from + ((to - from) * i) / steps));
  };
  const ouch = bubble(1, '!');
  const huh = bubble(1, '?');
  const over = (b: Image, y: number) => (img: Image) => drawImage(img, b, x + 4, y - b.height + 2);
  const bonk = () => {
    add('idle-up-0', at + 4, (img) => drawImage(img, BONK, x + 5, at + 1));
    for (let i = 0; i < 4; i++) add('idle-up-0', at + 4, over(ouch, at + 4));
  };

  for (let i = 0; i < 6; i++) add('idle-up-0', start);
  walk(start, at);
  bonk();
  walk(at + 4, at);
  bonk();
  walk(at + 4, at);
  bonk();
  // Backing off, still facing the door, to where she began.
  walk(at + 4, start);
  for (let i = 0; i < 12; i++) add('idle-up-0', start, over(huh, start));
  // The still: Ada on the sidewalk, wondering.
  const still = createImage(room.width, room.height);
  drawImage(still, room, 0, 0);
  drawImage(still, odd('idle-up-0'), x, start);
  over(huh, start)(still);
  frames.push({ image: still, delay: 0 });
  return frames;
}

// The padlock, hung through both brass pulls: an amber body with a keyhole,
// outlined in ink so it shows on the lit glass by night and by day.
const PADLOCK = sprite([
  '.kkkk.',
  '.k..k.',
  '.k..k.',
  'kkkkkk',
  'kYYYYk',
  'kYkkYk',
  'kYYYYk',
  'kkkkkk'
]);

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

function lockedDoor({ room, door, open, odd }: DoorLayers): GifFrame[] {
  const x = Math.round(door.x + door.w / 2 - 8);
  // Ada's sprite top: at the door, half a step back where she waits while it
  // shuts, a step back where the padlock shows over her head, and where she
  // starts, a tile and a half back on the sidewalk.
  const at = door.y + door.h - 16;
  const near = at + 8;
  const back = at + 12;
  const start = at + 24;
  // The pulls sit in the door's columns 21 and 26, rows 22 to 24.
  const lock = { x: door.x + 21, y: door.y + 19 };
  const frames: GifFrame[] = [];
  // The door shut and open.
  const shut = doorAt(room, door.x, door.y);
  const opened = doorAt(open, 0, 0);
  // How far the leaves have slid shut, 0 open to 1 shut.
  let slid = 0;
  let locked = false;
  const scene = (pose: string, y: number, extra?: (img: Image) => void) => {
    const img = createImage(room.width, room.height);
    drawImage(img, room, 0, 0);
    drawImage(img, slid < 1 ? leaves() : shut, door.x, door.y);
    if (locked) drawImage(img, PADLOCK, lock.x, lock.y);
    drawImage(img, odd(pose), x, y);
    extra?.(img);
    return img;
  };
  const add = (pose: string, y: number, extra?: (img: Image) => void) =>
    frames.push({ image: scene(pose, y, extra), delay: DELAY });
  const walk = (from: number, to: number) => {
    const steps = Math.ceil(Math.abs(to - from) / 2);
    for (let i = 1; i <= steps; i++)
      add(`walk-up-${Math.floor(i / 2) % 4}`, Math.round(from + ((to - from) * i) / steps));
  };
  const click = bubble(6, 'CLICK!');
  const over = (b: Image, y: number) => (img: Image) => drawImage(img, b, x + 4, y - b.height + 2);

  /**
   * The door part way shut, over the open doorway: each leaf, whole and full
   * height, slid in from its side of the jamb. The part still in the wall
   * does not show.
   */
  function leaves(): Image {
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

  for (let i = 0; i < 6; i++) add('idle-up-0', start);
  walk(start, near);
  for (let i = 0; i < 2; i++) add('idle-up-0', near);
  // Both leaves slide together and meet in the middle, quick at first and
  // slowing as they meet.
  for (const s of [0.15, 0.35, 0.55, 0.72, 0.86, 0.95, 1]) {
    slid = s;
    add('idle-up-0', near);
  }
  for (let i = 0; i < 2; i++) add('idle-up-0', near);
  // She steps up and turns the key.
  walk(near, at);
  add('idle-up-0', at);
  locked = true;
  for (let i = 0; i < 8; i++) add('idle-up-0', at, over(click, at));
  // A step back, still facing the door, so the padlock shows.
  walk(at, back);
  for (let i = 0; i < 4; i++) add('idle-up-0', back);
  // Then she turns to face the street and stands by the locked door.
  add('idle-side-0', back);
  for (let i = 0; i < 24; i++) add(`idle-down-${Math.floor(i / 3) % 4}`, back);
  // The still: the door locked, Ada facing the street.
  frames.push({ image: scene('idle-down-0', back), delay: 0 });
  return frames;
}

/**
 * Ada walks along the hallway and the hall slides by: two pixels a frame, a
 * new step every second frame. One period of the hall (two windows, two
 * walls, one lamp) passes in period / 2 frames, a whole number of her walk's
 * cycles, so frame 0 follows the last and the loop runs on with no seam.
 */
function windows({ room, period, view, odd }: HallLayers): GifFrame[] {
  const SPEED = 2;
  const count = period / SPEED;
  if (!Number.isInteger(count) || count % 8)
    throw new Error('windows: the loop must end on a whole step');
  // Ada mid-view, her feet on the middle row of oak.
  const x = Math.round(view.w / 2 - 8);
  const y = view.h - 2 * 16 - 8;
  const shot = (t: number) => {
    const img = createImage(view.w, view.h);
    drawImage(img, room, -(period + t * SPEED), 0);
    drawImage(img, odd(`walk-side-${Math.floor(t / 2) % 4}`), x, y);
    return img;
  };
  const frames: GifFrame[] = [];
  for (let t = 0; t < count; t++) frames.push({ image: shot(t), delay: DELAY });
  // The still: Ada mid-stride in the hall.
  frames.push({ image: shot(0), delay: 0 });
  return frames;
}

// The props passed along the hall in 0.0.6's relay, each outlined in ink so
// it shows on plaster and oak by night and by day.
const FOLDER = sprite(['.kkk....', 'kyyykkkk', 'kyyyyyyk', 'kYYYYYYk', 'kYYYYYYk', 'kkkkkkkk']);
// A book with an X on the cover.
const CODEX = sprite([
  'kkkkkkk',
  'kRRRRRk',
  'kRyRyRk',
  'kRRyRRk',
  'kRyRyRk',
  'kRRRRRk',
  'k=====k',
  'kkkkkkk'
]);
// A brain: two halves, folded, on its stem.
const BRAIN_ROWS = [
  '...kkkkkkk...',
  '..kfFfFkFfkk.',
  '.kfFffFkfFffk',
  'kffFfffkffFfk',
  'kFfffFfkFfffk',
  'kffFffFkffFfk',
  'kfFffffkfFffk',
  '.kffFfFkfffk.',
  '..kkkkkkkkk..',
  '.....kFk.....'
];
const BRAIN = sprite(BRAIN_ROWS);
// The brain lit up, the moment the key goes in.
const BRAIN_LIT = sprite(BRAIN_ROWS.map((r) => r.replace(/f/g, 'g').replace(/F/g, 'G')));
const KEY = sprite(['.kkk....', 'kYyYkkkk', 'ky.yyyyk', 'kYyYkkYk', '.kkk..kk']);
// A sticky note, written on.
const NOTE = sprite([
  'kkkkkkkkk',
  'kyyyyyyyk',
  'kyKKKKyyk',
  'kyyyyyyyk',
  'kyKKKyyyk',
  'kyyyyyyyk',
  'kyKKKKyYk',
  'kyyyyyYYk',
  'kkkkkkkkk'
]);

/**
 * A relay down the 0.0.5 hallway, one pun a hand-off. Ada walks in with a
 * folder and hands it off to Theo, who is hands on, and folder and wiser. A
 * book with an X drops into her hands: Codex marks the spot. Theo hops: Grok
 * on. She sticks a note to the wall: the lesson stuck. A brain turns up in
 * Theo's hands, she tosses a key into it and it lights: no brainer. Then she
 * takes the key back: backsies. They turn to face you. Everything they set
 * down stays where it landed.
 */
function handOff({ room, period, view, odd, mate, shade }: HallLayers): GifFrame[] {
  // Their sprite tops: feet on the middle row of oak, as in the hallway walk.
  const Y = view.h - 2 * 16 - 8;
  // Where Ada stops, and where Theo stands facing her.
  const A = 34;
  const T = 78;
  // `shade` lights the image it is given, so each theme lights its own copy.
  const lit = (src: Image) => {
    const img = createImage(src.width, src.height);
    drawImage(img, src, 0, 0);
    return shade(img);
  };
  const folder = lit(FOLDER);
  const codex = lit(CODEX);
  const brain = lit(BRAIN);
  const key = lit(KEY);
  const note = lit(NOTE);

  const ada = { x: -16, pose: 'idle-side' };
  const theo = { y: Y, pose: 'idle-side' };
  const holding: { ada?: Image; theo?: Image } = {};
  // What they set down: it stays for the rest of the loop.
  const down: { img: Image; x: number; y: number }[] = [];
  const frames: GifFrame[] = [];

  /** Where a held prop sits: in front of the hands, at chest height. */
  const at = (who: 'ada' | 'theo', img: Image) => ({
    x: who === 'ada' ? ada.x + 11 : T + 5 - img.width,
    y: (who === 'ada' ? Y : theo.y) + 18 - (img.height >> 1)
  });
  /** A pose's frame: idles breathe on the clock, walks name their own step. */
  const pose = (p: string) => (/-\d$/.test(p) ? p : `${p}-${Math.floor(frames.length / 3) % 4}`);
  const shot = (extra?: (img: Image) => void) => {
    const img = createImage(view.w, view.h);
    drawImage(img, room, -period, 0);
    for (const d of down) drawImage(img, d.img, d.x, d.y);
    drawImage(img, odd(pose(ada.pose)), ada.x, Y);
    // Theo faces Ada: his side poses, flipped.
    drawImage(img, mate(pose(theo.pose)), T, theo.y, true);
    for (const who of ['ada', 'theo'] as const) {
      const held = holding[who];
      if (held) drawImage(img, held, at(who, held).x, at(who, held).y);
    }
    extra?.(img);
    return img;
  };
  const add = (extra?: (img: Image) => void, n = 1) => {
    for (let i = 0; i < n; i++) frames.push({ image: shot(extra), delay: DELAY });
  };
  /** A bubble over one of them, kept inside the art with its tail over the head. */
  const say = (text: string, who: 'ada' | 'theo') => {
    const w = width(text) + 6;
    const head = (who === 'ada' ? ada.x : T) + 6;
    const x = Math.max(1, Math.min(view.w - w - 1, head - 3));
    const b = bubble(text.length, text, Math.max(1, Math.min(w - 5, head - x)));
    return (img: Image) => drawImage(img, b, x, Y - b.height + 2);
  };
  /** A prop flying from one place to another over an arc `lift` pixels high. */
  const toss = (
    img: Image,
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps: number,
    lift: number
  ) => {
    for (let i = 1; i <= steps; i++) {
      const s = i / steps;
      const x = Math.round(from.x + (to.x - from.x) * s);
      const y = Math.round(from.y + (to.y - from.y) * s - lift * Math.sin(Math.PI * s));
      add((g) => drawImage(g, img, x, y));
    }
  };
  const pass = (img: Image, from: 'ada' | 'theo', to: 'ada' | 'theo', lift = 8) => {
    const start = at(from, img);
    holding[from] = undefined;
    toss(img, start, at(to, img), 6, lift);
    holding[to] = img;
  };
  const setDown = (who: 'ada' | 'theo', img: Image, x: number) => {
    const start = at(who, img);
    holding[who] = undefined;
    const to = { x, y: Y + 31 - img.height };
    toss(img, start, to, 3, 0);
    down.push({ img, ...to });
  };

  // Ada walks in with the folder.
  holding.ada = folder;
  for (let i = 1; ada.x < A; i++) {
    ada.x += 2;
    ada.pose = `walk-side-${Math.floor(i / 2) % 4}`;
    add();
  }
  ada.pose = 'idle-side';
  add(undefined, 2);
  // Hand-off, hands on.
  add(say('HAND-OFF!', 'ada'), 10);
  pass(folder, 'ada', 'theo');
  add(say('HANDS ON!', 'theo'), 10);
  add(say('FOLDER AND WISER', 'theo'), 16);
  setDown('theo', folder, T - 10);
  add(undefined, 2);
  // Codex drops in from above, X and all.
  toss(codex, { x: at('ada', codex).x, y: -codex.height }, at('ada', codex), 6, 0);
  holding.ada = codex;
  add(say('CODEX MARKS THE SPOT', 'ada'), 18);
  setDown('ada', codex, A + 16);
  add(undefined, 2);
  // Grok on: Theo hops twice.
  const grok = say('GROK ON!', 'theo');
  for (const dy of [0, -2, -4, -2, 0, -2, -4, -2, 0, 0, 0, 0]) {
    theo.y = Y + dy;
    add(grok);
  }
  theo.y = Y;
  // The lesson sticks to the wall, with a bonk.
  holding.ada = note;
  add(undefined, 2);
  const wall = { x: 52, y: 20 };
  holding.ada = undefined;
  toss(note, at('ada', note), wall, 6, 6);
  down.push({ img: note, ...wall });
  add((img) => drawImage(img, BONK, wall.x + 1, wall.y + 1));
  add(say('LESSON? IT STUCK.', 'ada'), 16);
  // A brain in Theo's hands, and the key that opens it.
  holding.theo = brain;
  add(undefined, 4);
  holding.ada = key;
  add(undefined, 2);
  const slot = { x: at('theo', brain).x - 5, y: at('theo', brain).y + 1 };
  holding.ada = undefined;
  toss(key, at('ada', key), slot, 6, 8);
  const keyIn = (img: Image) => drawImage(img, key, slot.x, slot.y);
  holding.theo = BRAIN_LIT;
  add((img) => {
    keyIn(img);
    drawImage(img, BONK, slot.x - 3, slot.y - 2);
  });
  const noBrainer = say('NO BRAINER!', 'theo');
  add((img) => {
    keyIn(img);
    noBrainer(img);
  }, 14);
  // Backsies: the key comes back out, and the brain goes dark.
  holding.theo = brain;
  toss(key, slot, at('ada', key), 6, 8);
  holding.ada = key;
  add(say('BACKSIES!', 'ada'), 12);
  // They turn to face you.
  ada.pose = 'idle-down';
  theo.pose = 'idle-down';
  add(undefined, 14);
  // The still: both facing you, the note on the wall, the folder and the book
  // on the floor, the brain and the key in hand.
  frames.push({ image: shot(), delay: 0 });
  return frames;
}

/**
 * Ada walks the 0.0.5 hallway, off its end and back in at its start, three
 * times, saying UPDATING!, then AGAIN?, then AND AGAIN?. The fourth time she
 * stops halfway, turns to face you and says OUT OF THE LOOP!
 */
function loop({ room, period, view, odd }: HallLayers): GifFrame[] {
  // Her sprite top: feet on the middle row of oak, as in the hallway walk.
  const Y = view.h - 2 * 16 - 8;
  const MID = Math.round(view.w / 2 - 8);
  const ada = { x: -16, pose: 'idle-down-0' };
  const frames: GifFrame[] = [];
  const bubbles = new Map<string, Image>();
  /** A bubble over Ada's head wherever she is, kept inside the art. */
  const say = (text: string) => (img: Image) => {
    if (ada.x < 0 || ada.x > view.w - 16) return;
    const w = width(text) + 6;
    const head = ada.x + 6;
    const x = Math.max(1, Math.min(view.w - w - 1, head - 3));
    const tail = Math.max(1, Math.min(w - 5, head - x));
    const key = `${text}@${tail}`;
    if (!bubbles.has(key)) bubbles.set(key, bubble(text.length, text, tail));
    const b = bubbles.get(key)!;
    drawImage(img, b, x, Y - b.height + 2);
  };
  const shot = (extra?: (img: Image) => void) => {
    const img = createImage(view.w, view.h);
    drawImage(img, room, -period, 0);
    drawImage(img, odd(ada.pose), ada.x, Y);
    extra?.(img);
    return img;
  };
  const add = (extra?: (img: Image) => void, n = 1) => {
    for (let i = 0; i < n; i++) frames.push({ image: shot(extra), delay: DELAY });
  };
  /** Walk from off the start to `to`, two pixels a frame, a new step every second frame. */
  const walk = (to: number, extra?: (img: Image) => void) => {
    ada.x = -16;
    for (let i = 1; ada.x < to; i++) {
      ada.x += 2;
      ada.pose = `walk-side-${Math.floor(i / 2) % 4}`;
      add(extra);
    }
  };

  walk(view.w, say('UPDATING!'));
  walk(view.w, say('AGAIN?'));
  walk(view.w, say('AND AGAIN?'));
  // The fourth time, she stops halfway and turns to you.
  walk(MID);
  for (let i = 0; i < 4; i++) {
    ada.pose = `idle-side-${i}`;
    add();
  }
  const out = say('OUT OF THE LOOP!');
  for (let i = 0; i < 24; i++) {
    ada.pose = `idle-down-${Math.floor(i / 3) % 4}`;
    add(out);
  }
  // The still: Ada facing you, mid-hall, out of the loop.
  frames.push({ image: shot(out), delay: 0 });
  return frames;
}

// Theo's lift poses with his hands somewhere other than at his sides: the row
// of his sprite that a held bar's middle sits on. The seat poses are the lift
// poses sitting down, three rows lower.
const SIT = 3;
const HANDS: Record<string, number> = {
  'exercise-lift-1': 17,
  'exercise-lift-2': 2,
  'exercise-lift-3': 17,
  'seat-lift-1': 17 + SIT,
  'seat-lift-2': 2 + SIT
};

/**
 * Theo works out in the office's gym, jogging from station to station. He
 * runs on the treadmill, pedals the bike and curls at the dumbbells. He jumps
 * to pull the bar off the rack and presses it, carries it to the bench, sits
 * facing you, and presses it again and again.
 */
function gym({ room, unracked, view, at, bar, odd }: GymLayers): GifFrame[] {
  const theo = { ...at.run, pose: 'exercise-run-0', flip: false, bob: 0 };
  // The treadmill's belt frame while Theo runs on it, and whether the bar is
  // on the rack or in his hands.
  let belt = 0;
  let racked = true;
  const frames: GifFrame[] = [];

  /** A seat pose: the lift pose's top half, dropped as sitting drops him, over sit-down's legs. */
  const seats = new Map<string, Image>();
  const look = (pose: string) => {
    if (!pose.startsWith('seat-')) return odd(pose);
    if (!seats.has(pose)) {
      const top = odd(pose.replace('seat-', 'exercise-'));
      const legs = odd('sit-down-0');
      const img = createImage(top.width, top.height);
      const row = top.width * 4;
      img.data.set(top.data.subarray(0, 23 * row), SIT * row);
      img.data.set(legs.data.subarray(26 * row), 26 * row);
      seats.set(pose, img);
    }
    return seats.get(pose)!;
  };
  const shot = () => {
    const img = createImage(view.w, view.h);
    drawImage(img, racked ? room[belt % room.length] : unracked, 0, 0);
    const y = theo.y + theo.bob;
    drawImage(img, look(theo.pose), theo.x, y, theo.flip);
    if (!racked)
      drawImage(
        img,
        bar.img,
        theo.x + 8 - (bar.img.width >> 1),
        y + (HANDS[theo.pose] ?? HANDS['exercise-lift-1']) - bar.mid
      );
    return img;
  };
  const add = (n = 1) => {
    for (let i = 0; i < n; i++) frames.push({ image: shot(), delay: DELAY });
  };
  /** Jog to each point in turn, one way at a time, four pixels a frame, a new stride every frame. */
  const jog = (...to: Point[]) => {
    for (const p of to)
      while (theo.x !== p.x || theo.y !== p.y) {
        const step = frames.length % 4;
        if (theo.x !== p.x) {
          const dx = Math.sign(p.x - theo.x) * Math.min(4, Math.abs(p.x - theo.x));
          theo.x += dx;
          theo.flip = dx < 0;
          theo.pose = `exercise-run-${step}`;
        } else {
          const dy = Math.sign(p.y - theo.y) * Math.min(4, Math.abs(p.y - theo.y));
          theo.y += dy;
          theo.flip = false;
          theo.pose = `walk-${dy < 0 ? 'up' : 'down'}-${step}`;
        }
        add();
      }
  };
  /** Carry the bar to each point, chest high, two pixels a frame, bobbing with each step. */
  const carry = (...to: Point[]) => {
    theo.pose = 'exercise-lift-1';
    for (const p of to)
      while (theo.x !== p.x || theo.y !== p.y) {
        if (theo.x !== p.x) theo.x += Math.sign(p.x - theo.x) * Math.min(2, Math.abs(p.x - theo.x));
        else theo.y += Math.sign(p.y - theo.y) * Math.min(2, Math.abs(p.y - theo.y));
        theo.bob = (frames.length >> 1) % 2;
        add();
      }
    theo.bob = 0;
  };

  // The treadmill: running in place, the belt turning under him.
  for (let i = 0; i < 28; i++) {
    belt = i;
    theo.pose = `exercise-run-${i % 4}`;
    add();
  }
  belt = 0;
  // Off the back of the treadmill and onto the bike.
  jog({ x: at.run.x, y: at.cycle.y }, at.cycle);
  for (let i = 0; i < 28; i++) {
    theo.pose = `exercise-cycle-${i % 4}`;
    add();
  }
  // Up to the dumbbells, and curls.
  jog({ x: at.cycle.x, y: at.curl.y }, at.curl);
  theo.flip = false;
  for (let i = 0; i < 30; i++) {
    theo.pose = Math.floor(i / 3) % 2 ? 'exercise-lift-1' : 'exercise-lift-0';
    add();
  }
  // Along to the rack. He turns, reaches, and jumps to pull the bar off.
  jog(at.rack);
  theo.flip = false;
  theo.pose = 'idle-down-0';
  add();
  theo.pose = 'exercise-lift-2';
  add(2);
  racked = false;
  theo.y -= 3;
  add();
  theo.y += 3;
  add();
  // Down to his chest, a strain, and up.
  theo.pose = 'exercise-lift-1';
  add(3);
  theo.pose = 'exercise-lift-3';
  for (const dx of [1, -1, 1, -1]) {
    theo.x += dx;
    add();
  }
  theo.pose = 'exercise-lift-2';
  add(14);
  theo.pose = 'exercise-lift-1';
  add(3);
  theo.pose = 'exercise-lift-2';
  add(8);
  // He carries the bar to the bench and sits on its end, facing you, a beat
  // before he presses.
  theo.pose = 'exercise-lift-1';
  add(2);
  carry({ x: at.rack.x, y: at.bench.y }, at.bench);
  theo.pose = 'seat-lift-1';
  add(17);
  // Up it goes, then twice more, and he holds it there.
  theo.pose = 'seat-lift-2';
  add(6);
  for (let rep = 0; rep < 2; rep++) {
    theo.pose = 'seat-lift-1';
    add(3);
    theo.pose = 'seat-lift-2';
    add(4);
  }
  add(8);
  // The still: Theo on the bench with the bar up.
  frames.push({ image: shot(), delay: 0 });
  return frames;
}

/**
 * Every release's art. `share` is the GIF frame, counted from 0, that becomes
 * the link preview while that release is the newest one, and `shareLight` is
 * whether that frame is drawn by night or by day. The owner picks both when
 * the art is made; there is no default.
 */
const ART: {
  name: string;
  frames: (layers: Layers) => GifFrame[];
  share: number;
  shareLight: 'night' | 'day';
}[] = [
  // The whole hello in its bubble.
  { name: 'hello-world', frames: (l) => helloWorld(l.desk), share: 30, shareLight: 'night' },
  // Ada backed off on the sidewalk, wondering.
  { name: 'stuck-sign-in', frames: (l) => stuckSignIn(l.door), share: 55, shareLight: 'night' },
  // The penguin standing on the floor, by day, where his ink shows.
  { name: 'linux', frames: (l) => linux(l.desk), share: 30, shareLight: 'day' },
  // Ada facing the street beside the locked door, by night, where the glass glows.
  { name: 'locked-door', frames: (l) => lockedDoor(l.door), share: 60, shareLight: 'night' },
  // Ada mid-hall among the windows, by day, where the sky shows.
  { name: 'windows', frames: (l) => windows(l.hall), share: 0, shareLight: 'day' },
  // Theo's brain lit with Ada's key in it: no brainer.
  { name: 'hand-off', frames: (l) => handOff(l.hall), share: 158, shareLight: 'night' },
  // Ada facing you mid-hall, by day: out of the loop.
  { name: 'loop', frames: (l) => loop(l.hall), share: 270, shareLight: 'day' },
  // Theo on the bench with the bar up.
  { name: 'gym', frames: (l) => gym(l.gym), share: 197, shareLight: 'day' }
];

// The link preview's size, and the ink it sits on.
const CARD = { w: 1200, h: 630 };

/** One frame, scaled up by whole pixels and centred on ink, at the preview's size. */
function shareCard(img: Image): Image {
  const scale = Math.min(Math.floor(CARD.w / img.width), Math.floor(CARD.h / img.height));
  const card = createImage(CARD.w, CARD.h);
  const ink = hexToRgba(PALETTE.k.hex);
  for (let p = 0; p < CARD.w * CARD.h; p++) card.data.set(ink, p * 4);
  const big = scaleImage(img, scale);
  drawImage(card, big, (CARD.w - big.width) >> 1, (CARD.h - big.height) >> 1);
  return card;
}

/**
 * Writes <name>.gif and its still, <name>.png, into `dir`, for one theme. In
 * the light an animation picks for its link preview, it also writes
 * <name>-share.png into `shareDir`, the same folder in both themes.
 */
export function writeReleaseArt(
  layers: Layers,
  dir: string,
  theme: 'night' | 'day',
  shareDir: string
): void {
  mkdirSync(dir, { recursive: true });
  for (const art of ART) {
    const frames = art.frames(layers);
    const gif = frames.slice(0, -1);
    if (!Number.isInteger(art.share) || art.share < 0 || art.share >= gif.length)
      throw new Error(`${art.name}: share frame ${art.share} is not one of its ${gif.length}`);
    writeFileSync(join(dir, `${art.name}.gif`), encodeGif(gif));
    writeFileSync(join(dir, `${art.name}.png`), encodePng(frames.at(-1)!.image));
    if (theme === art.shareLight) {
      mkdirSync(shareDir, { recursive: true });
      writeFileSync(
        join(shareDir, `${art.name}-share.png`),
        encodePng(shareCard(gif[art.share].image))
      );
    }
    console.log(`${relative(process.cwd(), join(dir, art.name))}.gif: ${gif.length} frames`);
  }
}
