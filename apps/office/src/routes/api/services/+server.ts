// Every service in the office and the Odds that hold each, for the owner's Services section.
import { json } from '@sveltejs/kit';
import { services } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await services());
