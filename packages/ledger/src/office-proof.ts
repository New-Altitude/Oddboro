// Whether an address is this office, proven before the owner's key goes there.
// Anything can listen on a port the office uses when the office is not there,
// so a caller that sent the key to learn who answered would hand it to
// whatever did. The prover sends no key: it asks the office's proof route for
// a hash of the key with a fresh nonce, and only the office, which holds the
// key, can answer it.
//
// The answer also says which listener the request came through. The office's
// own Caddy, and the routes it adds to the owner's Caddy, set a header holding
// `proxySecret`, so an answer through Caddy differs from the office's own. A
// program on port 80 that hands only the proof to the office's own port gets
// the office's direct answer, which a caller that expected Caddy refuses.
//
// It imports only Node's own modules, so the release scripts can import it
// by its path and the app's shell can check the same known answer in Rust.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

/** The keyless route that answers the proof. */
export const OFFICE_PROOF_PATH = '/api/office-proof';
/** The query parameter that carries the nonce. */
export const NONCE_PARAM = 'n';
/** The header Caddy sets on every request it hands the office, replacing any copy a client sent. */
export const PROXY_HEADER = 'X-Oddboro-Proxy';

type Scheme = 'http' | 'https';
/** Which listener a proof came through: the office itself, or Caddy by the scheme the client used. */
export type Via = 'direct' | `proxy:${Scheme}`;

/** A nonce as the prover makes it: 16 random bytes in lowercase hex. */
const NONCE = /^[0-9a-f]{32}$/;
/**
 * The only addresses a proven name may resolve to. The office and Windows'
 * Caddy hold only these two, so another 127/8 address could be anything.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1']);
/** A proof is one small request on this computer; one slower than this is no answer. */
const TIMEOUT = 3000;
/** An answer is 64 hex characters; anything much longer is not one. */
const MOST = 256;

const hmac = (key: string, text: string) => createHmac('sha256', key).update(text).digest('hex');

/** What Caddy's header holds before the scheme: a hash of the key, so the Caddyfile never holds the key. */
export function proxySecret(key: string): string {
  return hmac(key, 'oddboro-proxy');
}

/** The office's answer to a nonce, for the listener it came through. */
export function proofAnswer(key: string, nonce: string, via: Via): string {
  return hmac(key, `${nonce}|${via}`);
}

/** Timing-safe text compare. A different length is false without a compare, since timingSafeEqual throws on one. */
function same(given: string, want: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Which listener a request came through, by its proxy header: Caddy's only
 * when the header holds exactly the key's proxy secret and a scheme. Anything
 * else, a guess included, reads as a direct request.
 */
function viaOf(key: string, header: string | null): Via {
  if (header === null) return 'direct';
  const secret = proxySecret(key);
  for (const scheme of ['http', 'https'] as const)
    if (same(header, `${secret} ${scheme}`)) return `proxy:${scheme}`;
  return 'direct';
}

/**
 * The proof route's whole answer: the hash of the nonce for the listener the
 * request came through. A nonce that is not one the prover makes gets 400 and
 * no hash. It changes nothing.
 */
export function answerProof(
  key: string,
  nonce: string | null,
  proxyHeader: string | null
): { status: 200 | 400; body: string } {
  if (nonce === null || !NONCE.test(nonce))
    return { status: 400, body: 'A proof needs a nonce of 32 lowercase hex characters' };
  return { status: 200, body: proofAnswer(key, nonce, viaOf(key, proxyHeader)) };
}

/**
 * Whether `url` is this office through the listener `via` names. Every
 * address the name resolves to must be 127.0.0.1 or ::1, and each must answer
 * a fresh nonce with the key's hash: a relay on one of them fails the name.
 * Nothing is sent when one address is not loopback. The key is passed in, so
 * the prover never makes one, and it is never sent.
 */
export async function provesOffice(url: string, key: string, via: Via): Promise<boolean> {
  const at = URL.parse(url);
  if (!at || (at.protocol !== 'http:' && at.protocol !== 'https:')) return false;
  // `[::1]` is how a URL writes an IPv6 address; a lookup refuses the brackets.
  const name = at.hostname.replace(/^\[(.*)\]$/, '$1');
  const addresses = isIP(name)
    ? [name]
    : await lookup(name, { all: true }).then(
        (found) => found.map((a) => a.address),
        () => []
      );
  if (addresses.length === 0 || !addresses.every((a) => LOOPBACK.has(a))) return false;
  const secure = at.protocol === 'https:';
  const port = Number(at.port) || (secure ? 443 : 80);
  const proofs = await Promise.all(
    [...new Set(addresses)].map((address) =>
      provesAt({ address, port, host: at.host, name, secure }, key, via)
    )
  );
  return proofs.every(Boolean);
}

type Listener = {
  /** The resolved address to connect to, never resolved again. */
  address: string;
  port: number;
  /** The Host header: the name and port the caller asked for. */
  host: string;
  /** The name, for TLS's server name. */
  name: string;
  secure: boolean;
};

/** One proof at one address. It follows no redirect: a 302 is no answer. */
function provesAt(at: Listener, key: string, via: Via): Promise<boolean> {
  const nonce = randomBytes(16).toString('hex');
  const options: RequestOptions = {
    host: at.address,
    port: at.port,
    path: `${OFFICE_PROOF_PATH}?${NONCE_PARAM}=${nonce}`,
    headers: { host: at.host },
    // A fresh connection each time, so no earlier socket answers this one.
    agent: false,
    timeout: TIMEOUT
  };
  return new Promise((done) => {
    const answered = (res: IncomingMessage) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > MOST) req.destroy();
      });
      res.on('end', () => done(res.statusCode === 200 && same(body, proofAnswer(key, nonce, via))));
      res.on('error', () => done(false));
    };
    const req = at.secure
      ? httpsRequest(
          {
            ...options,
            // TLS refuses an IP address as a server name.
            servername: isIP(at.name) ? undefined : at.name,
            // The certificate is from Caddy's own authority, which Node does
            // not trust. The answer's hash, not the certificate, proves who answered.
            rejectUnauthorized: false
          },
          answered
        )
      : httpRequest(options, answered);
    req.on('error', () => done(false));
    req.on('timeout', () => req.destroy());
    req.end();
  });
}
