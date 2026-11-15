// A buzz on the owner's phone when something new lands on the desk (Web Push).
//
// The owner turns it on per phone, on the phone desk (`/desk`): the phone asks
// its own push service for an address and the page hands the office that
// address. When an ask, task or report arrives that was not on the desk
// before, the office sends each address an empty push, signed with the
// office's own key (VAPID). Empty, so nothing of the desk leaves: the phone's
// service worker (`static/desk-push.js`) shows a fixed line and opens the
// desk. The key and the addresses live in the system's secret store, never in
// Postgres or a file, under a name of this office's own home (`SECRET`), so
// two offices on one computer never share them. The list of phones is read
// from the store once and kept in memory, so a change to the desk with no
// phone on starts nothing.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type JsonWebKey
} from 'node:crypto';
import { desk } from '@oddboro/ledger';
import { deskKeys } from '#lib/desk.ts';
import { home } from '@oddboro/ledger/home';
import { deleteSecret, getSecret, setSecret } from '@oddboro/ledger/secrets';
import { bus, listen, type OfficeEvent } from './events.ts';

/**
 * Where the key and the phones are kept: `push-` and the start of a hash of
 * the office's home. Every dev office on a Mac shares one Keychain service,
 * so a plain name would have each of them buzz the others' phones.
 */
const SECRET = `push-${createHash('sha256').update(home()).digest('hex').slice(0, 12)}`;
/** The tables whose change can put something new on the desk. */
const DESK_TABLES = new Set(['asks', 'tasks', 'reports']);
/** Who sends the pushes, as push services ask: the project, never the owner. */
const SUBJECT = 'https://oddboro.com';
/** How long a push service keeps a push for a phone that is off: a day. */
const KEEP_SECONDS = 86_400;

/**
 * The push services a phone's address may be at: Apple's, Google's (Chrome
 * and Android), Mozilla's (Firefox) and Microsoft's (Edge). A host ending in
 * one of these, or equal to it. Any other address is refused, so the office
 * only ever sends to these.
 */
export const PUSH_HOSTS = [
  'web.push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com'
];

/** Whether an address is https at one of `PUSH_HOSTS`. */
export function isPushAddress(address: string): boolean {
  const u = URL.parse(address);
  if (!u || u.protocol !== 'https:' || u.username || u.password) return false;
  return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** The office's key pair as JWK, made the first time it is asked for. */
function keyPair(): JsonWebKey {
  const kept = getSecret(SECRET, 'vapid');
  if (kept) return JSON.parse(kept) as JsonWebKey;
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  setSecret(SECRET, 'vapid', JSON.stringify(jwk));
  return jwk;
}

/** The public key as the page hands it to the push service: the raw point, base64url. */
export function publicKey(jwk: JsonWebKey = keyPair()): string {
  const pub = createPublicKey({
    key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    format: 'jwk'
  });
  return b64url(pub.export({ format: 'der', type: 'spki' }).subarray(-65));
}

/**
 * The Authorization header for one push: a token signed with the office's key,
 * for the push service's origin, good for 12 hours.
 */
export function vapidHeader(address: string, jwk: JsonWebKey, now = Date.now()): string {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(
    JSON.stringify({
      aud: new URL(address).origin,
      exp: Math.floor(now / 1000) + 12 * 3600,
      sub: SUBJECT
    })
  );
  const key = createPrivateKey({ key: jwk, format: 'jwk' });
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: 'ieee-p1363'
  });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${publicKey(jwk)}`;
}

/**
 * What the watcher holds between changes, on `globalThis` so it outlives a
 * dev reload of this module: the phones, read from the store once, and what
 * the desk held at the last look while a phone was on.
 */
type Held = { phones?: string[]; seen?: Set<string>; looking: Promise<void> };
const held = ((globalThis as unknown as { officePush?: Held }).officePush ??= {
  looking: Promise.resolve()
});

function storedPhones(): string[] {
  try {
    const list: unknown = JSON.parse(getSecret(SECRET, 'phones') ?? '[]');
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

/** The addresses of the phones the owner turned the buzz on for. */
export function phones(): string[] {
  held.phones ??= storedPhones();
  return held.phones;
}

function keepPhones(list: string[]): void {
  if (list.length) setSecret(SECRET, 'phones', JSON.stringify(list));
  else deleteSecret(SECRET, 'phones');
  held.phones = list;
}

/** Turn the buzz on for a phone. The desk as it stands now is already seen. */
export function addPhone(address: string): void {
  if (!isPushAddress(address)) throw new Error("That is not a phone's push address.");
  if (!phones().includes(address)) keepPhones([...phones(), address]);
  held.seen = undefined;
  void deskChanged();
}

/** Turn the buzz off for a phone. */
export function removePhone(address: string): void {
  keepPhones(phones().filter((a) => a !== address));
}

/**
 * Send each phone an empty push. A phone its push service no longer knows
 * (404 or 410: the owner turned it off there, or removed the app) is dropped.
 * Returns how many took it.
 */
export async function buzz(): Promise<number> {
  const list = phones();
  if (!list.length) return 0;
  const jwk = keyPair();
  let took = 0;
  for (const address of list) {
    try {
      const res = await fetch(address, {
        method: 'POST',
        headers: {
          authorization: vapidHeader(address, jwk),
          ttl: String(KEEP_SECONDS),
          urgency: 'normal',
          // A newer buzz replaces one the phone has not had yet.
          topic: 'desk'
        }
      });
      if (res.ok) took++;
      else if (res.status === 404 || res.status === 410) removePhone(address);
      else console.error(`[push] a push service answered ${res.status}`);
    } catch (e) {
      console.error('[push] a push service could not be reached', e);
    }
  }
  console.log(`[push] sent to ${took} of ${list.length} ${list.length === 1 ? 'phone' : 'phones'}`);
  return took;
}

/**
 * Read the desk, and buzz when it holds anything the last look did not. One
 * look at a time. With no phone on it reads nothing. A first look, or one
 * after a phone was turned on, only sees.
 */
export function deskChanged(): Promise<void> {
  held.looking = held.looking.then(async () => {
    if (!phones().length) {
      held.seen = undefined;
      return;
    }
    try {
      const now = deskKeys(await desk());
      const before = held.seen;
      const fresh = before ? [...now].some((k) => !before.has(k)) : false;
      held.seen = now;
      if (fresh) await buzz();
    } catch (e) {
      console.error('[push] desk', e);
    }
  });
  return held.looking;
}

const g = globalThis as unknown as { officePushStarted?: boolean };

/** Start once per process, from the server's `init`. A restart buzzes for nothing already there. */
export function startPush(): void {
  if (g.officePushStarted) return;
  g.officePushStarted = true;
  listen();
  bus.on('event', (e: OfficeEvent) => {
    if (e.type === 'change' && DESK_TABLES.has(e.table)) void deskChanged();
  });
  void deskChanged();
}
