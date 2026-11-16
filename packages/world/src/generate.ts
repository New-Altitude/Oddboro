// The short spec an office is built from: which rooms, how big, how many desks,
// the materials and the extras. Claude writes the spec from the owner's
// words. This file holds its words and shapes and the limits that check it, so
// no spec can ask for a floor that breaks the office: too many rooms or desks,
// a building wider than the screen. building.ts turns a checked spec into a
// floor plan and room templates, the same shapes the hand-built Main Street
// uses, and checks the world it makes, such as a seat nobody can reach.
import type { SpriteCatalog } from './types.ts';

export const ROOM_KINDS = [
  'office',
  'workspace',
  'lobby',
  'kitchen',
  'break',
  'library',
  'gym',
  'mail'
] as const;
export const WALLS = ['plaster', 'brick', 'teal'] as const;
export const FLOORS = ['oak', 'carpet', 'tile', 'rubber'] as const;
export const SIZES = ['small', 'medium', 'large'] as const;
export const ACCENTS = ['teal', 'rust', 'sage'] as const;
export const GROUNDS = ['park', 'woods', 'meadow'] as const;
export const PLANTS = ['few', 'some', 'lots'] as const;

export type RoomKind = (typeof ROOM_KINDS)[number];
export type Wall = (typeof WALLS)[number];
export type Floor = (typeof FLOORS)[number];
export type Size = (typeof SIZES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Grounds = (typeof GROUNDS)[number];
export type Plants = (typeof PLANTS)[number];

export type RoomSpec = {
  kind: RoomKind;
  name: string;
  size?: Size;
  /** Desks, for a workspace. */
  seats?: number;
  /** One of WALLS, or a wall style the office drew. */
  wall?: string;
  /** One of FLOORS, or a floor the office drew. */
  floor?: string;
  accent?: Accent;
  /** Sprites from EXTRAS, or props the office drew. */
  extras?: string[];
  /** For a workspace: what stands on every desk, from DESK_TOPS or drawn. */
  desk?: string;
  /** The end of its row a room stands at, when the owner says. Left out, the office arranges it. */
  side?: 'west' | 'east';
  /** The row a room stands in, when the owner says. Left out, it goes to the narrower row. */
  row?: 'back' | 'front';
  /** Changes to what the office furnished it with, applied in order after it does. */
  edits?: RoomEdit[];
};

/**
 * One change to a furnished room. An item is named by its id in the room,
 * `sprite#n` (the nth of that sprite), and a tile counts from the room's
 * top-left corner, walls included.
 */
export type RoomEdit =
  | { remove: string }
  | { move: string; to: [number, number]; hand?: true }
  | { add: string; at: [number, number]; variant?: string; hand?: true };

/** The parts of an office outside its rooms. */
export const AREAS = ['halls', 'street', 'grounds'] as const;
export type Area = (typeof AREAS)[number];
/**
 * Changes to what the office put outside its rooms, by area, each in that
 * area's own tiles from its top-left: the halls in the building's (the back
 * wall is row 0), the street's (the sidewalk by the building is row 0), the
 * grounds' (the whole lot). They apply like a room's edits, at the exact tile.
 */
export type AreaEdits = Partial<Record<Area, RoomEdit[]>>;

/** A deck outside the front door, with seats and things along the building. */
export type Porch = { floor?: string; extras?: string[] };

export type OfficeSpec = {
  name: string;
  /** The halls, and every room that does not pick its own. */
  wall: string;
  floor: string;
  grounds: Grounds;
  plants?: Plants;
  porch?: Porch;
  rooms: RoomSpec[];
  /**
   * A theme's own pieces in place of the library's, everywhere: a torch for
   * every floor lamp, a scribe's desk for every desk. Each stands in exactly:
   * same layer, footprint and spots, so staff use it the same way. An empty
   * string leaves the piece out, for one that has no place in the theme.
   */
  swaps?: Record<string, string>;
  /** False for a building with no windows at all, like a dungeon. */
  windows?: boolean;
  /** The wall style the building shows the street, brick unless a theme says. */
  facade?: string;
  /** What changed in the halls, on the street and on the grounds. */
  areas?: AreaEdits;
};

/** Why a sprite cannot stand in for another, in words. Empty when it can. */
export function swapProblems(from: string, to: string, catalog: SpriteCatalog): string[] {
  const a = catalog[from];
  const b = catalog[to];
  // A ground or floor material (the sidewalk, the road) swaps for another floor.
  if (!a && catalog[`floor-${from}`])
    return catalog[`floor-${to}`] ? [] : [`there is no floor "${to}" to swap in for ${from}`];
  if (!a) return [`there is no "${from}" to swap out`];
  // Staff use anything with a spot, and a door is the way in: those get a stand-in.
  if (to === '')
    return a.spots.length || a.tags.includes('door')
      ? [`Odds use ${from}, so it cannot be left out: draw a stand-in for it`]
      : [];
  if (!b) return [`there is no "${to}" to swap in`];
  const out: string[] = [];
  if (a.layer !== b.layer) out.push(`${to} is layer ${b.layer}, and ${from} is ${a.layer}`);
  if (a.footprint.join() !== b.footprint.join())
    out.push(
      `${to} stands on ${b.footprint.join(' x ')} tiles, and ${from} on ${a.footprint.join(' x ')}`
    );
  if (a.walkable !== b.walkable)
    out.push(`${to} and ${from} differ in whether Odds walk over them`);
  const spots = (m: typeof a) =>
    m.spots
      .map((s) => [s.name, s.dx, s.dy, s.facing, s.activity, s.pose].join(' '))
      .sort()
      .join('; ');
  if (spots(a) !== spots(b))
    out.push(`${to} needs the same spots as ${from}: ${spots(a) || 'none'}`);
  return out;
}

/** What a room of each kind is for, in the words the owner and Claude use. */
export const KIND_ABOUT: Record<RoomKind, string> = {
  office: "the owner's office. Odds come to its desk to talk to the owner",
  workspace: 'desks where Odds work. `seats` sets how many',
  lobby: 'the way in, with a reception desk (one work seat) and a couch',
  kitchen: 'counters and a dining table: where Odds eat',
  break: 'a couch, a TV, arcade machines and beanbags: where Odds rest and play',
  library: 'shelves, armchairs and a reading table: where Odds read',
  gym: 'treadmills, weights, a bike and mats: where Odds exercise',
  mail: 'a sorting table where mail and intake come in (one work seat)'
};

/** Extras any room can ask for, and what each one is. */
export const EXTRAS: Record<string, string> = {
  'plant-tall': 'a tall potted plant',
  'plant-fern': 'a fern',
  'plant-small': 'a small plant',
  'lobby-plant-big': 'a big planter',
  'floor-lamp': 'a floor lamp',
  bookshelf: 'a bookshelf',
  'filing-cabinet': 'a filing cabinet',
  'lobby-aquarium': 'an aquarium, 4 tiles wide',
  'library-fireplace': 'a fireplace',
  'library-globe': 'a globe',
  'library-cat': 'a cat',
  'owner-guitar': 'a guitar on a stand',
  'owner-sideboard': 'a sideboard',
  'break-arcade': 'an arcade machine, a place to play',
  'break-tv': 'a TV',
  'break-vending': 'a vending machine',
  'kitchen-cooler': 'a water cooler',
  'kitchen-coffee': 'a coffee machine',
  'gym-bike': 'an exercise bike, a place to exercise',
  'lobby-couch': 'a couch, a place to rest',
  'break-beanbag': 'a beanbag, a place to play',
  rug: 'a rug',
  'art-frame': 'framed art on the wall',
  whiteboard: 'a whiteboard on the wall',
  'wall-clock': 'a clock on the wall',
  'winter-wreath': 'an evergreen holiday wreath with a ribbon on the wall',
  'owner-photos': 'photos on the wall',
  'break-poster': 'a poster on the wall',
  'break-dartboard': 'a dartboard on the wall',
  'library-map': 'a map on the wall',
  'mail-corkboard': 'a corkboard on the wall'
};

/** What a workspace can stand on every desk. Without one, desks alternate the two. */
export const DESK_TOPS: Record<string, string> = {
  'desk-lamp': 'a desk lamp',
  'plant-small': 'a small plant'
};

/** What the office drew for itself, found by its `drawn` tag in the catalog. */
export function drawnIn(catalog: SpriteCatalog = {}) {
  const out = {
    walls: [] as string[],
    floors: [] as string[],
    extras: [] as string[],
    desk: [] as string[]
  };
  for (const [name, m] of Object.entries(catalog)) {
    if (!m.tags.includes('drawn')) continue;
    const wall = /^wall-(.+)-face$/.exec(name);
    const floor = m.layer === 'floor' && /^floor-(.+)$/.exec(name);
    if (wall) out.walls.push(wall[1]);
    else if (floor) out.floors.push(floor[1]);
    else if (m.tags.includes('place-desk')) out.desk.push(name);
    else if (m.tags.some((t) => t.startsWith('place-'))) out.extras.push(name);
  }
  return out;
}

export const LIMITS = {
  rooms: 12,
  /** Of any one kind, apart from workspaces. The office and lobby are one each. */
  perKind: 2,
  workspaces: 4,
  /** Desks across every workspace. */
  seats: 32,
  seatsPerRoom: 12,
  extras: 6,
  /** Per room. Room edits come from Claude, and from a layout saved while the office offered arranging by hand. */
  edits: 200,
  name: 32,
  roomName: 24,
  /** The building, in tiles. */
  width: 110,
  description: 2000
} as const;

/** Everything wrong with a spec, in words. Empty when it is good. */
export function checkSpec(spec: OfficeSpec, catalog?: SpriteCatalog): string[] {
  const out: string[] = [];
  const drawn = drawnIn(catalog);
  const walls = [...WALLS, ...drawn.walls];
  const floors = [...FLOORS, ...drawn.floors];
  const isExtra = (e: string) => e in EXTRAS || drawn.extras.includes(e);
  // Any library thing that stands in a room or hangs on its wall can be added
  // by hand: not a tile, a wall style or a person.
  const isPiece = (s: string) => {
    const m = catalog?.[s];
    return (
      !!m &&
      ['object', 'floor', 'wall'].includes(m.layer) &&
      !/^(wall|floor)-/.test(s) &&
      !m.tags.includes('character')
    );
  };
  const checkExtras = (at: string, extras: unknown, porch = false) => {
    if (extras === undefined) return;
    if (!Array.isArray(extras)) return out.push(`${at}: extras must be a list`);
    if (extras.length > LIMITS.extras)
      out.push(`${at}: ${extras.length} extras is over the limit of ${LIMITS.extras}`);
    for (const e of extras)
      if (!isExtra(e)) out.push(`${at}: there is no extra "${e}"`);
      else if (porch && (catalog?.[e]?.footprint[1] ?? 1) > 1)
        out.push(`${at}: "${e}" is more than one tile deep, and the porch is one`);
  };
  const oneOf = <T extends string>(
    list: readonly T[],
    v: unknown,
    what: string,
    optional = false
  ) => {
    if (v === undefined && optional) return;
    if (!list.includes(v as T)) out.push(`${what} "${String(v)}" is not one of ${list.join(', ')}`);
  };
  if (!spec || typeof spec !== 'object') return ['the spec is not an object'];
  if (typeof spec.name !== 'string' || !spec.name.trim()) out.push('the office needs a name');
  else if (spec.name.length > LIMITS.name) out.push(`the name is over ${LIMITS.name} characters`);
  oneOf(walls, spec.wall, 'wall');
  oneOf(floors, spec.floor, 'floor');
  oneOf(GROUNDS, spec.grounds, 'grounds');
  oneOf(PLANTS, spec.plants, 'plants', true);
  oneOf(walls, spec.facade, 'facade', true);
  if (spec.windows !== undefined && typeof spec.windows !== 'boolean')
    out.push('windows is true or false');
  if (spec.swaps !== undefined) {
    if (!spec.swaps || typeof spec.swaps !== 'object' || Array.isArray(spec.swaps))
      out.push('swaps maps a library sprite to the one that stands in for it');
    else if (catalog)
      for (const [from, to] of Object.entries(spec.swaps))
        out.push(...swapProblems(from, String(to), catalog).map((p) => `swap ${from}: ${p}`));
  }
  /** A room's or an area's edits: each a remove, a move or an add, naming what it can. */
  const checkEdits = (at: string, edits: unknown) => {
    if (edits === undefined) return;
    if (!Array.isArray(edits)) out.push(`${at}: edits must be a list`);
    else {
      if (edits.length > LIMITS.edits)
        out.push(`${at}: ${edits.length} edits is over the limit of ${LIMITS.edits}`);
      const tile = (v: unknown) =>
        Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0);
      for (const e of edits as Record<string, unknown>[]) {
        if (!e || typeof e !== 'object') out.push(`${at}: an edit is not an object`);
        else if ('remove' in e) {
          if (typeof e.remove !== 'string') out.push(`${at}: remove names an item, like "rug#1"`);
        } else if ('move' in e) {
          if (typeof e.move !== 'string' || !tile(e.to))
            out.push(`${at}: move names an item and a tile, like {"move": "rug#1", "to": [4, 5]}`);
        } else if ('add' in e) {
          if (typeof e.add !== 'string' || !tile(e.at))
            out.push(
              `${at}: add names a sprite and a tile, like {"add": "plant-tall", "at": [2, 4]}`
            );
          else if (!isExtra(e.add) && !isPiece(e.add))
            out.push(`${at}: there is no "${e.add}" to add`);
        } else out.push(`${at}: an edit is remove, move or add`);
      }
    }
  };
  if (spec.areas !== undefined) {
    if (!spec.areas || typeof spec.areas !== 'object' || Array.isArray(spec.areas))
      out.push('areas maps halls, street or grounds to its edits');
    else
      for (const [k, v] of Object.entries(spec.areas))
        if (!AREAS.includes(k as Area))
          out.push(`there is no area "${k}": halls, street or grounds`);
        else checkEdits(`the ${k}`, v);
  }
  if (spec.porch !== undefined) {
    if (!spec.porch || typeof spec.porch !== 'object') out.push('porch must be an object');
    else {
      oneOf(floors, spec.porch.floor, 'porch floor', true);
      checkExtras('the porch', spec.porch.extras, true);
    }
  }
  if (!Array.isArray(spec.rooms)) return [...out, 'rooms must be a list'];
  if (spec.rooms.length > LIMITS.rooms)
    out.push(`${spec.rooms.length} rooms is over the limit of ${LIMITS.rooms}`);
  const count = (k: RoomKind) => spec.rooms.filter((r) => r?.kind === k).length;
  if (count('office') !== 1) out.push('there must be exactly one office');
  if (count('lobby') !== 1) out.push('there must be exactly one lobby');
  const workspaces = count('workspace');
  if (workspaces < 1) out.push('there must be at least one workspace');
  if (workspaces > LIMITS.workspaces)
    out.push(`${workspaces} workspaces is over the limit of ${LIMITS.workspaces}`);
  for (const k of ROOM_KINDS)
    if (!['office', 'lobby', 'workspace'].includes(k) && count(k) > LIMITS.perKind)
      out.push(`${count(k)} rooms of kind ${k} is over the limit of ${LIMITS.perKind}`);
  let seats = 0;
  spec.rooms.forEach((r, i) => {
    const at = `room ${i + 1}${r?.name ? ` (${r.name})` : ''}`;
    if (!r || typeof r !== 'object') return out.push(`${at} is not an object`);
    oneOf(ROOM_KINDS, r.kind, `${at} kind`);
    oneOf(['west', 'east'], r.side, `${at} side`, true);
    oneOf(['back', 'front'], r.row, `${at} row`, true);
    if ((r.kind === 'office' || r.kind === 'lobby') && (r.side || r.row))
      out.push(
        `${at}: the ${r.kind} always stands in the middle of its row; leave out side and row`
      );
    if (typeof r.name !== 'string' || !r.name.trim()) out.push(`${at} needs a name`);
    else if (r.name.length > LIMITS.roomName)
      out.push(`${at}: the name is over ${LIMITS.roomName} characters`);
    oneOf(SIZES, r.size, `${at} size`, true);
    oneOf(walls, r.wall, `${at} wall`, true);
    oneOf(floors, r.floor, `${at} floor`, true);
    oneOf(ACCENTS, r.accent, `${at} accent`, true);
    if (r.kind === 'workspace') {
      if (!Number.isInteger(r.seats) || r.seats! < 1 || r.seats! > LIMITS.seatsPerRoom)
        out.push(`${at}: seats must be a whole number from 1 to ${LIMITS.seatsPerRoom}`);
      else seats += r.seats!;
    } else if (r.seats !== undefined) out.push(`${at}: only a workspace has seats`);
    if (r.desk !== undefined) {
      if (r.kind !== 'workspace') out.push(`${at}: only a workspace has desks to put things on`);
      else if (!(r.desk in DESK_TOPS) && !drawn.desk.includes(r.desk))
        out.push(`${at}: "${r.desk}" cannot stand on a desk`);
    }
    checkExtras(at, r.extras);
    checkEdits(at, r.edits);
  });
  if (seats > LIMITS.seats) out.push(`${seats} desks is over the limit of ${LIMITS.seats}`);
  return out;
}
