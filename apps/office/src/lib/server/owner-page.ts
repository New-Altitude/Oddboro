// Which requests the office answers. It runs on the owner's computer, where
// any web page the owner opens can send it requests, so `guardOffice` (the
// server's `handle` in hooks.server.ts) checks every request before a route
// sees it:
//
// - The request must come from this computer (`fromThisComputer`). Through
//   Caddy, which on a Mac and Linux listens on every address, the connection
//   is always from 127.0.0.1, so the office reads the address Caddy forwards
//   for (X-Forwarded-For), which Caddy writes itself. A program on this
//   computer can write that header too; this check keeps out other machines,
//   not other programs. Every entry counts, since a Caddy that trusts the
//   client appends to what it sent, and an entry that is not a plain address
//   (a port, brackets, a name, empty) counts as another computer.
// - The Host must be one of the office's own names. A page that points a
//   name of its own at 127.0.0.1 (DNS rebinding) counts as same-origin to the
//   browser, so only the name it asked for gives it away.
// - Anything that is not a read (GET, HEAD, OPTIONS) must come from the
//   owner's own page (`fromOwnerPage`), in every mode. SvelteKit's own check
//   covers form posts only, so the office checks every action itself.
//   The other clients are the app's shell, which reports updates to
//   /api/update with the token it gave the server (`fromShell`), and an
//   Odd's run, which reaches its outside tools through /api/gateway with the
//   token the office gave that run (`fromRun`).
//
// A plain comparison of Origin with the office's own address would refuse the
// owner's page through Caddy, which reaches the office over http while the
// page is https, so `fromOwnerPage` compares what the browser itself says.
import { isIPv4 } from 'node:net';
import type { Handle } from '@sveltejs/kit/hooks';
import { HOSTS } from './hosts.ts';
import { fromRun, GATEWAY_PATH } from './gateway.ts';
import { fromShell } from './update.ts';

/**
 * The names the office answers to, without a port: loopback, its addresses
 * through Caddy, and the app's ORIGIN. Names under .localhost reach only this
 * computer, so no other site can point one at the office.
 */
const NAMES = new Set(
  ['127.0.0.1', '[::1]', 'localhost', ...HOSTS, URL.parse(process.env.ORIGIN ?? '')?.hostname]
    .filter((n): n is string => !!n)
    .map((n) => n.toLowerCase())
);

/** True when the request asked for the office by one of its own names, on any port. */
function toThisOffice(request: Request): boolean {
  // `[::1]:4500` gives `[::1]`. Anything that is not exactly a name and a port matches no name.
  const name = (request.headers.get('host') ?? '').replace(/:\d+$/, '');
  return NAMES.has(name.toLowerCase());
}

/** True when the connection and every X-Forwarded-For entry are loopback (127.0.0.0/8, ::1, ::ffff:127.x). */
function fromThisComputer(request: Request, peer: string): boolean {
  const hops = request.headers.get('x-forwarded-for')?.split(',') ?? [];
  return [peer, ...hops].every((hop) => {
    const address = hop.trim().toLowerCase();
    const v4 = address.replace(/^::ffff:/, '');
    return address === '::1' || (isIPv4(v4) && v4.startsWith('127.'));
  });
}

/**
 * True when the browser says the request comes from the same origin
 * (Sec-Fetch-Site, which no page can set). A browser or webview that sends no
 * Sec-Fetch-Site passes when its Origin names the host it asked (the Host
 * header), whatever the scheme. With neither, it is refused.
 */
export function fromOwnerPage(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  // An Origin that is not a URL ("null", from a sandboxed frame) or none at all names no host.
  return URL.parse(request.headers.get('origin') ?? '')?.host === request.headers.get('host');
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

const refuse = (message: string) => new Response(message, { status: 403 });

/** The server's `handle`: every request passes here before a route sees it. */
export const guardOffice: Handle = ({ event, resolve }) => {
  const { request } = event;
  if (!fromThisComputer(request, event.getClientAddress()))
    return refuse('This office answers only its own computer');
  if (!toThisOffice(request)) return refuse('This office answers only at its own address');
  if (
    READS.has(request.method) ||
    fromOwnerPage(request) ||
    (event.url.pathname === '/api/update' && fromShell(request)) ||
    (event.url.pathname.startsWith(`${GATEWAY_PATH}/`) && fromRun(request))
  )
    return resolve(event);
  return refuse("Only the office's own page can do that");
};
