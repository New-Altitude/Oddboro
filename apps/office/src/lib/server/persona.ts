// New Altitude personas in this office: which ones the owner's account is
// offered, each persona's own sign-in for its door, and a persona installed as
// an Odd. One read of New Altitude (`syncPersonas`) serves the offers, access
// and package updates. It runs when the office starts, on each GET
// /api/personas and on Check again, never on a timer.
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  approveHire,
  hirePersona,
  ownerName,
  personaOdd,
  roster,
  setQuiet,
  updatePersona,
  welcomed,
  type StaffRow
} from '@oddboro/ledger';
import type { Offer, Offers } from '#lib/persona.ts';
import {
  ACCOUNT_PLACE,
  accountHasPersonas,
  accountIssuer,
  accountSite,
  accountStatus,
  accountToken,
  claimSignIn,
  endSignIn,
  forgetOlderPages,
  OLD_LINK,
  requireSecretStore,
  SignInRefused
} from './account.ts';
import { emit } from './events.ts';
import { preview } from './looks.ts';
import { deleteSecret, getSecret, setSecret } from './keychain.ts';
import { exclusive, freshAccess, KeychainProvider, steadyFetch, type Saved } from './oauth.ts';
import { askDoor, doorUrl, PERSONA_SCOPE, type DoorAnswer } from './persona-door.ts';
import { heardOffers } from './persona-offered.ts';
import { isSlug, packageProblems, readListed, type Listed } from './persona-package.ts';
import { sayInChat } from './staff.ts';

const PREFIX = 'new-altitude-persona-';
/** The secret id of a persona's own sign-in, one per persona. */
const personaId = (slug: string) => `${PREFIX}${slug}`;
/** The persona a sign-in's id belongs to, or undefined for any other sign-in. */
export const personaOf = (id: string | undefined): string | undefined =>
  id?.startsWith(PREFIX) ? id.slice(PREFIX.length) : undefined;

/**
 * The personas with a sign-in in the secret store, by slug. The store cannot
 * list its entries, and sign-out must end every persona's sign-in whatever
 * New Altitude lists now or this run remembers, so the office keeps their
 * names here. It holds no secret. It sits in the store beside the sign-ins
 * it names, so it outlives a restart and moves with them, not with the
 * database. Two offices on one computer that write it at the same instant
 * can lose a name; that persona's Odd, if it has one, still names it to sign-out.
 */
const KEPT = ['new-altitude-personas', 'granted'] as const;
function keptGrants(): Set<string> {
  const raw = getSecret(...KEPT);
  if (!raw) return new Set();
  try {
    const slugs: unknown = JSON.parse(raw);
    if (Array.isArray(slugs))
      return new Set(slugs.filter((s): s is string => typeof s === 'string' && isSlug(s)));
  } catch {
    // Not JSON: told below, as a list of the wrong shape is.
  }
  console.error('[persona] the list of kept persona sign-ins did not read, so it starts empty');
  return new Set();
}
function saveKept(slugs: Set<string>): void {
  if (slugs.size) setSecret(...KEPT, JSON.stringify([...slugs]));
  else deleteSecret(...KEPT);
}

/**
 * A persona's sign-in. It returns where the account's does, through the same
 * pending states, and every write names the persona in the kept list, after
 * the sign-in itself so the list never names one the store lacks.
 */
class PersonaGrant extends KeychainProvider {
  readonly slug: string;
  constructor(slug: string) {
    super(personaId(slug), ACCOUNT_PLACE);
    this.slug = slug;
  }
  protected write(saved: Saved): void {
    super.write(saved);
    const kept = keptGrants();
    if (!kept.has(this.slug)) saveKept(kept.add(this.slug));
  }
}
const grant = (slug: string) => new PersonaGrant(slug);

/**
 * Personas the owner added in this office since it started. During the first
 * visit the office is not welcomed yet, so a persona granted on its card waits
 * here until Open the office installs it. A sign-in the store kept from before
 * is never a yes on its own: the store is shared by every office on this
 * computer and outlives a reset, so that persona waits for its Add.
 */
const grantedThisRun = new Set<string>();

/**
 * By slug: the hire ask whose window added this persona in place of the
 * proposed Odd. The persona's join answers it (`installPersona`). Only in
 * memory, so a restart, a sign-in that never finishes, or an install that
 * fails leaves the ask open on the desk. An Add without an ask forgets it.
 */
const proposals = new Map<string, number>();

const NO_SUCH = 'New Altitude has no persona by that name.';
const NOT_OFFERED = 'New Altitude does not offer this persona to your account.';
const SIGN_IN_FIRST = 'Sign in to New Altitude first.';
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Add on a persona New Altitude does not offer this account now, as a stale card asks. Its route answers 404. */
export class NotOffered extends Error {
  constructor() {
    super(NOT_OFFERED);
  }
}

/**
 * Start a persona's own sign-in: the New Altitude page to open, or '' when a
 * kept one still worked. `askId` is the hire ask its join answers.
 */
export async function startPersonaGrant(slug: string, askId?: number): Promise<{ url: string }> {
  if (!isSlug(slug)) throw new SignInRefused(NO_SUCH);
  requireSecretStore();
  const issuer = accountIssuer();
  if (!issuer) throw new SignInRefused(SIGN_IN_FIRST);
  // Read now, not from the card: a persona New Altitude stopped offering gets
  // no sign-in, which no Odd would hold and so no sign-out would end.
  const listing = await readListing();
  if (listing.state === 'unreachable') throw new Error('the list of personas did not load');
  if (listing.state !== 'ok') throw new SignInRefused(SIGN_IN_FIRST);
  if (!listing.listed.some((l) => l.slug === slug)) throw new NotOffered();
  if (askId === undefined) proposals.delete(slug);
  else proposals.set(slug, askId);
  forgetOlderPages(personaId(slug));
  const p = grant(slug);
  const result = await auth(p, {
    serverUrl: doorUrl(slug, issuer),
    scope: PERSONA_SCOPE,
    fetchFn: steadyFetch
  });
  if (result === 'AUTHORIZED') {
    await afterGrant(slug);
    return { url: '' };
  }
  // The SDK goes on to a page when New Altitude did not answer a refresh (a
  // 5xx, or no answer), and the tokens stay. `finishPersonaGrant` refuses any
  // page while they do, so this one could never finish: open none.
  if (p.tokens()) {
    forgetOlderPages(personaId(slug));
    throw new Error(`${slug}'s sign-in could not refresh`);
  }
  // The SDK sets it in redirectToAuthorization, which REDIRECT always calls.
  return { url: p.url!.toString() };
}

/** New Altitude sent the owner back from a persona's sign-in: trade the code, then add the persona. */
export async function finishPersonaGrant(slug: string, state: string, code: string): Promise<void> {
  claimSignIn(state, personaId(slug));
  const issuer = accountIssuer();
  if (!issuer) throw new SignInRefused(SIGN_IN_FIRST);
  const p = grant(slug);
  // A failed exchange clears the kept tokens, so a page that arrives while
  // the sign-in holds (another office on this computer finished one) stops here.
  if (p.tokens()) throw new SignInRefused(OLD_LINK);
  await auth(p, {
    serverUrl: doorUrl(slug, issuer),
    authorizationCode: code,
    scope: PERSONA_SCOPE,
    fetchFn: steadyFetch
  });
  await afterGrant(slug);
}

/**
 * A persona's sign-in holds: tell the page, wake its Odd if the sign-in was
 * why it was quiet, or install it once the office is open.
 */
async function afterGrant(slug: string): Promise<void> {
  grantedThisRun.add(slug);
  emit({ type: 'persona', slug, joined: 'granted' });
  const odd = await personaOdd(slug);
  if (odd) {
    const quiet = odd.package?.quiet;
    if (quiet === 'grant' || quiet === 'signed-out') await setQuiet(odd.id, undefined);
    return;
  }
  if (await welcomed()) await installPersona(slug);
}

/** End a persona's sign-in at New Altitude and remove it here. Its Odd stays. */
async function forgetPersonaGrant(slug: string): Promise<void> {
  grantedThisRun.delete(slug);
  proposals.delete(slug);
  await exclusive(personaId(slug), async () => {
    await endSignIn(grant(slug), 'persona');
    // A delete the store refused keeps the name, so the next sign-out tries again.
    if (getSecret(personaId(slug), 'oauth') !== undefined) return;
    const kept = keptGrants();
    if (!kept.delete(slug)) return;
    // A list the store will not write keeps the name too. Sign-out goes on to
    // end every other sign-in and the account's own.
    try {
      saveKept(kept);
    } catch (e) {
      console.error(
        `[persona] the list of kept persona sign-ins still names ${slug}: ${reason(e)}`
      );
    }
  });
}

/** The owner's Disconnect: the persona's sign-in ends and its Odd goes quiet until Reconnect. */
export async function disconnectPersona(slug: string): Promise<void> {
  if (!isSlug(slug)) throw new SignInRefused(NO_SUCH);
  await forgetPersonaGrant(slug);
  const odd = await personaOdd(slug);
  if (odd) await setQuiet(odd.id, 'grant');
}

/**
 * Before the account signs out: end every persona's sign-in the kept list or
 * a persona Odd names, and make each persona Odd quiet until the owner signs
 * in and reconnects it.
 */
export async function endPersonaGrants(): Promise<void> {
  heardOffers(undefined);
  // Without the ledger, the kept list still names every sign-in, so the
  // owner's sign-out goes on and ends them all.
  const staff = await roster().catch((e: unknown) => {
    console.error(`[persona] the roster did not load, so no persona Odd went quiet: ${reason(e)}`);
    return [];
  });
  const odds = staff.filter((s) => s.package);
  const slugs = new Set([...odds.map((s) => s.package!.slug), ...keptGrants()]);
  for (const slug of slugs) await forgetPersonaGrant(slug);
  for (const odd of odds) await setQuiet(odd.id, 'signed-out');
}

type Listing = Exclude<Offers, { state: 'ok' }> | { state: 'ok'; listed: Listed[] };

/**
 * The personas New Altitude lists with an Odd for this account, each checked;
 * a bad one is left out. Each answer tells the Odds who can be proposed
 * (`heardOffers`); an unreachable New Altitude changes nothing there.
 */
async function readListing(): Promise<Listing> {
  const listing = await askListing();
  if (listing.state === 'ok') heardOffers(listing.listed);
  else if (listing.state !== 'unreachable') heardOffers(undefined);
  return listing;
}

async function askListing(): Promise<Listing> {
  if (accountStatus().state !== 'in') return { state: 'out' };
  // Signed in with `profile` alone: only a fresh sign-in can add personas.
  if (!accountHasPersonas()) return { state: 'rescope' };
  const token = await accountToken();
  // A refused refresh turned the account to expired; anything else is New Altitude not answering.
  if (!token) return accountStatus().state === 'in' ? { state: 'unreachable' } : { state: 'out' };
  let res: Response;
  try {
    res = await steadyFetch(`${accountSite()}/api/personas/odds`, {
      headers: { authorization: `Bearer ${token}`, 'accept-language': 'en-US' }
    });
  } catch (e) {
    console.error(`[persona] the list of personas did not load: ${reason(e)}`);
    return { state: 'unreachable' };
  }
  // The grant holds personas, so New Altitude turned the account down.
  if (res.status === 401) return { state: 'refused' };
  const body: unknown = res.ok ? await res.json().catch(() => undefined) : undefined;
  const odds = (body as { odds?: unknown } | undefined)?.odds;
  if (!Array.isArray(odds)) {
    console.error(`[persona] the list of personas came back ${res.status} with no list`);
    return { state: 'unreachable' };
  }
  const listed: Listed[] = [];
  for (const raw of odds as unknown[]) {
    const entry = readListed(raw);
    if (typeof entry === 'string') console.error(`[persona] left out: ${entry}`);
    else listed.push(entry);
  }
  return { state: 'ok', listed };
}

/**
 * Bring each persona Odd in line with the list: quiet when it is no longer
 * offered, speaking again when it is, and on a newer package. A quiet for its
 * own sign-in or the owner's sign-out stays: only the owner lifts those.
 */
async function applyListing(listed: Listed[]): Promise<void> {
  for (const odd of (await roster()).filter((s) => s.package)) {
    const link = odd.package!;
    const offered = listed.find((l) => l.slug === link.slug);
    if (!offered) {
      if (!link.quiet) await setQuiet(odd.id, 'access');
      continue;
    }
    if (link.quiet === 'access') await setQuiet(odd.id, undefined);
    if (offered.pkg.version <= link.version) continue;
    const problems = await packageProblems(offered, odd.id);
    if (problems.length)
      console.error(
        `[persona] ${link.slug} version ${offered.pkg.version} left out: ${problems.join('; ')}`
      );
    else await updatePersona(odd.id, offered.pkg, offered.disclosure);
  }
}

/** One offer as the page shows it, with the package's portrait drawn. */
async function toOffer(l: Listed): Promise<Offer> {
  const odd = await personaOdd(l.slug);
  const art = await preview({
    look: l.pkg.look,
    portraitPx: l.pkg.portraitPx,
    newParts: l.pkg.parts
  });
  return {
    slug: l.slug,
    displayName: l.displayName,
    jobTitle: l.jobTitle,
    disclosure: l.disclosure,
    name: l.pkg.name,
    role: l.pkg.role,
    remit: l.pkg.remit,
    portrait: art.portrait,
    joined: odd ? 'installed' : grantedThisRun.has(l.slug) ? 'granted' : 'no',
    ...(odd?.package?.quiet ? { quiet: odd.package.quiet } : {})
  };
}

/** Read New Altitude's list once, bring the persona Odds in line with it, and answer the offers. */
export async function syncPersonas(): Promise<Offers> {
  const listing = await readListing();
  if (listing.state !== 'ok') return listing;
  await applyListing(listing.listed);
  return { state: 'ok', offers: await Promise.all(listing.listed.map(toOffer)) };
}

/**
 * Hire the persona `slug` from its package, with nothing drawn, and have it
 * say its hello. A persona not offered, or a package that fails the look
 * checks, hires nobody: its sign-in ends, since nothing here would use it,
 * and the page hears the problem beside Add.
 */
export async function installPersona(slug: string): Promise<void> {
  const problem = async (why: string) => {
    console.error(`[persona] ${slug} was not added: ${why}`);
    await forgetPersonaGrant(slug);
    emit({ type: 'persona', slug, joined: 'no', problem: why });
  };
  if (await personaOdd(slug)) return;
  const listing = await readListing();
  if (listing.state !== 'ok') return problem('New Altitude did not send its list of personas.');
  const offered = listing.listed.find((l) => l.slug === slug);
  if (!offered) return problem(NOT_OFFERED);
  const problems = await packageProblems(offered);
  if (problems.length) return problem(problems.join('; '));
  let row;
  try {
    row = await hirePersona({
      slug,
      pkg: offered.pkg,
      disclosure: offered.disclosure,
      displayName: offered.displayName
    });
  } catch (e) {
    return problem(reason(e));
  }
  const owner = await ownerName();
  sayInChat(row.id, offered.pkg.hello.replaceAll('{owner}', owner));
  emit({ type: 'persona', slug, joined: 'installed' });
  // Added from a hire ask's window: the persona's join is the owner's answer to it.
  const askId = proposals.get(slug);
  proposals.delete(slug);
  if (askId !== undefined)
    await approveHire(
      askId,
      row.id,
      `${owner} added ${offered.displayName}'s New Altitude persona instead of a new Odd.`
    ).catch((e: unknown) =>
      console.error(`[persona] proposal ${askId} for ${slug} stays open: ${reason(e)}`)
    );
}

/** At Open the office: install each persona granted on the first visit's card. */
export async function installGrantedPersonas(): Promise<void> {
  for (const slug of grantedThisRun) await installPersona(slug);
}

/**
 * One turn of a persona Odd's persona, with its own sign-in. `chat` carries on
 * the Odd's conversation there. A sign-in that is gone, or whose refresh New
 * Altitude refused, is `grant`; one New Altitude could not be reached to
 * refresh is `failed`, and stays. `signal` (the run's Stop) ends the wait.
 */
export async function askPersona(
  who: StaffRow,
  message: string,
  o: { chat?: { ownerSaid: string }; signal?: AbortSignal } = {}
): Promise<DoorAnswer> {
  const slug = who.package?.slug;
  const issuer = accountIssuer();
  if (!slug || !issuer) return { outcome: 'grant' };
  const url = doorUrl(slug, issuer);
  const p = grant(slug);
  const token = await freshAccess(p, { serverUrl: () => url, scope: PERSONA_SCOPE });
  // A refused refresh clears the tokens (`invalidateCredentials`); an unreachable one keeps them.
  if (!token) return { outcome: p.tokens() ? 'failed' : 'grant' };
  const answer = await askDoor({
    url,
    token,
    message,
    chat: o.chat && { odd: who.id, ...o.chat },
    signal: o.signal
  });
  if (answer.outcome === 'grant') await dropRefused(slug, token);
  return answer;
}

/**
 * The door turned a live token down. Drop the sign-in's tokens, so Reconnect
 * runs a real sign-in instead of refreshing a grant the door keeps refusing.
 * Only when the refused token is still the kept one: a refresh meanwhile kept newer ones.
 */
async function dropRefused(slug: string, token: string): Promise<void> {
  await exclusive(personaId(slug), async () => {
    const kept = grant(slug);
    if (kept.tokens()?.access_token !== token) return;
    kept.invalidateCredentials('tokens');
    console.error(`[persona] ${slug}'s door refused its sign-in, so the office dropped it`);
  });
}
