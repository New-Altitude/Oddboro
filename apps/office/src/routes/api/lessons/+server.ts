// Everything the office knows about the owner, for the Lessons window: every
// open lesson, for one Odd or every Odd, guesses waiting for the owner's Keep
// first, each with the name of the Odd that heard it and its uses per Odd and
// in all. The window filters and searches it on the page.
import { json } from '@sveltejs/kit';
import { libraryLessons, roster } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const names = new Map((await roster()).map((s) => [s.id, s.name]));
  return json(
    (await libraryLessons()).map((l) => ({ ...l, heardByName: names.get(l.heardBy) ?? l.heardBy }))
  );
};
