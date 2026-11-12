// The New Altitude personas this owner is offered, read fresh from New
// Altitude on each GET, which also brings each persona Odd up to date. That
// read writes to the ledger and calls New Altitude, so, unlike other reads, a
// browser that says it comes from another site is refused, as `guardOffice`
// refuses its actions. A client that says nothing passes, as for any read.
import { error, json } from '@sveltejs/kit';
import { NOT_THE_OWNER_TEXT } from '@oddboro/ledger/owner-key';
import { fromOwnerPage } from '#lib/server/owner-page.ts';
import { syncPersonas } from '#lib/server/persona.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  if (request.headers.has('sec-fetch-site') && !fromOwnerPage(request))
    error(403, NOT_THE_OWNER_TEXT);
  return json(await syncPersonas());
};
