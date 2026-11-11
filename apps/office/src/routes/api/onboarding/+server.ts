// A new owner's first visit. GET lists the ready-made managers to pick from.
// POST is Go at the end of it: the office keeps the owner's time zone,
// finishes the welcome under their name, hires the Office Manager they picked
// (ready-made, or the one they described and the office drew), has the
// manager say hello in chat and ask for the owner's goals, adds each persona
// signed in to on the New Altitude card, and moves into the drawn office the
// moment the drawing is done.
import { error, json } from '@sveltejs/kit';
import {
  customHello,
  finishWelcome,
  hireManager,
  managerPortrait,
  MANAGERS
} from '@oddboro/ledger';
import { isZone, setZone } from '@oddboro/ledger/time';
import { writeEnv } from '@oddboro/ledger/env';
import { currentDesign, moveInWhenDone } from '#lib/server/design-job.ts';
import { drawnFrom, preview, problemsWith } from '#lib/server/looks.ts';
import { installGrantedPersonas } from '#lib/server/persona.ts';
import { sayInChat } from '#lib/server/staff.ts';
import { toProfile } from '#lib/server/profile.ts';
import type { RequestHandler } from './$types';

/** The four ready-made managers, each with a portrait and a walk to show on the lot. */
export const GET: RequestHandler = async () =>
  json(
    await Promise.all(
      MANAGERS.map(async (m) => {
        const px = m.look && managerPortrait(m.id);
        const art =
          m.look && px ? await preview({ look: m.look, portraitPx: px, newParts: [] }) : undefined;
        return {
          id: m.id,
          name: m.name,
          trait: m.trait,
          says: m.says,
          // Marshall's portrait is in the atlas; the others are drawn looks.
          frame: art ? undefined : `portrait-${m.id}/default`,
          portrait: art?.portrait
        };
      })
    )
  );

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 30) : '';
  if (!name) error(400, 'Say what your Odds should call you');
  const zone = typeof b.zone === 'string' ? b.zone : '';
  if (!isZone(zone)) error(400, 'Pick a time zone from the list');

  const m = (b.manager ?? {}) as Record<string, unknown>;
  let choice: Parameters<typeof hireManager>[0];
  if (typeof m.preset === 'string' && MANAGERS.some((p) => p.id === m.preset))
    choice = { preset: m.preset };
  else if (typeof m.name === 'string' && m.name.trim() && m.drawn) {
    const drawn = drawnFrom(m.drawn as Record<string, unknown>);
    if (!drawn) error(400, 'Draw the manager first');
    const problems = await problemsWith(drawn);
    if (problems.length) error(400, problems.join('; '));
    choice = {
      custom: {
        name: m.name.trim().slice(0, 40),
        description: typeof m.description === 'string' ? m.description.trim().slice(0, 1000) : '',
        ...drawn
      }
    };
  } else error(400, 'Pick an office manager');

  writeEnv({ OFFICE_TIME_ZONE: zone });
  process.env.OFFICE_TIME_ZONE = zone;
  setZone(zone);
  await finishWelcome(name);
  let row;
  try {
    row = await hireManager(choice);
  } catch (e) {
    error(400, e instanceof Error ? e.message : String(e));
  }
  const preset = 'preset' in choice ? MANAGERS.find((p) => p.id === choice.preset) : undefined;
  sayInChat(row.id, preset ? preset.hello(name) : customHello(row.name, name));
  // The welcome never fails for a persona: a problem is logged and told to the page.
  await installGrantedPersonas().catch((e) => console.error('[persona] after the welcome', e));
  const job = currentDesign();
  if (job) await moveInWhenDone(job);
  return json({ manager: toProfile(row) });
};
