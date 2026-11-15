// Every office layout the owner has moved into, newest first, and the sample
// office every install starts in, which is where the owner is with no layout.
// `current` is the spec of the layout the owner is in, to change it with a note.
import { json } from '@sveltejs/kit';
import { activeOffice, officeLayouts, roomNamesFor } from '@oddboro/ledger';
import { loadSpaces } from '@oddboro/world/load';
import { mainStreetSpec } from '#lib/server/main-street.ts';
import { SAMPLE } from '#lib/server/space.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const layouts = (await officeLayouts()).filter((l) => l.movedInAt);
  const active = await activeOffice();
  return json({
    layouts,
    current: active
      ? { spec: active.spec, description: active.description }
      : {
          spec: mainStreetSpec(await roomNamesFor(SAMPLE)),
          description: 'Start with the rooms, furniture and street in Main Street.'
        },
    sample: { name: loadSpaces().plans[SAMPLE].name, active: !active }
  });
};
