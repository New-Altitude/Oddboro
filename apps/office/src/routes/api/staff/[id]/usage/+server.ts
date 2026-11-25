// A staffer's token use over the last day, week and month, its latest runs,
// and the owner's plan windows, which every staffer shares.
import { json } from '@sveltejs/kit';
import { plan, recentRuns, usageFor } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) =>
  json({ ...(await usageFor(params.id)), runs: await recentRuns(params.id), plan: await plan() });
