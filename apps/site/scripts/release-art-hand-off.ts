// 0.0.6's animation: a relay in the hall, one pun a hand-off.
import { createImage, drawImage, type Image } from '@oddboro/sprites/png';
import { type GifFrame } from './gif.ts';
import type { HallLayers } from './release-art.ts';
import { sprite, width, bubble, DELAY, BONK } from './release-art-kit.ts';

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

export { handOff };
