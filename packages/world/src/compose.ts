// Turns a floor plan and its room stamps into one world: a cell grid, a draw
// list in paint order, the spots staff can go to, the lights, and which tiles
// can be walked. Pure and browser-safe; the renderer and the office both use it.
import {
  PASS,
  TILE,
  type Cell,
  type DrawCmd,
  type FloorPlan,
  type PlacedLight,
  type PlacedSpot,
  type PropPlacement,
  type RoomBounds,
  type RoomTemplate,
  type SpriteCatalog,
  type World
} from './types.ts';

type Raw = { ch: string; cell: Cell };

const hash = (x: number, y: number, salt = 0) =>
  (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0;

/** Most tiles use frame 0; the other frames are scattered detail. */
function pickFrame(frames: string[], x: number, y: number): string {
  if (frames.length <= 1) return frames[0];
  const h = hash(x, y);
  return h % 100 < 70 ? frames[0] : frames[1 + ((h >>> 8) % (frames.length - 1))];
}

const FLIP_FACING = { left: 'right', right: 'left', up: 'up', down: 'down' } as const;

export function composeWorld(
  source: FloorPlan,
  templates: Record<string, RoomTemplate>,
  catalog: SpriteCatalog,
  /** `actors: false` drops the plan's preview-only figures, as the live office does. */
  options: { actors?: boolean } = {}
): World {
  // Grounds margins push the whole plan in from the top-left corner.
  const [ml, mt, mr, mb] = source.grounds?.margin ?? [0, 0, 0, 0];
  const move = <T extends { at: [number, number] }>(o: T): T => ({
    ...o,
    at: [o.at[0] + ml, o.at[1] + mt]
  });
  const plan: FloorPlan = {
    ...source,
    halls: source.halls?.map(move),
    rooms: source.rooms.map(move),
    props: source.props?.map(move),
    actors: source.actors?.map(move)
  };
  const missing = new Set<string>();
  const has = (name: string) => {
    if (catalog[name]) return true;
    missing.add(name);
    return false;
  };

  const halls = plan.halls ?? [];
  const stamps = plan.rooms;

  let width = 0;
  let height = 0;
  for (const r of stamps) {
    const t = templates[r.room];
    if (!t) throw new Error(`plan ${plan.id}: no room template "${r.room}"`);
    width = Math.max(width, r.at[0] + Math.max(...t.map.map((row) => row.length)));
    height = Math.max(height, r.at[1] + t.map.length);
  }
  for (const h of halls) {
    width = Math.max(width, h.at[0] + h.size[0]);
    height = Math.max(height, h.at[1] + h.size[1]);
  }
  width += mr;
  height += mb;

  const raw: Raw[] = Array.from({ length: width * height }, () => ({
    ch: ' ',
    cell: { kind: 'void' }
  }));
  const at = (x: number, y: number): Raw | undefined =>
    x < 0 || y < 0 || x >= width || y >= height ? undefined : raw[y * width + x];

  // Halls carve first: their floor overwrites anything, their edge only fills
  // empty cells, so two crossing halls join instead of walling each other off.
  // Rooms stamp after and win.
  for (const h of halls) {
    const [w, hh] = h.size;
    for (let dy = 0; dy < hh; dy++)
      for (let dx = 0; dx < w; dx++) {
        const target = at(h.at[0] + dx, h.at[1] + dy)!;
        const edge = dx === 0 || dy === 0 || dx === w - 1 || dy === hh - 1;
        if (!edge) {
          target.ch = '.';
          target.cell = { kind: 'floor', material: h.floor };
        } else if (target.cell.kind === 'void') {
          target.ch = 'W';
          target.cell = { kind: 'wall', style: h.wall, feature: 'plain' };
        }
      }
  }

  const rooms: RoomBounds[] = [];
  const props: { p: PropPlacement; room: string; ox: number; oy: number }[] = [];

  stamps.forEach((r, i) => {
    const t = templates[r.room];
    const id = `${r.room}#${i}`;
    rooms.push({
      id,
      name: r.label ?? t.name,
      x: r.at[0],
      y: r.at[1],
      w: Math.max(...t.map.map((row) => row.length)),
      h: t.map.length,
      ...(t.outdoor ? { outdoor: true } : {}),
      ...(t.sign === false ? { sign: false as const } : {})
    });
    t.map.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        if (ch === ' ') return;
        const target = at(r.at[0] + dx, r.at[1] + dy)!;
        target.ch = ch;
        if (ch === 'W' || ch === 'N' || ch === 'D') {
          const feature = ch === 'N' ? 'window' : ch === 'D' ? 'door' : 'plain';
          target.cell = { kind: 'wall', style: t.wall, feature };
        } else {
          const material = ch === '.' ? t.floor : t.materials?.[ch];
          if (!material) throw new Error(`room ${t.id}: no material for "${ch}"`);
          target.cell = { kind: 'floor', material };
        }
      });
    });
    for (const p of t.props) props.push({ p, room: id, ox: r.at[0], oy: r.at[1] });
  });
  for (const p of plan.props ?? []) props.push({ p, room: 'plan', ox: 0, oy: 0 });

  // The grounds fill every cell nothing else claimed: grass, paths, water.
  // They are scenery, so staff never walk them, and a grounds prop must stand
  // wholly on grounds.
  const ground = new Set<number>();
  if (plan.grounds) {
    const t = templates[plan.grounds.room];
    if (!t) throw new Error(`plan ${plan.id}: no grounds template "${plan.grounds.room}"`);
    t.map.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const target = at(x, y);
        if (ch === ' ' || !target || target.cell.kind !== 'void') return;
        const material = ch === '.' ? t.floor : t.materials?.[ch];
        if (!material) throw new Error(`grounds ${t.id}: no material for "${ch}"`);
        target.ch = ch;
        target.cell = { kind: 'floor', material };
        ground.add(y * width + x);
      })
    );
    for (const p of t.props) {
      const def = catalog[p.sprite];
      const [fw, fh] = def?.footprint ?? [1, 1];
      for (let y = p.at[1]; y < p.at[1] + fh; y++)
        for (let x = p.at[0]; x < p.at[0] + fw; x++)
          if (!ground.has(y * width + x))
            throw new Error(`grounds ${t.id}: ${p.sprite} at ${p.at} stands off the grounds`);
      props.push({ p, room: 'grounds', ox: 0, oy: 0 });
    }
  }

  const isFloor = (x: number, y: number) => at(x, y)?.cell.kind === 'floor';
  const isFaceBottom = (x: number, y: number) => {
    const c = at(x, y);
    return !!c && (c.ch === 'W' || c.ch === 'N') && isFloor(x, y + 1);
  };
  const isFaceTop = (x: number, y: number) => {
    const c = at(x, y);
    return !!c && (c.ch === 'W' || c.ch === 'N') && isFaceBottom(x, y + 1);
  };
  const isCap = (x: number, y: number) =>
    at(x, y)?.ch === 'W' && !isFaceBottom(x, y) && !isFaceTop(x, y);

  const draws: DrawCmd[] = [];
  const lights: PlacedLight[] = [];
  const spots: PlacedSpot[] = [];
  const walkable = new Array<boolean>(width * height).fill(false);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { ch, cell } = raw[y * width + x];
      if (cell.kind === 'floor') {
        walkable[y * width + x] = !ground.has(y * width + x);
        const name = `floor-${cell.material}`;
        if (has(name))
          draws.push({
            sprite: name,
            frame: pickFrame(catalog[name].frames, x, y),
            x: x * TILE,
            y: y * TILE,
            z: y * TILE,
            pass: PASS.floor
          });
        const north = at(x, y - 1);
        if (north?.cell.kind === 'wall' && catalog['fx-wall-shadow'])
          draws.push({
            sprite: 'fx-wall-shadow',
            frame: catalog['fx-wall-shadow'].frames[0],
            x: x * TILE,
            y: y * TILE,
            z: y * TILE + 1,
            pass: PASS.floor
          });
        // A material with an fx-edge-<material> sprite draws its own shore:
        // one frame per side that meets something else, and an inner corner
        // where only the diagonal does. The world's edge counts as the same.
        const edge = `fx-edge-${cell.material}`;
        if (catalog[edge]) {
          const same = (dx: number, dy: number) => {
            const n = at(x + dx, y + dy);
            return !n || (n.cell.kind === 'floor' && n.cell.material === cell.material);
          };
          // Top and bottom first: the side frames paint over them at the corners.
          const sides = { n: same(0, -1), s: same(0, 1), e: same(1, 0), w: same(-1, 0) };
          const corners = {
            ne: sides.n && sides.e && !same(1, -1),
            nw: sides.n && sides.w && !same(-1, -1),
            se: sides.s && sides.e && !same(1, 1),
            sw: sides.s && sides.w && !same(-1, 1)
          };
          const frames = [
            ...Object.entries(sides).filter(([, v]) => !v),
            ...Object.entries(corners).filter(([, v]) => v)
          ].map(([k]) => k);
          for (const frame of frames)
            if (catalog[edge].frames.includes(frame))
              draws.push({
                sprite: edge,
                frame,
                x: x * TILE,
                y: y * TILE,
                z: y * TILE + 2,
                pass: PASS.floor
              });
        }
        continue;
      }
      if (cell.kind !== 'wall') continue;
      const style = cell.style;
      const z = (y + 1) * TILE;
      if (ch === 'D') {
        walkable[y * width + x] = true;
        if (isFloor(x, y + 1) && has(`${style}-door`)) {
          const def = catalog[`${style}-door`];
          // Floor beyond the doorway's top: the cap over it gives way, so
          // the way through shows and no one walks over a wall.
          const through = isFloor(x, y + 1 - def.height / TILE) && def.frames.includes('through');
          draws.push({
            sprite: `${style}-door`,
            frame: through ? 'through' : def.frames.includes('closed') ? 'closed' : def.frames[0],
            x: x * TILE,
            y: (y + 1) * TILE - def.height,
            z,
            pass: isFloor(x, y - 1) ? PASS.object : PASS.wall
          });
        }
      } else if (isFaceBottom(x, y)) {
        const name = ch === 'N' ? `${style}-window` : `${style}-face`;
        if (has(name)) {
          const def = catalog[name];
          // A face with floor behind it (a room's south wall, seen from the
          // corridor or the street) stands in front of that floor row, so it
          // sorts with objects and hides whatever stands on the row behind.
          const southWall = isFloor(x, y - 1);
          draws.push({
            sprite: name,
            frame: pickFrame(def.frames, x, y),
            x: x * TILE,
            y: (y + 1) * TILE - def.height,
            z,
            pass: southWall ? PASS.object : PASS.wall
          });
        }
      } else if (isCap(x, y)) {
        const mask =
          (isCap(x, y - 1) ? 1 : 0) |
          (isCap(x + 1, y) ? 2 : 0) |
          (isCap(x, y + 1) ? 4 : 0) |
          (isCap(x - 1, y) ? 8 : 0);
        const name = `${style}-cap`;
        if (has(name)) {
          const frame = `m${mask}`;
          draws.push({
            sprite: name,
            frame: catalog[name].frames.includes(frame) ? frame : catalog[name].frames[0],
            x: x * TILE,
            y: y * TILE,
            z,
            pass: PASS.wall
          });
        }
      }
    }
  }

  const blocked = new Set<number>();
  const hallBounds: RoomBounds[] = halls.map((h, i) => ({
    id: `hall#${i}`,
    name: 'Hall',
    x: h.at[0],
    y: h.at[1],
    w: h.size[0],
    h: h.size[1]
  }));
  const inside = (b: RoomBounds, x: number, y: number) =>
    x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
  const toPx = (b: RoomBounds) => ({ x: b.x * TILE, y: b.y * TILE, w: b.w * TILE, h: b.h * TILE });
  // A lamp lights the back walls it can see: a wall face counts only when the
  // floor it faces is in the lamp's area. A south wall (floor on both sides)
  // reads as a wall top from above, so it never counts. An edge of the area
  // made mostly of wall tops is the far side of a wall, so trim it.
  const lightClip = (b: RoomBounds) => {
    const back = (x: number, y: number) => !isFloor(x, y - 1);
    const faces = (x: number, y: number) =>
      (isFaceBottom(x, y) && back(x, y) && inside(b, x, y + 1)) ||
      (isFaceTop(x, y) && inside(b, x, y + 2));
    const isTop = (x: number, y: number) => {
      const c = at(x, y);
      return !c || c.cell.kind === 'void' || (c.cell.kind === 'wall' && !faces(x, y));
    };
    // Mostly wall tops: a side wall meeting the edge leaves a stray face cell.
    const farSide = (cells: [number, number][]) =>
      cells.filter(([x, y]) => isTop(x, y)).length >
      2 * cells.filter(([x, y]) => faces(x, y)).length;
    let { x, y, w, h } = b;
    const row = (ry: number) =>
      farSide(Array.from({ length: w }, (_, i): [number, number] => [x + i, ry]));
    const col = (cx: number) =>
      farSide(Array.from({ length: h }, (_, i): [number, number] => [cx, y + i]));
    if (w > 2 && col(x)) (x++, w--);
    if (w > 2 && col(x + w - 1)) w--;
    if (h > 2 && row(y)) (y++, h--);
    if (h > 2 && row(y + h - 1)) h--;
    // A south wall's face is two tiles tall and hides the floor row behind it.
    // When most of the bottom row is hidden by a face looking out, trim it too.
    const hidden = (hx: number, hy: number) =>
      isFloor(hx, hy) && isFaceBottom(hx, hy + 1) && !inside(b, hx, hy + 2);
    const bottom = Array.from({ length: w }, (_, i) => hidden(x + i, y + h - 1));
    if (h > 2 && bottom.filter(Boolean).length * 2 >= w) h--;
    return toPx({ ...b, x, y, w, h });
  };

  props.forEach(({ p, room, ox, oy }, i) => {
    if (!has(p.sprite)) return;
    const def = catalog[p.sprite];
    const tx = ox + p.at[0];
    const ty = oy + p.at[1];
    const [fw, fh] = def.footprint;
    const px = tx * TILE - (p.flip ? def.width - fw * TILE - def.origin[0] : def.origin[0]);
    const py = ty * TILE - def.origin[1];
    const name = p.variant ? `${p.sprite}@${p.variant}` : p.sprite;
    const obj = `${room}/${name}#${i}`;
    // A wall prop on a south wall (floor behind it, like a shop front seen
    // from the street) sorts with objects, the same as the wall face it hangs on.
    const onSouthWall = def.layer === 'wall' && isFloor(tx, ty - 1);
    const pass =
      def.layer === 'floor'
        ? PASS.floor
        : def.layer === 'wall'
          ? onSouthWall
            ? PASS.object
            : PASS.wall
          : def.layer === 'overlay'
            ? PASS.overlay
            : PASS.object;
    draws.push({
      sprite: p.sprite,
      variant: p.variant,
      // Bare-number frames are variety, like floor tiles: pick one by position.
      frame:
        p.frame ??
        (def.frames.every((f) => /^\d+$/.test(f)) ? pickFrame(def.frames, tx, ty) : def.frames[0]),
      x: px,
      y: py,
      // Floor and wall props paint after every tile and wall in their pass.
      z: onSouthWall
        ? (ty + fh) * TILE + def.zbias + 1
        : (ty + fh) * TILE +
          def.zbias +
          (def.layer === 'floor' || def.layer === 'wall' ? TILE * 10000 : 0),
      pass,
      flip: p.flip,
      obj,
      ...(p.id ? { item: p.id } : {})
    });
    if (!def.walkable && def.layer === 'object')
      for (let y = ty; y < ty + fh; y++)
        for (let x = tx; x < tx + fw; x++) blocked.add(y * width + x);
    // A light glows in the room or hall its prop stands in, so a tall lamp
    // whose shade rises over a wall still lights its own side. A wall prop
    // lights the floor its wall faces: the first floor below its centre, so a
    // shop window lights the street and a wall lamp its own room. Its own room
    // wins where rooms overlap at a shared wall.
    for (const l of def.lights) {
      const lx = px + (p.flip ? def.width - 1 - l.x : l.x);
      const ly = py + l.y;
      const col = Math.min(tx + fw - 1, Math.max(tx, Math.floor(lx / TILE)));
      let [cx, cy] = [col, ty + fh - 1];
      if (def.layer === 'wall' || !isFloor(cx, cy)) {
        // Floor hidden behind a south wall's face does not count.
        const open = (x: number, y: number) => isFloor(x, y) && !isFaceBottom(x, y + 1);
        [cx, cy] = [Math.floor(lx / TILE), Math.floor(ly / TILE)];
        for (let d = 0; d < 4; d++)
          if (open(cx, cy + d)) {
            cy += d;
            break;
          }
      }
      const own = rooms.find((r) => r.id === room);
      const area =
        (own && inside(own, cx, cy) ? own : undefined) ??
        rooms.find((b) => inside(b, cx, cy)) ??
        hallBounds.find((b) => inside(b, cx, cy)) ??
        own;
      // No room or hall means the grounds, which are outdoors too.
      const outdoor = !area || !!area.outdoor;
      // Outdoors no wall stops the light, so it spills onto the grass and
      // past the building's sides; only the building front above cuts it,
      // and only where one stands, so an empty lot takes the light too.
      let clip = area && lightClip(area);
      if (clip && area && outdoor) {
        const reach = l.radius * 2;
        const front = at(cx, area.y - 1)?.cell.kind === 'wall';
        const top = front ? clip.y : ly - reach;
        clip = { x: lx - reach, y: top, w: 2 * reach, h: ly + reach - top };
      }
      lights.push({ ...l, x: lx, y: ly, clip, outdoor, obj });
    }
    for (const s of def.spots) {
      const dx = p.flip ? fw - 1 - s.dx : s.dx;
      const tile: [number, number] = [tx + dx, ty + s.dy];
      spots.push({
        id: `${obj}/${s.name}`,
        prop: p.sprite,
        obj,
        name: s.name,
        room,
        activity: s.activity,
        facing: p.flip ? FLIP_FACING[s.facing] : s.facing,
        pose: s.pose,
        tile
      });
    }
  });
  for (const i of blocked) walkable[i] = false;

  // Seats and stations are entered from one side only, so nobody walks
  // through a couch or climbs over its back. A spot faces where its person
  // looks: try that side first (a couch faces into the room), then behind
  // (a desk chair faces the desk), then the two flanks.
  const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
  const open = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && walkable[y * width + x];
  for (const s of spots) {
    const [fx, fy] = STEP[s.facing];
    const [x, y] = s.tile;
    const sides: [number, number][] = [
      [x + fx, y + fy],
      [x - fx, y - fy],
      [x + fy, y + fx],
      [x - fy, y - fx]
    ];
    s.approach = sides.find(([ax, ay]) => open(ax, ay));
  }

  for (const a of options.actors === false ? [] : (plan.actors ?? [])) {
    if (!has(a.sprite)) continue;
    const def = catalog[a.sprite];
    draws.push({
      sprite: a.sprite,
      variant: a.variant,
      frame: a.frame ?? def.frames[0],
      x: a.at[0] * TILE - def.origin[0],
      y: a.at[1] * TILE - def.origin[1],
      z: (a.at[1] + 1) * TILE + def.zbias,
      pass: PASS.object,
      flip: a.flip
    });
  }

  draws.sort((a, b) => a.pass - b.pass || a.z - b.z || a.x - b.x);
  return {
    width,
    height,
    cells: raw.map((r) => r.cell),
    walkable,
    draws,
    spots,
    lights,
    rooms,
    halls: hallBounds,
    site: { x: ml, y: mt, w: width - ml - mr, h: height - mt - mb },
    missing: [...missing].sort()
  };
}
