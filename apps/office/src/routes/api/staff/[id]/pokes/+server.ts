// A staffer's pokes: GET the ones still to come, for its chat. POST marks the
// ones that landed as read, when the owner opens that chat.
import { error, json } from '@sveltejs/kit';
import { readPokes, staffer, waitingPokes } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!(await staffer(params.id))) error(404, 'No such Odd');
  return json(await waitingPokes(params.id));
};

export const POST: RequestHandler = async ({ params }) => {
  if (!(await staffer(params.id))) error(404, 'No such Odd');
  return json({ read: await readPokes(params.id) });
};
