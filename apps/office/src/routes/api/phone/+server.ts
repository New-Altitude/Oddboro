// The phone desk in Setup (`#lib/server/tailscale.ts`). GET says whether this
// computer has Tailscale, its name there, whether `tailscale serve` points
// that name at the phone's door, and whether the door answers it. POST lists
// the name in ODDBORO_EXTRA_HOSTS, the owner's one click.
import { json } from '@sveltejs/kit';
import { allowPhoneDesk, phoneDesk } from '#lib/server/tailscale.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await phoneDesk());

export const POST: RequestHandler = async () => json(await allowPhoneDesk());
