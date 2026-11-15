// The phone's door into the office (`docs/remote-desk.md`). The office answers
// only this computer (`fromThisComputer`), so `tailscale serve` cannot point
// at it straight: Tailscale names the phone in X-Forwarded-For. It points
// here instead, a second listener on 127.0.0.1 alone, which hands each
// request on to the office as this computer, the way Caddy does for the
// office's https address. The office's own guard still runs on every request,
// so an action still comes only from the office's own page.
//
// The door lets a request through only when it came through `tailscale serve`
// from someone signed in to the tailnet (Tailscale-User-Login, which Tailscale
// writes itself and drops from what a client sends, and which a request
// through `tailscale funnel` never carries), at a name the owner listed in
// ODDBORO_EXTRA_HOSTS. It never opens in the desktop app, whose office answers
// only its own window (`app-key.ts`): the phone works with an office run from
// source.
import { createServer, request as forward, type IncomingMessage, type Server } from 'node:http';
import { readEnv } from '@oddboro/ledger/env';
import { OFFICE_PORT, OFFICE_URL } from '@oddboro/ledger/home';

/** Where the door listens, on 127.0.0.1: two above the office, past the site's 4501. */
export const DOOR_PORT = Number(process.env.ODDBORO_PHONE_PORT) || OFFICE_PORT + 2;
/** The door's address, which `tailscale serve` points at. */
export const DOOR_URL = `http://127.0.0.1:${DOOR_PORT}`;

/** What the door answers a request that did not come through the owner's tailnet. */
export const NOT_THE_TAILNET = "This door opens only to the owner's own tailnet";

/**
 * The names the owner lists in `ODDBORO_EXTRA_HOSTS`, such as the home
 * computer's Tailscale name. A comma-separated list. Each entry may be a bare
 * name or an address with a scheme or a port; only its name counts.
 */
export function extraHosts(list: string | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => URL.parse(n.includes('//') ? n : `http://${n}`)?.hostname.toLowerCase() ?? '')
    .filter(Boolean);
}

/** The listed names, read on each request, so Setup's one click works at once. */
export const listedNames = () =>
  extraHosts(process.env.ODDBORO_EXTRA_HOSTS || readEnv().ODDBORO_EXTRA_HOSTS);

/** A header's one value, as Node gives it. */
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** True when the request came through `tailscale serve`, from the tailnet, at a listed name. */
export function throughTailnet(
  headers: IncomingMessage['headers'],
  names: string[] = listedNames()
): boolean {
  const name = one(headers.host).replace(/:\d+$/, '').toLowerCase();
  return !!one(headers['tailscale-user-login']) && names.includes(name);
}

/**
 * The headers the office gets: as the browser sent them, without what
 * Tailscale added, and asked of the office at its own address. An Origin that
 * names the tailnet address becomes the office's, so the guard's check that
 * an action comes from the office's own page reads it as the browser meant
 * it. Sec-Fetch-Site, which no page can set, passes through as it came.
 */
export function officeHeaders(headers: IncomingMessage['headers']): IncomingMessage['headers'] {
  const out: IncomingMessage['headers'] = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/^(x-forwarded-|tailscale-|forwarded$|x-real-ip$)/.test(key)) continue;
    out[key] = value;
  }
  const host = one(headers.host);
  out.host = `127.0.0.1:${OFFICE_PORT}`;
  const origin = one(headers.origin);
  if (origin && URL.parse(origin)?.host === host) out.origin = OFFICE_URL;
  return out;
}

/** A Location the office sent at its own address, made relative for the phone. */
export function phoneLocation(location: string | undefined): string | undefined {
  return location?.startsWith(OFFICE_URL) ? location.slice(OFFICE_URL.length) || '/' : location;
}

/** The door's server, which hands each request on to `target`. Not yet listening. */
export function door(target = OFFICE_URL): Server {
  const to = new URL(target);
  const server = createServer((req, res) => {
    if (!throughTailnet(req.headers)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(NOT_THE_TAILNET);
      return;
    }
    const out = forward(
      {
        hostname: to.hostname,
        port: to.port,
        method: req.method,
        path: req.url,
        headers: officeHeaders(req.headers)
      },
      (reply) => {
        const headers = { ...reply.headers };
        const location = phoneLocation(one(headers.location) || undefined);
        if (location) headers.location = location;
        res.writeHead(reply.statusCode ?? 502, headers);
        reply.pipe(res);
      }
    );
    out.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The office is not answering');
    });
    // The phone leaving (a closed tab, a live line it drops) ends the office's side too.
    res.on('close', () => out.destroy());
    req.pipe(out);
  });
  // No websocket: the phone needs none, and Vite's live reload stays this computer's.
  server.on('upgrade', (_req, socket) => socket.destroy());
  return server;
}

const OPEN = Symbol.for('oddboro.phone-door');

/**
 * Open the door once, as the office starts from source. Never in the app.
 * Under `vite dev` the server's hooks can load again; the door stays the one.
 */
export function openPhoneDoor(inApp: boolean): void {
  const held = globalThis as { [OPEN]?: Server };
  if (inApp || held[OPEN]) return;
  const server = door();
  server.on('error', (e) =>
    console.error(`[phone] the phone door could not open on ${DOOR_URL}`, e)
  );
  server.listen(DOOR_PORT, '127.0.0.1');
  held[OPEN] = server;
}
