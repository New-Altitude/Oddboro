// Everything an Odd has kept, for its Storage tab (`oddStorage`): its own
// folder, and under `work` its part of each thread it is on, by that thread's
// title. Files and folders with sizes and times, never the office's own files
// there, hidden ones or links. Read only when the tab opens.
import { error, json } from '@sveltejs/kit';
import { staffer } from '@oddboro/ledger';
import { oddStorage, STORAGE_CAP } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!/^[a-z0-9-]+$/.test(params.id) || !(await staffer(params.id))) error(404, 'No such Odd');
  return json({ ...(await oddStorage(params.id)), cap: STORAGE_CAP });
};
