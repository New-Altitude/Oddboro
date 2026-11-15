// One goal's page on the phone: why, done when, progress, the team, and its
// work as one conversation (`phoneGoal`). Read only.
import { error, json } from '@sveltejs/kit';
import { phoneGoal } from '#lib/server/phone-goals.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const id = Number(params.id);
  const g = Number.isInteger(id) ? await phoneGoal(id) : undefined;
  if (!g) error(404, 'No such goal');
  return json(g);
};
