import { error, json } from '@sveltejs/kit';
import { changePublications, publicationSetting } from '#lib/server/persona-publications.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) =>
  json(await publicationSetting(params.slug));
export const PUT: RequestHandler = async ({ params, request }) => {
  const mode = (await request.json().catch(() => null))?.mode;
  if (mode !== 'off' && mode !== 'chat' && mode !== 'desktop')
    error(400, 'Choose how to receive publication updates.');
  try {
    return json(await changePublications(params.slug, mode));
  } catch (e) {
    error(
      409,
      e instanceof Error && !(e instanceof TypeError) && !('issues' in e)
        ? e.message
        : 'Publication updates could not be changed. Try again.'
    );
  }
};
