// How the office is doing, for a test or a bug report: its version and pid,
// how long each startup step took, how many pages hold the live line, and how
// many errors pages have reported. A read, so any program on this computer
// may ask: it holds nothing private.
import { proof } from '../../../../scripts/service-identity.mjs';
import { json } from '@sveltejs/kit';
import { health } from '#lib/server/health.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
  const key = process.env.ODDBORO_SERVICE_KEY;
  const challenge = url.searchParams.get('challenge');
  return json(
    {
      ...health(),
      ...(key && challenge && /^[0-9a-f]{64}$/.test(challenge)
        ? { proof: proof(key, challenge) }
        : {})
    },
    { headers: { 'cache-control': 'no-store' } }
  );
};
