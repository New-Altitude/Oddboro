// Signing in with OAuth, through the MCP SDK: to hosted MCP servers, since a
// headless staffer cannot reuse Claude Code's own sign-ins, and to the owner's
// New Altitude account (`account.ts`). The office registers as a client, sends
// the owner to the service's sign-in page, takes the code at its callback, and
// keeps the tokens in the system's secret store. Before each use it refreshes
// them, one refresh per sign-in at a time, and passes the access token on.
import { randomUUID } from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { connector, tickKey, OFFICE_URL } from '@oddboro/ledger';
import { fixedError } from '@oddboro/ledger/errors';
import type { Account } from '#lib/account.ts';
import { getSecret, setSecret } from './keychain.ts';

export const REDIRECT = `${OFFICE_URL}/connect/callback`;
/** Refresh a token this long before it runs out. */
const MARGIN_MS = 5 * 60_000;

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
  constructor(id: string, place: ProviderPlace) {
    this.id = id;
    this.place = place;
  }

  /**
   * The saved sign-in, read from the secret store once and then kept. Each
   * read starts a process (`security`, `secret-tool`), so a call reads once.
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
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Oddboro office',
      redirect_uris: [this.place.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    };
  }
  state() {
    const s = randomUUID();
    this.place.pending.set(s, this.id);
    return s;
  }
  clientInformation() {
    return this.load().client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    this.save({ client });
  }
  tokens() {
    return this.load().tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.save({ tokens, savedAt: Date.now() });
  }
  redirectToAuthorization(url: URL) {
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

async function serverUrl(id: string): Promise<string> {
  const c = await connector(id);
  if (!c?.config.url) throw new Error(`${id} is not a hosted server`);
  return c.config.url;
}

/**
 * Start signing in. Returns the page to open, or nothing when the tool was
 * already signed in (a stored refresh token still works).
 */
export async function startSignIn(id: string): Promise<{ url?: string }> {
  const provider = new KeychainProvider(id, CONNECTOR);
  const result = await auth(provider, { serverUrl: await serverUrl(id), fetchFn: steadyFetch });
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
  await auth(new KeychainProvider(id, CONNECTOR), {
    serverUrl: await serverUrl(id),
    authorizationCode: code,
    fetchFn: steadyFetch
  });
  await tickKey(`oauth:${id}`);
  return id;
}

/** A live access token for a run, refreshed when it is close to running out. */
export function bearer(id: string): Promise<string | undefined> {
  return freshAccess(new KeychainProvider(id, CONNECTOR), { serverUrl: () => serverUrl(id) });
}
