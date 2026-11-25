// Everything an Odd put in front of the owner, for its Items tab: open and
// closed, or with ?deleted the ones the owner deleted, which can be restored.
import { error, json } from '@sveltejs/kit';
import { deliveries, staffer } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
  if (!/^[a-z0-9-]+$/.test(params.id) || !(await staffer(params.id))) error(404, 'No such Odd');
  return json({ items: await deliveries(params.id, 500, url.searchParams.has('deleted')) });
};
