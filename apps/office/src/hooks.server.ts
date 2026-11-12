// Once, when the office server starts: the certificates this computer trusts
// (`trustSystemCertificates`), the office's own database if .env names
// no other (copied aside first on a new version's first start), the tables
// brought up to date, the update row reset, then the job clock, the follow-up
// watcher, one read of the New Altitude personas, and the office's address in
// the owner's Caddy if it uses theirs (never in the app, which has no address).
// In the app (ODDBORO_APP) it also quits when the app does: on SIGTERM, once
// the HTTP server has closed, and when the app's stdin pipe closes, which
// happens however the app ends, Force Quit included. On a Mac it keeps its
// secrets through the app's shell, over those same pipes (`useShellSecrets`).
// Every route and API request passes `guardOffice` first: the office's own
// names, and actions only from the owner's page (`#lib/server/owner-page.ts`).
// Files built into the page (scripts, styles, images) are served before it.
// Then Sentry's handle, which traces the request when the owner said yes to diagnostics.
import { sequence, type ServerInit } from '@sveltejs/kit/hooks';
import { handleErrorWithSentry, sentryHandle } from '@sentry/sveltekit';
import { LOCAL, whenOddLeaves } from '@oddboro/ledger';
import { trustSystemCertificates } from '@oddboro/ledger/certificates';
import { startLocalDatabase } from '@oddboro/ledger/local-db';
import { useShellSecrets } from '@oddboro/ledger/secrets';
import { bringUpToDate } from '@oddboro/ledger/upgrade';
import { keepAddress } from '#lib/server/address.ts';
import { startFollowUps } from '#lib/server/follow-ups.ts';
import { stopRuns } from '#lib/server/staff.ts';
import { startClock } from '#lib/server/jobs.ts';
import { guardOffice } from '#lib/server/owner-page.ts';
import { syncPersonas } from '#lib/server/persona.ts';
import { loadUpdate } from '#lib/server/update.ts';

// The guard first, so a refused request reaches neither Sentry nor a route.
// Kit 3 needs no fetch proxy script; saying so keeps the handle from
// importing `@sveltejs/kit` to find out.
export const handle = sequence(guardOffice, sentryHandle({ injectFetchProxyScript: false }));
export const handleError = handleErrorWithSentry();

// Before anything reaches out: New Altitude, a connector, a model, Sentry.
trustSystemCertificates();

if (process.env.ODDBORO_APP) {
  process.on('sveltekit:shutdown', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0)).resume();
}

export const init: ServerInit = async () => {
  // In the Mac app the shell keeps the secrets; this process alone asks it.
  await useShellSecrets();
  if (LOCAL) await startLocalDatabase();
  await bringUpToDate();
  // Before the clock: a poke that came due while the app updated still lands.
  await loadUpdate();
  startClock();
  startFollowUps();
  // An Odd that leaves the office stops what it is running at once.
  whenOddLeaves(stopRuns);
  // Never awaited: an office offline or signed out starts as fast as any.
  void syncPersonas().catch((e) => console.error('[persona] sync at start', e));
  void keepAddress();
};
