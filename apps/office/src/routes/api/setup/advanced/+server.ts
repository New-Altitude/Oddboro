// Advanced mode, from Setup: on only after the owner's yes to its warning, and
// a ledger line each way. Turning it off detaches every open project view.
import { error, json } from '@sveltejs/kit';
import { advancedMode, setAdvancedMode } from '@oddboro/ledger';
import { detachProjectViews } from '#lib/server/project-sessions/controller.ts';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { on?: unknown };
  if (typeof b.on !== 'boolean') error(400, 'Say on or off');
  try {
    await setAdvancedMode(b.on);
  } catch (e) {
    error(409, e instanceof Error ? e.message : 'Advanced mode did not change.');
  }
  if (!b.on) detachProjectViews();
  return json({ on: await advancedMode() });
};
