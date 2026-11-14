import { error, json } from '@sveltejs/kit';
import { command } from '#lib/newsroom/edition.ts';
import { newsroomAction, newsroomView } from '#lib/server/newsroom.ts';
import type { RequestHandler } from './$types';
const view = async () => json(await newsroomView(), { headers: { 'cache-control': 'no-store' } });
export const GET: RequestHandler = view;
export const POST: RequestHandler = async ({ request }) => {
  const c = command.safeParse(await request.json().catch(() => null));
  if (!c.success) error(400, 'Choose a newsroom action.');
  try {
    await newsroomAction(c.data);
  } catch (e) {
    error(503, e instanceof Error ? e.message : 'The newsroom is unavailable.');
  }
  return view();
};
