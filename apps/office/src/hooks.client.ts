// The page's error and trace reports. It always starts the SDK: it cannot
// know before its data arrives whether the office has an address, and the
// relay drops what it gets when it has none.
// The page also tells the office it booted, and logs every error it hits, to
// /api/client-log, which writes them to the app's log on this computer.
// Through api.ts like every write: a text/plain beacon would meet the
// release-only origin check (#25).
import * as Sentry from '@sentry/sveltekit';
import type { ClientInit, HandleClientError } from '@sveltejs/kit/hooks';
import { pageOptions } from '#lib/diagnostics.ts';
import { post } from '#lib/ui/api.ts';
import { pageAnswer } from '#lib/ui/diagnostics.svelte.ts';

Sentry.init(pageOptions(pageAnswer));

/** At most this many reports a page load, so a loop cannot flood the office. */
const MOST = 20;
let sent = 0;

function report(kind: 'boot' | 'error', message: string, stack?: string): void {
  if (++sent > MOST) return;
  post('/api/client-log', { kind, message, stack }, true).catch(() => {});
}

const describe = (e: unknown): { message: string; stack?: string } =>
  e instanceof Error
    ? { message: e.message, stack: e.stack }
    : typeof e === 'object' && e !== null && 'message' in e
      ? { message: String(e.message) }
      : { message: String(e) };

export const init: ClientInit = () => {
  report('boot', `${location.pathname} in ${navigator.userAgent}`);
  addEventListener('error', (e) => {
    const { message, stack } = describe(e.error ?? e.message);
    report('error', message, stack);
  });
  addEventListener('unhandledrejection', (e) => {
    const { message, stack } = describe(e.reason);
    report('error', message, stack);
  });
};

const logError: HandleClientError = ({ kind, error }) => {
  const { message, stack } = describe(error);
  report('error', `${kind}: ${message}`, stack);
};

export const handleError = Sentry.handleErrorWithSentry(logError);
