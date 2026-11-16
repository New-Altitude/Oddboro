// The street and the grounds around the building, and the edits an area takes.
import type { PropPlacement, RoomTemplate, SpriteCatalog } from './types.ts';
import type { Grounds, RoomEdit, Porch } from './generate.ts';
import { pieceWords } from './furnish.ts';

const STREET_ROWS = 10;

/** Ids for an area's props, `sprite#n` in the order they were placed. */
function withIds(props: PropPlacement[]) {
  const n = new Map<string, number>();
  for (const p of props) {
    const k = (n.get(p.sprite) ?? 0) + 1;
    n.set(p.sprite, k);
    p.id ??= `${p.sprite}#${k}`;
  }
}

/** What an area takes where: floor to stand on, wall to hang on, ground that stays open. */
type AreaRules = {
  /** Where a standing thing may not go, in words: "the sidewalk". */
  ground: string;
  stands: (x: number, y: number) => boolean;
  hangs: (x: number, y: number) => boolean;
  keep: Set<string>;
};

/**
 * An area's edits on its props, in order, each at the exact tile it names. A
 * thing stands on the area's own floor, off what stays open and off other
 * things; one that cannot is left where it was, and the note says why.
 */
function editArea(
  name: string,
  props: PropPlacement[],
  edits: RoomEdit[],
  catalog: SpriteCatalog,
  rules: AreaRules,
  notes: string[]
) {
  const layer = (s: string) => catalog[s]?.layer;
  const cells = (p: Pick<PropPlacement, 'sprite' | 'at'>) => {
    const [fw, fh] = catalog[p.sprite]?.footprint ?? [1, 1];
    return Array.from({ length: fw * fh }, (_, k): [number, number] => [
      p.at[0] + (k % fw),
      p.at[1] + Math.floor(k / fw)
    ]);
  };
  const why = (p: Pick<PropPlacement, 'sprite' | 'at'>, others: PropPlacement[]) => {
    const wall = layer(p.sprite) === 'wall';
    const flat = layer(p.sprite) === 'floor';
    for (const [x, y] of cells(p)) {
      if (wall ? !rules.hangs(x, y) : !rules.stands(x, y))
        return wall ? 'would hang off the wall' : `would stand off ${rules.ground}`;
      if (!wall && !flat && rules.keep.has(`${x},${y}`)) return 'would block the way in';
      const under = others.find(
        (q) =>
          (layer(q.sprite) === 'wall') === wall &&
          (layer(q.sprite) === 'floor') === flat &&
          cells(q).some(([qx, qy]) => qx === x && qy === y)
      );
      if (under) return `would ${wall ? 'hang over' : 'stand on'} the ${pieceWords(under.sprite)}`;
    }
    return undefined;
  };
  for (const e of edits) {
    if ('remove' in e) {
      const i = props.findIndex((p) => p.id === e.remove);
      if (i < 0) notes.push(`${name}: there is no ${e.remove} to remove.`);
      else props.splice(i, 1);
    } else if ('move' in e) {
      const p = props.find((q) => q.id === e.move);
      if (!p) {
        notes.push(`${name}: there is no ${e.move} to move.`);
        continue;
      }
      const no = why(
        { sprite: p.sprite, at: e.to },
        props.filter((q) => q !== p)
      );
      if (no) notes.push(`${name}: the ${pieceWords(p.sprite)} ${no}, so it stayed.`);
      else p.at = [...e.to];
    } else {
      const what = pieceWords(e.add);
      const a = `${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what}`;
      if (!catalog[e.add]) {
        notes.push(`${name}: there is no ${e.add} to add.`);
        continue;
      }
      const no = why({ sprite: e.add, at: e.at }, props);
      if (no) notes.push(`${name}: ${a} ${no}.`);
      else {
        const n =
          Math.max(
            0,
            ...props.filter((q) => q.sprite === e.add).map((q) => Number(q.id?.split('#')[1] ?? 0))
          ) + 1;
        props.push({
          sprite: e.add,
          at: [...e.at],
          id: `${e.add}#${n}`,
          ...(e.variant ? { variant: e.variant } : {})
        });
      }
    }
  }
}

const STREET_MATERIALS = {
  c: 'curb',
  a: 'asphalt',
  l: 'asphalt-line',
  x: 'crosswalk',
  f: 'curb-far',
  g: 'grass'
};

/** The street along the front: sidewalk, the road with a crossing at the door, the far side. */
function street(
  w: number,
  door: number,
  random: () => number,
  porch?: Porch,
  catalog: SpriteCatalog = {}
): RoomTemplate {
  const row = (ch: string, cross?: string) =>
    Array.from({ length: w }, (_, x) =>
      cross && (x === door || x === door + 1) ? cross : ch
    ).join('');
  const map = [
    row('.'),
    row('.'),
    row('.'),
    row('c'),
    row('a', 'x'),
    row('l', 'x'),
    row('a', 'x'),
    row('f'),
    row('.'),
    row('g')
  ];
  const used = new Set<string>();
  const props: PropPlacement[] = [];
  const put = (sprite: string, x: number, y: number, fw = 1) => {
    if (x < 0 || x + fw > w) return false;
    for (let i = -1; i <= fw; i++) if (used.has(`${x + i},${y}`)) return false;
    for (let i = 0; i < fw; i++) used.add(`${x + i},${y}`);
    props.push({ sprite, at: [x, y] });
    return true;
  };
  // The door's own row stays clear, so the way in is never blocked.
  for (let i = -1; i <= 2; i++) used.add(`${door + i},0`).add(`${door + i},2`);
  // A porch decks the two rows of sidewalk outside the door. Its things stand
  // along the building, and the row in front of them stays clear to walk.
  const deck = porch ? [Math.max(0, door - 5), Math.min(w - 1, door + 6)] : undefined;
  if (deck) {
    for (const y of [0, 1])
      map[y] = [...map[y]].map((c, x) => (x >= deck[0] && x <= deck[1] ? 'p' : c)).join('');
    // The sidewalk in front of it stays open too, so trees do not crowd it.
    for (let x = deck[0] - 1; x <= deck[1] + 1; x++) used.add(`${x},1`).add(`${x},2`);
  }
  // The bus stop first: staff come and go by it, so it must find a place.
  // Its roof stands over the sidewalk behind it, so that stays clear too.
  for (const x of [door + 9, door - 12, door + 5, door - 8, 1, w - 5])
    if (put('street-bus-shelter', x, 2, 3)) {
      for (let i = -1; i <= 3; i++) used.add(`${x + i},0`);
      put('street-bus-sign', x + 3, 2);
      break;
    }
  if (deck) {
    // Nearest the door first, a tile apart.
    const xs = Array.from({ length: deck[1] - deck[0] + 1 }, (_, i) => deck[0] + i).sort(
      (a, b) => Math.abs(a - door - 0.5) - Math.abs(b - door - 0.5)
    );
    for (const e of porch!.extras ?? []) {
      const fw = catalog[e]?.footprint[0] ?? 1;
      xs.find((x) => x + fw - 1 <= deck[1] && put(e, x, 0, fw));
    }
  } else {
    put('street-planter', door - 3, 0);
    put('street-planter', door + 4, 0);
  }
  put('street-mailbox', door - 6, 2);
  put('street-newsbox', door - 5, 2);
  for (let x = 2; x < w - 2; x += 10) put('street-lamp', x, 2);
  for (let x = 6; x < w - 3; x += 10) if (random() < 0.7) put('street-tree', x, 2, 2);
  for (let x = 4; x < w - 3; x += 8) {
    if (random() < 0.6) put('street-tree', x, 8, 2);
    else put('street-lamp', x + 1, 8);
  }
  if (random() < 0.5) put('street-coffee-cart', door + 6, 0, 2);
  put('street-bike-rack', door - 10, 0, 2);
  put('street-bench', Math.max(1, door - 16), 2, 2);
  put('street-hydrant', door + 15, 2);
  return {
    id: 'street',
    name: 'Street',
    sign: false,
    outdoor: true,
    wall: 'wall-brick',
    floor: 'sidewalk',
    materials: deck ? { ...STREET_MATERIALS, p: porch!.floor ?? 'oak' } : STREET_MATERIALS,
    map,
    props
  };
}

const GROUND_PROPS: Record<Grounds, { odds: number; pick: [string, number, number][] }> = {
  park: {
    odds: 0.07,
    pick: [
      ['park-tree', 2, 3],
      ['park-tree-small', 1, 3],
      ['park-bush', 1, 3],
      ['park-bush-large', 2, 2],
      ['park-flowers', 1, 4],
      ['park-tuft', 1, 4],
      ['park-rock', 1, 1]
    ]
  },
  woods: {
    odds: 0.12,
    pick: [
      ['park-pine', 2, 4],
      ['park-pine-large', 2, 3],
      ['park-tree-large', 2, 2],
      ['park-fern', 1, 3],
      ['park-stump', 1, 1],
      ['park-mushrooms', 1, 2],
      ['park-log', 2, 1]
    ]
  },
  meadow: {
    odds: 0.08,
    pick: [
      ['park-tuft', 1, 6],
      ['park-flowers', 1, 6],
      ['park-tree-small', 1, 1],
      ['park-sapling', 1, 1],
      ['park-rock', 1, 1]
    ]
  }
};

/**
 * Land around the building, in world coordinates: the road carries on to the
 * edges and the rest is grass, planted by the spec's grounds.
 */
function grounds(
  kind: Grounds,
  [w, h]: [number, number],
  [ml, mt, bw, streetY]: [number, number, number, number],
  random: () => number
): RoomTemplate {
  const sy = mt + streetY;
  const road: Record<number, string> = {
    0: 's',
    1: 's',
    2: 's',
    3: 'c',
    4: 'a',
    5: 'l',
    6: 'a',
    7: 'f',
    8: 's'
  };
  const map = Array.from({ length: h }, (_, y) => (road[y - sy] ?? '.').repeat(w));
  // Keep a tile of grass clear around the building and the street.
  const clear = (x: number, y: number) =>
    !(x >= ml - 1 && x <= ml + bw && y >= mt - 1 && y <= sy + STREET_ROWS) &&
    !(y >= sy - 1 && y <= sy + 9);
  const { odds, pick } = GROUND_PROPS[kind];
  const bag = pick.flatMap(([s, fw, weight]) =>
    Array.from({ length: weight }, () => [s, fw] as const)
  );
  const used = new Set<number>();
  const props: PropPlacement[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 2; x++) {
      if (random() >= odds) continue;
      const [sprite, fw] = bag[Math.floor(random() * bag.length)];
      const cells = Array.from({ length: fw }, (_, i) => x + i);
      if (!cells.every((cx) => clear(cx, y) && clear(cx, y + 1))) continue;
      if (cells.some((cx) => [-1, 0, 1].some((oy) => used.has((y + oy) * w + cx)))) continue;
      for (const cx of cells) used.add(y * w + cx);
      props.push({ sprite, at: [x, y] });
    }
  return {
    id: 'grounds',
    name: 'Grounds',
    sign: false,
    outdoor: true,
    wall: 'wall-brick',
    floor: 'grass',
    materials: { s: 'sidewalk', c: 'curb', a: 'asphalt', l: 'asphalt-line', f: 'curb-far' },
    map,
    props
  };
}

export { STREET_ROWS, withIds, editArea, street, GROUND_PROPS, grounds };
