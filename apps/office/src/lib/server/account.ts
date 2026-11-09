// The owner's New Altitude account, signed in from this office. The office is
// its own public client (registered on first use, PKCE, a loopback address),
// asks for the profile permission alone, and keeps the sign-in with who
// signed in as one secret, `new-altitude-account:oauth`, in the system's
// secret store. Error reports to New Altitude need it: `accountToken()` is the
// one way to get its token.
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { OFFICE_URL } from '@oddboro/ledger';
import { checkKeyring } from '@oddboro/ledger/checks';
import { secretStore } from '@oddboro/ledger/secrets';
import type { Account, AccountStatus } from '#lib/account.ts';
import { emit } from './events.ts';
import { deleteSecret } from './keychain.ts';
import {
  exclusive,
  freshAccess,
  KeychainProvider,
  steadyFetch,
  type ProviderPlace,
  type Saved
} from './oauth.ts';

/**
 * The New Altitude site that holds members' data. Read at each call, since
 * the settings file loads after this module does. Trailing slashes go here
 * once, so `${site()}/api/me` never doubles one.
 */
const site = () =>
  (process.env.ODDBORO_ACCOUNT_SITE || 'https://members.newaltitude.ai').replace(/\/+$/, '');

/** Who the owner is, and nothing more. Without it the SDK asks for every scope the site lists. */
const ACCOUNT_SCOPE = 'profile';
/** A name of its own, apart from any connector's. */
const ACCOUNT_ID = 'new-altitude-account';
const ACCOUNT_REDIRECT = `${OFFICE_URL}/account/callback`;
/** Sign-ins in flight, apart from the connectors' own. */
const pending = new Map<string, string>();
const ACCOUNT_PLACE: ProviderPlace = { redirect: ACCOUNT_REDIRECT, pending };

/** A reason the owner reads as written. Routes answer it with 409; anything else is New Altitude not answering. */
export class SignInRefused extends Error {}

/**
 * The store check's own fix when it fails. When it passes and a write still
 * fails, the store refused that write, as a locked one does, and the check has
 * no fix to give.
 */
const noStore = () =>
  new SignInRefused(
    `Signing in needs this computer's secret store, and it did not answer. ${checkKeyring().fix ?? 'Make sure it is unlocked, then click Sign in again.'}`
  );
const OLD_LINK = 'This sign-in link is old. Click Sign in in Oddboro again.';

class AccountProvider extends KeychainProvider {
  /**
   * A store that cannot write (a locked keyring, a cancelled unlock prompt)
   * is the owner's to fix, so it gets the store's words, not New Altitude's.
   * Its error is not logged: on a Mac the command it names holds the value.
   */
  protected write(saved: Saved): void {
    try {
      super.write(saved);
    } catch {
      throw noStore();
    }
  }
  /**
   * The resource is always the configured site, whatever the site's own
   * document names. The SDK's own check would refuse a site whose document
   * names another.
   */
  async validateResourceURL(serverUrl: URL): Promise<URL> {
    return serverUrl;
  }
  profile(): Account | undefined {
    return this.load().profile;
  }
  saveProfile(profile: Account): void {
    this.save({ profile });
  }
  status(): AccountStatus {
    const account = this.profile();
    if (!account) return { state: 'out' };
    return this.tokens() ? { state: 'in', account } : { state: 'expired', account };
  }
}

const provider = () => new AccountProvider(ACCOUNT_ID, ACCOUNT_PLACE);

/**
 * The status as last known, so a page load starts no secret-store process.
 * Signing in, signing out and each token check set it. A change it misses
 * (the secret deleted by hand, another office on this computer) shows at the
 * next GET /api/account, which reads the store. It stays the same object
 * until the status changes: reports reuse a token only while it does.
 */
let known: AccountStatus | undefined;

export function accountStatus(): AccountStatus {
  return (known ??= provider().status());
}

/** Keep the new status and tell every open page, when it changed. */
function settle(next: AccountStatus): void {
  if (JSON.stringify(next) === JSON.stringify(known)) return;
  known = next;
  emit({ type: 'account', status: next });
}

/** Start signing in: the New Altitude page to open, or '' when a kept sign-in still worked. */
export async function startAccountSignIn(): Promise<{ url: string }> {
  // Refused before any request: tokens never go anywhere but the secret store.
  if (!secretStore().ok) throw noStore();
  // Only the newest page can finish: the store keeps one verifier, this
  // Sign in's, so an older page's code would fail its exchange.
  pending.clear();
  const p = provider();
  const result = await auth(p, { serverUrl: site(), scope: ACCOUNT_SCOPE, fetchFn: steadyFetch });
  if (result === 'AUTHORIZED') {
    // A kept sign-in still worked, though the page showed none (its profile
    // was missing, or another office signed in): ask who it is.
    await keepWhoSignedIn(p);
    return { url: '' };
  }
  // The SDK sets it in redirectToAuthorization, which REDIRECT always calls.
  return { url: p.url!.toString() };
}

/** New Altitude sent the owner back with a code: trade it, then ask once who signed in. */
export async function finishAccountSignIn(state: string, code: string): Promise<Account> {
  const ours = pending.get(state) === ACCOUNT_ID;
  pending.delete(state);
  const p = provider();
  // A failed exchange clears the kept tokens, so a page that arrives while a
  // sign-in is live never gets as far as one.
  if (!ours || p.tokens()) throw new SignInRefused(OLD_LINK);
  await auth(p, {
    serverUrl: site(),
    authorizationCode: code,
    scope: ACCOUNT_SCOPE,
    fetchFn: steadyFetch
  });
  return keepWhoSignedIn(p);
}

/**
 * The sign-in has tokens: ask New Altitude who signed in, keep it, and tell
 * every open page. Any failure signs out, so no tokens stay without the
 * account the page needs to show them and offer Sign out.
 */
async function keepWhoSignedIn(p: AccountProvider): Promise<Account> {
  try {
    const account = await whoSignedIn(p.tokens()?.access_token);
    if (!account)
      throw new SignInRefused('New Altitude did not say who signed in. Try Sign in again.');
    p.saveProfile(account);
    settle(p.status());
    return account;
  } catch (e) {
    await signOut();
    throw e;
  }
}

/** `/api/me` on the members' site, never the issuer. Only an id, a name and an email are kept. */
async function whoSignedIn(token: string | undefined): Promise<Account | undefined> {
  if (!token) return undefined;
  const res = await steadyFetch(`${site()}/api/me`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (res.status !== 200) return undefined;
  const me: unknown = await res.json().catch(() => undefined);
  if (!me || typeof me !== 'object') return undefined;
  const { id, name, email } = me as Record<string, unknown>;
  if (typeof id !== 'string' || typeof email !== 'string') return undefined;
  return { id, name: typeof name === 'string' ? name : null, email };
}

/**
 * The account's live access token, refreshed when it is close to running out;
 * undefined when signed out, refused, or New Altitude could not be reached.
 * A refusal turns the status to expired and tells every open page.
 */
export async function accountToken(): Promise<string | undefined> {
  const p = provider();
  const token = await freshAccess(p, { serverUrl: site, scope: ACCOUNT_SCOPE });
  // Compared with the module's status, so callers sharing one refusal emit once.
  settle(p.status());
  return token;
}

/** End the sign-in at New Altitude, then remove it here, even when New Altitude cannot be reached. */
export async function signOut(): Promise<void> {
  await exclusive(ACCOUNT_ID, async () => {
    const saved = provider();
    const refresh = saved.tokens()?.refresh_token;
    const client = saved.clientInformation()?.client_id;
    const endpoint = revocationEndpoint(saved.discoveryState());
    if (refresh && client && endpoint) {
      const body = new URLSearchParams({
        token: refresh,
        token_type_hint: 'refresh_token',
        client_id: client
      });
      // New Altitude answers 200 whatever it ended; only an unreachable server is a failure.
      await steadyFetch(endpoint, { method: 'POST', body }).catch(() =>
        console.error(
          `[account] could not reach ${new URL(endpoint).host} to end the sign-in there`
        )
      );
    }
    // False when there was nothing to delete, which is fine here.
    deleteSecret(ACCOUNT_ID, 'oauth');
  });
  settle({ state: 'out' });
}

/** The revocation endpoint from the kept discovery, checked: the blob is JSON from the store. */
function revocationEndpoint(discovery: unknown): string | undefined {
  const meta = (discovery as { authorizationServerMetadata?: { revocation_endpoint?: unknown } })
    ?.authorizationServerMetadata;
  return typeof meta?.revocation_endpoint === 'string' ? meta.revocation_endpoint : undefined;
}
