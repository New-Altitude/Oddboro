// 0.0.10's animation: the BUG HUNTERS van pulls up and two hunters walk in.
import { createImage, drawImage } from '@oddboro/sprites/png';
import { type GifFrame } from './gif.ts';
import type { CurbLayers } from './release-art.ts';
import { sprite, GLYPHS, DELAY, LEAF, doorAt, leaves } from './release-art-kit.ts';

// The bug hunters' van, nose to the right like the bus: a white box van with
// a lower cab, a red stripe, and six columns spare at the rear for its back
// door to swing into. Its lettering is stamped on below.
const VAN_ROWS = [
  '.......kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk............',
  '......k=====================================k...........',
  '......k=====================================k...........',
  '......kqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk...........',
  '......kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPk...........',
  '......kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPk...........',
  '......kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPkkkkkkk.....',
  '......kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPk======k....',
  '......kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPkkccccCck...',
  '......kRPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPkkcccccCck..',
  '......kRPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPkkccccckCck.',
  '......kRPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPkkkkkkkkkkk.',
  '......kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPkPPPPPPPPPPk',
  '......kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPqP55PPPPPPlk',
  '......kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPqPPPPPPPPPLk',
  '......kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPqPPPPPPPPPPk',
  '......kRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRqRRRRRRRRRRk',
  '......kRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRqRRRRRRRRRRk',
  '......5PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPqPPPPPPPPPPk',
  '......5qqqqqkkkkkqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkkkkkqqqq5',
  '......5qqqqkkkkkkkqqqqqqqqqqqqqqqqqqqqqqqqqqqkkkkkkkqqq5',
  '......kkkkkkK555KkkkkkkkkkkkkkkkkkkkkkkkkkkkkkK555Kkkkkk',
  '...........kK5k5Kk...........................kK5k5Kk....',
  '...........kK555Kk...........................kK555Kk....',
  '............kKKKk.............................kKKKk.....',
  '.......______kkk_______________________________kkk_____.',
  '.......________________________________________________.'
];
// The open back door, swung out flat beside the box: its outer face, a
// window, and its hinge on the rear edge.
const VAN_DOOR = [
  '.kkkkk',
  'k====k',
  'kPPPPk',
  'kkkkkk',
  'kcccck',
  'kcccck',
  'kkkkkk',
  ...Array(10).fill('kPPPPk'),
  'kqqqqk',
  'kqqqqk',
  'kkkkkk'
];
// The logo: a bug in a red ring, struck through.
const NO_BUG = ['.RRR.', 'RRk.R', 'RkRkR', 'R.kRR', '.RRR.'];

/** `rows` with `glyphs` stamped in `key` at (x, y), and `art` (palette keys) where it is not `.`. */
function stamp(rows: string[], at: { x: number; y: number }, art: string[]): string[] {
  return rows.map((row, y) => {
    const line = art[y - at.y];
    if (!line) return row;
    return [...row]
      .map((c, x) => (line[x - at.x] && line[x - at.x] !== '.' ? line[x - at.x] : c))
      .join('');
  });
}
/** Text in the 5-pixel font as rows of `key`, one column between letters. */
function lettering(text: string, key: string): string[] {
  return [0, 1, 2, 3, 4].map((y) =>
    [...text].map((ch) => GLYPHS[ch][y].replaceAll('x', key)).join('.')
  );
}
const VAN_SIDE = (() => {
  let rows = stamp(VAN_ROWS, { x: 16, y: 4 }, NO_BUG);
  rows = stamp(rows, { x: 23, y: 4 }, lettering('BUG', 'k'));
  return stamp(rows, { x: 12, y: 10 }, lettering('HUNTERS', 'k'));
})();
// The wheels turn: the hub's dark spot moves round between frames.
const VAN_ROLL = VAN_SIDE.map((r, y) => (y === 22 ? r.replaceAll('kK5k5Kk', 'kKk5kKk') : r));
const VAN_OPEN = stamp(VAN_SIDE, { x: 0, y: 1 }, VAN_DOOR);

// A bug hunter's hood, visor and mask, drawn over the head from row 3, by
// facing: a yellow hood, a dark visor with a glint, and a respirator with a
// filter each side. From behind it is all hood.
const HOOD: Record<'down' | 'up' | 'side', string[]> = {
  down: [
    '....kkkkkkkk....',
    '...kyyyyyyyyk...',
    '..kyyyyyyyyyYk..',
    '..kyykkkkkkkYk..',
    '..kykKmKKKKKkk..',
    '..kykKKKKKmKkk..',
    '..kyYkkkkkkkYk..',
    '..kYkk5MM5kkYk..',
    '..kYkMk55kMk9k..',
    '..k9kMk55kMk9k..',
    '...k9kkkkkk9k...',
    '....kk9999kk....',
    '....kYYYYYYk....'
  ],
  up: [
    '....kkkkkkkk....',
    '...kyyyyyyyyk...',
    '..kyyyyyyyyyYk..',
    '..kyyyyyyyyyYk..',
    '..kYyyyyyyyyYk..',
    '..kYyyyyyyyYYk..',
    '..kYYyyyyyYY9k..',
    '..k9YYYYYYYY9k..',
    '..k9YYYYYYYY9k..',
    '..k99YYYYYY99k..',
    '...k99YYYY99k...',
    '....kk9999kk....',
    '....kYYYYYYk....'
  ],
  side: [
    '....kkkkkkk.....',
    '...kyyyyyyyk....',
    '..kyyyyyyyyyk...',
    '..kyyyyyykkkkk..',
    '..kyyyyykKmKKk..',
    '..kYyyyykKKKMk..',
    '..kYyyyyykkkkk..',
    '..kYyyyyk5MMk...',
    '..k9Yyyyk55MMk..',
    '..k9YYYYk5MMk...',
    '...k99YYYkkk....',
    '....kk999kk.....',
    '.....kYYYYk.....'
  ]
};
// The spray tank on a hunter's back, from row 15: seen from behind, side on
// (behind the shoulder), and from the front only its straps show.
const TANK: Record<'down' | 'up' | 'side', string[]> = {
  down: ['................', '.....k....k.....', '.....k....k.....', '.....k....k.....'],
  up: [
    '.....kkkkkk.....',
    '....kMrRRR8k....',
    '....kmrRRR8k....',
    '....kMrRRR8k....',
    '....kMrRRR8k....',
    '....kMrRRR8k....',
    '....kMrRRR8k....',
    '.....kkkkkk.....'
  ],
  side: ['..kkk...', '.krR8k..', '.krR8k..', '.krR8k..', '.krR8k..', '.krR8k..', '..kkk...']
};

// How far past the threshold a hunter walks before the lobby's dark takes them.
const DEPTH = 8;
// The still: one hunter side on in the mask, the other walking off, the van behind.
const STILL_AT = 52;

/**
 * 0.0.10, a release of bug fixes. A white van marked BUG HUNTERS drives up
 * the near lane and stops past the crossing. Its back door swings open and two
 * bug hunters hop out, one after the other, in yellow suits with hoods, masks
 * and spray tanks. They walk to the front door side by side, the view tilting
 * up with them, the door slides open, and in they go. It slides shut behind
 * them.
 */
function bugHunters({
  room,
  view,
  door,
  open,
  lane,
  odd,
  head,
  torso,
  shade
}: CurbLayers): GifFrame[] {
  const frames: GifFrame[] = [];
  const van = {
    side: shade(sprite(VAN_SIDE)),
    roll: shade(sprite(VAN_ROLL)),
    open: shade(sprite(VAN_OPEN))
  };
  const hoods = {
    down: shade(sprite(HOOD.down)),
    up: shade(sprite(HOOD.up)),
    side: shade(sprite(HOOD.side))
  };
  const tanks = {
    down: shade(sprite(TANK.down)),
    up: shade(sprite(TANK.up)),
    side: shade(sprite(TANK.side))
  };
  const shut = doorAt(room, door.x, door.y);
  const opened = doorAt(open, 0, 0);
  // The doorway the hunters step through, inside the jamb, in the room's pixels.
  const doorway = {
    x0: door.x + LEAF.left,
    x1: door.x + LEAF.right,
    y0: door.y + LEAF.top,
    y1: door.y + LEAF.bottom
  };

  // The van's wheels sit on the lane where the bus's do, and it stops with
  // its nose at the view's edge, its back by the crossing.
  const vanY = lane + 13 - 24;
  const stop = view.w - VAN_SIDE[0].length;
  const car = { x: -VAN_SIDE[0].length, img: van.side };
  let slid = 1;
  // The view's top in the room: it starts at the bottom, on the street.
  let cam = room.height - view.h;

  type Hunter = { x: number; y: number; pose: string; flip: boolean; out: boolean };
  // Feet on the road beside the van's back door.
  const kerbY = vanY + 24 - 30;
  const hunters: Hunter[] = [0, 1].map(() => ({
    x: 0,
    y: kerbY,
    pose: 'idle-side-0',
    flip: true,
    out: false
  }));

  /** A hunter, suited up: the tank behind (or, facing you, its straps in front), then the hood. */
  const suited = (h: Hunter) => {
    const dir = h.pose.includes('-side-') ? 'side' : h.pose.includes('-up-') ? 'up' : 'down';
    const img = createImage(16, 32);
    const [tx, ty] = torso(h.pose);
    const [hx, hy] = head(h.pose);
    if (dir === 'side') drawImage(img, tanks.side, tx, 15 + ty);
    drawImage(img, odd(h.pose), 0, 0);
    if (dir !== 'side') drawImage(img, tanks[dir], tx, 15 + ty);
    drawImage(img, hoods[dir], hx, 3 + hy);
    return img;
  };

  const shot = () => {
    const img = createImage(room.width, room.height);
    drawImage(img, room, 0, 0);
    drawImage(img, slid < 1 ? leaves(shut, opened, slid) : shut, door.x, door.y);
    // Whoever has stepped over the threshold shows only through the doorway,
    // darker the further into the lobby they go.
    const sill = door.y + door.h;
    const inside = (h: Hunter) => h.out && h.y + 30 < sill;
    for (const h of hunters.filter(inside)) {
      const body = suited(h);
      const dim = 1 - (0.75 * (sill - h.y - 30)) / DEPTH;
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 16; x++) {
          const rx = h.x + x;
          const ry = h.y + y;
          if (rx < doorway.x0 || rx > doorway.x1 || ry < doorway.y0 || ry > doorway.y1) continue;
          const i = (y * 16 + (h.flip ? 15 - x : x)) * 4;
          if (!body.data[i + 3]) continue;
          const o = (ry * room.width + rx) * 4;
          for (let c = 0; c < 3; c++) img.data[o + c] = Math.round(body.data[i + c] * dim);
        }
    }
    // Front to back: the van, then the hunters on the sidewalk, lowest last.
    drawImage(img, car.img, car.x, vanY);
    for (const h of [...hunters].filter((h) => h.out && !inside(h)).sort((a, b) => a.y - b.y))
      drawImage(img, suited(h), h.x, h.y, h.flip);
    const out = createImage(view.w, view.h);
    drawImage(out, img, 0, -Math.round(cam));
    return out;
  };
  const add = (n = 1, step?: () => void) => {
    for (let i = 0; i < n; i++) {
      step?.();
      frames.push({ image: shot(), delay: DELAY });
    }
  };

  // A quiet street.
  add(6);
  // The van drives in, slowing to a stop, its wheels turning.
  const from = car.x;
  const STEPS = 26;
  for (let i = 1; i <= STEPS; i++)
    add(1, () => {
      const s = i / STEPS;
      car.x = Math.round(from + (stop - from) * (1 - (1 - s) * (1 - s)));
      car.img = i < STEPS && (i >> 1) % 2 ? van.roll : van.side;
    });
  car.img = van.side;
  add(5);
  // The back door swings open.
  car.img = van.open;
  add(3);

  // The hunters' marks: either side of the doorway's middle, on the sidewalk
  // a step below the door, then through it.
  const mid = door.x + door.w / 2 - 8;
  const cols = [mid - 6, mid + 6];
  const below = door.y + door.h - 30 + 10;
  const gone = door.y + door.h - 30 - DEPTH;
  // Each hunter: hop down from the back of the van, walk along the road to
  // their column, then up the sidewalk and in. The second follows nine
  // frames behind the first.
  type Leg = { x?: number; y?: number };
  const plans: Leg[][] = cols.map((x) => [{ x }, { y: below }, { y: gone }]);
  const starts = [0, 9];
  const stepOf = hunters.map(() => 0);
  const legOf = hunters.map(() => 0);
  const hop = [-3, -2, 0];
  let t = 0;
  const done = () => hunters.every((_, k) => legOf[k] >= plans[k].length);
  const dooring = () => Math.min(...hunters.map((h) => (h.out ? h.y : Infinity)));
  while (!done()) {
    add(1, () => {
      hunters.forEach((h, k) => {
        const s = t - starts[k];
        if (s < 0) return;
        if (s < hop.length) {
          // Out of the back door and down onto the road.
          h.out = true;
          h.x = car.x + 6 - 14;
          h.y = kerbY + hop[s];
          h.pose = 'idle-side-0';
          h.flip = true;
          return;
        }
        const at = (leg: Leg) => (leg.x ?? h.x) === h.x && (leg.y ?? h.y) === h.y;
        while (plans[k][legOf[k]] && at(plans[k][legOf[k]])) legOf[k]++;
        const leg = plans[k][legOf[k]];
        if (!leg) return;
        if (leg.x !== undefined && h.x !== leg.x) {
          h.flip = leg.x < h.x;
          h.x += Math.sign(leg.x - h.x) * Math.min(2, Math.abs(leg.x - h.x));
          h.pose = `walk-side-${(stepOf[k]++ >> 1) % 4}`;
        } else if (leg.y !== undefined && h.y !== leg.y) {
          h.y += Math.sign(leg.y - h.y) * Math.min(2, Math.abs(leg.y - h.y));
          h.flip = false;
          h.pose = `walk-up-${(stepOf[k]++ >> 1) % 4}`;
        }
        if (at(leg)) legOf[k]++;
      });
      // The door slides open as the first of them nears it.
      const lead = dooring();
      if (lead < below + 14 && slid > 0) slid = Math.max(0, slid - 0.2);
      // The view tilts up with the first of them, a pixel or two a frame.
      const want = Math.max(0, Math.min(room.height - view.h, lead + 16 - view.h / 2 - 8));
      if (cam > want) cam = Math.max(want, cam - 2);
      t++;
    });
  }
  for (const h of hunters) h.out = false;
  add(3);
  // The door slides shut behind them.
  for (const s of [0.15, 0.35, 0.55, 0.72, 0.86, 0.95, 1]) {
    slid = s;
    add();
  }
  add(14);
  frames.push({ image: frames[STILL_AT].image, delay: 0 });
  return frames;
}

export { STILL_AT, bugHunters };
