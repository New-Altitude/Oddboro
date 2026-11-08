// Once, when the office server starts: the office's own database if .env names
// no other (copied aside first on a new version's first start), the tables
// brought up to date, the update row reset, then the job clock, the follow-up
// watcher, and the office's address in the owner's Caddy if it uses theirs
// (never in the app, which has no address). Each step's time goes to the log
// and to /api/health (`#lib/server/health.ts`).
// In the app (ODDBORO_APP) it also quits when the app does: on SIGTERM, once
// the HTTP server has closed, and when the app's stdin pipe closes, which
// happens however the app ends, Force Quit included. On a Mac it keeps its
// secrets through the app's shell, over those same pipes (`useShellSecrets`).
// Every route and API request passes `guardOffice` first: the office's own
// names, and actions only from the owner's page (`#lib/server/owner-page.ts`).
// Files built into the page (scripts, styles, images) are served before it.
import { release } from 'node:os';
import type { ServerInit } from '@sveltejs/kit/hooks';
import { LOCAL } from '@oddboro/ledger';
import { startLocalDatabase } from '@oddboro/ledger/local-db';
import { useShellSecrets } from '@oddboro/ledger/secrets';
import { bringUpToDate } from '@oddboro/ledger/upgrade';
import { keepAddress } from '#lib/server/address.ts';
import { startFollowUps } from '#lib/server/follow-ups.ts';
import { markReady, timed } from '#lib/server/health.ts';
import { startClock } from '#lib/server/jobs.ts';
import { loadUpdate, VERSION } from '#lib/server/update.ts';

export { guardOffice as handle } from '#lib/server/owner-page.ts';

if (process.env.ODDBORO_APP) {
  process.on('sveltekit:shutdown', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0)).resume();
}

export const init: ServerInit = async () => {
  console.log(
    `office: ${VERSION || 'development'} on ${process.platform} ${release()} ${process.arch}, Node ${process.version}`
  );
  // In the Mac app the shell keeps the secrets; this process alone asks it.
  await timed('secrets', useShellSecrets);
  if (LOCAL) await timed('database', startLocalDatabase);
  await timed('tables', bringUpToDate);
  // Before the clock: a poke that came due while the app updated still lands.
  await timed('update row', loadUpdate);
  startClock();
  startFollowUps();
  void keepAddress();
  markReady();
};
