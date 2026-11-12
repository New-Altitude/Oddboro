// Where `npm run setup` opens the office, and the owner's key it opens it
// with. Setup sends the key on its own requests and hands it to the browser in
// the address, so each address must first prove, in this run, that the
// office holding that key answers there (office-proof.ts). Anything else on a
// port the office uses would otherwise be handed the key.
import { OFFICE_PORT } from './home.ts';
import { provesOffice, type Via } from './office-proof.ts';
import { OWNER_COOKIE, storedOwnerKey } from './owner-key.ts';

/** The office's own port, and the ports its Caddy answers http and https on. Tests move them to free ones. */
export type Ports = { office: number; http: number; https: number };
const PORTS: Ports = { office: OFFICE_PORT, http: 80, https: 443 };

/** How long setup waits for the office: the first start brings the tables up to date, which can take a while. */
export type Wait = { tries: number; pause: number };
const WAIT: Wait = { tries: 120, pause: 1000 };

// Through Caddy, when the office set its address up; the port otherwise. The
// first name needs public DNS to point it here; the second always reaches this computer.
const NAMES = ['local.oddboro.com', 'oddboro.localhost'];

const keyed = (key: string) => ({ cookie: `${OWNER_COOKIE}=${key}` });

/**
 * The office's key once the office answers on its own port, or undefined when
 * it never does. The office makes its key file as it starts, before it
 * answers, so until the file is there the office is not up and setup waits,
 * making no key of its own. Then the office proves it holds that key before
 * any request carries it.
 */
async function officeKey(office: string, wait: Wait): Promise<string | undefined> {
  for (let i = 0; i < wait.tries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, wait.pause));
    const key = storedOwnerKey();
    if (key === undefined) continue;
    if (!(await provesOffice(office, key, 'direct'))) continue;
    const up = await fetch(office, { headers: keyed(key) }).then(
      (r) => r.ok,
      () => false
    );
    if (up) return key;
  }
  return undefined;
}

/**
 * The office's key and the address setup opens it at, or undefined when the
 * office did not answer. The address is the first that proves itself in this
 * run: https once the office says its certificate is trusted here, then each
 * name through Caddy and then at the office's port, which ends with today's
 * `oddboro.localhost`, then the office's own 127.0.0.1. That last one is
 * opened only when `oddboro.localhost` fails its proof, as it does on a
 * computer with no IPv6 loopback.
 */
export async function setupAddress(
  ports: Ports = PORTS,
  wait: Wait = WAIT
): Promise<{ key: string; address: string } | undefined> {
  const office = `http://127.0.0.1:${ports.office}`;
  const key = await officeKey(office, wait);
  if (key === undefined) return undefined;
  // The office itself answers whether https is set up: it knows where its
  // Caddy keeps the certificate.
  const secure = await fetch(`${office}/api/setup/address`, {
    headers: keyed(key),
    signal: AbortSignal.timeout(5000)
  })
    .then((r) => r.json() as Promise<{ secure?: boolean }>)
    .then((r) => r.secure === true)
    .catch(() => false);
  const tries: [url: string, via: Via][] = [
    ...(secure ? [[`https://${NAMES[0]}:${ports.https}`, 'proxy:https'] as [string, Via]] : []),
    ...NAMES.flatMap((name): [string, Via][] => [
      [`http://${name}:${ports.http}`, 'proxy:http'],
      [`http://${name}:${ports.office}`, 'direct']
    ]),
    [office, 'direct']
  ];
  for (const [url, via] of tries)
    // The origin drops a default port, so Caddy's addresses read as before.
    if (await provesOffice(url, key, via)) return { key, address: new URL(url).origin };
  return undefined;
}
