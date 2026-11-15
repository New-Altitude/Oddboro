// The phone's Home: each Odd's next job and the goals with work handed on or
// back today (`phoneHome`). Read only; the phone reads it again on a change.
import { json } from '@sveltejs/kit';
import { phoneHome } from '#lib/server/phone-home.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await phoneHome());
