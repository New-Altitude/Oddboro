// Reads every .px file and the palette from disk. Used by the compiler and by
// the room renderer in @oddboro/world, so both see the same sprites.
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parsePx, PxError, type Palette, type SpriteDef } from './px.ts';

export const SPRITES_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SRC = join(SPRITES_ROOT, 'src');
export const DIST = join(SPRITES_ROOT, 'dist');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.px') ? [p] : [];
  });
}

/**
 * The base palette plus any extension files in src/palettes/. Extensions let
 * several artists add colours at once without editing one file; a key defined
 * twice is an error.
 */
export function loadPalette(): Palette {
  const base = JSON.parse(readFileSync(join(SRC, 'palette.json'), 'utf8')) as Palette;
  const dir = join(SRC, 'palettes');
  if (!existsSync(dir)) return base;
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const ext = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Palette;
    for (const [key, color] of Object.entries(ext.colors)) {
      if (base.colors[key])
        throw new PxError(`src/palettes/${file}: key "${key}" is already in the palette`);
      base.colors[key] = color;
    }
  }
  return base;
}

export type Loaded = { palette: Palette; sprites: Map<string, SpriteDef>; errors: string[] };

/** Parse everything. Errors are collected, not thrown, so one bad file does not hide the rest. */
export function loadSprites(): Loaded {
  const palette = loadPalette();
  const sprites = new Map<string, SpriteDef>();
  const errors: string[] = [];
  for (const file of walk(SRC).sort()) {
    const rel = relative(SPRITES_ROOT, file);
    try {
      const def = parsePx(readFileSync(file, 'utf8'), rel, palette);
      const prior = sprites.get(def.name);
      if (prior) errors.push(`${rel}: sprite "${def.name}" is also defined in ${prior.file}`);
      else sprites.set(def.name, def);
    } catch (e) {
      if (e instanceof PxError) errors.push(e.message);
      else throw e;
    }
  }
  return { palette, sprites, errors };
}
