import type { MagpieGroup, MagpieModel, MagpieProvider, MagpieSignIn } from '../magpie.ts';

export class MagpieError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Discovery stays local without DNS or alternate IP spellings. Check the raw
 * authority before URL parsing can normalize another spelling into loopback.
 */
export function magpieLoopback(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^http:\/\/(127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}\/?$/.test(value)
  )
    throw new MagpieError('Use an http address with literal 127.0.0.1 or [::1] and a port.');
  const port = Number(/:([0-9]+)\/?$/.exec(value)?.[1]);
  if (port < 1 || port > 65535) throw new MagpieError('Use a valid local port.');
  return value.replace(/\/$/, '');
}

/** Remote credentials require explicit HTTPS; advertised internal URLs cannot select a server. */
export function magpieServer(value: unknown): string {
  if (typeof value !== 'string' || !/^https:\/\/[^/?#\\\s]+\/?$/.test(value) || value.includes('@'))
    throw new MagpieError(
      'Use an HTTPS server root URL without credentials, a path, query or fragment.'
    );
  try {
    const url = new URL(value);
    if (
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid server origin');
    return url.origin;
  } catch {
    throw new MagpieError('Use a valid HTTPS server root URL.');
  }
}

/** Parse the official Browser access link without forwarding its credential query. */
export function magpieAccessLink(
  value: unknown,
  location: 'local' | 'server'
): { origin: string; key: string } {
  const invalid = () => new MagpieError('Paste a valid Magpie Browser access link.');
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f]/.test(value))
    throw invalid();
  // Validate the original authority before URL normalization, so alternate
  // IPv4 spellings cannot turn into the literal local loopback address.
  const match = /^(https?:\/\/[^/?#\\\s]+)\/?\?([^#\s]*)$/.exec(value);
  if (!match || !match[2].startsWith('k=') || match[2].includes('&')) throw invalid();
  const parameters = new URLSearchParams(match[2]);
  if ([...parameters.keys()].length !== 1 || !parameters.has('k')) throw invalid();
  let origin: string;
  try {
    origin = location === 'server' ? magpieServer(match[1]) : magpieLoopback(match[1]);
  } catch {
    throw invalid();
  }
  const key = parameters.get('k');
  if (!key || !/^[A-Za-z0-9._~-]{16,4096}$/.test(key)) throw invalid();
  return { origin, key };
}

export const magpieCookieName = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^magpie_web_[1-9][0-9]{0,4}$/.test(value) &&
  Number(value.slice(11)) <= 65535;

/** Supported web sign-in exchanges a body key for the internal listener's cookie name. */
export async function magpieServerSession(origin: string, key: string): Promise<string> {
  const base = magpieServer(origin);
  let response: Response;
  try {
    response = await fetch(`${base}/_magpie/sign-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: base,
        'Sec-Fetch-Site': 'same-origin'
      },
      body: new URLSearchParams({ key, back: '/' }),
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000)
    });
  } catch {
    throw new MagpieError(
      'The Magpie server did not answer securely. Check its HTTPS certificate and address.',
      503
    );
  }
  await response.body?.cancel();
  if (response.status !== 303)
    throw new MagpieError(
      'The Magpie server refused its management sign-in. Check the access link or web key.',
      502
    );
  const location = response.headers.get('location');
  if (location !== '/' && location !== `${base}/`)
    throw new MagpieError('The Magpie server returned an unsupported sign-in redirect.', 502);
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0];
    const at = pair.indexOf('=');
    const name = pair.slice(0, at);
    if (magpieCookieName(name) && pair.slice(at + 1) === key) return name;
  }
  throw new MagpieError(
    'The Magpie server did not establish its supported management session.',
    502
  );
}

export type ObjectValue = Record<string, unknown>;
export const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const word = (value: unknown, max = 256): string =>
  typeof value === 'string' ? value.slice(0, max) : '';
export const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
export const id = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._~:@/+-]{1,256}$/.test(value))
    throw new MagpieError('Choose a valid Magpie item.');
  return value;
};

/**
 * Management uses its own cookie key; inference uses only its separate token,
 * with no browser headers. Never follow redirects with either credential.
 * Fixed paths, time/size bounds and generic errors keep this from being a proxy.
 */
export async function magpieRequest(
  origin: string,
  key: string,
  path: string,
  body?: unknown,
  inference = false,
  location: 'local' | 'server' = 'local',
  managementCookie?: string
): Promise<unknown> {
  const remote = location === 'server';
  const base = remote ? magpieServer(origin) : magpieLoopback(origin);
  if (
    !(inference
      ? remote
        ? path === '/v1' || path === '/v1/models'
        : path === '/v1/magpie/integration' || path === '/v1' || path === '/v1/models'
      : /^\/api\/[a-zA-Z0-9/_-]+$/.test(path))
  )
    throw new MagpieError('Unsupported Magpie operation.');
  if (managementCookie !== undefined && !magpieCookieName(managementCookie))
    throw new MagpieError('The saved Magpie management session is invalid. Reconnect it.');
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(inference
          ? key
            ? { Authorization: `Bearer ${key}` }
            : {}
          : {
              Cookie: `${managementCookie || `magpie_web_${new URL(base).port || (remote ? '443' : '80')}`}=${key}`,
              Origin: base,
              'Sec-Fetch-Site': 'same-origin'
            }),
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000)
    });
  } catch {
    throw new MagpieError(
      remote
        ? 'The Magpie server did not answer securely. Check its HTTPS certificate and address.'
        : 'Magpie did not answer. Check that its local web service is running.',
      503
    );
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new MagpieError('Magpie redirected the request. Check the local connection.', 502);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new MagpieError(
      response.status === 401 || response.status === 403
        ? inference
          ? 'Magpie refused the inference token. Check its gateway key and network sharing settings.'
          : 'Magpie refused its management key. Check the access link or web key.'
        : `Magpie could not complete this operation (HTTP ${response.status}).`,
      response.status === 404 ? 404 : 502
    );
  }
  if (response.status === 204) return null;
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new MagpieError('This service did not return Magpie JSON.', 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MagpieError('Magpie returned an empty response.', 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new MagpieError('Magpie response is too large.', 502);
      }
      chunks.push(next.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (object(value).error && typeof object(value).state !== 'string')
      throw new MagpieError('Magpie could not complete this operation.', 502);
    return value;
  } catch (error) {
    if (error instanceof MagpieError) throw error;
    throw new MagpieError('Magpie returned an unreadable response.', 502);
  }
}

export function magpieProviders(raw: unknown): MagpieProvider[] {
  return list(object(raw).providers)
    .slice(0, 1000)
    .map((value) => {
      const p = object(value);
      const provider = word(p.id);
      return {
        id: provider,
        name: word(p.name),
        preset: word(p.preset),
        // Endpoint headers, keys, query strings and custom bodies are intentionally excluded.
        chat: safeEndpoint(p.chat),
        responses: safeEndpoint(p.responses),
        anthropic: safeEndpoint(p.anthropic),
        ready: p.ready === true,
        off: p.off === true,
        keySet: object(p.key).set === true,
        subscription: !!p.account,
        keys: list(p.keyList)
          .slice(0, 1000)
          .map((value) => {
            const k = object(value);
            return {
              id: word(k.id),
              name: word(k.name),
              on: k.on === true,
              active: k.active === true
            };
          }),
        models: list(p.models)
          .filter((m) => object(m).on === true && !object(m).noAPI)
          .slice(0, 5000)
          .map((model): MagpieModel => {
            const m = object(model);
            return {
              id: `${provider}/${word(m.id)}`,
              name: word(m.name) || word(m.id),
              provider,
              images: m.images === true
            };
          })
      };
    });
}

function safeEndpoint(value: unknown): string {
  try {
    const u = new URL(word(value, 2048));
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

export function magpieGroups(raw: unknown): MagpieGroup[] {
  return list(object(raw).groups)
    .slice(0, 1000)
    .map((value) => {
      const g = object(value);
      return {
        id: word(g.id),
        name: word(g.name),
        ref: word(g.ref) || `group/${word(g.id)}`,
        members: list(g.members).map((m) => word(m)),
        routing: word(g.routing) as MagpieGroup['routing'],
        ready: g.ready === true,
        firstToken: number(g.firstToken),
        patience: number(g.patience)
      };
    });
}

export function magpieSignIn(raw: unknown): MagpieSignIn {
  const s = object(raw);
  let url = '';
  try {
    const u = new URL(word(s.url, 8192));
    if (u.protocol === 'https:' && !u.username && !u.password) url = u.toString();
  } catch {
    /* No link before the provider has one. */
  }
  return {
    id: word(s.id),
    agent: word(s.agent),
    state: word(s.state),
    url,
    code: word(s.code),
    pasteCallback: s.pasteCallback === true,
    pasteCode: s.pasteCode === true,
    pasteKey: s.pasteKey === true,
    instructions: word(s.instructions, 4096),
    user: word(s.user),
    error: s.error ? 'Sign-in failed. Check the selected provider and try again.' : ''
  };
}

export type MagpieEndpointStatus = 'magpie' | 'absent' | 'unknown';

/** Public metadata only. Unknown local listeners are never mistaken for absence. */
export async function magpieEndpoint(
  origin: string,
  kind: 'management' | 'gateway' = 'management'
): Promise<MagpieEndpointStatus> {
  const base = magpieLoopback(origin);
  try {
    const response = await fetch(`${base}${kind === 'management' ? '/manifest.json' : '/'}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(750)
    });
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('json')) {
      await response.body?.cancel();
      return 'unknown';
    }
    const reader = response.body?.getReader();
    if (!reader) return 'unknown';
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 16 * 1024) {
        await reader.cancel();
        return 'unknown';
      }
      chunks.push(next.value);
    }
    const value = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return value.name === 'magpie' &&
      (kind === 'gateway'
        ? value.version === undefined ||
          (typeof value.version === 'string' && /^[A-Za-z0-9._+-]{0,128}$/.test(value.version))
        : value.short_name === 'magpie')
      ? 'magpie'
      : 'unknown';
  } catch (error) {
    return object(object(error).cause).code === 'ECONNREFUSED' ? 'absent' : 'unknown';
  }
}

/** A candidate is metadata only and still needs a valid management credential. */
export const magpieCandidate = async (origin: string): Promise<boolean> =>
  (await magpieEndpoint(origin)) === 'magpie';
