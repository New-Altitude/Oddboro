// Once, when the office server starts: the office's own database if .env names
// no other (copied aside first on a new version's first start), the tables
// brought up to date, the update row reset, then the job clock, the follow-up
// watcher, and the office's address in the owner's Caddy if it uses theirs
// (never in the app, which has no address).
// In the app (ODDBORO_APP) it also quits when the app does: on SIGTERM, once
// the HTTP server has closed, and when the app's stdin pipe closes, which
// happens however the app ends, Force Quit included. On a Mac it keeps its
// secrets through the app's shell, over those same pipes (`useShellSecrets`).
// Every route and API request passes `guardOffice` first: the office's own
// names, and actions only from the owner's page (`#lib/server/owner-page.ts`).
// Files built into the page (scripts, styles, images) are served before it.
import type { ServerInit } from '@sveltejs/kit/hooks';
import { LOCAL } from '@oddboro/ledger';
import { startLocalDatabase } from '@oddboro/ledger/local-db';
import { useShellSecrets } from '@oddboro/ledger/secrets';
import { bringUpToDate } from '@oddboro/ledger/upgrade';
import { keepAddress } from '#lib/server/address.ts';
import { startFollowUps } from '#lib/server/follow-ups.ts';
import { startClock } from '#lib/server/jobs.ts';
import { loadUpdate } from '#lib/server/update.ts';
import { initializeMagpie, shutdownMagpie } from '#lib/server/magpie.ts';

export { guardOffice as handle } from '#lib/server/owner-page.ts';

let closing: Promise<void> | undefined;
const closeOwnedRuntime = () => (closing ??= shutdownMagpie());
process.on('sveltekit:shutdown', () => {
  void closeOwnedRuntime().finally(() => {
    if (process.env.ODDBORO_APP) process.exit(0);
  });
});
if (process.env.ODDBORO_APP)
  process.stdin.on('close', () => void closeOwnedRuntime().finally(() => process.exit(0))).resume();

export const init: ServerInit = async () => {
  // In the Mac app the shell keeps the secrets; this process alone asks it.
  await useShellSecrets();
  if (LOCAL) await startLocalDatabase();
  await bringUpToDate();
  // Before the clock: a poke that came due while the app updated still lands.
  await loadUpdate();
  // Resume only the private runtime the owner selected, before any jobs start.
  await initializeMagpie();
  startClock();
  startFollowUps();
  void keepAddress();
};
