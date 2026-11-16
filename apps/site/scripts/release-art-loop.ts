// 0.0.7's animation: Ada walks the hall again and again, then out of the loop.
import { createImage, drawImage, type Image } from '@oddboro/sprites/png';
import { type GifFrame } from './gif.ts';
import type { HallLayers } from './release-art.ts';
import { width, bubble, DELAY } from './release-art-kit.ts';

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

export { loop };
