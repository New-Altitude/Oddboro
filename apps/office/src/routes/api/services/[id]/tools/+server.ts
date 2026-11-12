// The owner's Refresh, and their opening a service's actions on the Settings
// tab: ask the service for its tools now and keep them (`refreshService`).
// Says what changed in a few words, or that nothing did, and whether anything
// did, so opening the actions says nothing when all is as it was.
import { error, json } from '@sveltejs/kit';
import { changesSaid, toolsChanged } from '@oddboro/ledger';
import { refreshService } from '#lib/server/access.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
  try {
    const ch = await refreshService(params.id);
    return json({ said: changesSaid(ch), changed: toolsChanged(ch) });
  } catch (e) {
    error(502, `Could not reach it: ${e instanceof Error ? e.message : String(e)}`);
  }
};
