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
 * Whether a proposal may name a persona: it carries a slug, says "persona",
 * or names its hire with more than one word, as a person's whole name is.
 * Only such a proposal waits for the offers before its window shows anything.
 */
export const hasPersonaHint = (p: Pick<HireProposal, 'name' | 'role' | 'personaSlug'>) =>
  namesPersona(p) || whole(p.name).includes(' ');

/** Whether a proposal says outright that it means a persona: a slug, or the word persona. */
export const namesPersona = (p: Pick<HireProposal, 'name' | 'role' | 'personaSlug'>) =>
  !!p.personaSlug?.trim() || /\bpersona\b/i.test(`${p.name} ${p.role}`);

/** The person a proposal that names a persona means, as it wrote them: its role without "Persona", or its name. */
export const personaNamed = (p: Pick<HireProposal, 'name' | 'role'>) =>
  /\bpersona\b/i.test(p.role)
    ? p.role.replace(/\s*\bpersona\b\s*/gi, ' ').trim() || p.name
    : p.name;

/**
 * What a hire window opened from a proposal shows:
 * - `wait`: the offers have not answered and the proposal may name a persona,
 *   so the builder never shows only to be replaced;
 * - `persona`: the persona it names, offered to this account;
 * - for a proposal that says it means a persona (`namesPersona`): `sign-in`
 *   while the account is signed out or lacks personas, `unreachable` while
 *   New Altitude does not answer, and `not-offered` when the list lacks it;
 * - `odd`: the builder.
 */
export type ProposalView = 'wait' | 'persona' | 'sign-in' | 'unreachable' | 'not-offered' | 'odd';

export function proposalView(
  proposal: HireProposal | undefined,
  offers: Offers | undefined
): ProposalView {
  if (!proposal) return 'odd';
  if (!offers) return hasPersonaHint(proposal) ? 'wait' : 'odd';
  if (suggestedPersona(proposal, offers)) return 'persona';
  if (!namesPersona(proposal)) return 'odd';
  if (offers.state === 'ok') return 'not-offered';
  return offers.state === 'unreachable' ? 'unreachable' : 'sign-in';
}

/**
 * The builder's first name, role and appearance when the owner builds an
 * ordinary Odd from a proposal: none of them from a proposal that says it
 * means a persona, none of the person's own from one matched by name, and
 * the proposal's own otherwise.
 */
export function ordinaryFrom(
  p: Pick<HireProposal, 'name' | 'role' | 'personaSlug'> & { appearance: string },
  matched?: Pick<Offer, 'displayName' | 'name'>
): { name: string; role: string; appearance: string } {
  if (namesPersona(p)) return { name: '', role: '', appearance: '' };
  return matched
    ? withoutLikeness(p, matched)
    : { name: p.name, role: p.role, appearance: p.appearance };
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
