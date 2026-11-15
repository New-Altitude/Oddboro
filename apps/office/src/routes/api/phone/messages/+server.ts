// The phone's Messages: the last line of each Odd's chat (`lastLines`). Read
// only; the phone reads it again when Messages opens, on a change, and when a
// chat or a call on the phone ends.
import { json } from '@sveltejs/kit';
import { lastLines } from '#lib/server/phone-messages.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await lastLines());
