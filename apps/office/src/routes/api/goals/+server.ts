// The owner's goals. GET lists every one, with who serves it, how it is going
// and its threads, and other work: threads for no goal still in flight. POST
// sets a new one, and the Office Manager starts planning it.
import { error, json } from '@sveltejs/kit';
import { addGoal, goalDraft, goalsWindow } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await goalsWindow());

export const POST: RequestHandler = async ({ request }) => {
  const d = goalDraft((await request.json().catch(() => ({}))) as Record<string, unknown>);
  if (typeof d === 'string') error(400, d);
  return json(await addGoal(d));
};
