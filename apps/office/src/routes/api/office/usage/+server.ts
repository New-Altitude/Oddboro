// Every Odd's tokens over the last day and week, most first, for the Office
// panel's list of who uses the owner's plan most.
import { json } from '@sveltejs/kit';
import { officeUsage } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await officeUsage());
