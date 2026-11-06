// What an Odd has been taught, for its Lessons tab: its own and every Odd's,
// live or waiting for the owner's Keep, guesses first, each with the name of the
// Odd that heard it and how often it changed this Odd's work. A dropped guess is
// left out: it shows only in the chat, where it was kept.
import { error, json } from '@sveltejs/kit';
import { lessonsOf, openGuessesFirst, roster, staffer } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!(await staffer(params.id))) error(404, 'No such Odd');
  const names = new Map((await roster()).map((s) => [s.id, s.name]));
  const all = await lessonsOf(params.id);
  return json(
    openGuessesFirst(all).map((l) => ({ ...l, heardByName: names.get(l.heardBy) ?? l.heardBy }))
  );
};
