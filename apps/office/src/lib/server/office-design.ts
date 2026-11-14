// Drawing an office from the owner's words. Claude reads the description and
// writes a spec: which rooms, how big, how many desks, the materials and the
// extras, and the pieces to draw that the library lacks. Each piece is drawn
// in its own run, all at once. The world package turns the spec into a floor
// and checks it, with the limits in code. A spec with problems goes back once
// with the problems listed. It runs as the office, so it works before anybody
// is hired.
import { writeFileSync } from 'node:fs';
import { roster, type Destination, home } from '@oddboro/ledger';
import {
  ART_LIMITS,
  artCatalog,
  artSprite,
  checkArt,
  checkRequest,
  type ArtRequest,
  type DrawnArt
} from '@oddboro/sprites/art';
import { loadSprites } from '@oddboro/sprites/load';
import { encodePng, scaleImage } from '@oddboro/sprites/png';
import type { SpriteDef } from '@oddboro/sprites/px';
import { cropImage, paintWorld } from '@oddboro/world/render';
import {
  ACCENTS,
  AREAS,
  checkSpec,
  DESK_TOPS,
  EXTRAS,
  FLOORS,
  generateOffice,
  libraryPieces,
  swapProblems,
  GROUNDS,
  KIND_ABOUT,
  LIMITS,
  PLANTS,
  SIZES,
  WALLS,
  type FloorPlan,
  type OfficeSpec,
  type RoomEdit,
  type RoomKind,
  type RoomTemplate,
  type SpriteCatalog,
  type World
} from '@oddboro/world';
import { drawArt } from './office-art.ts';
import { runAsOffice } from './office-run.ts';
import { housePalette, officeLibrary, SAMPLE, sheetJson, type ArtSheetJson } from './space.ts';
import { canDraw, SONNET_CANNOT_DRAW } from './claude.ts';

export type DrawnOffice = {
  spec: OfficeSpec;
  plan: FloorPlan;
  templates: Record<string, RoomTemplate>;
  kinds: Record<string, RoomKind>;
  world: World;
  /** What the office changed to make it fit. */
  notes: string[];
  /** Things the owner asked for that the office has no art for yet. */
  missing: string[];
  /** Work seats per room template, for moving staff in. */
  seats: Record<string, number>;
  /** Art drawn for this office and not kept yet: it is kept on moving in. */
  art: DrawnArt[];
  /** That art's sprites, for the preview to load. */
  artSheet?: ArtSheetJson;
  artCatalog: SpriteCatalog;
};

/** What the page hears while the office draws. */
export type Progress =
  | { step: 'spec'; name: string; drawing: ArtRequest[] }
  /** The floor with library stand-ins for the pieces still drawing, to show before they land. */
  | { step: 'plan'; world: World }
  | { step: 'art'; name: string; ok: boolean }
  | { step: 'check' }
  | { step: 'more'; drawing: ArtRequest[] };

const SYSTEM = `You design an office floor for {owner}'s Odds, the AI workers in a pixel-art building they walk around in. You write a spec as JSON; the office builds the floor from it. Pick only from the lists you are given. Reply with one json block and nothing else.`;

const ABOUT_KIND: Record<string, string> = {
  prop: 'furniture or a thing on the floor. `place`: back (against the back wall), floor (out in the room) or corner (a free tile near the front). Use it in extras',
  'wall-prop': 'something hung on a back wall. Use it in extras',
  'desk-prop': "a small thing for every desk in a workspace. Use it as the workspace's `desk`",
  floor: 'a floor material. Use it as a floor',
  wall: 'a wall style: the face of the back walls, with a cap, door and window to match. Use it as a wall'
};

function brief(staff: number, drawn: DrawnArt[]): string {
  const list = (xs: readonly string[]) => xs.join(', ');
  const has = (kind: string) => drawn.filter((a) => a.kind === kind).map((a) => a.name);
  return `## How the office builds it

Rooms stand in two rows either side of a hall, with a front door onto a street. West is the left of the floor and east the right; the back row is the north side, the front row faces the street. The office places the rooms itself: the owner's office in the middle of the back row, the lobby in the middle of the front row over the front door, and the rest outward from the middle, east then west, into the narrower row, in the order you list them. You choose which rooms, their names, sizes and finishes.

When {owner} says where a room goes, pin it: \`"side": "west"\` or \`"east"\` puts it at that end of its row, and \`"row": "back"\` or \`"front"\` picks its row. Pin only what {owner} placed; the office and the lobby always stay in the middle. If {owner} asks for a place the office cannot give, say so in \`missing\`.

## Room kinds

${Object.entries(KIND_ABOUT)
  .map(([k, about]) => `- ${k}: ${about}`)
  .join('\n')}

## Choices

- wall: ${list([...WALLS, ...has('wall')])}
- floor: ${list([...FLOORS, ...has('floor')])}
- size: ${list(SIZES)} (medium when left out)
- accent, the colour of soft furnishings: ${list(ACCENTS)}
- grounds, the land around the building: ${list(GROUNDS)}
- plants, along the halls: ${list(PLANTS)}

## Extras, up to ${LIMITS.extras} a room

${Object.entries(EXTRAS)
  .map(([k, about]) => `- ${k}: ${about}`)
  .join('\n')}

## On every desk

A workspace's \`desk\` stands one thing on every desk: ${list([...Object.keys(DESK_TOPS), ...has('desk-prop')])}. Leave it out and desks alternate lamps and plants.

## A theme

When {owner} wants a whole look the library does not have, like a medieval dungeon, a spaceship or a treehouse, make it a theme: draw stand-ins for the library pieces that would break the look and swap them in everywhere.

- Add each stand-in to \`draw\` with \`"replaces": "<library sprite>"\`. It is drawn over that piece, keeping its footprint and spots, so Odds use it the same way: a scribe's desk still has a work seat.
- Map them in \`"swaps": { "<library sprite>": "<stand-in name>" }\`, inside \`spec\`. The office places the library piece and shows the stand-in.
- Pieces worth swapping first: floor-lamp, desk, desk-lamp, chair, bookshelf, plant-tall, rug, break-couch-back, lobby-couch, kitchen-table, whiteboard. Draw the walls and floors as styles, as usual; a wall style's window can be an arrow slit.
- \`"windows": false\`, also inside \`spec\`, leaves out every window, for a place underground.
- The outside takes the theme too: \`"facade": "<wall style>"\`, inside \`spec\`, is the wall the building shows the street (brick unless you say), and a floor stand-in (\`"kind": "floor"\`, \`"replaces": "sidewalk"\`) swaps a ground material: the sidewalk, curb, asphalt or grass. The street's pieces swap like any other.
- A library piece with no place in the theme and not worth drawing goes: swap it to \`""\` and the office leaves it out. Anything Odds use (a desk, a seat, the bus shelter) or a door needs a stand-in instead. Look at what each room kind brings (a break room's TV, arcade and vending machine, a kitchen's counters and microwave, the reception monitor, the hall plants, the street's shop windows) and swap or leave out whatever breaks the look.
- Give rooms whose kind has its own floor (kitchen, gym, mail) a floor in the theme.

What the office places in each part of a building, by library name:

${Object.entries(libraryPieces())
  .map(([part, names]) => `- ${part}: ${names.join(', ')}`)
  .join('\n')}

## A porch

\`"porch": { "floor": "oak", "extras": ["plant-tall"] }\` decks the sidewalk outside the front door, with its extras standing along the building. Each is one tile deep.

## Drawn for this office already

${
  drawn.length
    ? drawn
        .map((a) => `- ${a.name} (${a.kind}${a.place ? `, ${a.place}` : ''}): ${a.about}`)
        .join('\n')
    : 'Nothing yet.'
}

Use these by name like any other choice.

## Drawing what the library lacks

When {owner} asks for something no choice covers and it would show on a floor seen from above, have it drawn: add it to \`draw\` and use its name like any other choice. Up to ${ART_LIMITS.pieces} pieces. Use what is drawn already before drawing more, and do not draw what a choice above already is. Kinds:

${Object.entries(ABOUT_KIND)
  .map(([k, about]) => `- ${k}: ${about}`)
  .join('\n')}

A name is lowercase words joined by hyphens, new to the office. \`about\` says what it looks like, in a sentence the artist draws from: materials, colours, shape. Things overhead, like exposed beams, show best drawn into a wall style's face.

## Changing what is in a room

When you change an office, each room is listed with what the office furnished it with: every item's id (\`sprite#n\`) and its top-left tile. To change what is in a room, give it \`edits\`, applied in order after the office furnishes it:

- \`{"remove": "lobby-couch#1"}\`
- \`{"move": "rug#1", "to": [4, 6]}\`
- \`{"add": "plant-tall", "at": [2, 7]}\`, any extra or piece drawn for this office

Moving or removing the first of a group takes the whole group with it, like a desk with its chair and lamp. Keep the edits a room already has, and add to them. The office refuses an edit that would block a seat, a door or the floor a shelf or screen needs, and says so. Use edits for "remove that", "move this", "put one there"; use extras and the rest of the spec for bigger changes.

The halls, the street and the grounds take edits the same way, in \`"areas": {"halls": [...], "street": [...], "grounds": [...]}\` inside \`spec\`, each in its own tiles from its top-left. {owner} makes these by hand; keep \`areas\` exactly as it is.

## Limits

- Exactly one office and one lobby. One to ${LIMITS.workspaces} workspaces. At most ${LIMITS.perKind} of any other kind. At most ${LIMITS.rooms} rooms in all.
- A workspace has 1 to ${LIMITS.seatsPerRoom} seats; at most ${LIMITS.seats} across the office.
- Work seats are desks, plus one at the lobby's reception, one per mail room and one or two per library. There are ${staff} Odds now, so make at least ${staff + 2} work seats, and leave room to hire.
- The office name is at most ${LIMITS.name} characters, a room name at most ${LIMITS.roomName}.

## Answer

\`\`\`json
{
  "spec": {
    "name": "Harbor House",
    "wall": "plaster",
    "floor": "oak",
    "grounds": "park",
    "plants": "some",
    "rooms": [
      { "kind": "office", "name": "Your Office", "size": "medium", "wall": "teal", "floor": "carpet", "accent": "teal" },
      { "kind": "workspace", "name": "The Bullpen", "seats": 8 },
      { "kind": "lobby", "name": "Lobby", "extras": ["lobby-aquarium", "coat-hooks"] },
      { "kind": "kitchen", "name": "Kitchen", "floor": "terracotta" }
    ]
  },
  "draw": [
    { "name": "coat-hooks", "kind": "wall-prop", "about": "a walnut rail of brass hooks with two coats and a scarf hanging" },
    { "name": "terracotta", "kind": "floor", "about": "square terracotta tiles, warm orange, thin cream grout" }
  ],
  "missing": ["the high ceiling: the floor is seen from above"]
}
\`\`\`

\`missing\` lists what {owner} asked for that a floor seen from above cannot show, like ceiling height, sound or smell, each with why in a few words. Leave it empty when everything shows. Follow what {owner} says over the example: it only shows the shape.`;
}

type Reply = { spec?: OfficeSpec; draw: ArtRequest[]; missing: string[]; problems: string[] };

function parse(text: string): Reply {
  const block = /```json\s*\n([\s\S]*?)```/.exec(text)?.[1] ?? text;
  try {
    const reply = JSON.parse(block) as {
      spec?: OfficeSpec;
      draw?: unknown;
      missing?: unknown;
      swaps?: OfficeSpec['swaps'];
      windows?: boolean;
    };
    const missing = Array.isArray(reply.missing)
      ? reply.missing.filter((m): m is string => typeof m === 'string').slice(0, 10)
      : [];
    const draw = Array.isArray(reply.draw) ? (reply.draw as ArtRequest[]) : [];
    if (!reply.spec) return { draw, missing, problems: ['there is no "spec" in the reply'] };
    // A theme belongs inside the spec, but a reply may put it beside it.
    if (reply.swaps && !reply.spec.swaps) reply.spec.swaps = reply.swaps;
    if (reply.windows !== undefined && reply.spec.windows === undefined)
      reply.spec.windows = reply.windows;
    return { spec: reply.spec, draw, missing, problems: [] };
  } catch (e) {
    return {
      draw: [],
      missing: [],
      problems: [`the json does not parse: ${e instanceof Error ? e.message : e}`]
    };
  }
}

/** What a spec asks to have drawn is well formed, new, and within the limit. */
function checkDraw(draw: ArtRequest[], catalog: SpriteCatalog): string[] {
  const out = draw.length > ART_LIMITS.pieces ? [`draw at most ${ART_LIMITS.pieces} pieces`] : [];
  draw.forEach((d, i) =>
    out.push(
      ...checkRequest(d, (n) => n in catalog || draw.some((o, j) => j < i && artSprite(o) === n))
    )
  );
  return out;
}

/** Stand-ins for pieces not drawn yet, so the spec can be checked before they are. */
function stubs(draw: ArtRequest[], catalog: SpriteCatalog): SpriteCatalog {
  return Object.fromEntries(
    draw.map((d) => {
      // A stand-in will match what it replaces exactly, so check the spec as if it does.
      const original = d.replaces ? catalog[d.replaces] : undefined;
      if (original) return [artSprite(d), { ...original, tags: [...original.tags, 'drawn'] }];
      const place = d.kind === 'wall-prop' ? 'wall' : d.kind === 'desk-prop' ? 'desk' : d.place;
      return [
        artSprite(d),
        {
          width: 16,
          height: 16,
          layer:
            d.kind === 'floor'
              ? 'floor'
              : d.kind === 'wall' || d.kind === 'wall-prop'
                ? 'wall'
                : 'object',
          origin: [0, 0],
          footprint: [1, 1],
          walkable: false,
          zbias: 0,
          fps: 0,
          tags: ['drawn', ...(place ? [`place-${place}`] : [])],
          spots: [],
          lights: [],
          variants: [],
          frames: ['0']
        }
      ];
    })
  );
}

/** The spec without pieces that did not come out: their rooms fall back to the library. */
function without(spec: OfficeSpec, gone: string[]): OfficeSpec {
  if (!gone.length) return spec;
  const keep = (xs?: string[]) => xs?.filter((x) => !gone.includes(x));
  const out: OfficeSpec = structuredClone(spec);
  if (gone.includes(out.wall)) out.wall = 'plaster';
  if (gone.includes(out.floor)) out.floor = 'oak';
  if (out.facade && gone.includes(out.facade)) delete out.facade;
  if (out.porch) {
    out.porch.extras = keep(out.porch.extras);
    if (out.porch.floor && gone.includes(out.porch.floor)) delete out.porch.floor;
  }
  // A stand-in that did not come out leaves the library piece in place.
  if (out.swaps)
    for (const [from, to] of Object.entries(out.swaps))
      if (gone.includes(to)) delete out.swaps[from];
  for (const r of out.rooms) {
    r.extras = keep(r.extras);
    if (r.wall && gone.includes(r.wall)) delete r.wall;
    if (r.floor && gone.includes(r.floor)) delete r.floor;
    if (r.desk && gone.includes(r.desk)) delete r.desk;
    // An edit that adds a piece still drawing waits for it.
    if (r.edits) r.edits = r.edits.filter((e) => !('add' in e) || !gone.includes(e.add));
  }
  if (out.areas)
    for (const area of AREAS) {
      const edits = out.areas[area];
      if (edits) out.areas[area] = edits.filter((e) => !('add' in e) || !gone.includes(e.add));
    }
  return out;
}

/** The pieces a spec uses. */
const usedBy = (spec: OfficeSpec, art: DrawnArt[]) => {
  const text = JSON.stringify(spec);
  return art.filter((a) => text.includes(`"${a.name}"`));
};

/** Work seats in each room template: where staff can be given a room. */
export function seatsIn(world: World): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of world.spots)
    if (['work', 'intake', 'read'].includes(s.activity)) {
      const room = s.room.split('#')[0];
      out[room] = (out[room] ?? 0) + 1;
    }
  return out;
}

/**
 * Somewhere to move the office: a layout, or the sample when `id` is null.
 * A room is a workspace by its kind, or for the sample by its id.
 */
export function destination(
  id: number | null,
  name: string,
  world: World,
  kinds?: Record<string, RoomKind>
): Destination {
  const rooms: Destination['rooms'] = {};
  for (const r of world.rooms) {
    const t = r.id.split('#')[0];
    rooms[t] ??= {
      name: r.name,
      desks: kinds ? kinds[t] === 'workspace' : t.startsWith('workspace')
    };
  }
  const spots = world.spots
    .filter((s) => ['work', 'intake', 'read'].includes(s.activity))
    .map((s) => s.id);
  return {
    id,
    key: id === null ? SAMPLE : `office-${id}`,
    name,
    rooms,
    seats: seatsIn(world),
    spots
  };
}

/** Build a spec into an office, or say what is wrong with it. */
export function build(
  spec: OfficeSpec,
  staff: number,
  catalog: SpriteCatalog
): {
  office?: Omit<DrawnOffice, 'missing' | 'art' | 'artSheet' | 'artCatalog'>;
  problems: string[];
} {
  const built = generateOffice(spec, catalog, staff);
  if (built.problems.length || !built.world) return { problems: built.problems };
  return {
    office: {
      spec,
      plan: built.plan,
      templates: built.templates,
      kinds: built.kinds,
      world: built.world,
      notes: built.notes,
      seats: seatsIn(built.world)
    },
    problems: []
  };
}

/**
 * Build a spec as it stands, without asking Claude: to refurnish an office by
 * the latest rules, or to show a change made by hand. `sent` is art drawn for
 * it and not kept yet.
 */
export async function buildOnly(spec: OfficeSpec, sent: DrawnArt[]): Promise<DrawnOffice> {
  const staff = (await roster()).length;
  const lib = await officeLibrary();
  const palette = housePalette();
  const fresh: DrawnArt[] = [];
  const sprites: SpriteDef[] = [];
  for (const a of sent) {
    const r = checkArt(a, palette, (n) => n in lib.catalog || sprites.some((d) => d.name === n));
    if (r.problems.length) continue;
    fresh.push({ ...a, px: r.px });
    sprites.push(...r.sprites);
  }
  const catalog = { ...lib.catalog, ...artCatalog(sprites, palette) };
  const problems = checkSpec(spec, catalog);
  if (problems.length) throw new Error(problems.join('; '));
  const built = build(spec, staff, catalog);
  if (!built.office) throw new Error(built.problems.join('; '));
  const art = usedBy(built.office.spec, fresh);
  const used = sprites.filter((d) => art.some((a) => d.file === a.name));
  return {
    ...built.office,
    missing: [],
    art,
    artSheet: used.length ? sheetJson(used, palette) : undefined,
    artCatalog: artCatalog(used, palette)
  };
}

/** Where a spec's rooms stand, row by row, west to east, for Claude to change it without moving them. */
function standing(spec: OfficeSpec, staff: number, catalog: SpriteCatalog): string | undefined {
  const { office } = build(spec, staff, catalog);
  if (!office) return undefined;
  const rooms = office.world.rooms
    .filter((r) => office.kinds[r.id.split('#')[0]])
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const top = Math.min(...rooms.map((r) => r.y));
  const line = (label: string, list: typeof rooms) =>
    `- ${label}: ${list.map((r) => r.name).join(', ')}`;
  const rows = [
    line(
      'Back row',
      rooms.filter((r) => r.y === top)
    ),
    line(
      'Front row',
      rooms.filter((r) => r.y !== top)
    )
  ].join('\n');
  return `${rows}\n\nWhat is in each room now. A tile counts from the room's top-left corner, walls included; rows 0 to 2 are the back wall.\n\n${inventory(office)}`;
}

/** What is in each room, by id and tile, so a change can name the very thing. */
function inventory(office: Pick<DrawnOffice, 'templates' | 'kinds'>): string {
  return Object.values(office.templates)
    .filter((t) => office.kinds[t.id])
    .map((t) => {
      const h = t.map.length;
      const w = t.map[0].length;
      const door = t.map[h - 1].indexOf('.');
      const items = t.props
        .filter((p) => p.id)
        .map((p) => {
          const with_ = p.group && p.group !== p.id ? ` (placed with ${p.group})` : '';
          return `- ${p.id} at ${p.at.join(', ')}${p.frame === 'side' ? ', side on' : ''}${with_}`;
        });
      return `### ${t.name} (${office.kinds[t.id]}, ${w} x ${h} tiles; floor rows 3 to ${h - 3}, columns 1 to ${w - 2}; door at the bottom, columns ${door} and ${door + 1})\n${items.join('\n')}`;
    })
    .join('\n\n');
}

let libraryDefs: Map<string, SpriteDef> | undefined;

/** What a look over the finished office asks for: edits, pieces to draw, swaps, a facade. */
type Look = {
  rooms: Record<string, RoomEdit[]>;
  draw: ArtRequest[];
  swaps: Record<string, string>;
  facade?: string;
};

/**
 * Look over the office as built, the way a person walking in would: every
 * room, then the front of the building and the street. Claude fixes what
 * reads wrong with edits, furnishes rooms a theme left bare, and asks for
 * stand-ins for anything that still breaks the look, inside or out. One run
 * with a picture of each. Undefined when everything reads right.
 */
async function lookOver(
  office: Pick<DrawnOffice, 'spec' | 'world' | 'templates' | 'kinds'>,
  drawnSprites: SpriteDef[],
  drawn: DrawnArt[],
  feel: string,
  scope?: Scope
): Promise<Look | undefined> {
  libraryDefs ??= loadSprites().sprites;
  const defs = new Map([...libraryDefs, ...drawnSprites.map((d) => [d.name, d] as const)]);
  const picture = paintWorld(office.world, defs, housePalette());
  const shot = (x: number, y: number, w: number, h: number) => ({
    mediaType: 'image/png',
    data: Buffer.from(
      encodePng(scaleImage(cropImage(picture, x * 16, y * 16, w * 16, h * 16), 3))
    ).toString('base64')
  });
  const rooms = office.world.rooms.filter(
    (r) => office.kinds[r.id.split('#')[0]] && (!scope || scope.rooms.has(r.name))
  );
  const street =
    !scope || scope.outside
      ? office.world.rooms.find((r) => r.id.startsWith('street#'))
      : undefined;
  const images = rooms.map((r) => shot(r.x, r.y, r.w, r.h));
  // The front of the building and the street, from three rows above the sidewalk.
  if (street) images.push(shot(street.x, street.y - 3, street.w, street.h + 3));
  const pieces = libraryPieces();
  const message = `# Look over the office

${scope ? `{owner} changed only some of ${office.spec.name}. Look over only what is shown, and leave the rest of the office as it is.\n\n` : ''}The images above are the rooms of ${office.spec.name}, one each, three times larger, in this order: ${rooms.map((r, i) => `${i + 1}. ${r.name}`).join(', ')}${street ? `, then ${rooms.length + 1}: the front of the building and the street` : ''}. What {owner} wants the office to feel like: ${feel}

What is in each room, by id and top-left tile, counting from the room's top-left corner, walls included (rows 0 to 2 are the back wall):

${inventory({ ...office, templates: Object.fromEntries(Object.entries(office.templates).filter(([, t]) => rooms.some((r) => r.name === t.name))) })}

The theme so far: swaps ${JSON.stringify(office.spec.swaps ?? {})}, facade ${office.spec.facade ?? 'brick'}, windows ${office.spec.windows === false ? 'none' : 'yes'}. Pieces drawn for this office: ${drawn.map((a) => `${a.name}${a.replaces ? ` (stands in for ${a.replaces})` : ''}`).join(', ') || 'none'}.

Look at each picture the way someone walking in would, and find what reads wrong:

- a seat facing a wall, or turned from what it is for: a couch from its TV, a chair from its desk
- something in the way of a door, a shelf, a cabinet, a screen or a seat
- clutter in one part while the rest stands empty, or a room that reads bare, like one a theme took pieces out of: furnish it for what it is for
- anything that breaks the look {owner} asked for, in a room or outside: the facade, the street, its lamps, the bus shelter, the ground

## How to fix it

Edits on a room, applied in order:

- \`{"remove": "<id>"}\`
- \`{"move": "<id>", "to": [x, y]}\` (moving the first of a group takes the group)
- \`{"add": "<sprite>", "at": [x, y]}\`, an extra, a library piece, or a piece drawn for this office

For something that breaks the look, draw a stand-in and swap it in, or swap it to \`""\` to leave it out (never anything Odds use, or a door). A stand-in is \`{"name": "<new-name>", "kind": "prop", "about": "<what it looks like>", "replaces": "<library sprite>"}\`: it keeps the original's footprint and spots. A floor stand-in (\`"kind": "floor"\`) swaps a ground material, like the sidewalk; a wall style (\`"kind": "wall"\`) can be the facade. Up to ${ART_LIMITS.pieces} new pieces. What the office places, by library name:

${Object.entries(pieces)
  .map(([part, names]) => `- ${part}: ${names.join(', ')}`)
  .join('\n')}

Leave what reads right alone. Reply with one json block and nothing else, every key optional:

\`\`\`json
{"rooms": {"<room name>": [<edits>]}, "draw": [<pieces>], "swaps": {"<library sprite>": "<stand-in or empty>"}, "facade": "<wall style>"}
\`\`\``;
  const r = await runAsOffice(message, {
    system: SYSTEM,
    kind: 'office',
    timeoutMs: 8 * 60_000,
    effort: 'medium',
    images
  });
  if (!r.ok) return undefined;
  let reply: Partial<Look>;
  try {
    reply = JSON.parse(/\`\`\`json\s*\n([\s\S]*?)\`\`\`/.exec(r.text)?.[1] ?? r.text);
  } catch {
    return undefined;
  }
  const look: Look = {
    rooms: reply.rooms && typeof reply.rooms === 'object' ? reply.rooms : {},
    draw: Array.isArray(reply.draw) ? reply.draw.slice(0, ART_LIMITS.pieces) : [],
    swaps: reply.swaps && typeof reply.swaps === 'object' ? reply.swaps : {},
    facade: typeof reply.facade === 'string' ? reply.facade : undefined
  };
  const asks = Object.keys(look.rooms).length + look.draw.length + Object.keys(look.swaps).length;
  return asks || look.facade ? look : undefined;
}

/** Take out the swaps that cannot stand in, and say why. The rest of the theme stays. */
function dropBadSwaps(spec: OfficeSpec, catalog: SpriteCatalog): string[] {
  const notes: string[] = [];
  for (const [from, to] of Object.entries(spec.swaps ?? {})) {
    const why = swapProblems(from, to, catalog);
    if (!why.length) continue;
    delete spec.swaps![from];
    notes.push(`${from.replaceAll('-', ' ')} stays as it is: ${why[0]}.`);
  }
  return notes;
}

/**
 * What a change touched: the rooms whose spec is new or different, and
 * whether the theme or the outside changed. The look-over keeps to it.
 */
type Scope = { rooms: Set<string>; outside: boolean };

function scopeOf(before: OfficeSpec, after: OfficeSpec): Scope {
  const was = new Map(before.rooms.map((r) => [r.name.trim(), JSON.stringify(r)]));
  const rooms = new Set(
    after.rooms
      .filter((r) => was.get(r.name.trim()) !== JSON.stringify(r))
      .map((r) => r.name.trim())
  );
  const look = (s: OfficeSpec) =>
    JSON.stringify([
      s.swaps ?? {},
      s.facade ?? null,
      s.windows ?? null,
      s.wall,
      s.floor,
      s.grounds,
      s.porch ?? null
    ]);
  return { rooms, outside: look(before) !== look(after) };
}

/** A look's edits, swaps and facade on a spec. `only` keeps just the room edits. */
function withLook(spec: OfficeSpec, look: Look, gone: string[], only = false, scope?: Scope) {
  const out = structuredClone(spec);
  const changed: string[] = [];
  for (const [name, edits] of Object.entries(look.rooms)) {
    // A change keeps to the rooms it touched.
    if (scope && !scope.rooms.has(name.trim())) continue;
    const room = out.rooms.find((s) => s.name.trim() === name.trim());
    if (!room || !Array.isArray(edits) || !edits.length) continue;
    room.edits = [...(room.edits ?? []), ...edits];
    changed.push(name);
  }
  if (only || (scope && !scope.outside)) return { spec: out, changed };
  const swaps = Object.entries(look.swaps).filter(([, to]) => !gone.includes(to));
  if (swaps.length) out.swaps = { ...(out.swaps ?? {}), ...Object.fromEntries(swaps) };
  if (look.facade && !gone.includes(look.facade)) out.facade = look.facade;
  if (swaps.length || look.facade) changed.push('the theme');
  return { spec: out, changed };
}

export async function drawOffice(
  req: {
    description: string;
    note?: string;
    previous?: OfficeSpec;
    /** Art drawn for the previous version, not kept yet. */
    art?: DrawnArt[];
  },
  on: (p: Progress) => void = () => {}
): Promise<DrawnOffice> {
  if (!canDraw()) throw new Error(SONNET_CANNOT_DRAW);
  const staff = (await roster()).length;
  const lib = await officeLibrary();
  const palette = housePalette();
  // Art drawn for this office and not kept yet: from the version before, then from this one.
  const fresh: DrawnArt[] = [];
  const sprites: SpriteDef[] = [];
  const catalog = () => ({ ...lib.catalog, ...artCatalog(sprites, palette) });
  const add = (a: DrawnArt, s: SpriteDef[]) => {
    fresh.push(a);
    sprites.push(...s);
  };
  for (const a of req.art ?? []) {
    const r = checkArt(a, palette, (n) => n in catalog());
    if (!r.problems.length) add({ ...a, px: r.px }, r.sprites);
  }

  const where = req.previous && standing(req.previous, staff, catalog());
  const ask = () =>
    [
      '# Design the office\n',
      `What {owner} wants: ${req.description}\n`,
      req.previous &&
        `\nYou drew this before, and {owner} wants a change.\n\n\`\`\`json\n${JSON.stringify(req.previous)}\n\`\`\`\n${where ? `\nWhere its rooms stand now, west to east:\n\n${where}\n` : ''}\nKeep the rooms already there in the same order, and their pins, so they stay where they are; add new rooms at the end of the list.\n\nWhat {owner} wants changed: ${req.note || 'draw it again, differently'}`,
      brief(staff, [...lib.art, ...fresh])
    ]
      .filter(Boolean)
      .join('\n');

  /** Draw pieces at once; returns the names of any that did not come out. */
  const drawAll = async (list: ArtRequest[]) => {
    const gone: string[] = [];
    await Promise.all(
      list.map(async (d) => {
        try {
          const drawn = await drawArt(d, req.description, palette, (n) => n in catalog());
          add(drawn.art, drawn.sprites);
          on({ step: 'art', name: d.name, ok: true });
        } catch (e) {
          console.error(`[art] ${d.name}: ${e instanceof Error ? e.message : e}`);
          gone.push(d.name);
          on({ step: 'art', name: d.name, ok: false });
        }
      })
    );
    return gone;
  };

  const notes: string[] = [];
  let message = ask();
  for (let attempt = 1; ; attempt++) {
    const r = await runAsOffice(message, {
      system: SYSTEM,
      kind: 'office',
      timeoutMs: 6 * 60_000,
      effort: 'medium'
    });
    if (!r.ok) throw new Error(r.text);
    const parsed = parse(r.text);
    const problems = [...parsed.problems];
    if (parsed.spec) {
      // Over the limit: draw the first pieces, and leave the rest out.
      const over = parsed.draw.slice(ART_LIMITS.pieces).map((d) => d.name);
      if (over.length) {
        parsed.draw = parsed.draw.slice(0, ART_LIMITS.pieces);
        parsed.spec = without(parsed.spec, over);
        notes.push(`Only ${ART_LIMITS.pieces} pieces draw at once, so ${over.join(', ')} waited.`);
      }
      // A swap that cannot stand in is left out, not the whole theme.
      notes.push(...dropBadSwaps(parsed.spec, { ...catalog(), ...stubs(parsed.draw, catalog()) }));
    }
    if (parsed.spec) {
      problems.push(...checkDraw(parsed.draw, catalog()));
      if (!problems.length)
        problems.push(
          ...checkSpec(parsed.spec, { ...catalog(), ...stubs(parsed.draw, catalog()) })
        );
    }
    let built: ReturnType<typeof build> | undefined;
    if (parsed.spec && !problems.length) {
      on({ step: 'spec', name: parsed.spec.name, drawing: parsed.draw });
      const standIn = build(
        without(
          parsed.spec,
          parsed.draw.map((d) => d.name)
        ),
        staff,
        catalog()
      );
      if (standIn.office) on({ step: 'plan', world: standIn.office.world });
      else console.error(`[office] stand-in floor: ${standIn.problems.join('; ')}`);
      const gone = await drawAll(parsed.draw);
      for (const g of gone)
        notes.push(`The ${g.replaceAll('-', ' ')} did not come out, so it is left out.`);
      built = build(without(parsed.spec, gone), staff, catalog());
      problems.push(...built.problems);
    }
    if (!problems.length && built?.office) {
      // Look over the office as built, inside and out, and fix what reads
      // wrong. A change looks over only what it touched, and nothing if it
      // touched nothing a picture would show.
      const scope = req.previous ? scopeOf(req.previous, built.office.spec) : undefined;
      const looking = !scope || scope.rooms.size > 0 || scope.outside;
      if (looking) on({ step: 'check' });
      const look = !looking
        ? undefined
        : await lookOver(built.office, sprites, fresh, req.description, scope).catch((e) => {
            console.error(`[office] look over: ${e instanceof Error ? e.message : e}`);
            return undefined;
          });
      if (look) {
        // Draw what it asked for, if the names are free and well formed.
        const more = checkDraw(look.draw, catalog()).length ? [] : look.draw;
        if (more.length) on({ step: 'more', drawing: more });
        const gone = more.length ? await drawAll(more) : [];
        for (const g of gone)
          notes.push(`The ${g.replaceAll('-', ' ')} did not come out, so it is left out.`);
        // Everything it asked for if that builds, else just the room edits.
        for (const only of [false, true]) {
          const next = withLook(built.office.spec, look, gone, only, scope);
          notes.push(...(only ? [] : dropBadSwaps(next.spec, catalog())));
          if (!next.changed.length) continue;
          const wrong = checkSpec(next.spec, catalog());
          const again = wrong.length ? undefined : build(next.spec, staff, catalog());
          if (!again?.office) {
            console.error(
              `[office] look over, ${only ? 'edits only' : 'everything'}: ${(wrong.length ? wrong : (again?.problems ?? [])).join('; ')}`
            );
            continue;
          }
          built.office = again.office;
          notes.push(`Looked over the office and changed ${next.changed.join(', ')}.`);
          break;
        }
      }
      const art = usedBy(built.office.spec, fresh);
      const used = sprites.filter((d) => art.some((a) => d.file === a.name));
      return {
        ...built.office,
        notes: [...new Set([...notes, ...built.office.notes])],
        missing: parsed.missing,
        art,
        artSheet: used.length ? sheetJson(used, palette) : undefined,
        artCatalog: artCatalog(used, palette)
      };
    }
    // The last reply, for when a drawing keeps failing.
    writeFileSync(home('office', 'last-office.md'), r.text);
    console.error(`[office] attempt ${attempt}: ${problems.join('; ')}`);
    if (attempt >= 2) throw new Error(`The office did not come out right: ${problems.join('; ')}`);
    message = `${ask()}\n\n## Your last reply\n\n${r.text}\n\n## What was wrong with it\n\n${problems.map((p) => `- ${p}`).join('\n')}\n\nReply again in full, with every problem fixed. Pieces drawn for your last reply are listed under "Drawn for this office already"; use them by name instead of drawing them again.`;
  }
}
