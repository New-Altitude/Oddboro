// The phone's Goals tab: each active goal with its lead, team, what waits on
// the owner and how far along it is (`phoneGoals`). Read only; the phone reads
// it again on a change.
import { json } from '@sveltejs/kit';
import { phoneGoals } from '#lib/server/phone-goals.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await phoneGoals());
