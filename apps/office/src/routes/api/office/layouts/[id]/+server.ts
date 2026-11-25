// Move back into an earlier layout, as it was built, or into the sample office.
// DELETE removes a layout the owner is not in, and tells every open Office
// window, which reads its list again.
import { error, json } from '@sveltejs/kit';
import { activeOffice, moveIn, officeLayout, removeOffice } from '@oddboro/ledger';
import { composeWorld } from '@oddboro/world';
import { loadSpaces } from '@oddboro/world/load';
import { emit } from '#lib/server/events.ts';
import { destination } from '#lib/server/office-design.ts';
import { currentOffice, officeLibrary, SAMPLE } from '#lib/server/space.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
  const { catalog } = await officeLibrary();
  const from = (await currentOffice()).id;
  if (params.id === 'sample') {
    if (!(await activeOffice())) error(400, 'You are already in this one');
    const { rooms, plans } = loadSpaces();
    const plan = plans[SAMPLE];
    const world = composeWorld(plan, rooms, catalog, { actors: false });
    return json(await moveIn(from, destination(null, plan.name, world)));
  }
  const layout = await officeLayout(Number(params.id));
  if (!layout) error(404, 'No such layout');
  if (layout.active) error(400, 'You are already in this one');
  const world = composeWorld(layout.plan, layout.templates, catalog, { actors: false });
  return json(await moveIn(from, destination(layout.id, layout.name, world, layout.kinds)));
};

export const DELETE: RequestHandler = async ({ params }) => {
  const layout = await officeLayout(Number(params.id));
  if (!layout) error(404, 'No such layout');
  if (layout.active) error(400, 'You are in this one. Move to another layout first.');
  await removeOffice(layout.id);
  emit({ type: 'layouts' });
  return json({ ok: true });
};
