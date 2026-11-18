// 0.0.5's animation: Ada walks an endless hallway of windows, for the Windows app.
import { createImage, drawImage } from '@oddboro/sprites/png';
import { type GifFrame } from './gif.ts';
import type { HallLayers } from './release-art.ts';
import { DELAY } from './release-art-kit.ts';

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

export { windows };
