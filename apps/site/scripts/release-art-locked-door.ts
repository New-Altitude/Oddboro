// 0.0.4's animation: Ada locks the front door, as the office acts only from its own page.
import { createImage, drawImage, type Image } from '@oddboro/sprites/png';
import { type GifFrame } from './gif.ts';
import type { DoorLayers } from './release-art.ts';
import { sprite, bubble, DELAY, doorAt, leaves } from './release-art-kit.ts';

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
    drawImage(img, slid < 1 ? leaves(shut, opened, slid) : shut, door.x, door.y);
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

export { lockedDoor };
