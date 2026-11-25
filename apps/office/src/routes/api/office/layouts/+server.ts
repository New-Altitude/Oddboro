// Every office layout the owner has moved into, newest first, and the sample
// office every install starts in, which is where the owner is with no layout.
// `current` is the layout the owner is in, to change it with a note.
import { json } from '@sveltejs/kit';
import { activeOffice, officeLayouts } from '@oddboro/ledger';
import { loadSpaces } from '@oddboro/world/load';
import { SAMPLE } from '#lib/server/space.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const layouts = (await officeLayouts()).filter((l) => l.movedInAt);
  const active = await activeOffice();
  return json({
    layouts,
    current: active
      ? { id: active.id, spec: active.spec, description: active.description }
      : undefined,
    sample: { name: loadSpaces().plans[SAMPLE].name, active: !active }
  });
};
