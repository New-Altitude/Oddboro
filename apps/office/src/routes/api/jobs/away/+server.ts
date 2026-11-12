// The desk's While you were away card: Dismiss takes every job off it. Run now
// on one job goes through that job's own route, which takes it off too.
import { json } from '@sveltejs/kit';
import { clearAway } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async () => {
  await clearAway();
  return json({ ok: true });
};
