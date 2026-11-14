// A staffer's pokes: GET the ones still to come, for its chat. POST marks the
// ones that landed as read, when the owner opens that chat.
import { error, json } from '@sveltejs/kit';
import { readPokes, readPublications, staffer, waitingPokes } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!(await staffer(params.id))) error(404, 'No such Odd');
  return json(await waitingPokes(params.id));
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!(await staffer(params.id))) error(404, 'No such Odd');
  const id = (await request.json().catch(() => ({})))?.publication;
  if (id !== undefined) {
    if (!Number.isSafeInteger(id) || id < 1) error(400, 'Unknown publication.');
    await readPublications(params.id, [id]);
    return json({ ok: true });
  }
  return json({ read: await readPokes(params.id) });
};
