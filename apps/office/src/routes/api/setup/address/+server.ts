// The office's address on this computer, https://local.oddboro.com. GET says how
// things stand. POST sets it up; POST { action: 'secure' } has this computer trust
// Caddy's certificate, with the owner's password. `?probe=1` is how the office
// tells its own answer from something else on port 80 or 443. The Mac app has
// no address: it opens the office in its own window and never touches Caddy,
// so there this route is not found and onboarding shows no address step.
import { error, json } from '@sveltejs/kit';
import { IN_APP } from '@oddboro/ledger';
import { address, secureAddress, setUpAddress } from '#lib/server/address.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  if (IN_APP) error(404, 'The app has no web address');
  if (url.searchParams.has('probe')) return json({ office: true });
  return json(await address());
};

export const POST: RequestHandler = async ({ request }) => {
  if (IN_APP) error(404, 'The app has no web address');
  const b = (await request.json().catch(() => ({}))) as { action?: unknown };
  try {
    return json(b.action === 'secure' ? await secureAddress() : await setUpAddress());
  } catch (e) {
    error(502, e instanceof Error ? e.message : String(e));
  }
};
