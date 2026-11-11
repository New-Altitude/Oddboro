// Generated looks. A look is a body, a hairstyle, a top, a bottom and a
// colour for each role. This builds that person's 57 frames from parts and
// paints them in the look's own colours, on the server, without the atlas.
// Parts live in ../looks/, keyed by region with their own palette, so the full
// shared palette never limits a look. The format is in ../FORMAT.md.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPRITES_ROOT } from './load.ts';
import { createImage, encodePng, type Image } from './png.ts';
import { hexToRgba, parsePx, PxError, type Palette, type SpriteDef } from './px.ts';

export const LOOKS_ROOT = join(SPRITES_ROOT, 'looks');
const FRAME_W = 16;
const FRAME_H = 32;
export const PORTRAIT = 48;

export type PartKind = 'hair' | 'top' | 'bottom' | 'face';
export const PART_KINDS: PartKind[] = ['hair', 'top', 'bottom', 'face'];
/** Kinds a look may leave out: with no face, the body's own face shows. */
const OPTIONAL: PartKind[] = ['face'];
type Dir = 'down' | 'up' | 'side';
const DIRS: Dir[] = ['down', 'up', 'side'];

/** Rules a part may carry in its `tag` line, after its kind. */
export const RULES: Record<PartKind, Record<string, string>> = {
  hair: {},
  top: {
    'sleeves-short': 'the lower sleeve is bare arm',
    'sleeves-none': 'the whole sleeve is bare arm',
    'torso-second': 'the torso takes the second colour (a jacket); draw the shirt under it in z',
    'sleeves-second': 'the sleeves take the second colour',
    'bottom-top': 'the bottom takes the top colour (a dress)',
    'bottom-second': 'the bottom takes the second colour (overalls)'
  },
  bottom: {
    'body-skirt': 'a skirt over bare legs instead of trousers',
    'legs-shorts': 'the lower leg is bare'
  },
  face: {}
};

/** Keys a part of each kind may draw with, besides `.` (keep what is under it). */
export const PART_KEYS: Record<PartKind, string> = {
  hair: 'nNik K[',
  top: 'zZ+oO0aAkKfFE^&%-',
  bottom: '^&%zZoOaAkK3W-',
  // The face's shape and features: outline, skin, the beard's region, blush,
  // lips, eyes and brows in the hair's shade.
  face: 'kfFEGxbcpP=!i'
};

export type Swatch = {
  name: string;
  light: string;
  body: string;
  shade: string;
  deep?: string;
  /** Skin only: the lips and their shade, and the cheeks' blush, in this skin tone. */
  lip?: string;
  lipShade?: string;
  blush?: string;
};
export type Colours = Record<'hair' | 'skin' | 'cloth' | 'shoes' | 'glasses', Swatch[]>;

export type LookSpec = {
  hair: string;
  top: string;
  bottom: string;
  /** A face shape from the library, or none for the body's own face. */
  face?: string;
  colours: {
    hair: string;
    skin: string;
    top: string;
    /** The top's second colour: a jacket, a bib. */
    second?: string;
    accent?: string;
    bottom: string;
    shoes: string;
    /** A hair swatch for the beard when it differs from the hair, like a grey beard under dark hair. */
    beard?: string;
  };
  /** A glasses swatch name, or none. */
  glasses?: string;
  beard?: boolean;
};

export type Part = { kind: PartKind; name: string; rules: string[]; def: SpriteDef; px: string };
export type DrawnPart = { kind: PartKind; name: string; px: string };

export type Library = {
  palette: Palette;
  colours: Colours;
  anchors: Record<string, { dir: Dir; head: [number, number]; torso: [number, number] }>;
  bodies: Record<'trousers' | 'skirt', SpriteDef>;
  parts: Map<string, Part>;
  /** The first torso row on each facing's idle frame. */
  torsoTop: Record<Dir, number>;
};

const key = (kind: PartKind, name: string) => `${kind}:${name}`;
const readJson = <T>(file: string) => JSON.parse(readFileSync(join(LOOKS_ROOT, file), 'utf8')) as T;

/** Parse and check one part. Throws a PxError that says what is wrong. */
export function parsePart(px: string, palette: Palette, file = 'drawn part'): Part {
  const def = parsePx(px, file, palette);
  const [kind, ...rules] = def.tags as [PartKind, ...string[]];
  if (!PART_KINDS.includes(kind))
    throw new PxError(`${file}: the first tag is the kind: ${PART_KINDS.join(', ')}`);
  const prefix = `${kind}-`;
  if (!def.name.startsWith(prefix)) throw new PxError(`${file}: name it ${prefix}<name>`);
  if (def.width !== FRAME_W || def.height !== FRAME_H)
    throw new PxError(`${file}: a part is size ${FRAME_W} ${FRAME_H}`);
  for (const r of rules)
    if (!RULES[kind][r])
      throw new PxError(
        `${file}: no rule "${r}" for a ${kind}. Rules: ${Object.keys(RULES[kind]).join(', ') || 'none'}`
      );
  for (const d of DIRS) {
    const f = def.frames.find((x) => x.name === d);
    if (!f) throw new PxError(`${file}: needs frames down, up and side`);
    for (const row of f.rows)
      for (const ch of row)
        if (ch !== '.' && !PART_KEYS[kind].includes(ch))
          throw new PxError(
            `${file}: frame ${d} uses "${ch}". A ${kind} draws only with ${PART_KEYS[kind].replace(' ', '')}`
          );
  }
  if (
    kind === 'hair' &&
    !def.frames.some((f) => f.rows.some((r) => /[^.]/.test(r))) &&
    def.name !== 'hair-bald'
  )
    throw new PxError(`${file}: the hairstyle is empty`);
  return { kind, name: def.name.slice(prefix.length), rules, def, px };
}

/** Everything a look is built from: built-in parts, plus any drawn ones. */
export function loadLibrary(drawn: DrawnPart[] = []): Library {
  const palette = readJson<Palette>('palette.json');
  const body = (name: string) =>
    parsePx(readFileSync(join(LOOKS_ROOT, 'bodies', `${name}.px`), 'utf8'), `${name}.px`, palette);
  const bodies = { trousers: body('trousers'), skirt: body('skirt') };
  const parts = new Map<string, Part>();
  for (const dir of ['hair', 'tops', 'bottoms', 'faces']) {
    let files: string[] = [];
    try {
      files = readdirSync(join(LOOKS_ROOT, dir)).filter((f) => f.endsWith('.px'));
    } catch {
      continue;
    }
    for (const f of files) {
      const part = parsePart(
        readFileSync(join(LOOKS_ROOT, dir, f), 'utf8'),
        palette,
        `${dir}/${f}`
      );
      parts.set(key(part.kind, part.name), part);
    }
  }
  for (const d of drawn) {
    const part = parsePart(d.px, palette, `${d.kind} ${d.name}`);
    parts.set(key(part.kind, part.name), part);
  }
  const torsoTop = Object.fromEntries(
    DIRS.map((d) => {
      const f = bodies.trousers.frames.find((x) => x.name === `idle-${d}-0`)!;
      let top = 0;
      const head = f.rows.findLastIndex((r) => /[hH]/.test(r));
      for (let y = head + 1; y < FRAME_H; y++)
        if (/[zZ]/.test(f.rows[y][7] + f.rows[y][8])) {
          top = y;
          break;
        }
      return [d, top];
    })
  ) as Record<Dir, number>;
  return {
    palette,
    colours: readJson<Colours>('colours.json'),
    anchors: readJson('anchors.json'),
    bodies,
    parts,
    torsoTop
  };
}

export function partNames(lib: Library, kind: PartKind): string[] {
  return [...lib.parts.values()].filter((p) => p.kind === kind).map((p) => p.name);
}

const swatch = (lib: Library, group: keyof Colours, name: string | undefined) =>
  name === undefined ? undefined : lib.colours[group].find((s) => s.name === name);

/** What is wrong with a spec, in words, or nothing. */
export function checkSpec(lib: Library, spec: LookSpec): string[] {
  const problems: string[] = [];
  for (const kind of PART_KINDS)
    if (spec[kind] === undefined && OPTIONAL.includes(kind)) continue;
    else if (!lib.parts.has(key(kind, spec[kind] ?? '')))
      problems.push(
        `no ${kind} named "${spec[kind]}". Pick from: ${partNames(lib, kind).join(', ')}`
      );
  const c = spec.colours ?? ({} as LookSpec['colours']);
  const need: [keyof LookSpec['colours'], keyof Colours, boolean][] = [
    ['hair', 'hair', true],
    ['skin', 'skin', true],
    ['top', 'cloth', true],
    ['bottom', 'cloth', true],
    ['shoes', 'shoes', true],
    ['second', 'cloth', false],
    ['accent', 'cloth', false],
    ['beard', 'hair', false]
  ];
  for (const [role, group, required] of need) {
    const name = c[role];
    if (name === undefined) {
      if (required) problems.push(`colours.${role} is missing`);
    } else if (!swatch(lib, group, name))
      problems.push(`no ${group} colour named "${name}" for ${role}`);
  }
  if (spec.glasses !== undefined && !swatch(lib, 'glasses', spec.glasses))
    problems.push(`no glasses colour named "${spec.glasses}"`);
  return problems;
}

/** The same spec always gives the same signature: two staff may not share one. */
export function lookSignature(spec: LookSpec): string {
  const c = spec.colours;
  return [
    spec.hair,
    spec.top,
    spec.bottom,
    spec.face ?? '',
    c.hair,
    c.skin,
    c.top,
    c.second ?? '',
    c.accent ?? '',
    c.bottom,
    c.shoes,
    spec.glasses ?? '',
    spec.beard ? 'beard' : '',
    c.beard ?? ''
  ].join('|');
}

/** The look's palette: every region and role key mapped to this person's colours. */
export function lookPalette(lib: Library, spec: LookSpec): Palette {
  const top = lib.parts.get(key('top', spec.top))!;
  const bottom = lib.parts.get(key('bottom', spec.bottom))!;
  const rule = (r: string) => top.rules.includes(r) || bottom.rules.includes(r);
  const sw = (group: keyof Colours, name?: string) => swatch(lib, group, name);
  const hair = sw('hair', spec.colours.hair)!;
  const skin = sw('skin', spec.colours.skin)!;
  const main = sw('cloth', spec.colours.top)!;
  const second = sw('cloth', spec.colours.second) ?? main;
  const accent = sw('cloth', spec.colours.accent) ?? second;
  const bottomColour = rule('bottom-top')
    ? main
    : rule('bottom-second')
      ? second
      : sw('cloth', spec.colours.bottom)!;
  const shoes = sw('shoes', spec.colours.shoes)!;
  const glasses = sw('glasses', spec.glasses);
  const beard = sw('hair', spec.colours.beard) ?? hair;
  const bareLower = rule('sleeves-short') || rule('sleeves-none');
  const bareUpper = rule('sleeves-none');
  const map: Record<string, string> = {
    N: hair.light,
    n: hair.body,
    i: hair.shade,
    E: skin.light,
    f: skin.body,
    F: skin.shade,
    G: skin.deep ?? skin.shade,
    h: skin.body,
    H: skin.light,
    X: glasses ? glasses.body : skin.body,
    // Without a beard its region is plain skin: in shade it read as stubble.
    x: spec.beard ? beard.shade : skin.body,
    b: spec.beard ? beard.body : skin.body,
    p: skin.lip ?? skin.shade,
    P: skin.lipShade ?? skin.deep ?? skin.shade,
    c: skin.blush ?? skin.body,
    '[': accent.body,
    '+': main.light,
    // z is always the shirt: a jacket's torso is rewritten to o before
    // the details go on, so a detail can draw the shirt under it in z.
    z: main.body,
    Z: main.shade,
    u: bareUpper ? skin.body : main.body,
    U: bareUpper ? skin.shade : main.shade,
    l: bareLower ? skin.body : main.body,
    L: bareLower ? skin.shade : main.shade,
    '0': second.light,
    o: second.body,
    O: second.shade,
    a: accent.body,
    A: accent.shade,
    '%': bottomColour.light,
    '^': bottomColour.body,
    '&': bottomColour.shade,
    j: rule('legs-shorts') ? skin.body : bottomColour.body,
    J: rule('legs-shorts') ? skin.shade : bottomColour.shade,
    W: shoes.light,
    '3': shoes.body
  };
  const colors = Object.fromEntries(
    Object.entries(lib.palette.colors).map(([k, c]) => [k, { ...c, hex: map[k] ?? c.hex }])
  );
  return { name: 'look', colors };
}

const CLOTHING = 'zZuUlL^&jJ+oO0aA%';

/** Paint a part's facing frame over a body frame, shifted by the anchor. */
function overlay(
  rows: string[][],
  part: Part,
  dir: Dir,
  [dx, dy]: [number, number],
  may: (base: string, x: number, y: number) => boolean
) {
  const f = part.def.frames.find((x) => x.name === dir)!;
  f.rows.forEach((row, py) =>
    [...row].forEach((ch, px) => {
      if (ch === '.') return;
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) return;
      if (may(rows[y][x], x, y)) rows[y][x] = ch;
    })
  );
}

/** One frame of the look, as palette keys. */
export function composeFrame(lib: Library, spec: LookSpec, frame: string): string[] {
  const bottom = lib.parts.get(key('bottom', spec.bottom))!;
  const top = lib.parts.get(key('top', spec.top))!;
  const hair = lib.parts.get(key('hair', spec.hair))!;
  const face = spec.face === undefined ? undefined : lib.parts.get(key('face', spec.face));
  const skirt = bottom.rules.includes('body-skirt') || top.rules.includes('bottom-top');
  const body = skirt ? lib.bodies.skirt : lib.bodies.trousers;
  const src = body.frames.find((f) => f.name === frame);
  if (!src) throw new PxError(`no body frame ${frame}`);
  const rows = src.rows.map((r) => [...r]);
  // A jacket: the torso, and the sleeves where they are not bare, take the
  // second colour.
  const rule = (r: string) => top.rules.includes(r);
  const bareLower = rule('sleeves-short') || rule('sleeves-none');
  const swap: Record<string, string> = {};
  if (rule('torso-second')) Object.assign(swap, { z: 'o', Z: 'O' });
  if (rule('sleeves-second')) {
    if (!rule('sleeves-none')) Object.assign(swap, { u: 'o', U: 'O' });
    if (!bareLower) Object.assign(swap, { l: 'o', L: 'O' });
  }
  for (const row of rows) row.forEach((c, x) => (row[x] = swap[c] ?? c));
  const a = lib.anchors[frame];
  const torsoTop = lib.torsoTop[a.dir] + a.torso[1];
  // Clothing paints over clothing, outlines inside the body, and the neck,
  // never hands, faces or what a hand holds.
  const clothes = (base: string, _x: number, y: number) =>
    CLOTHING.includes(base) ||
    (base === 'k' && y >= torsoTop - 1) ||
    ('fF'.includes(base) && y >= torsoTop - 2 && y <= torsoTop) ||
    (base === '.' && y >= torsoTop - 3);
  overlay(rows, bottom, a.dir, a.torso, clothes);
  overlay(rows, top, a.dir, a.torso, clothes);
  // A face reshapes the head above the neck, under the hair.
  if (face) overlay(rows, face, a.dir, a.head, (_base, _x, y) => y < torsoTop - 1);
  // Hair paints over the skull and empty space, and over the clothes and
  // outlines below the shoulders (long hair), never a face or a raised hand.
  // Seen from behind there is no face to keep clear: long hair covers the
  // ears and the nape too.
  // From the front, it may also cover the head's outer outline beside the face.
  // From the side, the front edge is the face: only the back edge counts.
  const edge = (x: number) => x - a.head[0] <= 3 || (a.dir !== 'side' && x - a.head[0] >= 12);
  const hairMay = (base: string, x: number, y: number) =>
    '.hHq'.includes(base) ||
    (a.dir === 'up' && y < torsoTop) ||
    (base === 'k' && y < torsoTop - 1 && edge(x)) ||
    (y >= torsoTop && (CLOTHING.includes(base) || base === 'k'));
  overlay(rows, hair, a.dir, a.head, hairMay);
  return rows.map((r) => r.join(''));
}

function paint(rows: string[], palette: Palette, w: number, h: number): Image {
  const img = createImage(w, h);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const c = palette.colors[ch];
      if (c) img.data.set(hexToRgba(c.hex), (y * w + x) * 4);
    })
  );
  return img;
}

export type LookSheet = {
  png: Uint8Array;
  width: number;
  height: number;
  /** Frame name to its x in the strip. Every frame is 16 by 32. */
  frames: Record<string, number>;
};

/** One frame of the look as an image, for previews. */
export function lookFrame(lib: Library, spec: LookSpec, frame: string): Image {
  return paint(composeFrame(lib, spec, frame), lookPalette(lib, spec), FRAME_W, FRAME_H);
}

/** All 57 frames in one strip, in the body's frame order. */
export function renderLook(lib: Library, spec: LookSpec): LookSheet {
  const problems = checkSpec(lib, spec);
  if (problems.length) throw new PxError(problems.join('; '));
  const palette = lookPalette(lib, spec);
  const names = lib.bodies.trousers.frames.map((f) => f.name);
  const strip = createImage(FRAME_W * names.length, FRAME_H);
  const frames: Record<string, number> = {};
  names.forEach((name, i) => {
    const img = paint(composeFrame(lib, spec, name), palette, FRAME_W, FRAME_H);
    for (let y = 0; y < FRAME_H; y++)
      strip.data.set(
        img.data.subarray(y * FRAME_W * 4, (y + 1) * FRAME_W * 4),
        (y * strip.width + i * FRAME_W) * 4
      );
    frames[name] = i * FRAME_W;
  });
  return { png: encodePng(strip), width: strip.width, height: FRAME_H, frames };
}

/** Check a drawn portrait: 48 by 48, frame default, only the looks palette. */
export function parsePortrait(lib: Library, px: string): SpriteDef {
  const def = parsePx(px, 'portrait', lib.palette);
  if (def.width !== PORTRAIT || def.height !== PORTRAIT)
    throw new PxError(`a portrait is size ${PORTRAIT} ${PORTRAIT}`);
  if (!def.frames.some((f) => f.name === 'default'))
    throw new PxError('a portrait has frame default');
  return def;
}

/** A drawn portrait in the look's colours, as an image. */
export function portraitImage(lib: Library, spec: LookSpec, px: string): Image {
  const def = parsePortrait(lib, px);
  const f = def.frames.find((x) => x.name === 'default')!;
  return paint(f.rows, lookPalette(lib, spec), PORTRAIT, PORTRAIT);
}

export function renderPortrait(lib: Library, spec: LookSpec, px: string): Uint8Array {
  return encodePng(portraitImage(lib, spec, px));
}

/**
 * A portrait made from the look's own parts, for an Odd built without a
 * drawing: the head and shoulders facing front, three times larger, on the
 * portrait teal. The same .px as a drawn portrait, so it is kept and shown
 * the same way.
 */
export function partsPortrait(lib: Library, spec: LookSpec): string {
  const rows = composeFrame(lib, spec, 'idle-down-0');
  const side = PORTRAIT / FRAME_W;
  // From just above the hair, so a tall bun or afro keeps its top.
  const first = rows.findIndex((r) => /[^.]/.test(r));
  const top = Math.max(0, Math.min(first - 1, rows.length - FRAME_W));
  const grid = rows.slice(top, top + FRAME_W).flatMap((r) => {
    const line = [...r].map((c) => (c === '.' || c === '-' ? '6' : c).repeat(side)).join('');
    return Array<string>(side).fill(line);
  });
  return [
    '# Made from parts.',
    'sprite portrait-parts',
    `size ${PORTRAIT} ${PORTRAIT}`,
    'layer overlay',
    '',
    'frame default',
    ...grid
  ].join('\n');
}

/**
 * Check a drawn part is the part it says it is and composes on both bodies in
 * every frame. Throws if not. The library keys a stored part by the name in
 * its drawing, so a drawing that names another part would replace that one.
 */
export function checkPart(lib: Library, part: DrawnPart): Part {
  const p = parsePart(part.px, lib.palette, `${part.kind} ${part.name}`);
  if (p.kind !== part.kind) throw new PxError(`the part is tagged ${p.kind}, not ${part.kind}`);
  if (p.name !== part.name)
    throw new PxError(`the drawing is named ${p.kind}-${p.name}, not ${part.kind}-${part.name}`);
  const trial = loadLibraryWith(lib, p);
  const base: LookSpec = {
    hair: p.kind === 'hair' ? p.name : 'short-crop',
    top: p.kind === 'top' ? p.name : 'long-sleeve',
    bottom: p.kind === 'bottom' ? p.name : 'trousers',
    colours: {
      hair: trial.colours.hair[0].name,
      skin: trial.colours.skin[0].name,
      top: trial.colours.cloth[0].name,
      bottom: trial.colours.cloth[1].name,
      shoes: trial.colours.shoes[0].name
    }
  };
  for (const name of trial.bodies.trousers.frames.map((f) => f.name)) {
    composeFrame(trial, base, name);
    composeFrame(trial, { ...base, bottom: p.kind === 'bottom' ? p.name : 'skirt' }, name);
  }
  return p;
}

function loadLibraryWith(lib: Library, p: Part): Library {
  const parts = new Map(lib.parts);
  parts.set(key(p.kind, p.name), p);
  return { ...lib, parts };
}
