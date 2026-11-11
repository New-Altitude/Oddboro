// The owner's Refresh: ask the service for its tools now and keep them
// (`refreshService`). Says what changed in a few words, or that nothing did.
import { error, json } from '@sveltejs/kit';
import { changesSaid } from '@oddboro/ledger';
import { refreshService } from '#lib/server/access.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
  try {
    return json({ said: changesSaid(await refreshService(params.id)) });
  } catch (e) {
    error(502, `Could not reach it: ${e instanceof Error ? e.message : String(e)}`);
  }
};
