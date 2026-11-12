// New Altitude personas as the page shows them. Type-only from the ledger, so
// nothing of it reaches the page bundle.
import type { HireProposal, Quiet } from '@oddboro/ledger';

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

/**
 * A whole name as matching reads it: lowercase words, with dots, commas, a
 * trailing "Persona" and any one-letter middle initial gone, so "Pat Q.
 * Rivers Persona" reads as "pat rivers".
 */
const whole = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/ persona$/, '')
    .split(' ')
    .filter((w, i, all) => w.length > 1 || i === 0 || i === all.length - 1)
    .join(' ');

/** The names a proposal gives its hire: its name, and its role. */
const namesIn = (p: Pick<HireProposal, 'name' | 'role'>) =>
  [whole(p.name), whole(p.role)].filter(Boolean);

/**
 * The persona a hire proposal names, when New Altitude offers it: by its slug,
 * or else by the whole display name as the proposal's name or role ("Pat Q.
 * Rivers Persona", or "Pat Rivers": a middle initial does not count). A first name alone, or a name inside a longer role, never
 * matches, and two matches are none.
 */
export function proposedPersona(
  p: Pick<HireProposal, 'name' | 'role' | 'personaSlug'>,
  offers: Offer[]
): Offer | undefined {
  const slug = p.personaSlug?.trim().toLowerCase();
  const bySlug = slug ? offers.find((o) => o.slug === slug) : undefined;
  if (bySlug) return bySlug;
  const names = namesIn(p);
  const found = offers.filter((o) => names.includes(whole(o.displayName)));
  return found.length === 1 ? found[0] : undefined;
}

/**
 * The persona a hire window opened from a proposal offers instead of the
 * builder: none without a proposal, or while the office has no list of offers
 * (signed out, or New Altitude did not answer).
 */
export function suggestedPersona(
  proposal: HireProposal | undefined,
  offers: Offers | undefined
): Offer | undefined {
  return proposal && offers?.state === 'ok' ? proposedPersona(proposal, offers.offers) : undefined;
}

/**
 * An ordinary Odd built from a proposal that named a persona: a name or role
 * that is the person's own is cleared, and so is the appearance, so nothing
 * of their likeness carries over.
 */
export function withoutLikeness(
  p: Pick<HireProposal, 'name' | 'role'>,
  o: Pick<Offer, 'displayName' | 'name'>
): { name: string; role: string; appearance: string } {
  const theirs = [whole(o.displayName), whole(o.name)];
  const is = (s: string) => theirs.includes(s);
  return {
    name: is(whole(p.name)) ? '' : p.name,
    role: is(whole(p.role)) ? '' : p.role,
    appearance: ''
  };
}
