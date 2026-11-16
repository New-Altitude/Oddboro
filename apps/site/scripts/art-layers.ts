// A stage of art.ts, not an entry point: the walk rows, the bus, the doors, the
// hall, the gym, the entrance, the personas' looks, the hunters and the rack.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToRgba, parsePx, spriteMeta } from '@oddboro/sprites/px';
import { createImage, type Image } from '@oddboro/sprites/png';
import { type Persona } from './release-art.ts';
import { catalog, palette, sprites, type Rect } from './paint.ts';
import {
  composeFrame,
  loadLibrary,
  lookPalette,
  type DrawnPart,
  type LookSpec
} from '@oddboro/sprites/look';
import { composeWorld, TILE, type DrawCmd, type RoomTemplate, type World } from '@oddboro/world';
import { loadSpaces } from '@oddboro/world/load';
import { ROOT, world, rectOf } from './art-office.ts';

// Odd sheets: one row per animation, four frames wide.
const STAFF: { name: string; sprite: string; variant: string }[] = [
  { name: 'marshall', sprite: 'staff', variant: 'marshall' },
  { name: 'ada', sprite: 'staff-b', variant: 'ada' },
  { name: 'theo', sprite: 'staff', variant: 'theo' },
  { name: 'juno', sprite: 'staff', variant: 'juno' }
];
const ROWS = [
  'walk-side',
  'walk-up',
  'walk-down',
  'idle-side',
  'idle-up',
  'idle-down',
  'sit-up',
  'sit-down'
];
const FRAMES = 4;
const bus = sprites.get('street-bus')!;
const doorDraw = world.draws.find((d) => d.sprite === 'street-front-door')!;
const openDraws = world.draws.map((d) => (d === doorDraw ? { ...d, frame: 'open' } : d));
const doorRect = rectOf(doorDraw);
// The near lane is the first row of road; Odds step off onto the sidewalk above the curb.
const lane = Math.min(
  ...world.draws.filter((d) => d.sprite.startsWith('floor-asphalt')).map((d) => d.y / TILE)
);

/**
 * The hallway in 0.0.5's release art: a plaster wall with a window in every
 * other tile and a wall light on every other wall between, over three rows of
 * oak, drawn the way the vignette office draws its walls (cap, then face,
 * then the wall's shadow on the first row of floor). It repeats every four
 * tiles. The art slides an eight-tile view along it, from one period in, so
 * twenty tiles leave every light that reaches the view (64 pixels at most)
 * in the strip, and the light repeats as the walls do.
 */
const HALL = { w: 20 * TILE, h: 6 * TILE, period: 4 * TILE, view: { w: 8 * TILE, h: 6 * TILE } };
const OAK = [
  ['0', '1'],
  ['2', '0'],
  ['1', '3']
];
const hallDraws: DrawCmd[] = [];
const hallLights: World['lights'] = [];
for (let t = 0; t < HALL.w / TILE; t++) {
  const x = t * TILE;
  const at = (sprite: string, frame: string, y: number, pass: DrawCmd['pass']) =>
    hallDraws.push({ sprite, frame, x, y, z: y, pass });
  OAK.forEach((row, r) => at('floor-oak', row[t % 2], 3 * TILE + r * TILE, 0));
  at('fx-wall-shadow', '0', 3 * TILE, 0);
  at('wall-plaster-cap', 'm10', 0, 1);
  at(t % 2 ? 'wall-plaster-face' : 'wall-plaster-window', '0', TILE, 1);
  if (t % 4 === 1) {
    const y = TILE + 6;
    at('gym-wall-light', '0', y, 2);
    for (const l of catalog['gym-wall-light'].lights)
      hallLights.push({ ...l, x: x + l.x, y: y + l.y, clip: { x: 0, y: 0, w: HALL.w, h: HALL.h } });
  }
}

/**
 * The gym in 0.0.8's release art: the office's gym stamp, its walls, floor and
 * equipment, packed into a room that fits the eight by six tiles every release
 * art shows. Along the back wall stand the treadmill, the dumbbells and the
 * rack; on the floor, the bike and the bench, with room to jog between them.
 * The view cuts off the side walls, the top of the back wall and the front
 * wall.
 */
const GYM_STAMP = loadSpaces().rooms.gym;
const GYM_ROOM: RoomTemplate = {
  ...GYM_STAMP,
  map: [
    'WWWWWWWWWW',
    'WWWWWNWWWW',
    'WWWWWNWWWW',
    'W........W',
    'W........W',
    'W........W',
    'W........W',
    'W........W',
    'WWWWWWWWWW'
  ],
  props: [
    { sprite: 'gym-mirror', at: [2, 2] },
    { sprite: 'gym-wall-light', at: [1, 2] },
    { sprite: 'gym-wall-light', at: [7, 2] },
    { sprite: 'gym-treadmill', at: [1, 3] },
    { sprite: 'gym-dumbbells', at: [3, 3] },
    { sprite: 'gym-rack', at: [6, 3] },
    { sprite: 'gym-bottle', at: [2, 3] },
    { sprite: 'gym-bike', at: [2, 5] },
    { sprite: 'gym-bench', at: [6, 5] },
    { sprite: 'gym-kettlebells', at: [8, 6] }
  ]
};
const gymWorld = composeWorld(
  { id: 'release-gym', name: GYM_STAMP.name, rooms: [{ room: 'gym', at: [0, 0] }] },
  { gym: GYM_ROOM },
  catalog
);
if (gymWorld.missing.length) {
  console.error(`Missing sprites in the gym: ${gymWorld.missing.join(', ')}`);
  process.exit(1);
}
const GYM_VIEW: Rect = { x: TILE, y: TILE + 4, w: 8 * TILE, h: 6 * TILE };
// The bench has no seat of its own. Theo sits this many pixels up from its
// near tile, on the middle of the pad.
const BENCH_SEAT = 6;

/**
 * The lobby in 0.0.9's release art, seen from inside: its back wall holds
 * the front doors, with a floor lamp, a plant and a window to each side, and
 * the doormat in front. The doors are the street door's own leaves, the
 * doorway's full height, with glass the sky shows through, and frames that
 * slide them open. The sprite is built here for this script only, from the
 * street door's pixels and the lobby entrance's cap.
 */
const ENTRANCE_DOOR = 'release-entrance';
const ENTRANCE_STEPS = ['closed', 'slide-1', 'slide-2', 'slide-3', 'open'] as const;
{
  const street = sprites.get('street-front-door')!;
  const cap = sprites.get('lobby-entrance')!.frames[0].rows.slice(0, 16);
  // The street door's doorway, columns 8 to 39 and rows 12 to 31, its warm
  // glass made clear. The glass rows above and below the pulls repeat so the
  // leaves fill a back wall's two-tile face.
  const doorway = street.frames
    .find((f) => f.name === 'closed')!
    .rows.slice(12)
    .map((r) => r.slice(8, 40).replaceAll(')', '/'));
  const glass = doorway[4];
  const below = doorway[13];
  const shut = [
    ...doorway.slice(0, 4),
    ...Array<string>(10).fill(glass),
    ...doorway.slice(10, 13),
    ...Array<string>(10).fill(below),
    ...doorway.slice(15)
  ];
  // Each leaf is 13 columns, from the jamb at column 3 to the meeting stiles
  // at 15 and 16, and runs from the top rail to the kick plate (rows 1 to 30).
  const LEAF = { top: 1, bottom: 30, left: 3, right: 28, w: 13 };
  // Open, the doorway shows the sky and, at its foot, the sidewalk outside.
  const open = shut.map((row, y) =>
    y < LEAF.top || y > LEAF.bottom
      ? row
      : row.slice(0, LEAF.left) +
        (y >= 26 ? 'a' : y === 25 ? 'A' : '.').repeat(LEAF.right - LEAF.left + 1) +
        row.slice(LEAF.right + 1)
  );
  // Part way, each whole leaf slides in from its side of the jamb, its inner
  // edge leading, the part still in the wall hidden: 0 is open, 1 is shut.
  const slid = (k: number) => {
    const off = Math.round(LEAF.w * (1 - k));
    const rows = open.map((r) => [...r]);
    for (let i = 0; i < LEAF.w - off; i++)
      for (const [dx, sx] of [
        [LEAF.left + i, LEAF.left + i + off],
        [LEAF.right - i, LEAF.right - i - off]
      ])
        for (let y = LEAF.top; y <= LEAF.bottom; y++) rows[y][dx] = shut[y][sx];
    return rows.map((r) => r.join(''));
  };
  const faces: Record<(typeof ENTRANCE_STEPS)[number], string[]> = {
    closed: shut,
    'slide-1': slid(0.75),
    'slide-2': slid(0.5),
    'slide-3': slid(0.25),
    open
  };
  const text = [
    `sprite ${ENTRANCE_DOOR}`,
    'size 32 48',
    'layer wall',
    'footprint 2 1',
    'origin 0 32',
    'tag wall door window entrance',
    ...ENTRANCE_STEPS.flatMap((f) => ['', `frame ${f}`, ...cap, ...faces[f]])
  ].join('\n');
  const def = parsePx(text, `${ENTRANCE_DOOR} (art.ts)`, palette);
  sprites.set(ENTRANCE_DOOR, def);
  catalog[ENTRANCE_DOOR] = spriteMeta(def, palette);
}
const LOBBY_STAMP = loadSpaces().rooms.lobby;
const ENTRANCE_ROOM: RoomTemplate = {
  ...LOBBY_STAMP,
  map: [
    'WWWWWWWWWW',
    'WWNWDDWNWW',
    'WWNWDDWNWW',
    'W........W',
    'W........W',
    'W........W',
    'W........W',
    'W........W',
    'WWWWWWWWWW'
  ],
  props: [
    { sprite: ENTRANCE_DOOR, at: [4, 2] },
    { sprite: 'lobby-doormat', at: [4, 3] },
    { sprite: 'floor-lamp', at: [1, 3] },
    { sprite: 'floor-lamp', at: [8, 3] },
    { sprite: 'plant-tall', at: [3, 3] },
    { sprite: 'plant-tall', at: [6, 3] }
  ]
};
const entranceWorld = composeWorld(
  { id: 'release-entrance', name: LOBBY_STAMP.name, rooms: [{ room: 'lobby', at: [0, 0] }] },
  { lobby: ENTRANCE_ROOM },
  catalog
);
if (entranceWorld.missing.length) {
  console.error(`Missing sprites in the lobby: ${entranceWorld.missing.join(', ')}`);
  process.exit(1);
}
const ENTRANCE_VIEW: Rect = { x: TILE, y: TILE + 2, w: 8 * TILE, h: 6 * TILE };

/**
 * Nate, Michele and Sam Frank, the New Altitude personas 0.0.9 brings in, in
 * the looks their packages carry, with the parts drawn for them. Copied from
 * a test office's ledger into scripts/persona-looks.json, since the site
 * build never reads one.
 */
const personaLooks = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'persona-looks.json'), 'utf8')
) as Record<Persona, { look: LookSpec; parts: DrawnPart[] }>;
const personaLib = loadLibrary(Object.values(personaLooks).flatMap((p) => p.parts));

/**
 * The bug hunters in 0.0.10's release art: yellow coveralls and black boots,
 * from the library's own parts. Their hands take black gloves here, and
 * release-art.ts puts on the hood, the mask and the tank.
 */
const HUNTER: LookSpec = {
  hair: 'bald',
  top: 'long-sleeve',
  bottom: 'trousers',
  colours: { hair: 'black', skin: 'light tan', top: 'amber', bottom: 'amber', shoes: 'black' }
};
const hunterPalette = lookPalette(personaLib, HUNTER).colors;
const GLOVE: Record<string, string> = { E: 'K', f: 'K', F: 'k', G: 'k' };
/** A bug hunter in one frame, gloved: below the neck, skin is glove. */
function hunterFrame(frame: string): Image {
  const neck = 15 + (personaLib.anchors[frame]?.torso[1] ?? 0);
  const img = createImage(16, 32);
  composeFrame(personaLib, HUNTER, frame).forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const key = y >= neck ? (GLOVE[ch] ?? ch) : ch;
      const c = hunterPalette[key];
      if (key !== '.' && c) img.data.set(hexToRgba(c.hex), (y * 16 + x) * 4);
    })
  );
  return img;
}

// The rack with its bar lifted off, and the bar alone, both from the rack's
// own pixels. UNRACK covers the rack's rows 14 to 21, which hold the bar and
// its plates: x marks a pixel unracking takes away (the plates, and the bar
// between the J-hooks) and k one it inks, to close the stub of bar left on
// each upright. The bar is every x pixel, and the whole bar where it crosses
// the uprights.
const RACK = sprites.get('gym-rack')!;
const RACK_BAR = { top: 14, mid: 17 };
const UNRACK = [
  'xxxxx........................................xxx',
  'xxxxxx......................................xxxx',
  'xxxx.........xxxxxxxxxxxxxxxxxxxxxx..........xxx',
  'xxxx........kxxxxxxxxxxxxxxxxxxxxxxk.........xxx',
  'xxxx.........xxxxxxxxxxxxxxxxxxxxxx..........xxx',
  'xxxxxx....................................xxxxxx',
  'xxxxxx....................................xxxxxx',
  'xxxxxx....................................xxxxxx'
];
{
  const f = RACK.frames[0];
  const mark = (r: number, c: number) => UNRACK[r - RACK_BAR.top]?.[c] ?? '.';
  const unracked = f.rows.map((row, r) =>
    [...row].map((ch, c) => (mark(r, c) === 'x' ? '.' : mark(r, c) === 'k' ? 'k' : ch)).join('')
  );
  const bar = f.rows.map((row, r) =>
    [...row]
      .map((ch, c) => (Math.abs(r - RACK_BAR.mid) <= 1 || mark(r, c) === 'x' ? ch : '.'))
      .join('')
  );
  // The rack's sprite gains the two as frames, for this script only.
  sprites.set('gym-rack', {
    ...RACK,
    frames: [
      ...RACK.frames,
      { ...f, name: 'unracked', rows: unracked },
      { ...f, name: 'bar', rows: bar }
    ]
  });
}

export {
  STAFF,
  ROWS,
  FRAMES,
  bus,
  openDraws,
  doorRect,
  lane,
  HALL,
  hallDraws,
  hallLights,
  GYM_ROOM,
  gymWorld,
  GYM_VIEW,
  BENCH_SEAT,
  ENTRANCE_DOOR,
  ENTRANCE_STEPS,
  entranceWorld,
  ENTRANCE_VIEW,
  personaLooks,
  personaLib,
  hunterFrame,
  RACK,
  RACK_BAR
};
