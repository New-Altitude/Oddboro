// Lays out the building from a checked spec and checks the world it makes.
//
// The layout is always the same shape, so it always works:
//
//   back row of rooms, doors down into the main hall
//   main hall
//   front row of rooms between two side halls, doors down into the front hall
//   front hall, with the front door under the lobby
//   the street, with the bus stop staff arrive and leave by
//
// Everything is seeded from the spec, so the preview and the office it
// becomes are the same, tile for tile.
import { composeWorld } from './compose.ts';
import { findPath } from './path.ts';
import { TILE } from './types.ts';
import type { FloorPlan, PropPlacement, RoomTemplate, SpriteCatalog, World } from './types.ts';
import {
  ROOM_KINDS,
  type RoomKind,
  type Floor,
  type Size,
  type RoomSpec,
  type OfficeSpec,
  LIMITS,
  checkSpec
} from './generate.ts';
import { recipe, furnish, fitDims, roomMap } from './recipe.ts';
import { STREET_ROWS, withIds, editArea, street, GROUND_PROPS, grounds } from './areas.ts';
import { Furnisher } from './furnish.ts';

/** A kind's own floor when the room does not pick one. */
const KIND_FLOOR: Partial<Record<RoomKind, Floor>> = {
  gym: 'rubber',
  kitchen: 'tile',
  mail: 'tile'
};
const HALL = 5;
const FRONT_HALL = 6;
const SIDE = 5;

const MARGIN: [number, number, number, number] = [18, 10, 18, 6];

function rng(seed: string): () => number {
  let a = 1779033703;
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 3432918353);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The library pieces the office furnishes each part of a building with, by
 * room kind, then the halls and the street: what a theme can swap or leave out.
 */
export function libraryPieces(): Record<string, string[]> {
  const f = new Furnisher({}, undefined);
  const own: Partial<Record<RoomKind, string[]>> = {
    office: ['owner-chair', 'owner-desk', 'desk-lamp', 'rug'],
    lobby: ['lobby-reception', 'chair-front'],
    workspace: ['desk', 'desk-lamp', 'plant-small', 'chair']
  };
  const out: Record<string, string[]> = {};
  for (const kind of ROOM_KINDS) {
    const pieces = recipe(f, { kind, name: kind, size: 'large' }).flatMap((p) =>
      p.items.map((i) => i.sprite)
    );
    out[kind] = [...new Set([...(own[kind] ?? []), ...pieces])];
  }
  out.halls = ['owner-bench', 'plant-tall', 'floor-lamp', 'plant-fern'];
  out.grounds = [...new Set(Object.values(GROUND_PROPS).flatMap((g) => g.pick.map(([s]) => s)))];
  out['ground (floors)'] = [
    'sidewalk',
    'curb',
    'asphalt',
    'asphalt-line',
    'crosswalk',
    'curb-far',
    'grass'
  ];
  out.street = [
    'street-shop-window',
    'street-front-door',
    'street-sconce',
    'street-lamp',
    'street-tree',
    'street-bench',
    'street-bike-rack',
    'street-bus-shelter',
    'street-bus-sign',
    'street-coffee-cart',
    'street-hydrant',
    'street-mailbox',
    'street-newsbox',
    'street-planter'
  ];
  return out;
}

// ---------------------------------------------------------------------------
// The building

export type Built = {
  plan: FloorPlan;
  /** What the office changed from the spec to make it fit, in words. */
  notes: string[];
  templates: Record<string, RoomTemplate>;
  /** Room template id to the room's kind, for sending staff to the right rooms. */
  kinds: Record<string, RoomKind>;
  problems: string[];
};

const ROOM_ID: Record<RoomKind, string> = {
  office: 'owner-office',
  workspace: 'workspace',
  lobby: 'lobby',
  kitchen: 'kitchen',
  break: 'break-room',
  library: 'library',
  gym: 'gym',
  mail: 'mail-room'
};

/** Turn a spec into a floor plan and its rooms. Check the spec first. */
export function buildOffice(spec: OfficeSpec, catalog: SpriteCatalog): Built {
  const problems: string[] = [];
  // The street and grounds take a seed of their own, from what shapes them, so
  // changing a room never moves a tree. Rooms furnish without chance.
  const random = rng(JSON.stringify([spec.grounds, spec.porch ?? null, spec.plants ?? null]));
  const fitted = spec.rooms.map((r) => ({ spec: r, dims: fitDims(r, catalog) }));
  for (const f of fitted)
    if (!f.dims) problems.push(`${f.spec.name}: what a ${f.spec.kind} needs does not fit`);
  if (problems.length)
    return { plan: emptyPlan(spec), notes: [], templates: {}, kinds: {}, problems };

  // The office sits in the middle of the back row and the lobby in the middle
  // of the front. The rest go to the row the spec names, or else the shorter
  // one, nearest the middle first, east then west, in the order the spec lists
  // them. A room pinned to a side goes after the rest, at that end of its row.
  type Placed = { spec: RoomSpec; w: number; h: number };
  type Row = { west: Placed[]; mid: Placed[]; east: Placed[] };
  const back: Row = { west: [], mid: [], east: [] };
  const front: Row = { west: [], mid: [], east: [] };
  const all = (row: Row) => [...row.west].reverse().concat(row.mid, row.east);
  const width = (row: Placed[]) => row.reduce((n, r) => n + r.w - 1, 1);
  const rowFor = (s: RoomSpec) =>
    s.row === 'back'
      ? back
      : s.row === 'front'
        ? front
        : width(all(back)) <= width(all(front)) + 2 * (SIDE - 1)
          ? back
          : front;
  const placed = (f: (typeof fitted)[number]) => ({ spec: f.spec, w: f.dims![0], h: f.dims![1] });
  for (const f of fitted)
    if (f.spec.kind === 'office') back.mid.push(placed(f));
    else if (f.spec.kind === 'lobby') front.mid.push(placed(f));
  const rest = fitted.filter((f) => f.spec.kind !== 'office' && f.spec.kind !== 'lobby');
  for (const f of rest.filter((f) => !f.spec.side)) {
    const row = rowFor(f.spec);
    (row.east.length <= row.west.length ? row.east : row.west).push(placed(f));
  }
  for (const f of rest.filter((f) => f.spec.side)) rowFor(f.spec)[f.spec.side!].push(placed(f));
  const backRow = all(back);
  const frontRow = all(front);

  // Square the building off: both rows as wide as the wider, every room in a
  // row as tall as the tallest.
  const B = Math.max(width(backRow), width(frontRow) + 2 * (SIDE - 1));
  const stretch = (row: Placed[], target: number) => {
    for (let i = 0; width(row) < target; i++) row[i % row.length].w++;
  };
  stretch(backRow, B);
  stretch(frontRow, B - 2 * (SIDE - 1));
  if (B > LIMITS.width)
    problems.push(
      `the building comes out ${B} tiles wide, over the limit of ${LIMITS.width}: fewer or smaller rooms`
    );
  const Hb = Math.max(...backRow.map((r) => r.h));
  const Hf = frontRow.length ? Math.max(...frontRow.map((r) => r.h)) : 7;
  for (const r of backRow) r.h = Hb;
  for (const r of frontRow) r.h = Hf;

  const templates: Record<string, RoomTemplate> = {};
  const kinds: Record<string, RoomKind> = {};
  const rooms: FloorPlan['rooms'] = [];
  const props: PropPlacement[] = [];
  const doors: { x: number; y: number; kind: RoomKind }[] = [];
  const taken = new Map<string, number>();
  const notes: string[] = [];
  // Where each room stands in the building, walls and all: the halls are what is left.
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const stamp = (p: Placed, x: number, y: number, outside: boolean) => {
    rects.push({ x, y, w: p.w, h: p.h });
    const room = furnish(p.spec, p.w, p.h, catalog);
    if (!room) {
      problems.push(`${p.spec.name}: what a ${p.spec.kind} needs does not fit`);
      return;
    }
    const furnisher = new Furnisher(catalog, p.spec.accent);
    // What the theme leaves out goes before any edit, or it would hold its tiles unseen.
    if (spec.swaps) furnisher.leaveOut(room, (s) => spec.swaps![s] === '');
    if (p.spec.edits?.length) furnisher.edit(room, p.spec.edits, p.spec.name, notes);
    const base = ROOM_ID[p.spec.kind];
    const n = (taken.get(base) ?? 0) + 1;
    taken.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    templates[id] = {
      id,
      name: p.spec.name.trim(),
      wall: `wall-${p.spec.wall ?? spec.wall}`,
      // A kind's own floor (the kitchen's tile) is the plain office's; a theme keeps its own.
      floor: p.spec.floor ?? (spec.swaps ? undefined : KIND_FLOOR[p.spec.kind]) ?? spec.floor,
      map: roomMap(room, outside),
      props: room.props
    };
    kinds[id] = p.spec.kind;
    rooms.push({ room: id, at: [x, y] });
    doors.push({ x: x + room.door, y: y + p.h - 1, kind: p.spec.kind });
  };

  let x = 0;
  for (const r of backRow) {
    stamp(r, x, 0, spec.windows !== false);
    x += r.w - 1;
  }
  x = SIDE - 1;
  // The front row's back wall shares its top row with the hall's last, the
  // way the back row's front wall shares the hall's first: one wall, not two.
  const frontY = Hb + HALL - 2;
  for (const r of frontRow) {
    stamp(r, x, frontY, false);
    x += r.w - 1;
  }

  const hallFloor = spec.floor === 'rubber' ? 'oak' : spec.floor;
  const mainY = Hb - 1;
  const frontHallY = frontY + Hf - 1;
  const southY = frontHallY + FRONT_HALL - 1;
  const halls: FloorPlan['halls'] = [
    { at: [0, mainY], size: [B, HALL], floor: hallFloor, wall: `wall-${spec.wall}` },
    { at: [0, frontHallY], size: [B, FRONT_HALL], floor: hallFloor, wall: 'wall-brick' },
    { at: [0, mainY], size: [SIDE, southY - mainY], floor: hallFloor, wall: `wall-${spec.wall}` },
    {
      at: [B - SIDE, mainY],
      size: [SIDE, southY - mainY],
      floor: hallFloor,
      wall: `wall-${spec.wall}`
    }
  ];

  // Staff wait for the owner on a bench in the hall, beside the office door.
  const office = doors.find((d) => d.kind === 'office');
  const bench = office ? office.x + 3 : 0;
  if (office) props.push({ sprite: 'owner-bench', at: [bench, mainY + 1] });

  // Plants and lamps along each hall's back row, clear of every door.
  const every = { few: 14, some: 9, lots: 6 }[spec.plants ?? 'some'];
  // Each row runs along the foot of a row of rooms, where a south wall's face
  // covers the floor: only things at least two tiles tall stand in front of it.
  const HALL_DECOR = ['plant-tall', 'floor-lamp', 'plant-fern', 'plant-small'].filter(
    (s) => (catalog[s]?.height ?? 0) >= 2 * TILE
  );
  let k = 0;
  for (const [y, from, to] of [
    [mainY + 1, 1, B - 2],
    [frontHallY + 1, SIDE, B - SIDE - 1]
  ] as const)
    for (let hx = from + 1; hx <= to - 1; hx += every) {
      const near = doors.some((d) => Math.abs(d.x - hx) <= 2 || Math.abs(d.x + 1 - hx) <= 2);
      const onBench = y === mainY + 1 && hx >= bench - 1 && hx <= bench + 2;
      if (near || onBench) continue;
      if (HALL_DECOR.length)
        props.push({ sprite: HALL_DECOR[k++ % HALL_DECOR.length], at: [hx, y] });
    }

  // The front door, under the lobby's door, then the street.
  const lobby = doors.find((d) => d.kind === 'lobby');
  const doorX = lobby?.x ?? Math.floor(B / 2);
  templates['front-door'] = {
    id: 'front-door',
    name: 'Front door',
    sign: false,
    wall: 'wall-brick',
    floor: hallFloor,
    map: ['DD'],
    props: [{ sprite: 'street-front-door', at: [0, 0] }]
  };
  rooms.push({ room: 'front-door', at: [doorX, southY] });
  props.push(
    { sprite: 'street-sconce', at: [doorX - 1, southY] },
    { sprite: 'street-sconce', at: [doorX + 2, southY] }
  );
  for (let wx = 3; wx + 1 < B - 2; wx += 9)
    if (wx + 1 < doorX - 2 || wx > doorX + 3)
      props.push({ sprite: 'street-shop-window', at: [wx, southY] });

  // The owner's changes outside the rooms, each area in its own tiles. What a
  // theme leaves out goes first, so it never holds a tile unseen.
  const left = (list: PropPlacement[]) => {
    const out = list.filter((p) => spec.swaps?.[p.sprite] !== '');
    withIds(out);
    return out;
  };
  const inRoom = (x: number, y: number) =>
    rects.some((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
  const hallProps = left(props.splice(0));
  props.push(...hallProps);
  if (spec.areas?.halls?.length) {
    const keep = new Set<string>();
    for (const d of doors) keep.add(`${d.x},${d.y + 1}`).add(`${d.x + 1},${d.y + 1}`);
    keep.add(`${doorX},${southY - 1}`).add(`${doorX + 1},${southY - 1}`);
    editArea(
      'Halls',
      props,
      spec.areas.halls,
      catalog,
      {
        ground: "the hall's floor",
        stands: (x, y) => x >= 1 && x <= B - 2 && y > mainY && y < southY && !inRoom(x, y),
        hangs: (x, y) => y === southY && x >= 1 && x <= B - 2 && (x < doorX || x > doorX + 1),
        keep
      },
      notes
    );
  }

  const streetY = southY + 1;
  templates.street = street(B, doorX, random, spec.porch, catalog);
  const road = templates.street;
  road.props = left(road.props);
  if (spec.areas?.street?.length)
    editArea(
      'Street',
      road.props,
      spec.areas.street,
      catalog,
      {
        ground: 'the sidewalk',
        stands: (x, y) => '.p'.includes(road.map[y]?.[x] ?? 'x'),
        hangs: () => false,
        keep: new Set([0, 1].flatMap((y) => [`${doorX},${y}`, `${doorX + 1},${y}`]))
      },
      notes
    );
  rooms.push({ room: 'street', at: [0, streetY] });

  const [ml, mt, mr, mb] = MARGIN;
  const total: [number, number] = [B + ml + mr, streetY + STREET_ROWS + mt + mb];
  templates.grounds = grounds(spec.grounds, total, [ml, mt, B, streetY], random);
  const land = templates.grounds;
  land.props = left(land.props);
  if (spec.areas?.grounds?.length) {
    const built = (x: number, y: number) =>
      x >= ml && x < ml + B && y >= mt && y < mt + streetY + STREET_ROWS;
    editArea(
      'Grounds',
      land.props,
      spec.areas.grounds,
      catalog,
      {
        ground: 'the open ground',
        stands: (x, y) => '.s'.includes(land.map[y]?.[x] ?? 'x') && !built(x, y),
        hangs: () => false,
        keep: new Set()
      },
      notes
    );
  }

  const plan: FloorPlan = {
    id: 'office',
    name: spec.name.trim(),
    grounds: { room: 'grounds', margin: MARGIN },
    halls,
    rooms,
    props
  };
  // A theme's stand-ins take the place of library pieces everywhere, rooms,
  // halls and street alike. They match exactly, so nothing else moves.
  const swaps = spec.swaps ?? {};
  const swap = (p: PropPlacement) => {
    const to = swaps[p.sprite];
    if (!to || !catalog[to]) return;
    p.sprite = to;
    if (p.variant && !catalog[to].variants.includes(p.variant)) delete p.variant;
  };
  const kept = (p: PropPlacement) => swaps[p.sprite] !== '';
  // Floors and ground materials swap too: cobbles for the sidewalk.
  const ground = (name: string) =>
    swaps[name] && catalog[`floor-${swaps[name]}`] ? swaps[name] : name;
  // The outside of the building takes the theme's facade in place of brick.
  const facade = spec.facade ? `wall-${spec.facade}` : undefined;
  const outside = (wall: string) => (facade && wall === 'wall-brick' ? facade : wall);
  if (Object.keys(swaps).length || facade) {
    for (const t of Object.values(templates)) {
      (t.props = t.props.filter(kept)).forEach(swap);
      t.floor = ground(t.floor);
      t.wall = outside(t.wall);
      if (t.materials)
        t.materials = Object.fromEntries(
          Object.entries(t.materials).map(([k, v]) => [k, ground(v)])
        );
    }
    if (plan.props) (plan.props = plan.props.filter(kept)).forEach(swap);
    for (const h of plan.halls ?? []) {
      h.floor = ground(h.floor);
      if (h.wall) h.wall = outside(h.wall);
    }
  }
  return { plan, notes, templates, kinds, problems };
}

function emptyPlan(spec: OfficeSpec): FloorPlan {
  return { id: 'office', name: spec.name, rooms: [] };
}

// ---------------------------------------------------------------------------
// Checking the result

/** Everything wrong with a built office, in words: missing art, a seat nobody can reach. */
export function checkWorld(world: World, staff = 0): string[] {
  const out: string[] = [];
  if (world.missing.length) out.push(`missing art: ${world.missing.join(', ')}`);
  const home = world.spots.find((s) => s.activity === 'home');
  if (!home) return [...out, 'there is no bus stop for Odds to come and go by'];
  if (!world.spots.some((s) => s.activity === 'talk')) out.push("the office has no owner's desk");
  if (!world.spots.some((s) => s.activity === 'wait')) out.push('there is nowhere to wait');
  const unreached = world.spots.filter(
    (s) =>
      s !== home &&
      (!s.approach ||
        !findPath(world.walkable, world.width, home.approach ?? home.tile, s.tile, {
          enter: s.approach
        }))
  );
  for (const s of unreached.slice(0, 5)) out.push(`nobody can reach ${s.prop} in ${s.room}`);
  const seats = world.spots.filter((s) => ['work', 'intake', 'read'].includes(s.activity)).length;
  if (seats < staff) out.push(`${seats} work seats is fewer than the ${staff} Odds`);
  return out;
}

/** One size down for every room that has one: the rest of the building first, desks last. */
function smaller(spec: OfficeSpec): { spec: OfficeSpec; shrunk: string[] } | undefined {
  const down = (s: Size | undefined): Size | undefined =>
    s === 'large' ? 'medium' : s === 'small' ? undefined : 'small';
  for (const desks of [false, true]) {
    const shrunk: string[] = [];
    const rooms = spec.rooms.map((r) => {
      if ((r.kind === 'workspace') !== desks || !down(r.size)) return r;
      shrunk.push(r.name);
      return { ...r, size: down(r.size) };
    });
    if (shrunk.length) return { spec: { ...spec, rooms }, shrunk };
  }
  return undefined;
}

/**
 * The site before the building goes up: the plan's street and grounds, with
 * plain grass where the building will stand. A new owner's first floor.
 */
export function lotOf(
  plan: FloorPlan,
  templates: Record<string, RoomTemplate>
): { plan: FloorPlan; templates: Record<string, RoomTemplate> } {
  const street = plan.rooms.find((r) => r.room === 'street');
  const boxes = [
    ...plan.rooms
      .filter((r) => r !== street && templates[r.room])
      .map((r) => {
        const t = templates[r.room];
        return [r.at[0], r.at[1], Math.max(...t.map.map((row) => row.length)), t.map.length];
      }),
    ...(plan.halls ?? []).map((h) => [...h.at, ...h.size])
  ];
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.min(street?.at[1] ?? Infinity, Math.max(...boxes.map((b) => b[1] + b[3])));
  // Grass on exactly the tiles the building takes, so the grounds keep the rest.
  const grid = Array.from({ length: Math.max(0, y1 - y0) }, () =>
    Array<string>(Math.max(0, x1 - x0)).fill(' ')
  );
  const mark = (x: number, y: number) => {
    if (y >= y0 && y < y1 && x >= x0 && x < x1) grid[y - y0][x - x0] = '.';
  };
  for (const r of plan.rooms)
    if (r !== street)
      templates[r.room]?.map.forEach((row, dy) =>
        [...row].forEach((ch, dx) => ch !== ' ' && mark(r.at[0] + dx, r.at[1] + dy))
      );
  for (const h of plan.halls ?? [])
    for (let y = h.at[1]; y < h.at[1] + h.size[1]; y++)
      for (let x = h.at[0]; x < h.at[0] + h.size[0]; x++) mark(x, y);
  const lot: RoomTemplate = {
    id: 'lot',
    name: 'Lot',
    sign: false,
    outdoor: true,
    wall: 'wall-brick',
    floor: 'grass',
    map: grid.map((row) => row.join('')),
    props: []
  };
  return {
    plan: {
      ...plan,
      halls: [],
      props: [],
      rooms: [...(street ? [street] : []), { room: 'lot', at: [x0, y0] }]
    },
    templates: {
      ...templates,
      lot,
      // The street keeps its own things. What serves the office comes with it:
      // the shop fronts and door lamps, the coffee cart, the bike rack.
      ...(street && templates[street.room]
        ? {
            [street.room]: {
              ...templates[street.room],
              props: templates[street.room].props.filter((p) => !WITH_THE_OFFICE.has(p.sprite))
            }
          }
        : {})
    }
  };
}

const WITH_THE_OFFICE = new Set([
  'street-shop-window',
  'street-sconce',
  'street-front-door',
  'street-coffee-cart',
  'street-bike-rack'
]);

/**
 * Build and check in one go: the plan, its rooms, the world, and every
 * problem. A building too wide for the limit comes down a size at a time
 * before it counts as a problem, and the notes say which rooms shrank.
 */
export function generateOffice(
  spec: OfficeSpec,
  catalog: SpriteCatalog,
  staff = 0
): Built & { world?: World } {
  const problems = checkSpec(spec, catalog);
  if (problems.length)
    return { plan: emptyPlan(spec), notes: [], templates: {}, kinds: {}, problems };
  let built = buildOffice(spec, catalog);
  const notes: string[] = [];
  for (let next = smaller(spec); next && built.problems.some((p) => p.includes('tiles wide'));) {
    notes.push(`To fit the building, ${next.shrunk.join(', ')} came down a size.`);
    built = buildOffice(next.spec, catalog);
    next = smaller(next.spec);
  }
  built.notes = [...notes, ...built.notes];
  if (built.problems.length) return built;
  try {
    const world = composeWorld(built.plan, built.templates, catalog, { actors: false });
    return { ...built, world, problems: checkWorld(world, staff) };
  } catch (e) {
    return { ...built, problems: [e instanceof Error ? e.message : String(e)] };
  }
}
