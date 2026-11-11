import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { cancelPersonaRequest, personaRequestsFrom, personaRevisionsFor } from '@oddboro/ledger';
import { approvePersonaRequest } from '#lib/server/persona.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const revisions = url.searchParams.get('revisions');
  if (revisions) return json(await personaRevisionsFor(revisions));
  return json(await personaRequestsFrom(url.searchParams.get('from') ?? undefined));
};
const choice = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('map'),
    id: z.string().min(1),
    slug: z.string().min(1),
    staffId: z.string().nullable(),
    supersededTasks: z.array(z.number().int().positive()).max(30)
  }),
  z.object({ op: z.literal('cancel'), id: z.string().min(1) })
]);
export const POST: RequestHandler = async ({ request }) => {
  const parsed = choice.safeParse(await request.json());
  if (!parsed.success) error(400, 'Choose a persona connection or cancel this request.');
  const a = parsed.data;
  try {
    if (a.op === 'cancel') await cancelPersonaRequest(a.id);
    else await approvePersonaRequest(a.id, a.slug, a.staffId, a.supersededTasks);
  } catch (e) {
    error(409, e instanceof Error ? e.message : 'This connection could not be saved.');
  }
  return json({ ok: true });
};
