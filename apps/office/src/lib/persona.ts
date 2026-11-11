// New Altitude personas as the page shows them. Type-only from the ledger, so
// nothing of it reaches the page bundle.
import type { Quiet } from '@oddboro/ledger';

export type { Quiet, PersonaLink } from '@oddboro/ledger';

/** One persona New Altitude offers this owner, as the page shows it. */
export type Offer = {
  slug: string;
  displayName: string;
  jobTitle: string | null;
  disclosure: string;
  name: string;
  role: string;
  remit: string;
  /** The package's portrait, as a data URL. */
  portrait: string;
  joined: 'no' | 'granted' | 'installed';
  quiet?: Quiet;
};

/**
 * What the office knows of the personas on offer: signed out, signed in
 * without the personas permission, refused by New Altitude, not answering,
 * or the offers.
 */
export type Offers =
  | { state: 'out' }
  | { state: 'rescope' }
  | { state: 'refused' }
  | { state: 'unreachable' }
  | { state: 'ok'; offers: Offer[] };

/** What a quiet persona Odd says instead of answering, for each reason, with the one thing to do. */
export const QUIET_LINE: Record<Quiet, (name: string) => string> = {
  access: (name) =>
    `${name}'s New Altitude access has ended, so ${name} stays quiet. Renew it on New Altitude, then press Check again.`,
  grant: (name) =>
    `${name} is signed out of New Altitude. Press Reconnect to sign ${name} back in.`,
  'signed-out': (name) =>
    `You signed out of New Altitude, so ${name} stays quiet. Sign in under Setup, Account, then press Reconnect.`
};
