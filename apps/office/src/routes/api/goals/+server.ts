// The owner's goals. GET lists every one, with who serves it, how it is going
// and its threads, and other work: threads for no goal still in flight. POST
// sets a new one, and the Office Manager starts planning it.
import { error, json } from '@sveltejs/kit';
import { addGoal, goalDraft, goalsWindow, GoalRequestConflict } from '@oddboro/ledger';
import { CHAT_ID } from '../../../lib/staff/chat-input.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await goalsWindow());

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== 'object') error(400, 'Say what the goal is');
  if (body.requestId !== undefined || body.managerId !== undefined) {
    if (
      typeof body.managerId !== 'string' ||
      typeof body.requestId !== 'string' ||
      !CHAT_ID.test(body.requestId)
    )
      error(400, 'Open the goal box in the manager chat again');
    if (typeof body.title !== 'string' || body.title.trim().length > 140)
      error(400, 'Use up to 140 characters for the goal');
    const d = goalDraft({ title: body.title });
    if (typeof d === 'string') error(400, d);
    try {
      return json(await addGoal(d, { managerId: body.managerId, requestId: body.requestId }));
    } catch (e) {
      if (e instanceof GoalRequestConflict) error(409, e.message);
      throw e;
    }
  }
  const d = goalDraft(body);
  if (typeof d === 'string') error(400, d);
  return json(await addGoal(d));
};
