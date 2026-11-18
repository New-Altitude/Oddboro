// 0.0.2's animation: Ada walks into the shut front door, the stuck sign-in fix.
import { createImage, drawImage, type Image } from '@oddboro/sprites/png';
import { type GifFrame } from './gif.ts';
import type { DoorLayers } from './release-art.ts';
import { bubble, DELAY, BONK } from './release-art-kit.ts';

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

export { stuckSignIn };
