// Undo the last change to the layout the owner is in: the version before comes
// back, and undoing again redoes the change. Odds whose room is gone move, as
// they do on any move in.
import { error, json } from '@sveltejs/kit';
import { moveIn, officeLayout, undoOffice } from '@oddboro/ledger';
import { composeWorld } from '@oddboro/world';
import { destination } from '#lib/server/office-design.ts';
import { currentOffice, officeLibrary } from '#lib/server/space.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
  const layout = await officeLayout(Number(params.id));
  if (!layout) error(404, 'No such layout');
  if (!layout.active) error(400, 'Move into this layout first');
  const from = (await currentOffice()).id;
  const now = await undoOffice(layout.id);
  if (!now) error(400, 'There is no change to undo');
  const { catalog } = await officeLibrary();
  const world = composeWorld(now.plan, now.templates, catalog, { actors: false });
  return json(
    await moveIn(
      from,
      destination(now.id, now.name, world, now.kinds),
      `Undid the last change to ${now.name}`
    )
  );
};
