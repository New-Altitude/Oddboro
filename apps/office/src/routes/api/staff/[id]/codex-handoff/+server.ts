import { error, json } from '@sveltejs/kit';
import { acceptHandoff } from '#lib/server/codex-handoff.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => undefined);
  if (typeof body?.ticket !== 'string' || typeof body.revision !== 'string')
    error(400, 'Open the handoff link from Codex.');
  return json(await acceptHandoff(params.id, body.ticket, body.revision, body.goalId));
};
