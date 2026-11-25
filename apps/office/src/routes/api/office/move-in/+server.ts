// Move into a drawn office, from the spec and art the page was shown. It saves
// over the layout the owner is in. `new: true` adds another layout instead, and
// `layout` names the one to save over.
import { error, json } from '@sveltejs/kit';
import type { DrawnArt } from '@oddboro/sprites/art';
import type { OfficeSpec } from '@oddboro/world';
import { moveInto } from '#lib/server/move-in.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as {
    spec?: OfficeSpec;
    description?: unknown;
    art?: unknown;
    layout?: unknown;
    new?: unknown;
  };
  if (!b.spec) error(400, 'Draw an office first');
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  const art = Array.isArray(b.art) ? (b.art as DrawnArt[]) : [];
  const into =
    b.new === true ? 'new' : Number.isInteger(b.layout) ? (b.layout as number) : undefined;
  try {
    return json(await moveInto(b.spec, art, description, into));
  } catch (e) {
    error(400, e instanceof Error ? e.message : String(e));
  }
};
