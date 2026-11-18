// 0.0.11's animation: the ADVANCED switch flips on, the screen grows into a terminal full of code.
import { createImage, drawImage, type Image } from '@oddboro/sprites/png';
import { hexToRgba } from '@oddboro/sprites/px';
import { type GifFrame } from './gif.ts';
import type { DeskLayers } from './release-art.ts';
import { PALETTE, sprite, SCREEN, GLYPHS, width, frame, DELAY } from './release-art-kit.ts';
import { FLASH } from './release-art-linux.ts';

/** Writes `text` in the 5-pixel font into `img` at x, y, in palette key `key`. */
function print(img: Image, text: string, x: number, y: number, key: string): void {
  const rgba = hexToRgba(PALETTE[key].hex);
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    glyph.forEach((row, gy) =>
      [...row].forEach((on, gx) => {
        const px = x + gx;
        const py = y + gy;
        if (on === 'x' && px >= 0 && py >= 0 && px < img.width && py < img.height)
          img.data.set(rgba, (py * img.width + px) * 4);
      })
    );
    x += glyph[0].length + 1;
  }
}

/** A filled box in palette key `key`, clipped to `img`. */
function box(img: Image, x: number, y: number, w: number, h: number, key: string): void {
  const rgba = hexToRgba(PALETTE[key].hex);
  for (let py = Math.max(0, y); py < Math.min(img.height, y + h); py++)
    for (let px = Math.max(0, x); px < Math.min(img.width, x + w); px++)
      img.data.set(rgba, (py * img.width + px) * 4);
}

// The wall switch beside the window, its label above it, and the terminal
// the left desk's monitor grows into, in the vignette's pixels.
const SWITCH = { x: 106, y: 10 };
const ADVANCED = 'ADVANCED';
const TERMINAL = { x: 26, y: 2, w: 62, h: 31 };
const TITLE = 'PROJECTS';

// The code the terminal types: each line its words' lengths, and the key of
// each word. A line starting with '>' is a prompt.
const CODE: [string, number[]][] = [
  ['>y', [5, 7]],
  ['GG', [4, 9, 3]],
  ['gG', [6, 4, 8]],
  ['GyG', [3, 5, 10]],
  ['GG', [7, 6]],
  ['>y', [4, 6, 3]],
  ['gGG', [5, 3, 7]],
  ['GG', [9, 4]],
  ['yGg', [3, 8, 5]],
  ['>y', [6, 5]],
  ['GgG', [4, 4, 9]],
  ['GG', [8, 5]]
];

/** The wall switch: its lamp red when off and green when on, and its lever down, halfway or up. */
function wallSwitch(state: 'off' | 'half' | 'on'): Image {
  const knob = { off: 7, half: 6, on: 4 }[state];
  const rows = ['kkkkkkk', 'kmmmmmk', `km${state === 'on' ? 'vv' : 'RR'}mmk`, 'kmmmmmk'];
  for (let y = 4; y <= 7; y++)
    rows.push(y === knob || (state === 'half' && y === 5) ? 'kmm=mmk' : 'kmm5mmk');
  rows.push('kkkkkkk');
  return sprite(rows);
}

/** The terminal `w` by `h`, `lines` lines of its code typed and the next one `words` words in. */
function terminal(w: number, h: number, lines: number, words: number, cursor: boolean): Image {
  const img = createImage(w, h);
  box(img, 0, 0, w, h, 'k');
  box(img, 1, 1, w - 2, 7, 'T');
  box(img, 1, 8, w - 2, h - 9, '7');
  if (w >= width(TITLE) + 4 && h >= 9) print(img, TITLE, (w - width(TITLE)) >> 1, 2, '=');
  // Each line is 1 pixel of words with 2 of space; the newest at the bottom.
  const PITCH = 3;
  const fit = Math.max(0, Math.floor((h - 11) / PITCH));
  const shown = CODE.slice(0, lines + 1).map(
    (l, i) => [l, i === lines ? words : l[1].length] as [[string, number[]], number]
  );
  const first = Math.max(0, shown.length - fit);
  shown.slice(first).forEach(([[keys, lens], n], row) => {
    const y = 10 + row * PITCH;
    let x = 3;
    if (keys[0] === '>') {
      box(img, x, y, 2, 1, 'y');
      x += 4;
    }
    const wordKeys = keys[0] === '>' ? keys.slice(1) : keys;
    for (let i = 0; i < n; i++) {
      box(img, x, y, lens[i], 1, wordKeys[i] ?? 'G');
      x += lens[i] + 2;
    }
    if (cursor && row === shown.length - 1 - first) box(img, x, y - 1, 2, 3, 'g');
  });
  return img;
}

function advanced(layers: DeskLayers): GifFrame[] {
  const frames: GifFrame[] = [];
  let t = 0;
  const label = layers.shade(
    (() => {
      const w = width(ADVANCED) + 4;
      const img = createImage(w, 9);
      box(img, 0, 0, w, 9, 'k');
      box(img, 1, 1, w - 2, 7, '=');
      print(img, ADVANCED, 2, 2, 'k');
      return img;
    })()
  );
  const labelAt = { x: SWITCH.x + 3 - (label.width >> 1), y: 0 };
  if (labelAt.x < TERMINAL.x + TERMINAL.w + 2)
    throw new Error('advanced: the label runs under the terminal');
  const plates = {
    off: layers.shade(wallSwitch('off')),
    half: layers.shade(wallSwitch('half')),
    on: layers.shade(wallSwitch('on'))
  };
  const flash = sprite(Array(SCREEN.h).fill(FLASH.repeat(SCREEN.w)));
  const add = (plate: Image, extra: (img: Image) => void = () => {}, delay = DELAY) =>
    frames.push({
      image: frame(layers, t++, (img) => {
        drawImage(img, label, labelAt.x, labelAt.y);
        drawImage(img, plate, SWITCH.x, SWITCH.y);
        extra(img);
      }),
      delay
    });

  // The Odd works; the switch is off.
  for (let i = 0; i < 12; i++) add(plates.off);
  // The switch flips on.
  add(plates.half);
  for (let i = 0; i < 4; i++) add(plates.on);
  // The monitor flashes twice.
  for (const on of [true, false, true, false])
    add(plates.on, (img) => on && drawImage(img, flash, SCREEN.x, SCREEN.y));
  // The screen grows into the terminal.
  const GROW = 7;
  for (let i = 1; i <= GROW; i++) {
    const s = i / GROW;
    const w = Math.round(SCREEN.w + (TERMINAL.w - SCREEN.w) * s);
    const h = Math.round(SCREEN.h + (TERMINAL.h - SCREEN.h) * s);
    const x = Math.round(SCREEN.x + (TERMINAL.x - SCREEN.x) * s);
    const y = Math.round(SCREEN.y + (TERMINAL.y - SCREEN.y) * s);
    add(plates.on, (img) => drawImage(img, terminal(w, h, 0, 0, false), x, y));
  }
  // The code types out, a word a frame, and scrolls.
  const at = (img: Image, lines: number, words: number, cursor: boolean) =>
    drawImage(img, terminal(TERMINAL.w, TERMINAL.h, lines, words, cursor), TERMINAL.x, TERMINAL.y);
  for (let line = 0; line < CODE.length; line++) {
    const n = CODE[line][1].length;
    for (let word = CODE[line][0][0] === '>' ? 0 : 1; word <= n; word++)
      add(plates.on, (img) => at(img, line, word, true));
  }
  // It waits for more, the cursor blinking.
  for (let i = 0; i < 16; i++)
    add(plates.on, (img) => at(img, CODE.length - 1, CODE.at(-1)![1].length, i % 4 < 2));
  // The still: the terminal full of code, the switch on.
  frames.push({
    image: frame(layers, 0, (img) => {
      drawImage(img, label, labelAt.x, labelAt.y);
      drawImage(img, plates.on, SWITCH.x, SWITCH.y);
      at(img, CODE.length - 1, CODE.at(-1)![1].length, true);
    }),
    delay: 0
  });
  return frames;
}

export { advanced };
