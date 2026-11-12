// The page's own news for the log: that it booted, and any error it hit. In
// the app nobody can open the page's console, so this is the only record of
// what went wrong in it. Each report becomes one `page:` line on stdout, which
// the app's shell writes to office.log (`pageReport`). An action, so only the
// owner's page reaches it (`guardOffice`).
import { error, json } from '@sveltejs/kit';
import { pageReport } from '#lib/server/health.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    message?: unknown;
    stack?: unknown;
  };
  if (b.kind !== 'boot' && b.kind !== 'error') error(400, 'Say boot or error');
  const message = typeof b.message === 'string' ? b.message : '';
  const stack = typeof b.stack === 'string' ? ` | ${b.stack}` : '';
  return json({ ok: true, ...pageReport(b.kind, `${message}${stack}`) });
};
