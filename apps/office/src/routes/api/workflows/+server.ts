import { error, json } from '@sveltejs/kit';
import { saveWorkflow, StationProblem, workflowBoard } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await workflowBoard());

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (body?.id !== undefined && (!Number.isSafeInteger(body.id) || body.id < 1))
    error(400, 'Choose a saved workflow.');
  try {
    return json(await saveWorkflow(body?.name, body?.stations, body?.id));
  } catch (e) {
    if (e instanceof StationProblem) error(400, e.message);
    throw e;
  }
};
