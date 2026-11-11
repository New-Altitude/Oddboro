import { json } from '@sveltejs/kit';
import { runtimeSummary } from '@oddboro/ledger';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async () => json(runtimeSummary());
