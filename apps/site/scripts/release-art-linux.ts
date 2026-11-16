// 0.0.3's animation: a penguin jumps out of the screen and lands on the floor.
import { createImage, drawImage, type Image } from '@oddboro/sprites/png';
import { type GifFrame } from './gif.ts';
import type { DeskLayers } from './release-art.ts';
import { sprite, SCREEN, frame, DELAY } from './release-art-kit.ts';

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

const FLASH = 'g';

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

export { FLASH, linux };
