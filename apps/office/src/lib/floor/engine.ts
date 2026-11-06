// The floor: draws a composed world with PixiJS, lights it by the hour, and
// hosts the staff. The page owns one Floor and talks to it through methods.
//
// It draws only when something on screen changed: the camera moved, a
// staffer stepped or changed frame, or the ambient clock turned a visible
// animation. A still floor costs nothing.
import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Spritesheet,
  Texture,
  TextureStyle,
  TilingSprite,
  UPDATE_PRIORITY,
  type SpritesheetData
} from 'pixi.js';
import {
  ambientAt,
  bloomAlpha,
  BLOOM_REACH,
  glowAlpha,
  INDOOR_GLOW,
  OUTDOOR_GLOW,
  GLOW_STOPS,
  nightTint,
  skyAt,
  TILE,
  type DrawCmd,
  type PlacedLight,
  type SpriteCatalog,
  type World
} from '@oddboro/world';

export type Atlas = { sheet: Spritesheet; catalog: SpriteCatalog };

export async function loadAtlas(catalog: SpriteCatalog): Promise<Atlas> {
  TextureStyle.defaultOptions.scaleMode = 'nearest';
  const data = (await fetch('/atlas/atlas.json').then((r) => r.json())) as SpritesheetData;
  const texture = await Assets.load<Texture>({ src: '/atlas/atlas.png', alias: 'atlas' });
  const sheet = new Spritesheet(texture, data);
  await sheet.parse();
  return { sheet, catalog };
}

let shared: Promise<Atlas> | undefined;
/** The atlas, loaded once for the page: the floor and any preview share it. */
export const sharedAtlas = (catalog: SpriteCatalog): Promise<Atlas> =>
  (shared ??= loadAtlas(catalog));

const MAX_ZOOM = 6;
/** How often the ambient clock turns water, reeds and machines, and drifts the dust. */
const AMBIENT_FPS = 12;
/** Side of a culling block in world pixels: 16 tiles. */
const BLOCK = 16 * TILE;
/** How long after the last wheel event the zoom settles on a crisp level. */
const SETTLE_MS = 140;

/** A sprite the ambient clock animates, with its box in world pixels. */
type Anim = { s: Sprite; frames: Texture[]; fps: number; start: number; box: Box };
type Box = [number, number, number, number];
/** Something a tap can land on: its box, and its place in draw order, so the one drawn on top wins. */
type Hit = { box: Box; rank: number };
/**
 * A prop that gives off light, which the owner can switch off: its sprites, the
 * glowing pixels over them, and its lights. Off, a sprite shows its off frame
 * (drawn, like a cold fireplace, or compiled with its glow colours unlit).
 */
type Switch = Hit & {
  obj: string;
  on: boolean;
  parts: { s: Sprite; lit: Texture; off?: Texture; anim?: Anim }[];
  glows: { s: Sprite; anim?: Anim }[];
  lights: Sprite[];
};

/** Of the hits whose box holds a world point, the one drawn on top. */
function topAt<T extends Hit>(hits: Iterable<T>, [x, y]: [number, number]): T | undefined {
  let best: T | undefined;
  for (const h of hits) {
    const [bx, by, bw, bh] = h.box;
    if (x >= bx && x < bx + bw && y >= by && y < by + bh && (!best || h.rank > best.rank)) best = h;
  }
  return best;
}

/**
 * What a tap at a world point does: switch the prop drawn on top there, else
 * open the Lessons from a library shelf there. Switches come first, so the
 * library's own lamps and fire still switch.
 */
export function tapAt(
  switches: Iterable<Hit & { obj: string }>,
  shelves: Iterable<Hit>,
  at: [number, number]
): { switch: string } | 'shelf' | undefined {
  const sw = topAt(switches, at);
  if (sw) return { switch: sw.obj };
  return topAt(shelves, at) ? 'shelf' : undefined;
}

const toHex = (rgb: readonly number[]) =>
  (Math.round(rgb[0]) << 16) | (Math.round(rgb[1]) << 8) | Math.round(rgb[2]);

function glowTexture(): Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, v] of GLOW_STOPS) g.addColorStop(t, `rgba(255,255,255,${v})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'linear';
  return tex;
}

/**
 * One additive glow for a light, cut to the room it is in so it never shines
 * through a wall. `reach` scales the radius (the bloom uses a tighter one).
 */
function glowSprite(tex: Texture, l: PlacedLight, reach: number): Sprite | undefined {
  const r = l.radius * reach;
  let x0 = l.x - r;
  let y0 = l.y - r;
  let x1 = l.x + r;
  let y1 = l.y + r;
  if (l.clip) {
    x0 = Math.max(x0, l.clip.x);
    y0 = Math.max(y0, l.clip.y);
    x1 = Math.min(x1, l.clip.x + l.clip.w);
    y1 = Math.min(y1, l.clip.y + l.clip.h);
  }
  if (x1 <= x0 || y1 <= y0) return undefined;
  const k = tex.width / (2 * r);
  const frame = new Rectangle(
    (x0 - (l.x - r)) * k,
    (y0 - (l.y - r)) * k,
    (x1 - x0) * k,
    (y1 - y0) * k
  );
  const s = new Sprite(new Texture({ source: tex.source, frame }));
  s.position.set(x0, y0);
  s.width = x1 - x0;
  s.height = y1 - y0;
  s.tint = l.color;
  s.blendMode = 'add';
  return s;
}

/**
 * Build one sprite for a draw command. When its sprite animates, its frames
 * go on `anims` for the ambient clock to turn. `suffix` "~e" picks the
 * emissive-only frames, which line up with the normal ones because the start
 * frame comes from the position.
 */
function makeSprite(atlas: Atlas, d: DrawCmd, anims: Anim[], suffix = ''): Sprite | undefined {
  const meta = atlas.catalog[d.sprite];
  const prefix = d.variant ? `${d.sprite}@${d.variant}` : d.sprite;
  const m = /^(.*)-(\d+)$/.exec(d.frame);
  const frames =
    m && meta.fps > 0 ? atlas.sheet.animations[`${prefix}/${m[1]}${suffix}`] : undefined;
  let s: Sprite;
  if (frames && frames.length > 1) {
    const start = (Math.abs(d.x * 7 + d.y * 13) >> 4) % frames.length;
    s = new Sprite(frames[start]);
    anims.push({ s, frames, fps: meta.fps, start, box: [d.x, d.y, meta.width, meta.height] });
  } else {
    const tex = atlas.sheet.textures[`${prefix}/${d.frame}${suffix}`];
    if (!tex) return undefined;
    s = new Sprite(tex);
  }
  s.x = d.x;
  s.y = d.y;
  if (d.flip) {
    s.scale.x = -1;
    s.x += meta.width;
  }
  s.zIndex = d.z;
  return s;
}

/**
 * Plain grass laid past the world's own grounds, in tiles on every side, so
 * the camera can pull back far enough to see the whole office beside open
 * panels without showing the edge of the world.
 */
const MEADOW = 48;
/** Lamps that follow the daylight, by sprite: out by day, lit from dusk. */
const DAYLIGHT_LAMPS = new Set(['street-lamp']);
/** Whether a placed prop, by its id `room/sprite@variant#n`, is a lamp that follows the daylight. */
const byDaylight = (obj: string) =>
  DAYLIGHT_LAMPS.has(obj.split('/')[1]?.split('#')[0].split('@')[0] ?? '');
/** What grows on the meadow, the common ones listed more than once. */
const PLANTS = [
  'park-tree',
  'park-tree',
  'park-tree-large',
  'park-pine',
  'park-pine',
  'park-pine-large',
  'park-tree-small',
  'park-bush',
  'park-bush',
  'park-bush-large',
  'park-tuft',
  'park-tuft',
  'park-flowers',
  'park-rock'
];

export class Floor {
  readonly app: Application;
  /** The world on show. `swap` changes it in place. */
  world: World;
  readonly atlas: Atlas;
  readonly stage = new Container();
  readonly objects = new Container();
  /** Soft contact shadows under staff, painted on the floor below everything standing. */
  readonly shadows = new Container();
  private sky = new Graphics();
  private shafts = new Graphics();
  private motes: { g: Graphics; x: number; y: number; h: number; seed: number }[] = [];
  private moteLayer = new Container();
  private windows: { x: number; y: number; w: number; h: number }[] = [];
  private lightScene = new Container();
  private lightSprites: { s: Sprite; l: PlacedLight }[] = [];
  private anims: Anim[] = [];
  /**
   * The world's sprites grouped by the block they sit in. A draw shows only
   * the blocks on screen, so its cost follows the screen, not the map.
   */
  private blocks = new Map<number, { box: Box; items: Container[]; on: boolean }>();
  private ambientNext = 0;
  /** Something changed that the camera check below cannot see. */
  private dirty = true;
  /** The camera as last drawn: x, y, zoom. */
  private drawn: [number, number, number] = [NaN, NaN, NaN];
  /** Called after each draw, so HTML overlays such as name tags can follow. */
  onRender: (() => void) | undefined;
  private glow = new Container();
  /** Every scene sprite the night darkens. Emissive overlays stay out of it. */
  private shaded: (Sprite | TilingSprite)[] = [];
  /** The night tint every shaded sprite and every staffer wears right now. */
  nightTint = 0xffffff;
  private hour = 12;
  private zoom = 3;
  /** The zoom the camera is gliding to, and the screen point that holds still meanwhile. */
  private zoomTo = 3;
  private anchor: [number, number] = [0, 0];
  private settle: ReturnType<typeof setTimeout> | undefined;
  /** The zoom a wheel or pinch gesture started from, while it lasts. */
  private gestureFrom: number | undefined;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private drag: { x: number; y: number; sx: number; sy: number } | undefined;
  private target: { x: number; y: number } | undefined;
  /**
   * A camera move under way: the world point to end on at the screen's centre
   * and the zoom to end at. Every move the floor makes glides; none jumps.
   */
  private glide: { x: number; y: number; zoom: number } | undefined;
  private overviewing = false;
  /** Screen pixels to shift the camera's centre by, e.g. to clear a side panel. */
  viewOffsetX = 0;
  /** Screen pixels the panels cover, together: the whole-office view fits the rest. */
  viewCover = 0;
  /** Called when the user takes the camera by dragging or zooming. */
  onRelease: (() => void) | undefined;
  private resizeObserver: ResizeObserver;
  private doors: { s: Sprite; open: Texture; closed: Texture; tiles: Set<number> }[] = [];
  private switches = new Map<string, Switch>();
  /** Called when the owner taps a prop that can be switched, with its id. */
  onTap: ((obj: string) => void) | undefined;
  /** Every library shelf, which a tap opens the Lessons from. */
  private shelves: Hit[] = [];
  /** Called when the owner taps a library shelf that no switch covers. */
  onShelf: (() => void) | undefined;
  /** Every placed prop with an id in its room, for picking one by hand. */
  private items: (Hit & {
    obj: string;
    item: string;
    /** The footprint's top-left tile, and its size in tiles. */
    tile: [number, number];
    size: [number, number];
  })[] = [];
  /**
   * Set while arranging a room: a press on a placed thing that then moves
   * carries it, and letting go asks to put it at the tile under the pointer
   * (its footprint's top-left). Dragging empty floor still moves the camera.
   */
  onMove: ((hit: { obj: string; item: string }, tile: [number, number]) => void) | undefined;
  /** The thing being carried, and how far the press was from its top-left tile. */
  private carrying:
    { obj: string; item: string; size: [number, number]; grip: [number, number] } | undefined;
  private dropOutline = new Graphics();
  /**
   * Set while arranging a room: a tap picks the prop on top there, if any, and
   * the tile, instead of switching anything.
   */
  onPick: ((hit: { obj?: string; item?: string; tile: [number, number] }) => void) | undefined;
  private outline = new Graphics();
  /** Floor, wall, objects and overlay. Objects is shared with staff, so it is never cleared. */
  private layers: Container[] = [];
  /** Everything the world put on stage, to take down when it changes. */
  private made: Container[] = [];
  /** Each draw's sprite and its emissive overlay, by draw index, for the first-run reveal. */
  drawSprites: ({ s: Sprite; e?: Sprite } | undefined)[] = [];
  /** Each lamp's glow and bloom, with the prop it belongs to, for the reveal to light one at a time. */
  lightParts: { s: Sprite; obj?: string }[] = [];

  private constructor(app: Application, world: World, atlas: Atlas) {
    this.app = app;
    this.world = world;
    this.atlas = atlas;
    // The canvas follows its box, not only the window: a bar below it can grow.
    this.resizeObserver = new ResizeObserver(() => {
      this.app.resize();
      this.fit();
    });
  }

  /**
   * `preview` is for a small look at a floor that is not the office: any
   * zoom goes, so the whole building fits a little box.
   */
  static async create(
    host: HTMLElement,
    world: World,
    atlas: Atlas,
    opts: { preview?: boolean } = {}
  ): Promise<Floor> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: '#0b0d17',
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1
    });
    // Pixi draws every frame by default. The floor draws itself when needed.
    app.ticker.remove(app.render, app);
    host.appendChild(app.canvas);
    const floor = new Floor(app, world, atlas);
    floor.preview = !!opts.preview;
    floor.build();
    floor.resizeObserver.observe(host);
    floor.overview(false);
    return floor;
  }

  private build() {
    this.layers = [new Container(), new Container(), this.objects, new Container()];
    this.objects.sortableChildren = true;
    this.buildWorld();
    this.shafts.blendMode = 'add';
    const layers = this.layers;
    this.stage.addChild(
      layers[0],
      this.sky,
      layers[1],
      this.shafts,
      this.shadows,
      this.objects,
      layers[3]
    );
    this.stage.addChild(this.lightScene, this.glow, this.moteLayer, this.outline, this.dropOutline);
    this.app.stage.addChild(this.stage);
    // After the page's own ticker work, so a staffer's step draws the same frame.
    this.app.ticker.add(() => this.tick(), undefined, UPDATE_PRIORITY.LOW);
    this.bindCamera();
  }

  /**
   * Show another world in place: the first run's lot, then the office going
   * up on it. Staff on the floor stay where they are.
   */
  swap(world: World, opts: { fit?: boolean } = {}) {
    // Keep the view: the front of the site (where the street meets it) stays
    // where it is on screen. The two worlds can differ in size, so the same
    // world point would be somewhere else.
    const front = (w: World) => [(w.site.x + w.site.w / 2) * TILE, (w.site.y + w.site.h) * TILE];
    const [ox, oy] = front(this.world);
    const [sx, sy] = [this.stage.x + ox * this.zoom, this.stage.y + oy * this.zoom];
    for (const c of this.made) c.destroy();
    this.made = [];
    this.drawSprites = [];
    this.shaded = [];
    this.anims = [];
    this.blocks.clear();
    this.switches.clear();
    this.doors = [];
    this.shelves = [];
    this.windows = [];
    this.items = [];
    this.lightSprites = [];
    this.lightParts = [];
    this.motes = [];
    this.world = world;
    this.buildWorld();
    // A new world's lamps start lit: put out again the ones the owner switched off.
    for (const obj of this.ownerOff) this.light(obj, false);
    this.setHour(this.hour);
    const [nx, ny] = front(world);
    this.glide = undefined;
    this.place(sx - nx * this.zoom, sy - ny * this.zoom);
    // Asked to, and too close in to see the whole building: glide out to it.
    if (opts.fit && this.zoom > this.fitZoom()) this.overview();
  }

  private buildWorld() {
    const { world, atlas } = this;
    const layers = this.layers;
    const keep = <T extends Container>(c: T): T => {
      this.made.push(c);
      return c;
    };

    // The meadow under everything, past the grounds' edge.
    const grass = this.meadowPatch();
    if (grass) {
      const meadow = keep(
        new TilingSprite({
          texture: grass,
          width: (world.width + 2 * MEADOW) * TILE,
          height: (world.height + 2 * MEADOW) * TILE
        })
      );
      meadow.position.set(-MEADOW * TILE, -MEADOW * TILE);
      this.stage.addChildAt(meadow, 0);
      this.shaded.push(meadow);
      this.stage.addChildAt(keep(this.countryside()), 1);
    }

    const lightOf = new Set(world.lights.map((l) => l.obj));
    for (const [i, d] of world.draws.entries()) {
      const s = makeSprite(atlas, d, this.anims);
      if (!s) continue;
      layers[d.pass].addChild(keep(s));
      this.shaded.push(s);
      const meta = atlas.catalog[d.sprite];
      const box: Box = [d.x, d.y, meta.width, meta.height];
      this.addToBlock(s, box);
      // Emissive pixels ride directly on top of their sprite, in the same
      // layer and depth, so anything in front still covers them. Only the
      // base darkens at night.
      let e: Sprite | undefined;
      if (meta.emissive) {
        e = makeSprite(atlas, d, this.anims, '~e');
        if (e) {
          e.zIndex = d.z + 0.01;
          layers[d.pass].addChildAt(keep(e), layers[d.pass].getChildIndex(s) + 1);
          this.addToBlock(e, box);
        }
      }
      this.drawSprites[i] = { s, e };
      if (d.obj && (meta.emissive || lightOf.has(d.obj))) {
        const prefix = d.variant ? `${d.sprite}@${d.variant}` : d.sprite;
        const sw = this.switches.get(d.obj) ?? {
          obj: d.obj,
          on: true,
          rank: i,
          box,
          parts: [],
          glows: [],
          lights: []
        };
        sw.rank = i;
        const [bx, by, bw, bh] = sw.box;
        const x0 = Math.min(bx, box[0]);
        const y0 = Math.min(by, box[1]);
        sw.box = [
          x0,
          y0,
          Math.max(bx + bw, box[0] + box[2]) - x0,
          Math.max(by + bh, box[1] + box[3]) - y0
        ];
        sw.parts.push({
          s,
          lit: s.texture,
          off: atlas.sheet.textures[
            meta.frames.includes('off') ? `${prefix}/off` : `${prefix}/${d.frame}~off`
          ],
          anim: this.anims.find((a) => a.s === s)
        });
        if (e) sw.glows.push({ s: e, anim: this.anims.find((a) => a.s === e) });
        this.switches.set(d.obj, sw);
      }
      if (d.obj && d.item)
        this.items.push({
          obj: d.obj,
          item: d.item,
          box,
          rank: i,
          tile: [
            Math.round((d.x + meta.origin[0]) / TILE),
            Math.round((d.y + meta.origin[1]) / TILE)
          ],
          size: meta.footprint
        });
      if (meta.tags.includes('shelf') && meta.tags.includes('library'))
        this.shelves.push({ box, rank: i });
      // A door with open and closed frames swings open when staff come near.
      if (
        meta.tags.includes('door') &&
        meta.frames.includes('open') &&
        meta.frames.includes('closed')
      ) {
        const prefix = d.variant ? `${d.sprite}@${d.variant}` : d.sprite;
        // The door's own column of cells: its footprint, up through the wall above it.
        const tx = Math.round((d.x + meta.origin[0]) / TILE);
        const ty = Math.round((d.y + meta.origin[1]) / TILE);
        const tiles = new Set<number>();
        for (let x = tx; x < tx + meta.footprint[0]; x++)
          for (let y = ty - 2; y <= ty; y++) tiles.add(y * world.width + x);
        this.doors.push({
          s,
          open: atlas.sheet.textures[`${prefix}/open`],
          closed: atlas.sheet.textures[`${prefix}/closed`],
          tiles
        });
      }
      if (atlas.catalog[d.sprite].tags.includes('window'))
        this.windows.push({
          x: d.x,
          y: d.y,
          w: atlas.catalog[d.sprite].width,
          h: atlas.catalog[d.sprite].height
        });
    }

    // Dust drifting in each window's sunlight.
    for (const w of this.windows)
      for (let i = 0; i < 5; i++) {
        const g = keep(new Graphics().rect(0, 0, 1, 1).fill(0xfff4dc));
        this.moteLayer.addChild(g);
        this.motes.push({
          g,
          x: w.x + 2 + Math.random() * (w.w + 10),
          y: w.y + w.h + Math.random() * 36,
          h: 36,
          seed: Math.random() * 100
        });
      }

    // Lighting: every sprite wears a night tint by the hour (set in
    // setHour), emissive pixels stay bright on top of their sprite, and each
    // lamp adds a glow cut to its own room, then a tighter bloom.
    const tex = glowTexture();
    for (const l of world.lights) {
      const s = glowSprite(tex, l, 1);
      const g = glowSprite(tex, l, BLOOM_REACH);
      if (!s || !g) continue;
      // The bloom layer fades as one by the hour; indoor lamps carry half of it.
      g.alpha = l.outdoor ? OUTDOOR_GLOW : INDOOR_GLOW;
      this.lightScene.addChild(keep(s));
      this.glow.addChild(keep(g));
      this.lightParts.push({ s, obj: l.obj }, { s: g, obj: l.obj });
      this.lightSprites.push({ s, l });
      if (l.obj) this.switches.get(l.obj)?.lights.push(s, g);
      this.addToBlock(s, [s.x, s.y, s.width, s.height]);
      this.addToBlock(g, [g.x, g.y, g.width, g.height]);
    }
  }

  private patch: Texture | undefined;
  /**
   * A 16 by 16 tile patch of grass for the meadow to repeat, mixed the way the
   * world mixes its grass: plain about 70% of the time, flecked the rest.
   */
  private meadowPatch(): Texture | undefined {
    if (this.patch) return this.patch;
    const frames = this.atlas.catalog['floor-grass']?.frames ?? [];
    if (!frames.length) return undefined;
    const patch = new Container();
    const N = 16;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let h = (x * 374761393 + y * 668265263) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        h = (h ^ (h >>> 16)) >>> 0;
        const frame =
          frames.length > 1 && h % 100 >= 70
            ? frames[1 + ((h >>> 8) % (frames.length - 1))]
            : frames[0];
        const tex = this.atlas.sheet.textures[`floor-grass/${frame}`];
        if (!tex) continue;
        const sp = new Sprite(tex);
        sp.position.set(x * TILE, y * TILE);
        patch.addChild(sp);
      }
    this.patch = this.app.renderer.generateTexture({ target: patch, resolution: 1 });
    patch.destroy({ children: true });
    return this.patch;
  }

  /**
   * The meadow's own things: the street's road rows carried out to the edges
   * on both sides, and trees, bushes and tufts scattered over the grass, kept
   * clear of the road and of the world's own grounds. Drawn once per world, in
   * the same order every time.
   */
  private countryside(): Container {
    const { world, atlas } = this;
    const out = new Container();
    // Back to front, so a tree in front covers the one behind.
    out.sortableChildren = true;
    const add = (s: Sprite | TilingSprite) => {
      out.addChild(s);
      this.shaded.push(s);
    };
    const material = (x: number, y: number) => {
      const c = world.cells[y * world.width + x];
      return c?.kind === 'floor' ? c.material : undefined;
    };
    // The street's rows, whatever a theme paves them with: cobbles and a dirt
    // road carry on as far as asphalt does. The grass between stays meadow.
    const street = world.rooms.find((r) => r.id.startsWith('street'));
    const grass = material(0, 0);
    const texture = (m: string) => {
      const name = `floor-${m}`;
      const frame = atlas.catalog[name]?.frames.includes('0')
        ? '0'
        : atlas.catalog[name]?.frames[0];
      return frame ? atlas.sheet.textures[`${name}/${frame}`] : undefined;
    };
    const road = new Set<number>();
    for (let y = street?.y ?? 0; y < (street ? street.y + street.h : 0); y++)
      for (const [edge, from] of [
        [0, -MEADOW],
        [world.width - 1, world.width]
      ]) {
        const m = material(edge, y);
        const tex = m && m !== grass && texture(m);
        if (!tex) continue;
        road.add(y);
        const strip = new TilingSprite({ texture: tex, width: MEADOW * TILE, height: TILE });
        strip.position.set(from * TILE, y * TILE);
        add(strip);
      }
    // Scatter, deterministic by tile so the meadow never changes between visits.
    const hash = (x: number, y: number) => {
      let h = (x * 374761393 + y * 668265263) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      return (h ^ (h >>> 16)) / 4294967296;
    };
    const near = (y: number) => [...road].some((r) => Math.abs(r - y) <= 2);
    const W = world.width;
    const H = world.height;
    for (let y = -MEADOW + 2; y < H + MEADOW - 1; y++)
      for (let x = -MEADOW; x < W + MEADOW - 2; x++) {
        // Stay off the world itself and a few tiles from it, so nothing tall
        // reaches over its edge, and off the road.
        if (x > -4 && x < W + 1 && y > -1 && y < H + 4) continue;
        if (near(y)) continue;
        const r = hash(x, y);
        if (r > 0.05) continue;
        const name = PLANTS[Math.floor((r / 0.05) * PLANTS.length)];
        const meta = atlas.catalog[name];
        const frame = meta?.frames.includes('default') ? 'default' : meta?.frames[0];
        const tex = frame && atlas.sheet.textures[`${name}/${frame}`];
        if (!meta || !tex) continue;
        const sp = new Sprite(tex);
        sp.position.set(x * TILE - meta.origin[0], y * TILE - meta.origin[1]);
        sp.zIndex = (y + 1) * TILE;
        add(sp);
      }
    return out;
  }

  /** How much sun comes through the windows, 0 at night to 1 at midday. */
  private daylight() {
    return Math.max(0, Math.min(1, (ambientAt(this.hour).strength - 0.45) / 0.55));
  }

  setHour(hour: number) {
    this.hour = hour;
    // Street lamps come on at dusk and go out at dawn, unless the owner put one out.
    this.daylit = ambientAt(hour).strength >= 0.75;
    for (const obj of this.switches.keys())
      if (byDaylight(obj)) this.light(obj, !this.daylit && !this.ownerOff.has(obj));
    const [top, bottom] = skyAt(hour);
    // The night is a multiply by the ambient colour, done as a tint.
    this.nightTint = toHex(nightTint(hour).map((v) => v * 255));
    for (const sp of this.shaded) sp.tint = this.nightTint;
    // Sun shafts on the floor under each window, warmer as the day ends.
    const d = this.daylight();
    const warm = hour > 16 || hour < 8.5;
    this.shafts.clear();
    if (d > 0)
      for (const w of this.windows) {
        const y0 = w.y + w.h;
        for (let k = 0; k < 4; k++) {
          const len = 14 + k * 9;
          this.shafts
            .poly([
              w.x + 2,
              y0,
              w.x + w.w - 2,
              y0,
              w.x + w.w + len * 0.45,
              y0 + len,
              w.x + 2 + len * 0.45,
              y0 + len
            ])
            .fill({ color: warm ? 0xffc890 : 0xfff1d6, alpha: 0.035 * d });
        }
      }
    this.sky.clear();
    const bands = 8;
    for (const w of this.windows) {
      for (let b = 0; b < bands; b++) {
        const t = b / (bands - 1);
        const c = top.map((v, i) => v + (bottom[i] - v) * t);
        this.sky.rect(w.x, w.y + (w.h * b) / bands, w.w, Math.ceil(w.h / bands) + 1).fill(toHex(c));
      }
    }
    for (const { s, l } of this.lightSprites)
      s.alpha = Math.min(1, glowAlpha(l.intensity, hour, l.outdoor));
    this.glow.alpha = bloomAlpha(hour);
    this.moteLayer.visible = d > 0;
    this.dirty = true;
  }

  /** File a sprite under the block its centre falls in, growing the block's box to hold it. */
  private addToBlock(item: Container, [x, y, w, h]: Box) {
    const key = Math.floor((y + h / 2) / BLOCK) * 1024 + Math.floor((x + w / 2) / BLOCK);
    const b = this.blocks.get(key);
    if (!b) return void this.blocks.set(key, { box: [x, y, w, h], items: [item], on: true });
    const [bx, by, bw, bh] = b.box;
    const x0 = Math.min(bx, x);
    const y0 = Math.min(by, y);
    b.box = [x0, y0, Math.max(bx + bw, x + w) - x0, Math.max(by + bh, y + h) - y0];
    b.items.push(item);
  }

  /** Show the blocks on screen and hide the rest. Only a block that changes touches its sprites. */
  private showBlocks() {
    const [vx, vy, vw, vh] = this.view();
    for (const b of this.blocks.values()) {
      const [x, y, w, h] = b.box;
      const on = x < vx + vw && x + w > vx && y < vy + vh && y + h > vy;
      if (on === b.on) continue;
      b.on = on;
      for (const it of b.items) it.visible = on;
    }
  }

  /**
   * The owner switches a prop's light on or off. A street lamp also goes out
   * by itself in daylight; the owner's off holds day and night.
   */
  setSwitch(obj: string, on: boolean) {
    if (on) this.ownerOff.delete(obj);
    else this.ownerOff.add(obj);
    this.light(obj, on && !(this.daylit && byDaylight(obj)));
  }

  /** Lights the owner switched off, by placed prop id. */
  private ownerOff = new Set<string>();
  /** Daylight enough that street lamps are out: from about 6:50 am to 6:15 pm. */
  private daylit = false;

  /**
   * Put a prop's light on or off. Off, its sprites show their off frames,
   * its glow and light go out, and its animation stops, so an unlit fire costs
   * no redraws. Culling sets `visible`, so a switch uses `renderable`.
   */
  private light(obj: string, on: boolean) {
    const sw = this.switches.get(obj);
    if (!sw || sw.on === on) return;
    sw.on = on;
    const run = (a: Anim | undefined) => {
      if (!a) return;
      const at = this.anims.indexOf(a);
      if (on && at < 0) this.anims.push(a);
      if (!on && at >= 0) this.anims.splice(at, 1);
    };
    for (const p of sw.parts) {
      run(p.anim);
      if (!on && p.off) p.s.texture = p.off;
      else if (on && !p.anim) p.s.texture = p.lit;
    }
    for (const g of sw.glows) {
      run(g.anim);
      g.s.renderable = on;
    }
    for (const l of sw.lights) l.renderable = on;
    this.dirty = true;
  }

  /** A screen point in world pixels. */
  private toWorld(clientX: number, clientY: number): [number, number] {
    const r = this.app.canvas.getBoundingClientRect();
    return [
      (clientX - r.left - this.stage.x) / this.zoom,
      (clientY - r.top - this.stage.y) / this.zoom
    ];
  }

  /** The prop drawn on top at a screen point, and the tile under it. */
  private pickAt(clientX: number, clientY: number) {
    const [x, y] = this.toWorld(clientX, clientY);
    const best = topAt(this.items, [x, y]);
    const tile: [number, number] = [Math.floor(x / TILE), Math.floor(y / TILE)];
    return { obj: best?.obj, item: best?.item, tile };
  }

  /** The tile a screen point is over. */
  tileAt(clientX: number, clientY: number): [number, number] {
    const [x, y] = this.toWorld(clientX, clientY);
    return [Math.floor(x / TILE), Math.floor(y / TILE)];
  }

  /** Where a carried thing's top-left tile lands for a pointer at this screen point. */
  private carriedTo(clientX: number, clientY: number, c = this.carrying): [number, number] {
    const [tx, ty] = this.tileAt(clientX, clientY);
    return c ? [tx - c.grip[0], ty - c.grip[1]] : [tx, ty];
  }

  /** Outline where something will land, `size` tiles from `tile`, or clear it. */
  showDrop(tile: [number, number] | undefined, size: [number, number] = [1, 1]) {
    this.dropOutline.clear();
    if (tile)
      this.dropOutline
        .rect(tile[0] * TILE, tile[1] * TILE, size[0] * TILE, size[1] * TILE)
        .fill({ color: 0x2fb3a6, alpha: 0.18 })
        .stroke({ width: 1, color: 0x2fb3a6 });
    this.dirty = true;
  }

  /** Outline a prop, or clear the outline. */
  highlight(obj: string | undefined) {
    this.outline.clear();
    const it = obj && this.items.find((i) => i.obj === obj);
    if (it) {
      const [x, y, w, h] = it.box;
      this.outline.rect(x - 1, y - 1, w + 2, h + 2).stroke({ width: 1, color: 0xf2b45a });
    }
    this.dirty = true;
  }

  /** What a tap at a screen point does, if anything. */
  private tapAtScreen(clientX: number, clientY: number) {
    return tapAt(this.switches.values(), this.shelves, this.toWorld(clientX, clientY));
  }

  /**
   * Show or hide what lives in the windows: the sky behind the glass, the sun
   * shafts on the floor and the dust in them. The first run hides it until the
   * walls that hold the windows are up. Culling owns `visible`, so this uses
   * `renderable`.
   */
  showWindows(on: boolean) {
    this.sky.renderable = on;
    this.shafts.renderable = on;
    this.moteLayer.renderable = on;
    this.dirty = true;
  }

  /** Ask for a draw on the next frame. */
  invalidate() {
    this.dirty = true;
  }

  /** Where the stage sits when a world point is at the camera's centre. */
  private goal(x: number, y: number, offset = this.viewOffsetX): [number, number] {
    const { width, height } = this.app.screen;
    return [width / 2 + offset - x * this.zoom, height / 2 - y * this.zoom];
  }

  private tick() {
    const dt = this.app.ticker.deltaMS / 1000;
    if (this.glide) {
      const g = this.glide;
      // Gentle on purpose: a quicker glide made the move feel like a lurch.
      const k = this.reduceMotion.matches ? 1 : 1 - Math.exp(-dt * 4.8);
      // The world point at the screen's centre now, eased toward the goal with the zoom.
      const [cx, cy] = this.centre();
      const z = this.zoom + (g.zoom - this.zoom) * k;
      const x = cx + (g.x - cx) * k;
      const y = cy + (g.y - cy) * k;
      const done = Math.abs(g.zoom - z) < 0.002 && Math.hypot(g.x - x, g.y - y) * z < 0.5;
      this.zoom = this.zoomTo = done ? g.zoom : z;
      this.stage.scale.set(this.zoom);
      const [bx, by] = [this.stage.x, this.stage.y];
      const [gx, gy] = this.goal(done ? g.x : x, done ? g.y : y);
      this.place(gx, gy, done);
      // The grounds' edge can stop the camera short of the goal: then it has arrived too.
      const stuck =
        Math.abs(g.zoom - this.zoom) < 0.002 &&
        Math.abs(this.stage.x - bx) + Math.abs(this.stage.y - by) < 0.5;
      if (done || stuck) this.glide = undefined;
    } else if (this.zoom !== this.zoomTo) {
      const k = this.reduceMotion.matches ? 1 : 1 - Math.exp(-dt * 30);
      const z =
        Math.abs(this.zoomTo - this.zoom) < 0.002
          ? this.zoomTo
          : this.zoom + (this.zoomTo - this.zoom) * k;
      // Hold the followed staffer, or the point under the cursor, still on screen.
      const [ax, ay] = this.target
        ? [this.stage.x + this.target.x * this.zoom, this.stage.y + this.target.y * this.zoom]
        : this.anchor;
      const wx = (ax - this.stage.x) / this.zoom;
      const wy = (ay - this.stage.y) / this.zoom;
      this.zoom = z;
      this.stage.scale.set(z);
      this.place(ax - wx * z, ay - wy * z, z === this.zoomTo);
    } else if (this.target) {
      const [gx, gy] = this.goal(this.target.x, this.target.y);
      const k = 1 - Math.exp(-dt * 7.5);
      this.place(this.stage.x + (gx - this.stage.x) * k, this.stage.y + (gy - this.stage.y) * k);
    }
    const now = performance.now() / 1000;
    if (now >= this.ambientNext) {
      this.ambientNext = now + 1 / AMBIENT_FPS;
      this.ambient(now);
    }
    const { x, y } = this.stage;
    const [dx, dy, dz] = this.drawn;
    if (this.dirty || x !== dx || y !== dy || this.zoom !== dz) {
      this.dirty = false;
      this.drawn = [x, y, this.zoom];
      this.showBlocks();
      this.app.render();
      this.onRender?.();
    }
  }

  /** The world rectangle on screen, in world pixels. */
  private view(): Box {
    const { width, height } = this.app.screen;
    return [
      -this.stage.x / this.zoom,
      -this.stage.y / this.zoom,
      width / this.zoom,
      height / this.zoom
    ];
  }

  /**
   * Turn every animation to its frame for this moment, and drift the dust.
   * Only a change on screen asks for a draw.
   */
  private ambient(now: number) {
    const [vx, vy, vw, vh] = this.view();
    const seen = ([x, y, w, h]: Box) => x < vx + vw && x + w > vx && y < vy + vh && y + h > vy;
    for (const a of this.anims) {
      const tex = a.frames[(a.start + Math.floor(now * a.fps)) % a.frames.length];
      if (a.s.texture === tex) continue;
      a.s.texture = tex;
      if (!this.dirty && seen(a.box)) this.dirty = true;
    }
    if (!this.moteLayer.visible) return;
    const d = this.daylight();
    for (const m of this.motes) {
      const t = now * 0.12 + m.seed;
      m.g.x = Math.round(m.x + Math.sin(t * 1.7) * 4);
      m.g.y = Math.round(m.y - ((t * 6) % m.h));
      m.g.alpha = d * (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3.1)));
      if (!this.dirty && seen([m.g.x, m.g.y, 1, 1])) this.dirty = true;
    }
  }

  /**
   * The zoom levels that keep pixel art crisp: every art pixel covers a whole
   * number of device pixels. On a Retina screen that allows half steps. A
   * preview also goes below 1x, but only to levels where every tile still
   * covers whole device pixels: between them, tile edges leave black seams.
   */
  private preview = false;

  /** The step between zoom levels near `z`. */
  private zoomStep(z: number) {
    const crisp = 1 / this.app.renderer.resolution;
    return this.preview && z < 1 ? crisp / TILE : crisp;
  }

  /** The crisp zoom level nearest to `z`, measured as a ratio. */
  private crisp(z: number) {
    const step = this.zoomStep(z);
    const lo = Math.floor(z / step + 1e-6) * step;
    const hi = lo + step;
    const near = lo > 0 && z / lo <= hi / z ? lo : hi;
    return Math.max(this.minZoom(), Math.min(MAX_ZOOM, near));
  }

  /**
   * The crisp level a gesture settles on: the next one the way it went, so a
   * small scroll still takes a step and never springs back. One that barely
   * moved settles where it started.
   */
  private settleFrom(from: number, z: number) {
    if (Math.abs(Math.log(z / from)) < 0.02) return this.crisp(from);
    const step = this.zoomStep(z);
    const levels = z / step;
    const level = z > from ? Math.ceil(levels - 1e-6) : Math.floor(levels + 1e-6);
    return Math.max(this.minZoom(), Math.min(MAX_ZOOM, Math.max(1, level) * step));
  }

  /** The farthest out the camera goes: the grounds still cover the whole screen. */
  private minZoom() {
    const { width, height } = this.app.screen;
    const cover = Math.max(
      width / ((this.world.width + 2 * MEADOW) * TILE),
      height / ((this.world.height + 2 * MEADOW) * TILE)
    );
    const step = this.zoomStep(cover);
    return Math.min(MAX_ZOOM, Math.ceil(cover / step - 1e-6) * step);
  }

  /** Fits the site (the building and its street); the grounds fill the rest. */
  private fitZoom() {
    const { height } = this.app.screen;
    const width = Math.max(240, this.app.screen.width - this.viewCover);
    const W = this.world.site.w * TILE;
    const H = this.world.site.h * TILE;
    const most = Math.min(width / W, height / H);
    const step = this.zoomStep(most);
    const fit = Math.floor(most / step) * step;
    return Math.max(this.minZoom(), Math.min(MAX_ZOOM, fit));
  }

  /** The world point at the centre of the view. */
  private centre(): [number, number] {
    const { width, height } = this.app.screen;
    return [
      (width / 2 + this.viewOffsetX - this.stage.x) / this.zoom,
      (height / 2 - this.stage.y) / this.zoom
    ];
  }

  /** Glide the camera to a world point at a zoom. */
  private glideTo(x: number, y: number, zoom: number) {
    this.glide = { x, y, zoom };
    this.dirty = true;
  }

  /** On resize: keep the zoom unless it was the overview, and stay on the camera target. */
  fit() {
    this.dirty = true;
    if (this.overviewing) this.overview(false);
    else this.setZoom(Math.max(this.zoomTo, this.minZoom()));
  }

  private setZoom(z: number) {
    this.zoom = this.zoomTo = z;
    this.stage.scale.set(z);
    if (this.target) this.centerOn(this.target.x, this.target.y);
    else this.place(this.stage.x, this.stage.y);
  }

  private centerOn(x: number, y: number, offset = this.viewOffsetX) {
    const [gx, gy] = this.goal(x, y, offset);
    this.place(gx, gy);
  }

  /** Move the stage, never so far that the screen shows past the meadow's edge. */
  private place(x: number, y: number, round = true) {
    const { width, height } = this.app.screen;
    const o = MEADOW * TILE * this.zoom;
    const W = this.world.width * TILE * this.zoom + 2 * o;
    const H = this.world.height * TILE * this.zoom + 2 * o;
    const cx = W <= width ? (width - W) / 2 + o : Math.min(o, Math.max(width - W + o, x));
    const cy = H <= height ? (height - H) / 2 + o : Math.min(o, Math.max(height - H + o, y));
    this.stage.position.set(round ? Math.round(cx) : cx, round ? Math.round(cy) : cy);
  }

  /** Glide the camera to a world point and hold it there. */
  focus(x: number, y: number) {
    // Coming out of the overview, step in to a readable zoom once. After
    // that the zoom is the user's: following never changes it.
    if (this.overviewing || !this.target) {
      const zoom = this.overviewing ? Math.max(2, this.fitZoom()) : this.zoomTo;
      this.overviewing = false;
      if (!this.target) this.glideTo(x, y, zoom);
    }
    this.target = { x, y };
  }

  /** One zoom level in or out, about whatever is at the middle of the view. */
  zoomBy(dir: 1 | -1) {
    const z = Math.max(
      this.minZoom(),
      Math.min(MAX_ZOOM, this.crisp(this.zoomTo) + dir * this.zoomStep(this.zoomTo))
    );
    if (z === this.zoomTo) return;
    this.overviewing = false;
    const [x, y] = this.target ? [this.target.x, this.target.y] : this.centre();
    this.glideTo(x, y, z);
  }

  /** The whole floor, centred: at once when the floor opens, gliding after that. */
  overview(glide = true) {
    this.overviewing = true;
    this.target = undefined;
    const { x, y, w, h } = this.world.site;
    const [cx, cy] = [(x + w / 2) * TILE, (y + h / 2) * TILE];
    if (glide) return this.glideTo(cx, cy, this.fitZoom());
    this.glide = undefined;
    this.setZoom(this.fitZoom());
    // Centred on the floor the panels leave showing, not on the whole screen.
    this.centerOn(cx, cy);
  }

  /** True once the user has dragged the camera since the last focus. */
  get released() {
    return !this.target && !this.overviewing;
  }

  private bindCamera() {
    const canvas = this.app.canvas;
    // A press that does not move is a tap: it switches the prop under it, or opens a shelf.
    let still = false;
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, sx: this.stage.x, sy: this.stage.y };
      still = true;
      // Arranging: a press on a placed thing picks it up.
      const hit = this.onMove ? this.pickAt(e.clientX, e.clientY) : undefined;
      const it = hit?.obj && this.items.find((i) => i.obj === hit.obj);
      this.carrying = it
        ? {
            obj: it.obj,
            item: it.item,
            size: it.size,
            grip: [hit!.tile[0] - it.tile[0], hit!.tile[1] - it.tile[1]]
          }
        : undefined;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag) {
        if (e.target === canvas)
          canvas.style.cursor = this.onPick
            ? 'crosshair'
            : this.tapAtScreen(e.clientX, e.clientY)
              ? 'pointer'
              : '';
        return;
      }
      if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 4) still = false;
      if (this.carrying) {
        if (!still) {
          canvas.style.cursor = 'grabbing';
          this.showDrop(this.carriedTo(e.clientX, e.clientY), this.carrying.size);
        }
        return;
      }
      if (
        Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 4 &&
        (this.target || this.overviewing)
      ) {
        this.target = undefined;
        this.overviewing = false;
        this.glide = undefined;
        this.onRelease?.();
      }
      if (this.target || this.glide) return;
      this.place(this.drag.sx + e.clientX - this.drag.x, this.drag.sy + e.clientY - this.drag.y);
    });
    window.addEventListener('pointerup', (e) => {
      const carried = this.carrying;
      this.carrying = undefined;
      if (carried && !still) {
        this.showDrop(undefined);
        canvas.style.cursor = '';
        this.onMove?.(
          { obj: carried.obj, item: carried.item },
          this.carriedTo(e.clientX, e.clientY, carried)
        );
        this.drag = undefined;
        return;
      }
      if (this.drag && still && e.target === canvas) {
        if (this.onPick) this.onPick(this.pickAt(e.clientX, e.clientY));
        else {
          const tap = this.tapAtScreen(e.clientX, e.clientY);
          if (tap === 'shelf') this.onShelf?.();
          else if (tap) this.onTap?.(tap.switch);
        }
      }
      this.drag = undefined;
      still = false;
    });
    // The zoom follows the wheel or the pinch as it happens, then settles on
    // the next crisp level the way it went once the gesture stops. A pinch arrives as a
    // ctrl wheel event whose delta is about 100 times the log of the scale.
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 100 : 1;
        const rate = e.ctrlKey ? 0.01 : 0.003;
        const next = Math.max(
          this.minZoom(),
          Math.min(MAX_ZOOM, this.zoomTo * Math.exp(-e.deltaY * unit * rate))
        );
        if (next === this.zoomTo) return;
        this.overviewing = false;
        this.glide = undefined;
        // While following someone, zoom on them and keep following. Otherwise
        // zoom on the cursor and let go.
        if (!this.target) {
          this.onRelease?.();
          const rect = canvas.getBoundingClientRect();
          this.anchor = [e.clientX - rect.left, e.clientY - rect.top];
        }
        this.gestureFrom ??= this.zoomTo;
        this.zoomTo = next;
        clearTimeout(this.settle);
        this.settle = setTimeout(() => {
          this.zoomTo = this.settleFrom(this.gestureFrom ?? this.zoomTo, this.zoomTo);
          this.gestureFrom = undefined;
        }, SETTLE_MS);
      },
      { passive: false }
    );
  }

  /**
   * Open each door a staffer is about to walk through or is standing in, and
   * close the rest. Sitting on the bench beside a door does not open it.
   */
  updateDoors(steps: [number, number][]) {
    const w = this.world.width;
    const keys = steps.map(([x, y]) => y * w + x);
    for (const d of this.doors) {
      const through = keys.some((k) => d.tiles.has(k));
      const tex = through ? d.open : d.closed;
      if (d.s.texture !== tex) {
        d.s.texture = tex;
        this.dirty = true;
      }
    }
  }

  /** Screen position of a world pixel, for HTML overlays such as name tags. */
  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.stage.x + x * this.zoom, y: this.stage.y + y * this.zoom };
  }

  get scale() {
    return this.zoom;
  }

  destroy() {
    clearTimeout(this.settle);
    this.resizeObserver.disconnect();
    this.app.destroy(true, { children: true });
  }
}
