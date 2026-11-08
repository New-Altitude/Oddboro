// The page tells the office it booted, and reports every error it hits, to
// /api/client-log, which writes them to the app's log. Sent as JSON like every
// action: a text/plain beacon would meet the release-only origin check (#25).
import type { ClientInit, HandleClientError } from '@sveltejs/kit/hooks';

/** At most this many reports a page load, so a loop cannot flood the office. */
const MOST = 20;
let sent = 0;

function report(kind: 'boot' | 'error', message: string, stack?: string): void {
  if (++sent > MOST) return;
  fetch('/api/client-log', {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, message, stack })
  }).catch(() => {});
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

export const handleError: HandleClientError = ({ kind, error }) => {
  const { message, stack } = describe(error);
  report('error', `${kind}: ${message}`, stack);
};
