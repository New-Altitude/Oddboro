import { error, json } from '@sveltejs/kit';
import { startWorkflow, StationProblem } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) error(400, 'Choose a saved workflow.');
  const body = await request.json().catch(() => null);
  try {
    await startWorkflow(id, body?.job, body?.requestId);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof StationProblem) error(400, e.message);
    throw e;
  }
};
