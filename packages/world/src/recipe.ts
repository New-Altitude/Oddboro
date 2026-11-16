// What each kind of room holds at each size, and how big each room is drawn.
import type { SpriteCatalog } from './types.ts';
import type { RoomKind, Size, RoomSpec } from './generate.ts';
import { type Item, type Piece, type Room, Furnisher } from './furnish.ts';

const SIZE_STEP: Record<Size, number> = { small: 0, medium: 1, large: 2 };
/** Width and height of each kind of room, small, medium and large, walls included. */
const DIMS: Partial<Record<RoomKind, [number[], number[]]>> = {
  office: [
    [10, 12, 15],
    [9, 10, 12]
  ],
  lobby: [
    [12, 15, 18],
    [9, 10, 12]
  ],
  kitchen: [
    [11, 14, 17],
    [9, 10, 12]
  ]
};
const DEFAULT_DIMS: [number[], number[]] = [
  [10, 13, 17],
  [9, 10, 12]
];

/** The pieces a room of each kind is made of, most important first. */
function recipe(f: Furnisher, spec: RoomSpec): Piece[] {
  const n = SIZE_STEP[spec.size ?? 'medium'];
  const it = f.it.bind(f);
  const back = (...items: Item[]): Piece => ({ place: 'back', items });
  const floor = (...items: Item[]): Piece => ({ place: 'floor', items });
  const wall = (sprite: string): Piece => ({ place: 'wall', items: [it(sprite)] });
  const corner = (sprite: string): Piece => ({ place: 'corner', items: [it(sprite)] });
  const must = (p: Piece): Piece => ({ ...p, must: true });
  const center = (p: Piece): Piece => ({ ...p, center: true });
  const out: Piece[] = [];
  switch (spec.kind) {
    case 'office':
      out.push(
        wall('art-frame'),
        back(it('bookshelf')),
        back(it('plant-tall')),
        wall('wall-clock'),
        corner('floor-lamp'),
        corner('plant-fern')
      );
      if (n >= 1) out.push(back(it('owner-sideboard')));
      break;
    case 'lobby':
      out.push(
        center(must(floor(it('lobby-couch'), it('rug', 0, 1)))),
        back(it('lobby-plant-big')),
        back(it('lobby-coat-rack')),
        corner('floor-lamp'),
        corner('plant-tall')
      );
      if (n >= 2) out.push(back(it('lobby-aquarium')));
      break;
    case 'kitchen': {
      const counter = back(
        it('kitchen-counter-end'),
        it('kitchen-counter', 1),
        it('kitchen-counter-sink', 2),
        it('kitchen-counter', 4),
        it('kitchen-counter-end', 5, 0, { flip: true }),
        it('kitchen-kettle'),
        it('kitchen-microwave', 1),
        it('kitchen-coffee', 4),
        it('kitchen-cabinet', 0, -1),
        it('kitchen-shelf', 2, -1),
        it('kitchen-mat', 2, 1)
      );
      const table = (k: number) =>
        must(
          floor(
            ...[0, 1, 2, 3].map((x) =>
              it('kitchen-chair', x, 0, { variant: f.nth('kitchen-chair', x + k) })
            ),
            it('kitchen-table', 0, 1),
            it('kitchen-fruit-bowl', 1, 1),
            it('kitchen-pendant', 1, 1),
            it('kitchen-pendant', 2, 1)
          )
        );
      out.push(must(counter), back(it('kitchen-fridge')), center(table(0)));
      if (n >= 2) out.push(table(1));
      out.push(
        corner('kitchen-cooler'),
        back(it('plant-tall')),
        corner('bin'),
        corner('plant-fern')
      );
      break;
    }
    case 'break':
      out.push(
        // Somewhere to watch: the TV against the back wall, a couch facing it
        // three rows out, with the two rows between kept open.
        must(back(it('break-tv', 1), it('break-couch-back', 0, 3))),
        must(back(it('break-arcade', 0, 0, { variant: undefined }))),
        floor(
          it('rug', 0, 1),
          it('break-beanbag', 1, 1),
          it('break-beanbag', 2, 2, { variant: f.nth('break-beanbag', 1) })
        ),
        back(it('break-vending')),
        back(it('break-fridge')),
        wall('break-poster'),
        wall('break-dartboard'),
        corner('floor-lamp'),
        back(it('plant-tall'))
      );
      if (n >= 1) out.push(back(it('break-arcade', 0, 0, { variant: f.nth('break-arcade', 1) })));
      break;
    case 'library':
      out.push(
        must(
          floor(it('library-chair', 1), it('library-table', 0, 1), it('library-bankers-lamp', 2, 1))
        ),
        must(back(it('library-window-seat'))),
        back(it('library-shelf')),
        back(it('library-shelf-b'), it('library-ladder', 1)),
        center(
          floor(
            it('library-rug', 0, 0),
            it('library-armchair', 1, 1),
            it('library-side-table', 2, 1),
            it('library-lamp', 2, 1),
            it('library-armchair', 3, 1, { variant: f.nth('library-armchair', 1) }),
            it('library-books', 0, 2)
          )
        ),
        wall('library-map'),
        corner('floor-lamp'),
        corner('plant-fern')
      );
      if (n >= 1) out.push(back(it('library-fireplace')), back(it('library-globe')));
      if (n >= 2)
        out.push(
          floor(it('library-chair', 1), it('library-table', 0, 1), it('library-bankers-lamp', 2, 1))
        );
      break;
    case 'gym':
      out.push(
        must(back(it('gym-treadmill'))),
        must(back(it('gym-dumbbells'))),
        floor(it('gym-mat'), it('gym-mat', 2, 0, { variant: f.nth('gym-mat', 1) })),
        floor(it('gym-bike')),
        wall('gym-mirror'),
        wall('gym-wall-light'),
        back(it('gym-cooler')),
        wall('gym-poster'),
        wall('gym-wall-light'),
        corner('plant-tall'),
        corner('gym-bottle')
      );
      if (n >= 1) out.push(back(it('gym-treadmill')), back(it('gym-rack')));
      if (n >= 2) out.push(floor(it('gym-bench'), it('gym-kettlebells', 2, 1)));
      break;
    case 'mail':
      out.push(
        center(must(floor(it('mail-sort-table')))),
        back(it('mail-pigeonholes')),
        back(it('mail-printer')),
        back(it('mail-parcels')),
        wall('mail-corkboard'),
        wall('wall-clock'),
        floor(it('mail-cart')),
        corner('bin'),
        corner('floor-lamp'),
        corner('plant-fern')
      );
      if (n >= 1) out.push(back(it('mail-box-stack')));
      break;
    case 'workspace':
      out.push(
        wall('whiteboard'),
        back(it('bookshelf')),
        wall('art-frame'),
        back(it('plant-tall')),
        wall('wall-clock'),
        corner('filing-cabinet'),
        corner('floor-lamp'),
        corner('plant-fern')
      );
      break;
  }
  for (const e of spec.extras ?? []) out.push(extraPiece(f, e));
  return out;
}

function extraPiece(f: Furnisher, sprite: string): Piece {
  const item = f.it(sprite);
  // A drawn prop says where it goes.
  const place = f.catalog[sprite]?.tags.find((t) => t.startsWith('place-'))?.slice(6);
  if (place === 'back' || place === 'floor' || place === 'corner' || place === 'wall')
    return { place, items: [item] };
  if (
    /^(art-frame|whiteboard|wall-clock|owner-photos|break-poster|break-dartboard|library-map|mail-corkboard)$/.test(
      sprite
    )
  )
    return { place: 'wall', items: [item] };
  if (/^(plant-|floor-lamp|library-cat|kitchen-cooler|filing-cabinet)/.test(sprite))
    return { place: 'corner', items: [item] };
  if (/^(rug|lobby-couch|gym-bike|break-beanbag|library-globe)$/.test(sprite))
    return { place: 'floor', items: [item] };
  return { place: 'back', items: [item] };
}

/** The office's desk, chair, lamp and rug, at the top of the room, in the middle. */
function ownerDesk(f: Furnisher, r: Room): boolean {
  const piece: Piece = {
    place: 'floor',
    items: [
      f.it('owner-chair', 1, 0),
      f.it('owner-desk', 0, 1),
      f.it('desk-lamp', 0, 1),
      f.it('rug', 0, 2)
    ]
  };
  const x = Math.floor((r.w - 3) / 2);
  return f.fits(r, piece, x, 3, false) && f.put(r, piece, x, 3);
}

/** The reception desk, in front of the back wall with a row to sit down from. */
function reception(f: Furnisher, r: Room): boolean {
  const piece: Piece = {
    place: 'floor',
    items: [f.it('lobby-reception'), f.it('chair-front', 1, 0, { variant: f.tint('chair') })]
  };
  for (const x of [r.w - 5, r.w - 6, 3, 2, Math.floor(r.w / 2)])
    if (f.fits(r, piece, x, 5, false) && f.put(r, piece, x, 5)) return true;
  return false;
}

/** Where desks go across a room: three tiles apart, either side of the way in. */
function deskColumns(w: number): number[] {
  const door = Math.floor((w - 2) / 2);
  const xs: number[] = [];
  let x = 2;
  while (x + 1 <= w - 3) {
    // A desk would crowd the way in: carry on past it.
    if (x + 1 >= door - 1 && x <= door + 2) x = door + 3;
    else {
      xs.push(x);
      x += 3;
    }
  }
  return xs;
}

/** Rows of desks either side of the way in. */
function desks(f: Furnisher, r: Room, seats: number, top?: string): boolean {
  const xs = deskColumns(r.w);
  let placed = 0;
  for (let y = 4; placed < seats && y + 2 <= r.h - 2; y += 3)
    for (const x of xs) {
      if (placed >= seats) break;
      const piece: Piece = {
        place: 'floor',
        items: [
          f.it('desk', 0, 0, { variant: f.nth('desk', placed) }),
          top
            ? f.it(top, 0, 0, { variant: f.nth(top, placed) })
            : placed % 2 === 0
              ? f.it('desk-lamp', 0, 0, { variant: f.nth('desk-lamp', placed / 2) })
              : f.it('plant-small', 0, 0, { variant: f.nth('plant-small', placed) }),
          f.it('chair', 1, 1, { variant: f.nth('chair', placed) })
        ]
      };
      if (f.fits(r, piece, x, y, false) && f.put(r, piece, x, y)) placed++;
    }
  return placed === seats;
}

/** A workspace's size for its desks: as many to a row as fit, up to six. */
function workspaceDims(seats: number, size: Size): [number, number] {
  const rows = Math.ceil(seats / 6);
  const perRow = Math.ceil(seats / rows);
  let w = perRow * 3 + 4;
  while (deskColumns(w).length < perRow) w++;
  return [w + SIZE_STEP[size] * 2, Math.max(3 * rows + 6, DEFAULT_DIMS[1][SIZE_STEP[size]])];
}

function baseDims(spec: RoomSpec): [number, number] {
  const size = spec.size ?? 'medium';
  if (spec.kind === 'workspace') return workspaceDims(spec.seats ?? 4, size);
  const [ws, hs] = DIMS[spec.kind] ?? DEFAULT_DIMS;
  return [ws[SIZE_STEP[size]], hs[SIZE_STEP[size]]];
}

/** Furnish a room at a size. Undefined when what the room is for does not fit. */
function furnish(spec: RoomSpec, w: number, h: number, catalog: SpriteCatalog): Room | undefined {
  const f = new Furnisher(catalog, spec.accent);
  const r = f.empty(w, h);
  if (spec.kind === 'office' && !ownerDesk(f, r)) return undefined;
  if (spec.kind === 'lobby' && !reception(f, r)) return undefined;
  if (spec.kind === 'workspace' && !desks(f, r, spec.seats ?? 4, spec.desk)) return undefined;
  recipe(f, spec).forEach((p, i) => {
    if (!f.place(r, p, i) && p.must) r.w = -1;
  });
  return r.w < 0 ? undefined : r;
}

/** The smallest size, from the base up, that a room's must-haves fit in. */
function fitDims(spec: RoomSpec, catalog: SpriteCatalog): [number, number] | undefined {
  let [w, h] = baseDims(spec);
  for (let grow = 0; grow < 8; grow++) {
    if (furnish(spec, w, h, catalog)) return [w, h];
    if (grow % 2 === 0) w += 2;
    else h += 1;
  }
  return undefined;
}

/** A room's map. `outside` says its back wall is the building's, where windows go. */
function roomMap(r: Room, outside: boolean): string[] {
  const rows: string[][] = Array.from({ length: r.h }, (_, y) =>
    Array.from({ length: r.w }, (_, x) =>
      x === 0 || x === r.w - 1 || y < 3 || y === r.h - 1 ? 'W' : '.'
    )
  );
  rows[r.h - 1][r.door] = '.';
  rows[r.h - 1][r.door + 1] = '.';
  // Windows in pairs along an outside back wall, wherever nothing hangs. A
  // back wall onto the hall is inside the building: no windows, no sun.
  for (let x = 2; outside && x + 1 <= r.w - 3;) {
    if (!r.wall.has(x) && !r.wall.has(x + 1)) {
      rows[1][x] = rows[1][x + 1] = rows[2][x] = rows[2][x + 1] = 'N';
      x += 4;
    } else x++;
  }
  return rows.map((row) => row.join(''));
}

export { recipe, furnish, fitDims, roomMap };
