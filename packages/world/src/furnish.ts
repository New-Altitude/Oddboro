// Furnishing one room: the pieces it holds and where each one stands.
import { TILE } from './types.ts';
import type { Facing, PropPlacement, SpriteCatalog } from './types.ts';
import type { Accent, RoomEdit } from './generate.ts';

// ---------------------------------------------------------------------------
// Furnishing one room

type Item = {
  sprite: string;
  dx: number;
  dy: number;
  variant?: string;
  flip?: boolean;
  /** A frame other than the default, like `side` for a prop against a side wall. */
  frame?: string;
};
/**
 * Props that go together, like a couch and its coffee table. `back` stands
 * against the back wall, `floor` anywhere with a tile of space around it,
 * `wall` hangs on the back wall, `corner` fills a free tile near the front.
 * A `must` piece is what the room is for: the room grows until it fits.
 */
type Piece = {
  place: 'back' | 'floor' | 'wall' | 'corner';
  items: Item[];
  must?: boolean;
  /** The room's centrepiece, like the kitchen table: it goes nearest the middle. */
  center?: boolean;
};

type Spot = { tile: [number, number]; facing: Facing };
type Room = {
  w: number;
  h: number;
  door: number;
  used: Set<number>;
  blocked: Set<number>;
  /** Floor that must stay open: in front of a shelf or a screen, or where someone stands to use a thing. */
  keep: Set<number>;
  /** Where each standing thing's art shows, in pixels, so a tall one never hides a short one. */
  art: [number, number, number, number][];
  wall: Set<number>;
  /**
   * What lies flat on the floor (a rug, a mat) and what stands, by tile, and
   * the flat things' art. Placing by hand may stand a thing on a rug.
   */
  rugs: Set<number>;
  things: Set<number>;
  rugArt: [number, number, number, number][];
  props: PropPlacement[];
  spots: Spot[];
};

/**
 * What a sprite says about how it is used, from its tags. `clear-<n>` keeps
 * n rows open in front of it. `any-side` looks right against any wall, like a
 * plant or a lamp; anything else stands with its front to the room, against a
 * side wall only if it has a `side` frame.
 */
const clearOf = (m: SpriteCatalog[string] | undefined) =>
  Number(m?.tags.find((t) => t.startsWith('clear-'))?.slice(6) ?? 0);
const anySide = (m: SpriteCatalog[string] | undefined) => !!m?.tags.includes('any-side');

const STEP: Record<Facing, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0]
};
const FLIP: Record<Facing, Facing> = { up: 'up', down: 'down', left: 'right', right: 'left' };

/** A sprite in words, without its room kind: "break-vending" reads "vending". */
function pieceWords(sprite: string): string {
  return sprite
    .replace(/^(break|kitchen|library|gym|lobby|mail|owner|street)-/, '')
    .replaceAll('-', ' ');
}

/**
 * Tiles from `at` outward, nearest first, up to `reach` away: an edit lands
 * on the tile it names, or the closest one that fits, as a person would put it.
 */
function nearby([x, y]: [number, number], reach = 3): [number, number][] {
  const out: [number, number][] = [];
  for (let d = 0; d <= reach; d++)
    for (let dy = -d; dy <= d; dy++)
      for (let dx = -d; dx <= d; dx++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === d) out.push([x + dx, y + dy]);
  return out;
}

class Furnisher {
  readonly catalog: SpriteCatalog;
  private accent: Accent | undefined;
  constructor(catalog: SpriteCatalog, accent: Accent | undefined) {
    this.catalog = catalog;
    this.accent = accent;
  }

  /** The accent if the sprite comes in it, otherwise its own colour. */
  tint(sprite: string, accent = this.accent): string | undefined {
    return accent && this.catalog[sprite]?.variants.includes(accent) ? accent : undefined;
  }

  /** The nth colour a sprite comes in, its own first, for rows of the same thing. */
  nth(sprite: string, n: number): string | undefined {
    const all = [undefined, ...(this.catalog[sprite]?.variants ?? [])];
    return all[n % all.length];
  }

  it(sprite: string, dx = 0, dy = 0, opts: { variant?: string; flip?: boolean } = {}): Item {
    return { sprite, dx, dy, variant: opts.variant ?? this.tint(sprite), flip: opts.flip };
  }

  empty(w: number, h: number): Room {
    return {
      w,
      h,
      door: Math.floor((w - 2) / 2),
      used: new Set(),
      blocked: new Set(),
      keep: new Set(),
      art: [],
      wall: new Set(),
      rugs: new Set(),
      things: new Set(),
      rugArt: [],
      props: [],
      spots: []
    };
  }

  /**
   * Where a standing thing's art shows, in room pixels. A tall lamp's shade
   * rises over the tiles behind it; nothing of its own height or less may
   * stand there, or the lamp hides it. Rugs and wall hangings do not count.
   */
  private artBox(
    sprite: string,
    x: number,
    y: number,
    flip?: boolean
  ): [number, number, number, number] | undefined {
    const def = this.catalog[sprite];
    if (!def || def.layer !== 'object' || y < 3) return undefined;
    const ox = flip ? def.width - def.footprint[0] * TILE - def.origin[0] : def.origin[0];
    return [x * TILE - ox, y * TILE - def.origin[1], def.width, def.height];
  }

  /**
   * True when a box and a standing thing's art would mostly hide one of them:
   * more than half the smaller one covered. A lamp in front of a fireplace is
   * fine; a cat behind a lamp's shade is not.
   */
  private hides(
    r: Room,
    [x, y, w, h]: [number, number, number, number],
    overRugs = false
  ): boolean {
    return r.art.some((a) => {
      if (overRugs && r.rugArt.includes(a)) return false;
      const [ax, ay, aw, ah] = a;
      const ow = Math.min(x + w, ax + aw) - Math.max(x, ax);
      const oh = Math.min(y + h, ay + ah) - Math.max(y, ay);
      return ow > 0 && oh > 0 && ow * oh * 2 > Math.min(w * h, aw * ah);
    });
  }

  /**
   * The floor a piece needs open to be used: the rows its `clear-<n>` tag
   * asks for in front of it (to the side it faces, for a side view), and any
   * spot that stands off its footprint, like the tile in front of an arcade.
   */
  private front(p: Piece, x: number, y: number): number[][] {
    const out: number[][] = [];
    for (const i of p.items) {
      const def = this.catalog[i.sprite];
      if (!def || def.layer === 'wall' || i.dy < 0) continue;
      const [fw, fh] = def.footprint;
      const ax = x + i.dx;
      const ay = y + i.dy;
      const n = clearOf(def);
      for (let k = 0; k < n; k++)
        if (i.frame === 'side') {
          const cx = i.flip ? ax - 1 - k : ax + fw + k;
          for (let dy = 0; dy < fh; dy++) out.push([cx, ay + dy]);
        } else for (let dx = 0; dx < fw; dx++) out.push([ax + dx, ay + fh + k]);
      for (const s of def.spots) {
        const sx = ax + (i.flip ? fw - 1 - s.dx : s.dx);
        const sy = ay + s.dy;
        if (s.dx >= fw || s.dy >= fh || s.dx < 0 || s.dy < 0) out.push([sx, sy]);
      }
    }
    return out;
  }

  private cells(p: Piece, x: number, y: number) {
    const out: [number, number][] = [];
    for (const i of p.items) {
      const def = this.catalog[i.sprite];
      if (!def || def.layer === 'wall' || i.dy < 0) continue;
      const [fw, fh] = def.footprint;
      for (let dy = 0; dy < fh; dy++)
        for (let dx = 0; dx < fw; dx++) out.push([x + i.dx + dx, y + i.dy + dy]);
    }
    return out;
  }

  private wallCells(p: Piece, x: number) {
    const out: number[] = [];
    for (const i of p.items) {
      const def = this.catalog[i.sprite];
      if (!def || (def.layer !== 'wall' && i.dy >= 0)) continue;
      for (let dx = 0; dx < def.footprint[0]; dx++) out.push(x + i.dx + dx);
    }
    return out;
  }

  /** Floor a piece may stand on: inside the walls, clear of the back wall and the front row. */
  private inside(r: Room, x: number, y: number) {
    return x >= 1 && x <= r.w - 2 && y >= 3 && y <= r.h - 3;
  }

  /** The way in, from the door gap up two rows, stays clear. */
  private doorway(r: Room, x: number, y: number) {
    return (x === r.door || x === r.door + 1) && y >= r.h - 4;
  }

  /**
   * Whether a piece fits at a tile. `overRugs` is for placing by hand: a
   * standing thing may go on a rug or a mat, and a rug under standing things;
   * only a rug on a rug is refused. The furnisher keeps them apart.
   */
  fits(r: Room, p: Piece, x: number, y: number, pad: boolean, overRugs = false): boolean {
    // Nothing solid stands where another piece needs the floor open.
    const solid = new Set(
      p.items.flatMap((i) => {
        const def = this.catalog[i.sprite];
        if (!def || def.layer !== 'object' || def.walkable || i.dy < 0) return [];
        const [fw, fh] = def.footprint;
        return Array.from(
          { length: fw * fh },
          (_, k) => (y + i.dy + Math.floor(k / fw)) * r.w + x + i.dx + (k % fw)
        );
      })
    );
    for (const k of solid) if (r.keep.has(k)) return false;
    // Nothing stands where it would hide, or be hidden by, something already there.
    for (const i of p.items) {
      if (overRugs && this.catalog[i.sprite]?.layer === 'floor') continue;
      const box = this.artBox(i.sprite, x + i.dx, y + i.dy, i.flip);
      if (box && this.hides(r, box, overRugs)) return false;
    }
    // And what this piece needs open is open, and inside the room.
    for (const [fx, fy] of this.front(p, x, y)) {
      if (fx < 1 || fx > r.w - 2 || fy < 3 || fy > r.h - 2) return false;
      if (r.blocked.has(fy * r.w + fx) || solid.has(fy * r.w + fx)) return false;
    }
    for (const i of p.items) {
      const def = this.catalog[i.sprite];
      if (!def || def.layer === 'wall' || i.dy < 0) continue;
      const taken = !overRugs ? r.used : def.layer === 'floor' ? r.rugs : r.things;
      const [fw, fh] = def.footprint;
      for (let dy = 0; dy < fh; dy++)
        for (let dx = 0; dx < fw; dx++) {
          const [cx, cy] = [x + i.dx + dx, y + i.dy + dy];
          if (!this.inside(r, cx, cy) || this.doorway(r, cx, cy)) return false;
          if (taken.has(cy * r.w + cx)) return false;
          if (pad)
            for (let oy = -1; oy <= 1; oy++)
              for (let ox = -1; ox <= 1; ox++)
                if (r.used.has((cy + oy) * r.w + cx + ox)) return false;
        }
    }
    for (const cx of this.wallCells(p, x))
      if (cx < 1 || cx > r.w - 2 || r.wall.has(cx)) return false;
    return true;
  }

  /** Place a piece, and take it back if it leaves any seat out of reach. */
  put(r: Room, p: Piece, x: number, y: number): boolean {
    const before = {
      used: new Set(r.used),
      blocked: new Set(r.blocked),
      keep: new Set(r.keep),
      art: [...r.art],
      wall: new Set(r.wall),
      rugs: new Set(r.rugs),
      things: new Set(r.things),
      rugArt: [...r.rugArt],
      props: r.props.length,
      spots: r.spots.length
    };
    let group: string | undefined;
    for (const i of p.items) {
      if (!this.catalog[i.sprite]) continue;
      // The next number for this sprite, never one a removed item had.
      const n =
        Math.max(
          0,
          ...r.props
            .filter((q) => q.sprite === i.sprite)
            .map((q) => Number(q.id?.split('#')[1] ?? 0))
        ) + 1;
      const prop: PropPlacement = {
        sprite: i.sprite,
        at: [x + i.dx, y + i.dy],
        ...(i.variant ? { variant: i.variant } : {}),
        ...(i.flip ? { flip: true } : {}),
        ...(i.frame ? { frame: i.frame } : {}),
        id: `${i.sprite}#${n}`
      };
      // Things placed together stay together: a desk, its chair and its lamp.
      if (p.items.length > 1) prop.group = group ??= prop.id;
      r.props.push(prop);
      this.mark(r, prop);
    }
    if (this.reachable(r)) return true;
    Object.assign(r, {
      used: before.used,
      blocked: before.blocked,
      keep: before.keep,
      art: before.art,
      wall: before.wall,
      rugs: before.rugs,
      things: before.things,
      rugArt: before.rugArt
    });
    r.props.length = before.props;
    r.spots.length = before.spots;
    return false;
  }

  /**
   * Every seat's way in can be walked to from the door, as the office will
   * walk it: never through the seat itself, since a path only steps onto a
   * seat from its way in.
   */
  reachable(r: Room): boolean {
    const open = (x: number, y: number) =>
      x >= 1 && x <= r.w - 2 && y >= 3 && y <= r.h - 2 && !r.blocked.has(y * r.w + x);
    const walk = (avoid: number) => {
      const seen = new Set<number>([(r.h - 2) * r.w + r.door]);
      const queue: [number, number][] = [[r.door, r.h - 2]];
      while (queue.length) {
        const [x, y] = queue.shift()!;
        for (const [sx, sy] of Object.values(STEP)) {
          const [nx, ny] = [x + sx, y + sy];
          const k = ny * r.w + nx;
          if (k !== avoid && !seen.has(k) && open(nx, ny)) {
            seen.add(k);
            queue.push([nx, ny]);
          }
        }
      }
      return seen;
    };
    return r.spots.every(({ tile: [x, y], facing }) => {
      const [fx, fy] = STEP[facing];
      const sides: [number, number][] = [
        [x + fx, y + fy],
        [x - fx, y - fy],
        [x + fy, y + fx],
        [x - fy, y - fx]
      ];
      const way = sides.find(([ax, ay]) => open(ax, ay));
      return !!way && walk(y * r.w + x).has(way[1] * r.w + way[0]);
    });
  }

  /** What one placed prop holds: its floor or wall, the floor it keeps open, its spots. */
  mark(r: Room, p: PropPlacement) {
    const def = this.catalog[p.sprite];
    if (!def) return;
    const [ax, ay] = p.at;
    const [fw, fh] = def.footprint;
    if (def.layer === 'wall' || ay < 3) {
      for (let dx = 0; dx < fw; dx++) r.wall.add(ax + dx);
      return;
    }
    const flat = def.layer === 'floor';
    const box = this.artBox(p.sprite, ax, ay, p.flip);
    if (box) r.art.push(box);
    if (box && flat) r.rugArt.push(box);
    for (let dy = 0; dy < fh; dy++)
      for (let dx = 0; dx < fw; dx++) {
        r.used.add((ay + dy) * r.w + ax + dx);
        (flat ? r.rugs : r.things).add((ay + dy) * r.w + ax + dx);
        if (def.layer === 'object' && !def.walkable) r.blocked.add((ay + dy) * r.w + ax + dx);
      }
    const item: Item = { sprite: p.sprite, dx: 0, dy: 0, flip: p.flip, frame: p.frame };
    for (const [fx, fy] of this.front({ place: 'floor', items: [item] }, ax, ay))
      r.keep.add(fy * r.w + fx);
    for (const s of def.spots)
      r.spots.push({
        tile: [ax + (p.flip ? fw - 1 - s.dx : s.dx), ay + s.dy],
        facing: p.flip ? FLIP[s.facing] : s.facing
      });
  }

  /** Take out the pieces a theme leaves out, so nothing unseen holds a tile. */
  leaveOut(r: Room, gone: (sprite: string) => boolean) {
    if (!r.props.some((p) => gone(p.sprite))) return;
    r.props = r.props.filter((p) => !gone(p.sprite));
    this.index(r);
  }

  /** Work out what every prop holds again, after one is taken out. */
  private index(r: Room) {
    Object.assign(r, {
      used: new Set(),
      blocked: new Set(),
      keep: new Set(),
      art: [],
      wall: new Set(),
      rugs: new Set(),
      things: new Set(),
      rugArt: []
    });
    r.spots.length = 0;
    for (const p of r.props) this.mark(r, p);
  }

  /**
   * Put one item at a tile, turned to face the room on a side wall. A thing
   * that hangs on a wall goes on the back wall above the tile's column.
   */
  private putAt(r: Room, sprite: string, at: [number, number], extra: Partial<Item>): boolean {
    const def = this.catalog[sprite];
    if (!def) return false;
    const hangs = def.layer === 'wall';
    for (const [tx, ty] of nearby(at)) {
      // A wall hanging only slides along the wall.
      if (hangs && ty !== at[1]) continue;
      const [x, y] = hangs ? [tx, 2] : [tx, ty];
      const piece = this.orient(
        r,
        { place: hangs ? 'wall' : 'corner', items: [{ ...this.it(sprite), ...extra }] },
        x,
        y
      );
      if (piece && this.fits(r, piece, x, y, false, true) && this.put(r, piece, x, y)) return true;
    }
    return false;
  }

  /**
   * What moves with a thing the owner drags, of what was placed with it: what
   * stands on it (a desk's lamp), at its seats (the desk's chair, the kitchen
   * table's), or as a chair facing it (the owner's chair behind their desk).
   * A chair beside it but facing elsewhere stays, and so does a couch placed
   * to face a TV. A rug moves alone: what stands on it is not part of it.
   */
  private attached(r: Room, p: PropPlacement): PropPlacement[] {
    const def = this.catalog[p.sprite];
    if (!p.group || !def || def.layer === 'floor') return [p];
    const [fw, fh] = def.footprint;
    const [ax, ay] = p.at;
    const within = (x: number, y: number) => x >= ax && y >= ay && x < ax + fw && y < ay + fh;
    const on = (q: PropPlacement) => {
      const [x, y] = q.at;
      const seat = this.catalog[q.sprite];
      return (
        within(x, y) ||
        def.spots.some((s) => ax + (p.flip ? fw - 1 - s.dx : s.dx) === x && ay + s.dy === y) ||
        // A chair faces down the room, so what it is for stands on the tile below it.
        (!!seat?.tags.includes('chair') && within(x, y + seat.footprint[1]))
      );
    };
    return [p, ...r.props.filter((q) => q !== p && q.group === p.group && on(q))];
  }

  /** The thing standing on a tile, in words: a rug for a rug, or what stands there. */
  private standing(r: Room, x: number, y: number, flat: boolean): string {
    const p = r.props.find((q) => {
      const def = this.catalog[q.sprite];
      if (!def || def.layer === 'wall' || (def.layer === 'floor') !== flat) return false;
      const [fw, fh] = def.footprint;
      return x >= q.at[0] && y >= q.at[1] && x < q.at[0] + fw && y < q.at[1] + fh;
    });
    return p ? pieceWords(p.sprite) : 'something';
  }

  /**
   * Put a piece exactly where the owner dropped it. Only what keeps the office
   * working is checked: it stands on the room's floor, off the doorway (unless
   * it lies flat, like a rug) and off other things, and every seat can still be reached. The rest (what keeps
   * the floor open, what hides what) is the owner's call. Returns why it
   * cannot go there, or nothing once it is down.
   */
  private byHand(r: Room, p: Piece, [tx, ty]: [number, number]): string | undefined {
    const hangs = p.items.every((i) => this.catalog[i.sprite]?.layer === 'wall');
    const [x, y] = hangs ? [tx, 2] : [tx, ty];
    const piece = this.orient(r, p, x, y) ?? p;
    for (const i of piece.items) {
      const def = this.catalog[i.sprite];
      if (!def) continue;
      const [fw, fh] = def.footprint;
      // What it holds is where it lands: the back wall's rows, or the floor. A
      // pendant hangs over the room, over whatever stands below it.
      const onWall = y + i.dy < 3;
      if (def.layer === 'wall' && !onWall) continue;
      if (onWall) {
        for (let dx = 0; dx < fw; dx++) {
          const cx = x + i.dx + dx;
          if (cx < 1 || cx > r.w - 2) return 'would hang past the end of the wall';
          if (r.wall.has(cx)) return 'would hang over something already on that wall';
        }
        continue;
      }
      const flat = def.layer === 'floor';
      // A rug or a mat is walked over, so it may lie in the doorway.
      for (let dy = 0; dy < fh; dy++)
        for (let dx = 0; dx < fw; dx++) {
          const [cx, cy] = [x + i.dx + dx, y + i.dy + dy];
          if (!this.inside(r, cx, cy)) return "would stand off the room's floor";
          if (!flat && this.doorway(r, cx, cy)) return 'would block the door';
          if ((flat ? r.rugs : r.things).has(cy * r.w + cx))
            return `would stand on the ${this.standing(r, cx, cy, flat)}`;
        }
    }
    return this.put(r, piece, x, y) ? undefined : 'would leave a seat nobody can reach';
  }

  /** A prop and, if it is the first of a group, everything placed with it. */
  private together(r: Room, p: PropPlacement): PropPlacement[] {
    return p.group === p.id ? r.props.filter((q) => q.group === p.id) : [p];
  }

  /** Props as one piece, laid out around the first. One alone turns to face the room on a side wall. */
  private pieceOf(
    set: Pick<PropPlacement, 'sprite' | 'at' | 'variant' | 'flip' | 'frame'>[]
  ): Piece {
    const [lead] = set;
    if (set.length === 1) {
      const hangs = this.catalog[lead.sprite]?.layer === 'wall';
      return {
        place: hangs ? 'wall' : 'corner',
        items: [{ ...this.it(lead.sprite), ...(lead.variant ? { variant: lead.variant } : {}) }]
      };
    }
    return {
      place: 'floor',
      items: set.map((p) => ({
        sprite: p.sprite,
        dx: p.at[0] - lead.at[0],
        dy: p.at[1] - lead.at[1],
        variant: p.variant,
        flip: p.flip,
        frame: p.frame
      }))
    };
  }

  /**
   * Put a set of props down again with its first at a tile, the rest where
   * they stood beside it, keeping their ids. A lone prop on a side wall turns
   * to face the room.
   */
  private putGroup(r: Room, set: PropPlacement[], to: [number, number]): boolean {
    const [lead] = set;
    if (set.length === 1) {
      const ok = this.putAt(r, lead.sprite, to, { variant: lead.variant });
      if (ok) Object.assign(r.props[r.props.length - 1], { id: lead.id, group: lead.group });
      return ok;
    }
    const piece: Piece = {
      place: 'floor',
      items: set.map((p) => ({
        sprite: p.sprite,
        dx: p.at[0] - lead.at[0],
        dy: p.at[1] - lead.at[1],
        variant: p.variant,
        flip: p.flip,
        frame: p.frame
      }))
    };
    const spot = nearby(to).find(
      ([x, y]) => this.fits(r, piece, x, y, false, true) && this.put(r, piece, x, y)
    );
    if (!spot) return false;
    const placed = r.props.slice(-set.length);
    placed.forEach((p, k) => Object.assign(p, { id: set[k].id, group: set[k].group }));
    return true;
  }

  /**
   * The owner's changes to a furnished room, in order. A change that would
   * leave a seat out of reach, block what needs the floor open, or name
   * something not there is left out, and the note says so.
   */
  edit(r: Room, edits: RoomEdit[], room: string, notes: string[]) {
    const named = (id: string) => r.props.findIndex((p) => p.id === id);
    for (const e of edits) {
      if ('remove' in e) {
        const at = named(e.remove);
        if (at < 0) notes.push(`${room}: there is no ${e.remove} to remove.`);
        else {
          const gone = new Set(this.together(r, r.props[at]));
          r.props = r.props.filter((p) => !gone.has(p));
          this.index(r);
        }
      } else if ('move' in e) {
        const at = named(e.move);
        if (at < 0) {
          notes.push(`${room}: there is no ${e.move} to move.`);
          continue;
        }
        const lead = r.props[at];
        const set = e.hand ? this.attached(r, lead) : this.together(r, lead);
        const before = [...r.props];
        r.props = r.props.filter((p) => !set.includes(p));
        this.index(r);
        const why = e.hand
          ? this.byHand(r, this.pieceOf(set), e.to)
          : this.putGroup(r, set, e.to)
            ? undefined
            : `does not fit at or near ${e.to.join(', ')}`;
        if (why) {
          r.props = before;
          this.index(r);
          const name = e.hand ? `the ${pieceWords(lead.sprite)}` : lead.id;
          notes.push(`${room}: ${name} ${why}, so it stayed.`);
        } else if (e.hand) {
          // Keep the ids it had. What moved together is now its own group, led
          // by the thing dragged, and leaves behind the group it came from.
          r.props.slice(-set.length).forEach((p, k) => {
            p.id = set[k].id;
            if (set.length > 1) p.group = lead.id;
            else delete p.group;
          });
        }
      } else {
        const what = e.hand ? pieceWords(e.add) : e.add.replaceAll('-', ' ');
        const a = `${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what}`;
        const extra = e.variant ? { variant: e.variant } : {};
        if (e.hand) {
          const why = this.byHand(r, this.pieceOf([{ sprite: e.add, at: e.at, ...extra }]), e.at);
          if (why) notes.push(`${room}: ${a} ${why}.`);
        } else if (!this.putAt(r, e.add, e.at, extra))
          notes.push(`${room}: ${a} does not fit at or near ${e.at.join(', ')}.`);
      }
    }
  }

  /** Where a piece of each kind tries to go, best first. */
  private candidates(r: Room, p: Piece, n: number): [number, number][] {
    const out: [number, number][] = [];
    const xs = Array.from({ length: r.w }, (_, i) => i);
    // Alternate sides, so a room fills evenly instead of from the left.
    const side = n % 2 === 0 ? xs : [...xs].reverse();
    if (p.place === 'back') for (const x of side) out.push([x, 3]);
    else if (p.place === 'wall') {
      const mid = Math.floor(r.w / 2);
      const byMiddle = [...xs].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      for (const x of n % 2 === 0 ? byMiddle : side) out.push([x, 2]);
    } else if (p.place === 'corner') {
      for (let y = r.h - 3; y >= 3; y--) for (const x of [1, r.w - 2]) out.push([x, y]);
      for (const x of side) out.push([x, 3]);
    } else for (let y = 4; y <= r.h - 3; y++) for (const x of side) out.push([x, y]);
    return out;
  }

  /**
   * A corner piece against a side wall turns to face the room: a prop that
   * looks right from any side stays as it is, one with a side view shows it
   * (mirrored on the east wall), and one with only a front cannot go there.
   */
  private orient(r: Room, p: Piece, x: number, y: number): Piece | undefined {
    const onSide = p.place === 'corner' && y > 3 && (x === 1 || x === r.w - 2);
    if (!onSide) return p;
    const items: Item[] = [];
    for (const i of p.items) {
      const def = this.catalog[i.sprite];
      if (anySide(def)) items.push(i);
      else if (def?.frames.includes('side'))
        items.push({ ...i, frame: 'side', flip: x === r.w - 2 });
      else return undefined;
    }
    return { ...p, items };
  }

  /**
   * How good a spot is, higher better: a tile of room around it, so things
   * against a wall do not crowd each other, and for the room's centrepiece,
   * the middle of the room. Candidate order decides the rest, which keeps a
   * group like armchairs where it reads best. More space than a tile counts
   * for nothing: chasing it pushes everything to the edges.
   */
  private score(r: Room, p: Piece, x: number, y: number): number {
    const cells = this.cells(p, x, y);
    if (!cells.length) return 0;
    let room = 1;
    for (const [cx, cy] of cells)
      for (const k of r.blocked) {
        const d = Math.max(Math.abs((k % r.w) - cx), Math.abs(Math.floor(k / r.w) - cy)) - 1;
        if (d < room) room = Math.max(0, d);
      }
    if (!p.center) return room;
    const [mx, my] = [r.w / 2, (3 + r.h - 2) / 2];
    const [sx, sy] = cells.reduce(([a, b], [cx, cy]) => [a + cx, b + cy], [0, 0]);
    const off = Math.hypot(sx / cells.length + 0.5 - mx, sy / cells.length + 0.5 - my);
    return room - off / 2;
  }

  place(r: Room, p: Piece, n: number): boolean {
    const pad = p.place === 'floor' || p.place === 'corner';
    const ranked: { q: Piece; x: number; y: number; s: number }[] = [];
    for (const [x, y] of this.candidates(r, p, n)) {
      const q = this.orient(r, p, x, y);
      if (q && this.fits(r, q, x, y, pad))
        ranked.push({ q, x, y, s: this.score(r, q, x, y) - ranked.length * 1e-6 });
    }
    ranked.sort((a, b) => b.s - a.s);
    for (const { q, x, y } of ranked) if (this.put(r, q, x, y)) return true;
    return false;
  }
}

export { type Item, type Piece, type Room, pieceWords, Furnisher };
