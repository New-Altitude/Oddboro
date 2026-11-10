// Signing in with OAuth, through the MCP SDK: to hosted MCP servers, since a
// headless staffer cannot reuse Claude Code's own sign-ins, to Google, and to
// the owner's New Altitude account (`account.ts`). The office registers as a
// client, sends the owner to the service's sign-in page, takes the code at its
// callback, and keeps the tokens in the system's secret store. The gateway
// asks `bearer` for a fresh access token; each refresh runs once per sign-in
// at a time.
//
// Google is the same flow with a fixed client: New Altitude's Desktop client,
// so no owner makes one of their own. Its id ships in the code; its secret,
// which Google says a desktop app cannot keep, comes from the build
// (ODDBORO_GOOGLE_CLIENT_SECRET) and never sits in the repo. Each Google
// connector signs in on its own, with its product's scopes, and one Google
// account is one connector: a sign-in to an address another connector of the
// same product holds is not kept.
//
// GitHub lets no app register itself, so a hosted server that signs in
// through GitHub (GitHub's own MCP server) signs in with New Altitude's GitHub
// OAuth App the same way: its id in the code, its secret from the build
// (ODDBORO_GITHUB_CLIENT_SECRET), and the office's own scopes.
import { randomUUID } from 'node:crypto';
import {
  auth,
  discoverOAuthServerInfo,
  type OAuthClientProvider
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  connector,
  googleAccountHeld,
  OFFICE_URL,
  sayOnSignIn,
  signedInAs,
  tickKey,
  type GoogleProduct
} from '@oddboro/ledger';
import { fixedError } from '@oddboro/ledger/errors';
import type { Account } from '#lib/account.ts';
import { deleteSecret, getSecret, setSecret } from './keychain.ts';

export const REDIRECT = `${OFFICE_URL}/connect/callback`;
/** Refresh a token this long before it runs out. Reports reuse a token for less (`TOKEN_REUSE_MS`). */
export const MARGIN_MS = 5 * 60_000;

const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_CLIENT_ID = '143017077978-dd33kak7rf2m1praobmbc0olv7kjf5gp.apps.googleusercontent.com';
/**
 * The scopes each Google product asks for, space-separated. Gmail's
 * settings.basic is for the filters the office creates on the owner's click.
 */
export const GOOGLE_SCOPES: Record<GoogleProduct, string> = {
  gmail:
    'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.settings.basic',
  drive: 'https://www.googleapis.com/auth/drive'
};

/** Where each Google product says which account a token reaches. */
const WHO: Record<GoogleProduct, string> = {
  gmail: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
  drive: 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)'
};

/**
 * Whether a stored sign-in covers every scope asked for. One that does not
 * say counts as covering them.
 */
const covers = (tokens: OAuthTokens | undefined, scopes: string): boolean => {
  if (!tokens?.scope) return true;
  const has = new Set(tokens.scope.split(/\s+/));
  return scopes.split(/\s+/).every((s) => has.has(s));
};

/** The sign-in server GitHub's hosted MCP server names. It offers no registration. */
const GITHUB_ISSUER = 'https://github.com/login/oauth';
/** New Altitude's GitHub OAuth App, "Oddboro". */
const GITHUB_CLIENT_ID = 'Ov23liHSAMGGQ2kvqbkS';
/**
 * What a GitHub sign-in asks for: the repositories the owner can reach (GitHub
 * has no scope that reads private ones only; the server's address and the
 * Odd's grant hold what it may do), their organizations, and who they are.
 * Never the packages, gists, projects or notifications GitHub's server also
 * lists, which the SDK would ask for on its own.
 */
export const GITHUB_SCOPES = 'repo read:org read:user';

/**
 * Whether a sign-in server's address, as the server gave it, is `b`, with or
 * without one trailing slash. No pattern, since the address comes from the
 * server and a pattern on it can be made slow.
 */
const sameServer = (a: string | undefined, b: string) => a === b || a === `${b}/`;

/** A build without a sign-in client's secret: that sign-in cannot start, whatever the server offers. */
export class BuiltWithout extends Error {}

/** New Altitude's Google client, or why this build cannot sign in to Google. */
function googleClient(): OAuthClientInformationMixed {
  const secret = process.env.ODDBORO_GOOGLE_CLIENT_SECRET;
  if (!secret)
    throw new BuiltWithout(
      'This copy of Oddboro was built without its Google sign-in. Update Oddboro, or in development set ODDBORO_GOOGLE_CLIENT_SECRET in .env.'
    );
  return {
    client_id: GOOGLE_CLIENT_ID,
    client_secret: secret,
    token_endpoint_auth_method: 'client_secret_post'
  };
}

/** New Altitude's GitHub app, or why this build cannot sign in through GitHub. */
function githubClient(): OAuthClientInformationMixed {
  const secret = process.env.ODDBORO_GITHUB_CLIENT_SECRET;
  if (!secret)
    throw new BuiltWithout(
      'This copy of Oddboro was built without its GitHub sign-in. Update Oddboro, or in development set ODDBORO_GITHUB_CLIENT_SECRET in .env.'
    );
  return {
    client_id: GITHUB_CLIENT_ID,
    client_secret: secret,
    token_endpoint_auth_method: 'client_secret_post'
  };
}

/**
 * Failures raised before any connection exists, so the request was never
 * sent: no address for the host, no route to it or its network, a refusal, or
 * no connection within fetch's connect timeout. Every other failure counts as
 * maybe sent, since a refresh token or a code sent twice ends the sign-in.
 */
const NEVER_SENT = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT'
]);

/**
 * fetch, retried once when the request was never sent. A request whose answer
 * was lost is not retried within one request; the next request that needs it
 * sends it again. The failure's real cause goes in the error and the service
 * log.
 */
export const steadyFetch: FetchLike = async (input, init) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      const why = cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e));
      console.error(`[oauth] ${String(input)} failed (attempt ${attempt}): ${why}`);
      if (attempt >= 2 || !NEVER_SENT.has(cause?.code ?? ''))
        throw new Error(`Could not reach ${new URL(String(input)).host}: ${why}`);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
};

export type Saved = {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  savedAt?: number;
  verifier?: string;
  discovery?: unknown;
  /** Only the New Altitude sign-in keeps who signed in. */
  profile?: Account;
};

/** Where a kind of sign-in lives: connectors have one, the New Altitude account another. */
export type ProviderPlace = {
  /** Where the service sends the owner back. */
  redirect: string;
  /** Sign-ins in flight: the state the service sends back, to the id it was for. */
  pending: Map<string, string>;
};

/** Sign-ins in flight: the state the service sends back, to the connector it was for. */
const pending = new Map<string, string>();
const CONNECTOR: ProviderPlace = { redirect: REDIRECT, pending };

export class KeychainProvider implements OAuthClientProvider {
  url: URL | undefined;
  // Not parameter properties: Node's type stripping, which the office's tests
  // run on, cannot load one.
  readonly id: string;
  private readonly place: ProviderPlace;
  private kept: Saved | undefined;
  /** For a Google connector, the scopes it signs in with; else undefined. */
  readonly google: string | undefined;
  /** Sign in afresh, as if none were stored: the stored one lacks a scope. */
  fresh = false;
  constructor(id: string, place: ProviderPlace, google?: string) {
    this.id = id;
    this.place = place;
    this.google = google;
  }

  /**
   * The saved sign-in, read from the secret store once and then kept. Each
   * read can start a process (`security`, `secret-tool`), so a call reads once.
   * Every caller builds its provider per call, so the copy never outlives one.
   */
  protected load(): Saved {
    return (this.kept ??= this.read());
  }
  private read(): Saved {
    try {
      return JSON.parse(getSecret(this.id, 'oauth') ?? '{}') as Saved;
    } catch {
      return {};
    }
  }
  /** Merges into what the store holds now, not the kept copy, so a write never undoes another. */
  protected save(patch: Saved): void {
    this.write({ ...this.read(), ...patch });
  }
  /** Every write of the sign-in goes through here. */
  protected write(saved: Saved): void {
    setSecret(this.id, 'oauth', JSON.stringify(saved));
    this.kept = saved;
  }
  /** Drop the kept copy, so the next load reads the store again. */
  forget(): void {
    this.kept = undefined;
  }

  get redirectUrl() {
    return this.place.redirect;
  }
  /** Whether this sign-in goes through GitHub, from the server the office found (`knowServer`). */
  get github(): boolean {
    const found = this.load().discovery as { authorizationServerUrl?: string } | undefined;
    return sameServer(found?.authorizationServerUrl, GITHUB_ISSUER);
  }
  /** The scopes this sign-in asks for: the office's own for Google and GitHub, else the server's. */
  get scope(): string | undefined {
    return this.google ?? (this.github ? GITHUB_SCOPES : undefined);
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Oddboro office',
      redirect_uris: [this.place.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...(this.google
        ? { scope: this.google, token_endpoint_auth_method: 'client_secret_post' }
        : { token_endpoint_auth_method: 'none' })
    };
  }
  state() {
    const s = randomUUID();
    this.place.pending.set(s, this.id);
    return s;
  }
  clientInformation() {
    if (this.google) return googleClient();
    if (this.github) return githubClient();
    return this.load().client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    // Google's and GitHub's clients are fixed and never registered, so nothing
    // to keep, and their secret never goes in the store.
    if (!this.google && !this.github) this.save({ client });
  }
  tokens() {
    return this.fresh ? undefined : this.load().tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.save({ tokens, savedAt: Date.now() });
  }
  redirectToAuthorization(url: URL) {
    // Google gives a refresh token only when asked for offline access, and
    // again only with a fresh consent. The owner picks which account.
    if (this.google) {
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent select_account');
    }
    this.url = url;
  }
  saveCodeVerifier(verifier: string) {
    this.save({ verifier });
  }
  codeVerifier() {
    const v = this.load().verifier;
    if (!v) throw fixedError('No sign-in is in progress for this tool');
    return v;
  }
  discoveryState() {
    return this.load().discovery as never;
  }
  saveDiscoveryState(discovery: unknown) {
    this.save({ discovery });
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') this.write({});
    else
      this.save(
        scope === 'client'
          ? { client: undefined }
          : scope === 'tokens'
            ? { tokens: undefined }
            : scope === 'verifier'
              ? { verifier: undefined }
              : { discovery: undefined }
      );
  }
  expiresAt(): number | undefined {
    const s = this.load();
    return s.tokens?.expires_in && s.savedAt ? s.savedAt + s.tokens.expires_in * 1000 : undefined;
  }
}

/**
 * One refresh per sign-in at a time. New Altitude treats a refresh token sent
 * twice as stolen and ends the whole sign-in, so callers that arrive while one
 * runs share its answer.
 */
const refreshing = new Map<string, Promise<unknown>>();
function once<T>(id: string, run: () => Promise<T>): Promise<T> {
  // A caller that shares a run gets that run's answer, whatever its type. The
  // one caller that can share, `freshAccess`, only compares the answer with
  // 'AUTHORIZED', which a sign-out's answer never is.
  const running = refreshing.get(id) as Promise<T> | undefined;
  if (running) return running;
  const started = run().finally(() => refreshing.delete(id));
  refreshing.set(id, started);
  return started;
}

/**
 * Run with this sign-in's slot to itself: wait out a refresh in flight, then
 * hold the slot so none starts. Sign-out uses it, so a late refresh cannot
 * write tokens back after the delete.
 *
 * Order matters: the refresh's own caller (`freshAccess`) awaited the shared
 * promise before this did, so it resumes first, and the account's status it
 * reports is settled before the sign-out sets it to out.
 */
export async function exclusive<T>(id: string, run: () => Promise<T>): Promise<T> {
  // A failed refresh is its own caller's to report; here it only has to end.
  for (let r = refreshing.get(id); r; r = refreshing.get(id)) await r.catch(() => undefined);
  return once(id, run); // same tick as the last check, so nothing slips in between
}

/** A live access token, refreshed once when close to running out; undefined when there is none or the refresh failed. */
export async function freshAccess(
  provider: KeychainProvider,
  at: { serverUrl: () => Promise<string> | string; scope?: string }
): Promise<string | undefined> {
  if (!provider.tokens()) return undefined;
  const ends = provider.expiresAt();
  if (ends !== undefined && ends - MARGIN_MS < Date.now()) {
    const result = await once(provider.id, async () =>
      auth(provider, {
        serverUrl: await at.serverUrl(),
        scope: at.scope,
        fetchFn: steadyFetch
      }).catch((e: unknown) => {
        console.error(
          `[oauth] refresh for ${provider.id} failed: ${e instanceof Error ? e.message : String(e)}`
        );
        return 'FAILED' as const;
      })
    );
    // A caller that shared another's refresh holds a copy from before it.
    provider.forget();
    if (result !== 'AUTHORIZED') return undefined;
  }
  return provider.tokens()?.access_token;
}

/** A connector's provider and the address its sign-in is found from. */
async function signInFor(id: string): Promise<{ provider: KeychainProvider; serverUrl: string }> {
  const c = await connector(id);
  if (c?.config.oauth === 'google') {
    const scope = c.config.google && GOOGLE_SCOPES[c.config.google];
    if (!scope) throw new Error(`${c.name} does not say which Google product it is`);
    return { provider: new KeychainProvider(id, CONNECTOR, scope), serverUrl: GOOGLE_ISSUER };
  }
  if (!c?.config.url) throw new Error(`${id} is not a hosted server`);
  return { provider: new KeychainProvider(id, CONNECTOR), serverUrl: c.config.url };
}

/**
 * Find a hosted server's sign-in server before the SDK does, and keep it as
 * the SDK keeps it, which then uses it. The SDK picks the scopes before it
 * asks for the client, so a sign-in through GitHub would otherwise ask for
 * every scope GitHub's server lists.
 */
async function knowServer(provider: KeychainProvider, serverUrl: string): Promise<void> {
  if (provider.discoveryState() !== undefined) return;
  const found = await discoverOAuthServerInfo(serverUrl, { fetchFn: steadyFetch });
  provider.saveDiscoveryState({
    authorizationServerUrl: String(found.authorizationServerUrl),
    resourceMetadata: found.resourceMetadata,
    authorizationServerMetadata: found.authorizationServerMetadata
  });
}

/**
 * Start signing in. Returns the page to open, or nothing when the tool was
 * already signed in (a stored refresh token still works).
 */
export async function startSignIn(id: string): Promise<{ url?: string }> {
  const { provider, serverUrl } = await signInFor(id);
  // A Google sign-in made before the office asked for a scope would only be
  // renewed, still without it: Google asks for consent again instead. The
  // stored one keeps working until the new one lands.
  if (provider.google && !covers(provider.tokens(), provider.google)) provider.fresh = true;
  if (!provider.google) await knowServer(provider, serverUrl);
  const result = await auth(provider, { serverUrl, scope: provider.scope, fetchFn: steadyFetch });
  if (result === 'AUTHORIZED') {
    await tickKey(`oauth:${id}`);
    return {};
  }
  return { url: provider.url?.toString() };
}

/** The service sent the owner back with a code. Trade it for tokens. */
export async function finishSignIn(state: string, code: string): Promise<string> {
  const id = pending.get(state);
  if (!id) throw fixedError('This sign-in link is old. Click Sign in on the task again.');
  pending.delete(state);
  const { provider, serverUrl } = await signInFor(id);
  // What the store held before, to put back if this Google sign-in is not kept.
  const before = getSecret(id, 'oauth');
  await auth(provider, {
    serverUrl,
    authorizationCode: code,
    scope: provider.scope,
    fetchFn: steadyFetch
  });
  if (provider.google) await keepGoogleAccount(id, provider.tokens()?.access_token, before);
  await tickKey(`oauth:${id}`);
  return id;
}

/**
 * Show which Google account a connector reaches, as "Gmail (ada@example.com)",
 * so the owner knows whose mail or files an Odd holds. One account is one
 * connector: a sign-in to an address another connector of the same product
 * holds comes out of the secret store, and the store holds what it did
 * before. Google is not told, since cancelling there would end the other
 * connector's sign-in too. The owner reads why on this page and on the task.
 * Best effort: an address that cannot be read leaves the plain name.
 */
async function keepGoogleAccount(
  id: string,
  token: string | undefined,
  before: string | undefined
): Promise<void> {
  const c = await connector(id);
  const address = c?.config.google && token ? await googleAddress(c.config.google, token) : '';
  if (!address) return;
  const held = await googleAccountHeld(id, address);
  if (!held) return signedInAs(id, address);
  if (before && hadTokens(before)) setSecret(id, 'oauth', before);
  else deleteSecret(id, 'oauth');
  const words = `${address} is already connected as ${held.name}.`;
  await sayOnSignIn(id, `${words} Sign in with another Google account.`);
  throw new Error(
    `${words} This sign-in was not kept. Click Sign in on the task again and pick another Google account.`
  );
}

/** Whether a stored sign-in held tokens, rather than only a sign-in under way. */
function hadTokens(saved: string): boolean {
  try {
    return !!(JSON.parse(saved) as Saved).tokens;
  } catch {
    return false;
  }
}

/** The address a Google token reaches, or nothing when Google does not say. */
async function googleAddress(product: GoogleProduct, token: string): Promise<string> {
  try {
    const res = await fetch(WHO[product], { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return '';
    const body = (await res.json()) as { emailAddress?: string; user?: { emailAddress?: string } };
    return body.emailAddress ?? body.user?.emailAddress ?? '';
  } catch {
    return '';
  }
}

/** A live access token for a run, refreshed when it is close to running out. */
export async function bearer(id: string): Promise<string | undefined> {
  const { provider, serverUrl } = await signInFor(id);
  return freshAccess(provider, { serverUrl: () => serverUrl });
}
