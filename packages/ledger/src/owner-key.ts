// The owner's key: one secret in the office's folder that only the owner's own
// tools can read. The owner's page carries it as a cookie, and a request
// without it reaches only an exact exception route, each with its own proof.
// Both guards (the office's `guardOffice` and the dev server's `ownerOnly`)
// call the one rule here, so they cannot drift apart.
//
// It imports only Node's own modules, home.ts and office-proof.ts, so the dev server's config
// can load it without the office's server modules.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { home, OFFICE_PORT, type OfficeEntry } from './home.ts';
import { OFFICE_PROOF_PATH } from './office-proof.ts';

export const OWNER_KEY_FILE = 'owner-key' satisfies OfficeEntry;
/** Named by the office's port: a browser scopes cookies by host, not port, so two offices on 127.0.0.1 would share one name. */
export const OWNER_COOKIE = `oddboro-owner-${OFFICE_PORT}`;
/** The address parameter that hands the page its key once, before the cookie is set. */
export const OWNER_PARAM = 'oddboro-key';

/** 32 random bytes in base64url, as `makeKey` writes them. */
const KEY_SHAPE = /^[A-Za-z0-9_-]{43}$/;

let cached: string | undefined;

/**
 * The office's key: read from its file, or made there first. Cached per
 * process, so a key that reset moved aside is seen once the office restarts
 * (reset stops the office first).
 */
export function ownerKey(): string {
  if (cached !== undefined) return cached;
  const file = home(OWNER_KEY_FILE);
  if (!existsSync(file)) makeKey(file);
  const key = readFileSync(file, 'utf8').trim();
  // An empty or damaged key would let a cookie holding the same text in. The
  // office refuses to start on one rather than guess.
  if (!KEY_SHAPE.test(key))
    throw new Error(
      `${file} does not hold an owner key. Move it aside and start the office again.`
    );
  cached = key;
  return key;
}

/**
 * Writes a new key whole to a temp file beside the key file, readable by the
 * owner alone, then links it into place, so no reader sees it half written.
 * When another process linked its key first (EEXIST), that one stands and
 * every process reads it. The temp file goes either way.
 */
function makeKey(file: string): void {
  mkdirSync(home(), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}`;
  writeFileSync(temp, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
  try {
    linkSync(temp, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Timing-safe: whether `given` is the office's key. A different length is
 * false without a compare, since timingSafeEqual throws on one. The one
 * compare: hasOwnerKey, guardOffice and ownerOnly all call it.
 */
export function isOwnerKey(given: string | null): boolean {
  if (given === null) return false;
  const want = Buffer.from(ownerKey());
  const got = Buffer.from(given);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Whether a request's Cookie header carries the office's key: true when any
 * cookie named OWNER_COOKIE holds it. A page on another 127.0.0.1 port can
 * plant a cookie of that name with a longer path, which the browser sends
 * first, so reading only the first one would log the owner out.
 */
export function hasOwnerKey(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((pair) => {
    const at = pair.indexOf('=');
    return (
      at !== -1 &&
      pair.slice(0, at).trim() === OWNER_COOKIE &&
      isOwnerKey(pair.slice(at + 1).trim())
    );
  });
}

/** Where a run reaches its tools, with its own token. */
export const GATEWAY_PATH = '/api/gateway';
/** Where the app's shell reports an update, with its own token. */
export const UPDATE_PATH = '/api/update';
/**
 * The routes a request reaches without the key by GET or HEAD alone, each
 * proved by what it asks: a sign-in page by the sign-in's own `state`, and
 * the office's proof by a fresh nonce, which it answers with a hash of the key
 * and nothing else (`office-proof.ts`).
 */
export const OWN_PROOF = ['/account/callback', '/connect/callback', OFFICE_PROOF_PATH] as const;
/**
 * Every route a request without the owner's key may reach, as route ids, each
 * proved its own way: the shell's token, a run's token, a sign-in's state,
 * the office's proof.
 * isExceptionPath is built from this list and nothing else.
 */
export const EXCEPTION_ROUTES = [UPDATE_PATH, `${GATEWAY_PATH}/[connector]`, ...OWN_PROOF] as const;

/**
 * What a route parameter matches: a connector id. Every id the office writes
 * is lowercase letters, digits and dashes, and a run's address escapes its id.
 * It matches no `%`, backslash, `.` or `/`. With no `%`, the path SvelteKit
 * decodes before it routes is the text the guard read. With no `.` or `/`, it
 * holds no step a router would resolve to another path.
 */
export const PARAM = '[a-z0-9-]+';
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EXCEPTION = new RegExp(
  `^(?:${EXCEPTION_ROUTES.map((r) => literal(r).replace(/\\\[[a-z]+\\\]/g, PARAM)).join('|')})$`
);

/**
 * Whether `path` is exactly one exception route, as given. It does no parse
 * and no decode: each guard passes the text its router starts from. SvelteKit
 * decodes that text before it routes, but no exception route and no PARAM
 * match holds a `%`, so text that passes reads the same once decoded. A guard
 * that read the address differently from its router would let a keyless
 * request through.
 */
export function isExceptionPath(path: string): boolean {
  return EXCEPTION.test(path);
}

/** The gateway member of the exception routes, so guardOffice asks for a run's token. */
export function isGatewayPath(path: string): boolean {
  return isExceptionPath(path) && path.startsWith(`${GATEWAY_PATH}/`);
}

/** The key as a Cookie header, for setup and the office's own requests to itself. */
export function ownerCookie(): string {
  return `${OWNER_COOKIE}=${ownerKey()}`;
}

/** The Set-Cookie value once the key arrives in the address: 400 days, the most a browser keeps one. */
export function ownerSetCookie(): string {
  return `${ownerCookie()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000`;
}

/** What a person without the key gets on a page: how to open the office. It loads nothing and names no key or path. */
export const NOT_THE_OWNER_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open your office from Oddboro</title>
<style>body { font-family: system-ui, sans-serif; max-inline-size: 32rem; margin-block: 4rem; margin-inline: auto; padding-inline: 1rem; line-height: 1.5; }</style>
</head>
<body>
<h1>Open your office from Oddboro</h1>
<p>This office opens only from Oddboro on this computer. Open the Oddboro app. If you run the office from its code, run <code>npm run setup</code> in its folder.</p>
</body>
</html>
`;
/** What a program without the key gets on an /api/ path. */
export const NOT_THE_OWNER_TEXT = "Only the office's own page can do that";

/**
 * The refusal of a request without the key, by the path its guard routes on:
 * a program on an /api/ path gets a short line, and a person on a page learns
 * how to open the office. Both guards answer with this, each in its own
 * server's response, so the two cannot answer differently.
 */
export function notTheOwner(path: string): { status: 403; type: string; body: string } {
  return path.startsWith('/api/')
    ? { status: 403, type: 'text/plain; charset=utf-8', body: NOT_THE_OWNER_TEXT }
    : { status: 403, type: 'text/html; charset=utf-8', body: NOT_THE_OWNER_PAGE };
}
