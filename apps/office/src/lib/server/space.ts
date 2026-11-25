// Builds the office the page shows: the layout the owner moved into, or the
// sample Main Street plan until they have one, composed against the compiled sprite
// catalog and the art the office drew for itself. Read fresh on each request,
// so a sprite or room edit shows up on reload without restarting the server.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeOffice, drawnArt, layoutKey } from '@oddboro/ledger';
import { artCatalog, artSheet, checkArt, type DrawnArt } from '@oddboro/sprites/art';
import { DIST } from '@oddboro/sprites/load';
import type { Palette, SpriteDef } from '@oddboro/sprites/px';
import { composeWorld, lotOf, type SpriteCatalog, type World } from '@oddboro/world';
import { loadSpaces } from '@oddboro/world/load';

/** `id` keys the room names the owner gives: `main-street` for the sample, `office-<n>` for a layout. */
export type Office = {
  id: string;
  name: string;
  world: World;
  catalog: SpriteCatalog;
  /** The office's drawn art, for the floor to load beside the atlas. */
  art?: ArtSheetJson;
};

/** A sheet of drawn art as the page loads it: the PNG as a data URL, and each frame's box. */
export type ArtSheetJson = {
  png: string;
  frames: Record<string, [number, number, number, number]>;
};

export const SAMPLE = 'main-street';

type Meta = { palette: Palette; sprites: SpriteCatalog };
const meta = (): Meta => JSON.parse(readFileSync(join(DIST, 'meta.json'), 'utf8')) as Meta;

/** The compiled library, without anything drawn. */
export function spriteCatalog(): SpriteCatalog {
  return meta().sprites;
}

/** The one palette every sprite, drawn or not, takes its colours from. */
export function housePalette(): Palette {
  return meta().palette;
}

/**
 * Drawn art checked and turned into sprites. `taken` says which names are
 * spoken for already; a piece that fails is left out, with its reason logged.
 */
export function artSprites(
  list: DrawnArt[],
  taken: (sprite: string) => boolean,
  palette = housePalette()
): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (const a of list) {
    const r = checkArt(a, palette, (n) => taken(n) || out.some((d) => d.name === n));
    if (r.problems.length) console.error(`[art] ${r.problems.join('; ')}`);
    out.push(...r.sprites);
  }
  return out;
}

export function sheetJson(sprites: SpriteDef[], palette = housePalette()): ArtSheetJson {
  const { png, frames } = artSheet(sprites, palette);
  return { png: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, frames };
}

let cached:
  { key: string; art: DrawnArt[]; sprites: SpriteDef[]; sheet?: ArtSheetJson } | undefined;

/** The library the office builds from: the compiled sprites and everything it drew. */
export async function officeLibrary(): Promise<{
  catalog: SpriteCatalog;
  art: DrawnArt[];
  sheet?: ArtSheetJson;
}> {
  const { palette, sprites: built } = meta();
  const art = await drawnArt();
  const key = art.map((a) => a.name).join(',');
  if (cached?.key !== key) {
    const sprites = artSprites(art, (n) => n in built, palette);
    cached = { key, art, sprites, sheet: sprites.length ? sheetJson(sprites, palette) : undefined };
  }
  return {
    catalog: { ...built, ...artCatalog(cached.sprites, palette) },
    art: cached.art,
    sheet: cached.sheet
  };
}

/** The office the owner is in. Before they have one, `lot` gives the empty site instead. */
export async function currentOffice(opts: { lot?: boolean } = {}): Promise<Office> {
  const { catalog, sheet } = await officeLibrary();
  const active = await activeOffice();
  if (active)
    return {
      id: layoutKey(active.id),
      name: active.name,
      world: composeWorld(active.plan, active.templates, catalog, { actors: false }),
      catalog,
      art: sheet
    };
  const { rooms, plans } = loadSpaces();
  const plan = plans[SAMPLE];
  const site = opts.lot ? lotOf(plan, rooms) : { plan, templates: rooms };
  return {
    id: SAMPLE,
    name: plan.name,
    world: composeWorld(site.plan, site.templates, catalog, { actors: false }),
    catalog
  };
}

export function atlasFile(name: 'atlas.png' | 'atlas.json'): Buffer {
  return readFileSync(join(DIST, name));
}
