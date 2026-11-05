// Signing in to hosted MCP servers. A headless staffer cannot reuse Claude
// Code's own sign-ins, so the office runs OAuth itself with the MCP SDK: it
// registers as a client, sends the owner to the service's sign-in page, takes the
// code at /connect/callback, and keeps the tokens in the macOS keychain.
// Before each run it refreshes them and passes the access token as a header.
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
import { getSecret, setSecret } from './keychain.ts';

export const REDIRECT = `${OFFICE_URL}/connect/callback`;
/** Refresh a token this long before it runs out. */
const MARGIN_MS = 5 * 60_000;

/**
 * fetch, retried once when the network drops a request before any answer
 * comes back. The failure's real cause goes in the error and the service log.
 */
const steadyFetch: FetchLike = async (input, init) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      const why = cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e));
      console.error(`[oauth] ${String(input)} failed (attempt ${attempt}): ${why}`);
      if (attempt >= 2) throw new Error(`Could not reach ${new URL(String(input)).host}: ${why}`);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
};

type Saved = {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  savedAt?: number;
  verifier?: string;
  discovery?: unknown;
};

/** Sign-ins in flight: the state the service sends back, to the connector it was for. */
const pending = new Map<string, string>();

class KeychainProvider implements OAuthClientProvider {
  url: URL | undefined;
  // Not a parameter property: Node's type stripping, which the office's tests
  // run on, cannot load one.
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }

  private load(): Saved {
    try {
      return JSON.parse(getSecret(this.id, 'oauth') ?? '{}') as Saved;
    } catch {
      return {};
    }
  }
  private save(patch: Saved) {
    setSecret(this.id, 'oauth', JSON.stringify({ ...this.load(), ...patch }));
  }

  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Oddboro office',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    };
  }
  state() {
    const s = randomUUID();
    pending.set(s, this.id);
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
    if (scope === 'all') setSecret(this.id, 'oauth', '{}');
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
  const provider = new KeychainProvider(id);
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
  await auth(new KeychainProvider(id), {
    serverUrl: await serverUrl(id),
    authorizationCode: code,
    fetchFn: steadyFetch
  });
  await tickKey(`oauth:${id}`);
  return id;
}

/** A live access token for a run, refreshed when it is close to running out. */
export async function bearer(id: string): Promise<string | undefined> {
  const provider = new KeychainProvider(id);
  if (!provider.tokens()) return undefined;
  const ends = provider.expiresAt();
  if (ends !== undefined && ends - MARGIN_MS < Date.now()) {
    const result = await auth(provider, {
      serverUrl: await serverUrl(id),
      fetchFn: steadyFetch
    }).catch(() => 'FAILED');
    if (result !== 'AUTHORIZED') return undefined;
  }
  return provider.tokens()?.access_token;
}
