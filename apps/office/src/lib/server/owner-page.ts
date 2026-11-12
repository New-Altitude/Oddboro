import { FILE_MAX } from '#lib/attachments.ts';
import { CHAT_REQUEST_BYTES } from '../staff/chat-input.ts';
// Which requests the office answers. It runs on the owner's computer, where
// any program, and any web page the owner opens, can send it requests with
// whatever headers it likes. So `guardOffice` (the server's `handle` in
// hooks.server.ts) checks every request before a route sees it:
//
// - The Host must be one of the office's own names. A page that points a
//   name of its own at 127.0.0.1 (DNS rebinding) counts as same-origin to the
//   browser, so only the name it asked for gives it away.
// - A request without the owner's key (`@oddboro/ledger/owner-key`) reaches
//   only an exact exception route, each with its own proof: the app's shell
//   reports updates to /api/update with the token it gave the server
//   (`fromShell`), an Odd's run reaches its outside tools through
//   /api/gateway with the token the office gave that run (`fromRun`), and a
//   sign-in comes back to its page by GET, proved by the sign-in's own state.
//   Reads need the key too: a program on this computer must not read the office.
// - The owner's page carries the key as a cookie. It gets it by opening any
//   page once with the key in the address; the guard sets the cookie and
//   sends the browser to the same address without the key.
// - With the key, anything that is not a read (GET, HEAD, OPTIONS) must also
//   come from the owner's own page (`fromOwnerPage`): a page on another
//   localhost port is same-site, so it carries the cookie too. SvelteKit's own
//   check covers form posts only, so the office checks every action itself.
//
// Whether a path is an exception is judged on `event.url.pathname`, the text
// Kit routes on, never parsed or decoded again here: a guard that read the
// address differently from its router would let a keyless request through.
//
// A plain comparison of Origin with the office's own address would refuse the
// owner's page through Caddy, which reaches the office over http while the
// page is https, so `fromOwnerPage` compares what the browser itself says.
import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import {
  hasOwnerKey,
  isExceptionPath,
  isGatewayPath,
  isOwnerKey,
  notTheOwner,
  OWN_PROOF,
  OWNER_PARAM,
  ownerSetCookie,
  UPDATE_PATH
} from '@oddboro/ledger/owner-key';
import { HOSTS } from './hosts.ts';
import { fromRun } from './gateway.ts';
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

/** For a chunked request, count as it arrives and leave the body for the route. */
async function fits(request: Request, limit: number): Promise<boolean> {
  const length = request.headers.get('content-length');
  if (length !== null) return Number(length) <= limit;
  const reader = request.clone().body!.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return true;
      size += value.length;
      if (size > limit) return false;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

/**
 * Whether a request without the owner's key proves itself another way, on an
 * exact exception route: the shell's token, a run's token, or a sign-in page
 * by GET or HEAD.
 */
function provesItself(event: RequestEvent): boolean {
  const { request } = event;
  const path = event.url.pathname;
  if (!isExceptionPath(path)) return false;
  if (path === UPDATE_PATH) return fromShell(request, event.getClientAddress());
  if (isGatewayPath(path)) return fromRun(request);
  return (
    (request.method === 'GET' || request.method === 'HEAD') && OWN_PROOF.some((p) => p === path)
  );
}

/**
 * A 303 to the same address without the key in it. Leading slashes and
 * backslashes become one `/`: a browser reads `//evil.example/` as another
 * site, so `Location` must never start with two.
 */
function withoutKey(url: URL, setCookie: string | null): Response {
  const query = new URLSearchParams(url.search);
  query.delete(OWNER_PARAM);
  const headers = new Headers({
    location: url.pathname.replace(/^[/\\]+/, '/') + (query.size ? `?${query}` : '')
  });
  if (setCookie) headers.set('set-cookie', setCookie);
  return new Response(null, { status: 303, headers });
}

/** The refusal of a request without the key (`notTheOwner`), judged on Kit's own path. */
function refuseKeyless(url: URL): Response {
  const { status, type, body } = notTheOwner(url.pathname);
  return new Response(body, { status, headers: { 'content-type': type } });
}

/** The server's `handle`: every request passes here before a route sees it. */
export const guardOffice: Handle = async ({ event, resolve }) => {
  const { request, url } = event;
  if (!toThisOffice(request)) return refuse('This office answers only at its own address');
  if (!provesItself(event)) {
    const given = request.method === 'GET' ? url.searchParams.get(OWNER_PARAM) : null;
    // The cookie first, so an old key left in an address cannot lock out a
    // browser that holds the right one.
    if (hasOwnerKey(request.headers.get('cookie'))) {
      if (given !== null) return withoutKey(url, null);
      if (!READS.has(request.method) && !fromOwnerPage(request)) return refuseKeyless(url);
    } else if (given !== null && isOwnerKey(given)) {
      return withoutKey(url, ownerSetCookie());
    } else return refuseKeyless(url);
  }
  const chat =
    request.method === 'POST' && /^\/api\/staff\/[a-z0-9-]+\/chat\/?$/.test(url.pathname);
  // Uploads use their existing per-file limit. The larger chat limit
  // includes JSON encoding for inline imports, and never widens other actions.
  const upload =
    request.method === 'POST' && /^\/api\/staff\/[a-z0-9-]+\/attachments\/?$/.test(url.pathname);
  const limit = chat ? CHAT_REQUEST_BYTES : upload ? FILE_MAX : 512 * 1024;
  if (request.body && (chat || upload || process.env.ODDBORO_APP) && !(await fits(request, limit)))
    return new Response('That request is too large', { status: 413 });
  return resolve(event);
};
