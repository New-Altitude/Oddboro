import { error, json } from '@sveltejs/kit';
import { ask } from '@oddboro/ledger';
import { hasPersonaHint } from '#lib/proposal-persona.ts';
import { proposalLook } from '#lib/server/proposal-look.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const a = await ask(Number(params.id));
  if (a?.kind !== 'hire' || a.status !== 'open' || !a.hire) error(404, 'No open hire proposal');
  return json(hasPersonaHint(a.hire) ? await proposalLook(a.hire) : null);
};
