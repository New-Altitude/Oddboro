import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { home } from '@oddboro/ledger';
import type {
  MagpieAction,
  MagpieDiscovered,
  MagpieModel,
  MagpieReply,
  MagpieState
} from '../magpie.ts';
import {
  id,
  list,
  MagpieError,
  magpieGroups,
  magpieCandidate,
  magpieEndpoint,
  magpieLoopback,
  magpieAccessLink,
  magpieServer,
  magpieServerSession,
  magpieCookieName,
  magpieProviders,
  magpieRequest,
  magpieSignIn,
  number,
  object,
  word
} from './magpie-http.ts';
import {
  managedAvailable,
  managedRunning,
  startManagedMagpie,
  stopManagedMagpie,
  type MagpieConnection as RuntimeConnection
} from './magpie-runtime.ts';
import { magpieAppAccess } from './magpie-discovery.ts';
import { magpieSetup } from './magpie-setup.ts';
export { MagpieError } from './magpie-http.ts';

const settingsFile = () => home('magpie', 'connection.json');
type MagpieConnection = RuntimeConnection & { access?: 'manage' | 'use' };
let current: MagpieConnection | undefined;
let loaded = false;
let invalidSaved = false;
let setupPending: Promise<MagpieReply> | undefined;
let busy = false;
let startupProblem = '';
let discoveries: MagpieDiscovered[] = [];
const discoveredSources = new Map<string, string>();
const flows = new Set<string>();
const pendingInputs = new Map<string, Record<string, string>>();

function key(value: unknown, optional = false): string {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{16,4096}$/.test(value))
    throw new MagpieError(
      'Paste a valid Magpie web key. The management key is separate from an inference token.'
    );
  return value;
}
function load(): MagpieConnection | undefined {
  if (loaded) return current;
  loaded = true;
  try {
    const saved = object(JSON.parse(readFileSync(settingsFile(), 'utf8')));
    if (saved.mode !== 'existing' && saved.mode !== 'managed')
      throw new Error('Invalid saved connection'); // Never adopt or signal a saved process.
    if (saved.location !== undefined && saved.location !== 'local' && saved.location !== 'server')
      throw new Error('Invalid saved location');
    const server = saved.location === 'server';
    if (saved.access !== undefined && saved.access !== 'manage' && saved.access !== 'use')
      throw new Error('Invalid saved access');
    const use = saved.access === 'use';
    if (
      use &&
      (saved.mode !== 'existing' ||
        saved.location !== 'local' ||
        typeof saved.connectionId !== 'string' ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(saved.connectionId) ||
        typeof saved.version !== 'string' ||
        !/^[A-Za-z0-9._+-]{0,128}$/.test(saved.version) ||
        saved.managementUrl !== '' ||
        saved.managementKey !== '' ||
        saved.inferenceToken !== '' ||
        saved.managementCookie !== undefined ||
        saved.instanceId !== undefined ||
        saved.capabilities !== undefined)
    )
      throw new Error('Invalid saved inference-only connection');
    if (server && (saved.mode !== 'existing' || !magpieCookieName(saved.managementCookie)))
      throw new Error('Invalid saved server session');
    const validate = server ? magpieServer : magpieLoopback;
    current = {
      mode: saved.mode,
      access: use ? 'use' : 'manage',
      location: server ? 'server' : 'local',
      ...(server ? { managementCookie: saved.managementCookie as string } : {}),
      connectionId: word(saved.connectionId) || randomUUID(),
      instanceId: word(saved.instanceId),
      capabilities: list(saved.capabilities).map((c) => word(c)),
      managementUrl: use ? '' : validate(saved.managementUrl),
      managementKey: use ? '' : key(saved.managementKey),
      gatewayUrl: validate(saved.gatewayUrl),
      inferenceToken: key(saved.inferenceToken, !server),
      version: word(saved.version)
    };
    if (server && current.inferenceToken === current.managementKey)
      throw new Error('Invalid server credentials');
  } catch (error) {
    current = undefined;
    invalidSaved = (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
  return current;
}
function save(connection: MagpieConnection | undefined): void {
  const file = settingsFile();
  if (!connection) {
    rmSync(file, { force: true });
  } else {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(connection), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, file);
  }
  current = connection;
  loaded = true;
  invalidSaved = false;
  startupProblem = '';
  discoveries = [];
  discoveredSources.clear();
  flows.clear();
  pendingInputs.clear();
}

/**
 * Explicit attach/upgrade rotates connectionId, even when the URL is reused.
 * This isolates runner sessions; it does not prove ownership of an external process.
 */
export function magpieConnectionIdentity(): string {
  const c = load();
  return c
    ? createHash('sha256')
        .update(
          `${c.connectionId}\n${c.mode}\n${c.access ?? 'manage'}\n${c.managementUrl}\n${c.gatewayUrl}`
        )
        .digest('hex')
    : '';
}
function connection(): MagpieConnection {
  const c = load();
  if (!c) throw new MagpieError('Connect Magpie in Models & connections first.', 409);
  if (c.mode === 'managed' && !managedRunning())
    throw new MagpieError(
      'The built-in Magpie process has stopped. Start it again in Models & connections.',
      503
    );
  return c;
}
const request = (c: MagpieConnection, path: string, body?: unknown) => {
  if (c.access === 'use')
    throw new MagpieError('Connect Magpie management to change or inspect its setup.', 403);
  return magpieRequest(
    c.managementUrl,
    c.managementKey,
    path,
    body,
    false,
    c.location,
    c.managementCookie
  );
};

function empty(): MagpieState {
  return {
    connected: false,
    mode: null,
    location: 'local',
    access: 'manage',
    ready: false,
    version: '',
    managementUrl: '',
    gatewayUrl: '',
    shared: false,
    notice: '',
    problem: '',
    managedAvailable: managedAvailable(),
    providers: [],
    presets: [],
    models: [],
    groups: [],
    logins: [],
    calls: [],
    discoverySupported: false
  };
}

const BUILTIN_LOGINS = [
  ['codex', 'ChatGPT'],
  ['claude', 'Claude'],
  ['copilot', 'GitHub Copilot'],
  ['gemini', 'Gemini'],
  ['antigravity', 'Antigravity'],
  ['chatgpt-api', 'ChatGPT API']
] as const;
function builtinLogins(c: MagpieConnection, p: Record<string, unknown>): MagpieState['logins'] {
  return BUILTIN_LOGINS.filter(([id]) => !list(p.onPlugins).includes(id)).map(([id, name]) => ({
    id,
    name,
    kind: 'builtin',
    signedIn: list(p.providers).some((v) => object(v).id === id && object(v).ready === true),
    supported: c.mode === 'existing' || !!c.capabilities?.includes(`signin:${id}`),
    reason:
      c.mode === 'existing' || c.capabilities?.includes(`signin:${id}`)
        ? ''
        : 'This sign-in is not supported by the built-in runtime.',
    methods: [{ type: 'oauth', label: 'Sign in with your browser' }]
  }));
}

async function verifyManaged(c: MagpieConnection): Promise<void> {
  if (c.mode !== 'managed') return;
  const identity = object(await request(c, '/api/integration'));
  if (
    identity.app !== 'magpie' ||
    identity.apiVersion !== 1 ||
    identity.embedded !== true ||
    identity.instanceId !== c.instanceId ||
    identity.version !== c.version
  )
    throw new MagpieError('The built-in management service no longer belongs to this office.', 503);
}

/** An explicit external mapping is verified through the gateway key, never its internal advertised URL. */
async function serverCatalog(c: MagpieConnection): Promise<Set<string>> {
  const [identity, catalog] = await Promise.all([
    magpieRequest(c.gatewayUrl, c.inferenceToken, '/v1', undefined, true, 'server'),
    magpieRequest(c.gatewayUrl, c.inferenceToken, '/v1/models', undefined, true, 'server')
  ]);
  const info = object(identity);
  const models = object(catalog);
  if (
    info.name !== 'magpie' ||
    info.version !== c.version ||
    models.object !== 'list' ||
    !Array.isArray(models.data)
  )
    throw new MagpieError(
      'The external gateway did not match this Magpie version and catalog.',
      502
    );
  const allowed = new Set<string>();
  for (const value of models.data.slice(0, 10_000)) {
    const model = object(value);
    allowed.add(id(model.id));
  }
  return allowed;
}

/**
 * Public identity identifies the protocol, not process ownership. Catalog access
 * grants no management permission, so this path never reads an admin API.
 */
async function gatewaySnapshot(c: MagpieConnection): Promise<MagpieState> {
  const info = object(await magpieRequest(c.gatewayUrl, '', '/v1', undefined, true));
  if (
    info.name !== 'magpie' ||
    (info.version !== undefined &&
      (typeof info.version !== 'string' || !/^[A-Za-z0-9._+-]{0,128}$/.test(info.version)))
  )
    throw new MagpieError('This local gateway did not identify itself as Magpie.', 502);
  const version = word(info.version, 128);
  if (c.version && c.version !== version)
    throw new MagpieError('The local Magpie gateway changed version. Connect it again.', 409);
  const catalog = object(await magpieRequest(c.gatewayUrl, '', '/v1/models', undefined, true));
  if (catalog.object !== 'list' || !Array.isArray(catalog.data) || catalog.data.length > 10_000)
    throw new MagpieError('This Magpie gateway returned an unsupported model catalog.', 502);
  const seen = new Set<string>();
  const models: MagpieModel[] = catalog.data.map((value) => {
    const model = object(value);
    if (model.object !== 'model' || typeof model.owned_by !== 'string')
      throw new MagpieError('This Magpie gateway returned an invalid model catalog.', 502);
    const ref = id(model.id);
    const provider = id(model.owned_by);
    if (seen.has(ref))
      throw new MagpieError('This Magpie gateway returned duplicate model identifiers.', 502);
    seen.add(ref);
    return {
      id: ref,
      name: word(model.display_name) || ref,
      provider,
      images: list(object(model.modalities).input).includes('image'),
      kind: provider === 'group' || ref.startsWith('group/') ? 'group' : 'model'
    };
  });
  return {
    ...empty(),
    connected: true,
    mode: 'existing',
    location: 'local',
    access: 'use',
    ready: models.length > 0,
    version,
    gatewayUrl: c.gatewayUrl,
    shared: true,
    notice:
      'Connected to your existing Magpie gateway. Use its listed models here; management authorization is optional and needed only to change or inspect its setup. Catalog access does not test a model request. Disconnecting only removes Oddboro’s connection.',
    models
  };
}

async function attachGateway(gatewayUrl: unknown): Promise<MagpieState> {
  const next: MagpieConnection = {
    mode: 'existing',
    location: 'local',
    access: 'use',
    connectionId: randomUUID(),
    managementUrl: '',
    managementKey: '',
    gatewayUrl: magpieLoopback(gatewayUrl),
    inferenceToken: '',
    version: ''
  };
  const state = await gatewaySnapshot(next);
  next.version = state.version;
  if (load()?.mode === 'managed' && managedRunning() && !state.ready)
    throw new MagpieError(
      'The existing Magpie gateway has no models. Add a model and retry. Your built-in connection was kept.',
      409
    );
  if (load()?.mode === 'managed') await stopManagedMagpie();
  save(next);
  return state;
}

const tokenCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** A partial subtotal is not a measured total; each included row must report this counter. */
function sumTokens(usage: Record<string, unknown>[], field: string): number | undefined {
  if (!usage.length) return undefined;
  let total = 0;
  for (const row of usage) {
    const count = tokenCount(row[field]);
    if (count === undefined) return undefined;
    total += count;
    if (!Number.isSafeInteger(total)) return undefined;
  }
  return total;
}

async function snapshot(c: MagpieConnection): Promise<MagpieState> {
  if (c.access === 'use') return gatewaySnapshot(c);
  await verifyManaged(c);
  const [rawProviders, rawGroups] = await Promise.all([
    request(c, '/api/providers'),
    request(c, '/api/groups')
  ]);
  const p = object(rawProviders);
  const g = object(rawGroups);
  if (
    !Array.isArray(p.providers) ||
    !Array.isArray(p.presets) ||
    !Array.isArray(g.groups) ||
    !Array.isArray(g.models) ||
    typeof object(p.gateway).running !== 'boolean'
  )
    throw new MagpieError('This Magpie version has an unsupported management contract.', 502);
  const remote = c.location === 'server';
  if (!remote && magpieLoopback(object(p.gateway).url) !== c.gatewayUrl)
    throw new MagpieError(
      'Magpie changed its inference address. Reconnect the existing connection.',
      409
    );
  const allowed = remote ? await serverCatalog(c) : undefined;
  const providers = magpieProviders(p);
  const groups = magpieGroups(g).map((group) => ({
    ...group,
    ready: group.ready && (!allowed || allowed.has(group.ref))
  }));
  const models = list(g.models)
    .slice(0, 10_000)
    .map((value): MagpieModel => {
      const m = object(value);
      return {
        id: word(m.id),
        name: word(m.name) || word(m.id),
        provider: word(m.provider),
        images: m.images === true
      };
    })
    .filter((m) => m.id && (!allowed || allowed.has(m.id)));
  const shared = c.mode === 'existing';
  return {
    ...empty(),
    connected: true,
    mode: c.mode,
    location: remote ? 'server' : 'local',
    ready: object(p.gateway).running === true,
    version: c.version,
    managementUrl: c.managementUrl,
    gatewayUrl: c.gatewayUrl,
    shared,
    notice: shared
      ? 'Changes here edit your existing shared Magpie setup and affect its other clients. Disconnecting only removes Oddboro’s connection.'
      : 'Oddboro owns this Magpie process and its private settings. Existing agent settings stay separate. Only sign-ins explicitly supported below are available.',
    providers,
    groups,
    models,
    presets: list(p.presets).map((value) => {
      const preset = object(value);
      return { id: word(preset.id), name: word(preset.name) };
    }),
    logins: [
      ...builtinLogins(c, p),
      ...list(p.unmoved)
        .filter(
          (value) => !list(p.plugins).some((plugin) => object(plugin).id === object(value).id)
        )
        .map((value) => {
          const retired = object(value);
          return {
            id: word(retired.id),
            name: word(retired.name),
            kind: 'builtin' as const,
            signedIn: false,
            supported: false,
            reason:
              'This retired built-in requires its provider plugin. Use an existing Magpie with that plugin installed.',
            methods: []
          };
        }),
      ...list(p.plugins).map((value) => {
        const login = object(value);
        const methods = list(login.methods).map((method) => {
          const m = object(method);
          return { type: word(m.type), label: word(m.label) };
        });
        return {
          id: word(login.pid),
          kind: 'plugin' as const,
          name: word(login.name),
          signedIn: login.signedIn === true,
          supported: shared && methods.length > 0,
          reason: !shared
            ? 'Provider plugin sign-in is not available in the built-in runtime.'
            : methods.length
              ? ''
              : 'This provider has no installed sign-in method.',
          methods
        };
      })
    ],
    calls: list(object(p.gateway).calls)
      .slice(0, 40)
      .map((value) => {
        const call = object(value);
        return {
          model: word(call.model),
          provider: word(call.provider),
          status: number(call.status),
          at: word(call.time),
          duration: number(call.ms),
          inputTokens: tokenCount(object(call.usage).input),
          outputTokens: tokenCount(object(call.usage).output),
          cachedTokens: tokenCount(object(call.usage).cache_read),
          fallbackUsed: !!call.fallback
        };
      }),
    discoverySupported: (shared && !remote) || !!c.capabilities?.includes('discovery:codex-file')
  };
}

export async function magpieState(): Promise<MagpieState> {
  const c = load();
  if (!c)
    return invalidSaved || startupProblem
      ? {
          ...empty(),
          problem:
            startupProblem ||
            'The saved Magpie connection cannot be read safely. Connect again in Models & connections.'
        }
      : empty();
  try {
    connection();
    return await snapshot(c);
  } catch (error) {
    return {
      ...empty(),
      connected: true,
      mode: c.mode,
      location: c.location ?? 'local',
      access: c.access ?? 'manage',
      version: c.version,
      managementUrl: c.managementUrl,
      gatewayUrl: c.gatewayUrl,
      shared: c.mode === 'existing',
      problem:
        startupProblem ||
        (error instanceof MagpieError ? error.message : 'Magpie is not available.')
    };
  }
}
export async function magpieReadiness(): Promise<{ ready: boolean; problem: string }> {
  const state = await magpieState();
  return {
    ready: state.ready,
    problem:
      state.problem ||
      (state.ready ? '' : 'Connect a running Magpie gateway in Models & connections.')
  };
}

export async function magpieRunConnection(
  model: string
): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  const c = connection();
  const selected = id(model);
  const state = await snapshot(c);
  if (c.mode === 'managed') {
    const gateway = object(
      await magpieRequest(c.gatewayUrl, c.inferenceToken, '/v1/magpie/integration', undefined, true)
    );
    if (gateway.instanceId !== c.instanceId || gateway.version !== c.version)
      throw new MagpieError(
        'The built-in inference service no longer belongs to this office.',
        503
      );
  }
  // Validate opaque routes on every run. A group alias is not a provider/model to rewrite,
  // and use-only callers have no provider-health metadata to consult.
  const offered =
    (c.access === 'use' && state.models.some((m) => m.id === selected)) ||
    state.models.some(
      (m) =>
        m.id === selected && state.providers.some((p) => p.id === m.provider && p.ready && !p.off)
    ) ||
    state.groups.some((g) => g.ready && g.ref === selected);
  if (!state.ready || !offered)
    throw new MagpieError(
      'The selected Magpie model or group is unavailable. Choose a ready model in Models & connections.',
      409
    );
  return { baseUrl: c.gatewayUrl, apiKey: c.inferenceToken || 'oddboro-local', model: selected };
}

/** Authentication precedes all settings discovery. Management credentials never become inference credentials. */
async function attachExisting(
  managementUrl: unknown,
  managementKey: unknown,
  inferenceToken?: unknown,
  expectedGateway?: unknown,
  location: 'local' | 'server' = 'local'
): Promise<MagpieState> {
  const remote = location === 'server';
  const next: MagpieConnection = {
    mode: 'existing',
    access: 'manage',
    location,
    connectionId: randomUUID(),
    managementUrl: remote ? magpieServer(managementUrl) : magpieLoopback(managementUrl),
    managementKey: key(managementKey),
    gatewayUrl: '',
    inferenceToken: '',
    version: ''
  };
  if (remote) {
    next.gatewayUrl = magpieServer(expectedGateway);
    next.inferenceToken = key(inferenceToken);
    if (next.inferenceToken === next.managementKey)
      throw new MagpieError('Use a separate inference token for the Magpie server.');
    next.managementCookie = await magpieServerSession(next.managementUrl, next.managementKey);
  }
  const settings = object(await request(next, '/api/settings'));
  if (typeof settings.version !== 'string' || !settings.version)
    throw new MagpieError('This service has no compatible Magpie version.', 502);
  if (!remote) next.gatewayUrl = magpieLoopback(settings.gateway);
  const previous = load();
  if (
    previous?.access === 'use' &&
    !remote &&
    expectedGateway === undefined &&
    previous.gatewayUrl !== next.gatewayUrl
  )
    throw new MagpieError(
      'This management connection belongs to another gateway. Enter its inference address explicitly to switch.',
      409
    );
  if (!remote && next.managementUrl === next.gatewayUrl)
    throw new MagpieError('Management and inference must use separate local ports.');
  if (
    !remote &&
    expectedGateway !== undefined &&
    next.gatewayUrl !== magpieLoopback(expectedGateway)
  )
    throw new MagpieError('The inference address does not match this Magpie instance.');
  if (!remote)
    next.inferenceToken = key(
      inferenceToken === undefined ? settings.lanKey : inferenceToken,
      true
    );
  if (next.inferenceToken && next.inferenceToken === next.managementKey)
    throw new MagpieError(
      'Use a separate inference token, or leave it blank for the local gateway.'
    );
  next.version = word(settings.version);
  // Validate the replacement before stopping our child or saving over the current route.
  // A failed management upgrade must leave a working use-only connection intact.
  const state = await snapshot(next);
  if (load()?.mode === 'managed' && managedRunning() && !state.ready)
    throw new MagpieError(
      'The existing Magpie gateway is not running. Start it and retry. Your built-in connection was kept.',
      409
    );
  if ((remote || previous?.access === 'use') && !state.ready)
    throw new MagpieError(
      'The Magpie gateway is not running. Start it and retry. Your current connection was kept.',
      409
    );
  if (previous?.access === 'use' && !remote && previous.gatewayUrl === next.gatewayUrl)
    await gatewaySnapshot({ ...previous, version: next.version });
  if (load()?.mode === 'managed') await stopManagedMagpie();
  save(next);
  return state;
}

function fields(input: unknown): Record<string, string> {
  const value = object(input);
  if (Object.keys(value).length > 30) throw new MagpieError('Too many sign-in fields.');
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => {
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(k) || typeof v !== 'string' || v.length > 8192)
        throw new MagpieError('Invalid sign-in field.');
      return [k, v];
    })
  );
}
const ROUTINGS = new Set([
  '',
  'order',
  'rotate',
  'usage',
  'pace',
  'weight',
  'free',
  'fast',
  'cheap',
  'drain',
  'expiring'
]);

/** One bounded action at a time keeps connection changes and mutations together. */
export async function magpieAction(action: MagpieAction): Promise<MagpieReply> {
  if (action?.action !== 'setup') return runAction(action);
  if (setupPending) return setupPending;
  const pending = runAction(action);
  setupPending = pending;
  try {
    return await pending;
  } finally {
    if (setupPending === pending) setupPending = undefined;
  }
}
async function runAction(action: MagpieAction): Promise<MagpieReply> {
  if (busy) throw new MagpieError('Another Magpie change is still running.', 409);
  busy = true;
  try {
    return await perform(action);
  } catch (error) {
    if (action?.action === 'start-managed')
      startupProblem =
        error instanceof MagpieError
          ? error.message
          : 'The built-in Magpie runtime could not start.';
    throw error;
  } finally {
    busy = false;
  }
}
async function perform(action: MagpieAction): Promise<MagpieReply> {
  if (
    !action ||
    typeof action !== 'object' ||
    !new Set([
      'setup',
      'disconnect',
      'find-existing',
      'connect',
      'connect-gateway',
      'start-managed',
      'inspect',
      'provider-save',
      'provider-delete',
      'key-add',
      'key-replace',
      'key-remove',
      'key-toggle',
      'group-save',
      'group-delete',
      'signin-start',
      'signin-prompt',
      'signin-status',
      'signin-cancel',
      'signin-callback',
      'discovery',
      'import-selected'
    ]).has(action.action)
  )
    throw new MagpieError('Choose a Magpie action.');
  if (action.action === 'disconnect') {
    const c = load();
    if (c?.mode === 'managed') await stopManagedMagpie();
    save(undefined);
    return { state: empty() };
  }
  if (action.action === 'find-existing') {
    const candidates: { managementUrl: string }[] = [];
    // These known web ports are probes only. No credential file is opened.
    await Promise.all(
      [3430].map(async (port) => {
        const managementUrl = `http://127.0.0.1:${port}`;
        if (await magpieCandidate(managementUrl)) candidates.push({ managementUrl });
      })
    );
    return { state: await magpieState(), candidates };
  }
  if (action.action === 'setup') {
    const saved = load();
    return magpieSetup({
      savedMode: saved?.mode ?? null,
      savedLocation: saved?.location,
      savedAccess: saved?.access,
      savedUrl: saved?.managementUrl,
      invalidSaved,
      ownedRunning: managedRunning(),
      state: magpieState,
      appAccess: magpieAppAccess,
      attach: async (access) => attachExisting(access.managementUrl, access.key),
      gateway: async () => {
        const gatewayUrl = 'http://127.0.0.1:3425';
        const found = await magpieEndpoint(gatewayUrl, 'gateway');
        if (found === 'absent') return undefined;
        if (found !== 'magpie')
          throw new MagpieError(
            'A local service is using Magpie’s usual gateway address but could not be identified. Choose the correct connection in Models & connections.',
            409
          );
        return attachGateway(gatewayUrl);
      },
      discover: async () => {
        const origins = [
          ...new Set([
            'http://127.0.0.1:3430',
            ...(saved?.mode === 'existing' ? [saved.managementUrl] : [])
          ])
        ];
        const [management, gateway] = await Promise.all([
          Promise.all(
            origins.map(async (managementUrl) => ({
              managementUrl,
              status: await magpieEndpoint(managementUrl)
            }))
          ),
          magpieEndpoint('http://127.0.0.1:3425', 'gateway')
        ]);
        return {
          candidates: management
            .filter((m) => m.status === 'magpie')
            .map(({ managementUrl }) => ({ managementUrl })),
          gatewayOnly: gateway === 'magpie' && !management.some((m) => m.status === 'magpie'),
          uncertain: management.some((m) => m.status === 'unknown') || gateway === 'unknown'
        };
      },
      available: managedAvailable,
      start: async () => {
        try {
          return (await perform({ action: 'start-managed' })).state;
        } catch (error) {
          startupProblem =
            error instanceof MagpieError
              ? error.message
              : 'The built-in Magpie runtime could not start.';
          throw error;
        }
      }
    });
  }
  if (action.action === 'connect-gateway') return { state: await attachGateway(action.gatewayUrl) };
  if (action.action === 'connect') {
    if (action.shared !== true)
      throw new MagpieError('Confirm that this connection edits shared Magpie settings.');
    if (
      action.location !== undefined &&
      action.location !== 'local' &&
      action.location !== 'server'
    )
      throw new MagpieError('Choose a local Magpie or a Magpie server.');
    const hasLink = Object.hasOwn(action, 'accessLink');
    if (
      hasLink &&
      (Object.hasOwn(action, 'managementUrl') || Object.hasOwn(action, 'managementKey'))
    )
      throw new MagpieError('Use either the Browser access link or the manual connection fields.');
    const access = hasLink
      ? magpieAccessLink(action.accessLink, action.location ?? 'local')
      : undefined;
    return {
      state: await attachExisting(
        access?.origin ?? action.managementUrl,
        access?.key ?? action.managementKey,
        action.inferenceToken,
        action.gatewayUrl,
        action.location
      )
    };
  }
  if (action.action === 'start-managed') {
    const next = await startManagedMagpie();
    next.connectionId = randomUUID();
    try {
      const state = await snapshot(next);
      save(next);
      return { state };
    } catch (error) {
      await stopManagedMagpie();
      throw error;
    }
  }
  const c = connection();
  // Refuse before even a snapshot: hiding controls cannot prevent crafted admin actions.
  if (c.access === 'use')
    throw new MagpieError('Connect Magpie management to change or inspect its setup.', 403);
  await verifyManaged(c);
  if (action.action === 'inspect') {
    const state = await snapshot(c);
    const trace = object(await request(c, '/api/gateway/trace'));
    const knownProviders = new Set(state.providers.map((p) => p.id));
    state.calls = list(trace.routes)
      .slice(-40)
      .reverse()
      .map((value) => {
        const route = object(value);
        const order = new Map(
          list(route.order).map((value) => {
            const o = object(value);
            return [word(o.id), o];
          })
        );
        const attempts = list(route.tries)
          .slice(0, 100)
          .map((value) => {
            const t = object(value);
            const seat = object(order.get(word(t.id)));
            const provider = knownProviders.has(word(seat.provider))
              ? word(seat.provider)
              : 'Unavailable provider';
            return {
              provider,
              model: word(t.model) || word(seat.model),
              status: number(t.status),
              failed: !!t.error || !!t.fail || number(t.status) >= 400
            };
          });
        const usage = list(route.usage).map(object);
        return {
          model: word(route.model),
          provider: word(route.provider),
          status: number(route.status),
          at: word(route.time),
          duration: number(route.ms),
          inputTokens: sumTokens(usage, 'in'),
          outputTokens: sumTokens(usage, 'out'),
          cachedTokens: sumTokens(usage, 'cache_read'),
          fallbackUsed: attempts.some((a) => a.failed),
          attempts
        };
      });
    return { state };
  }
  let signIn: MagpieReply['signIn'];
  let discovered: MagpieReply['discovered'];
  if (action.action === 'provider-save') {
    const input = object(action.provider);
    const raw = object(await request(c, '/api/providers'));
    const previous = object(list(raw.providers).find((p) => object(p).id === input.id));
    const provider: Record<string, unknown> = {
      ...previous,
      id: id(input.id),
      name: word(input.name),
      new: input.new === true
    };
    delete provider.key;
    delete provider.balanceToken;
    delete provider.account;
    if (previous.account && input.key)
      throw new MagpieError(
        'This provider uses a sign-in. Use its supported sign-in instead of an API key.'
      );
    provider.models = Array.isArray(previous.chosen)
      ? previous.chosen
      : list(previous.models)
          .filter((m) => object(m).on === true)
          .map((m) => word(object(m).id));
    for (const field of ['preset', 'chat', 'responses', 'anthropic'] as const)
      if (typeof input[field] === 'string') {
        const safePrevious = magpieProviders({ providers: [previous] })[0];
        if (field === 'preset' || !previous.id || input[field] !== safePrevious?.[field])
          provider[field] = word(input[field], 2048);
      }
    for (const field of ['chat', 'responses', 'anthropic'] as const) {
      if (!provider[field] || provider[field] === previous[field]) continue;
      try {
        const u = new URL(String(provider[field]));
        if (
          !['http:', 'https:'].includes(u.protocol) ||
          u.username ||
          u.password ||
          u.search ||
          u.hash
        )
          throw new Error();
      } catch {
        throw new MagpieError(
          'Use a provider http or https endpoint without credentials or query parameters.'
        );
      }
    }
    if (input.key !== undefined) {
      if (typeof input.key !== 'string' || input.key.length > 16_384)
        throw new MagpieError('Invalid provider key.');
      provider.key = input.key;
    }
    if (input.models !== undefined) {
      const posted = list(input.models).slice(0, 5000).map(id);
      const shown = magpieProviders({ providers: [previous] })[0].models.map((m) =>
        m.id.slice(String(previous.id).length + 1)
      );
      if (!previous.id || JSON.stringify(posted) !== JSON.stringify(shown))
        provider.models = posted;
    }
    await request(c, '/api/provider/save', provider);
  } else if (action.action === 'provider-delete') {
    await request(c, '/api/provider/delete', { id: id(action.id) });
  } else if (
    action.action === 'key-add' ||
    action.action === 'key-replace' ||
    action.action === 'key-remove' ||
    action.action === 'key-toggle'
  ) {
    const providerId = id(action.id);
    const raw = object(await request(c, '/api/providers'));
    const provider = object(list(raw.providers).find((value) => object(value).id === providerId));
    if (!provider.id || provider.account)
      throw new MagpieError('Choose an API provider to manage its keys.');
    const input: Record<string, unknown> = { id: providerId };
    if (action.action !== 'key-add') {
      const ref = id(action.ref);
      if (!list(provider.keyList).some((value) => object(value).id === ref))
        throw new MagpieError('This key is no longer available. Reload the provider.');
      input.ref = ref;
    }
    if (action.action === 'key-add' || action.action === 'key-replace') {
      if (typeof action.key !== 'string' || !action.key.trim() || action.key.length > 16_384)
        throw new MagpieError('Paste a nonempty provider API key.');
      input.key = action.key;
    }
    if (action.action === 'key-add') input.name = word(action.name);
    if (action.action === 'key-toggle' && typeof action.on !== 'boolean')
      throw new MagpieError('Choose whether to use this key.');
    const operation =
      action.action === 'key-add'
        ? 'add'
        : action.action === 'key-replace'
          ? 'replace'
          : action.action === 'key-remove'
            ? 'remove'
            : action.on
              ? 'on'
              : 'off';
    await request(c, `/api/keys/${operation}`, input);
  } else if (action.action === 'group-save') {
    const group = object(action.group);
    if (
      !ROUTINGS.has(String(group.routing)) ||
      !Array.isArray(group.members) ||
      group.members.length > 500
    )
      throw new MagpieError('Choose a supported routing rule and group members.');
    const state = await snapshot(c);
    const members = group.members.map(id);
    const offered = new Set([
      ...state.models.map((m) => m.id),
      ...state.groups.filter((g) => g.ready).map((g) => g.ref)
    ]);
    if (members.some((member) => !offered.has(member)))
      throw new MagpieError('A group member is no longer available. Reload the model list.');
    if (!/^[a-z0-9][a-z0-9.-]{0,99}$/.test(String(group.id)))
      throw new MagpieError('Use lowercase letters, numbers, dots or dashes for the group id.');
    const rawGroups = object(await request(c, '/api/groups'));
    const previous = object(list(rawGroups.groups).find((g) => object(g).id === group.id));
    await request(c, '/api/groups/save', {
      ...previous,
      id: group.id,
      name: word(group.name),
      members,
      routing: group.routing,
      firstToken:
        group.firstToken === undefined
          ? previous.firstToken
          : Math.max(0, Math.min(600, number(group.firstToken))),
      patience:
        group.patience === undefined
          ? previous.patience
          : Math.max(-1, Math.min(240, number(group.patience)))
    });
  } else if (action.action === 'group-delete') {
    await request(c, '/api/groups/delete', { id: id(action.id) });
  } else if (action.action === 'signin-start' || action.action === 'signin-prompt') {
    const state = await snapshot(c);
    const login = state.logins.find((login) => login.id === action.agent && login.supported);
    const method = action.method ?? 0;
    if (!login || !Number.isInteger(method) || method < 0 || method >= login.methods.length)
      throw new MagpieError('This provider has no supported installed sign-in method.');
    const slot = `${action.agent}:${method}`;
    const inputs = { ...pendingInputs.get(slot), ...fields(action.inputs) };
    if (login.kind === 'builtin') {
      if (action.action === 'signin-prompt') return { state, prompt: null, inputs: {} };
      signIn = magpieSignIn(await request(c, '/api/signin', { agent: action.agent }));
      if (signIn.id) flows.add(signIn.id);
      return { state: await snapshot(c), signIn };
    }
    if (action.action === 'signin-prompt') {
      const out = object(
        await request(c, '/api/plugin-signin/prompt', {
          provider: action.agent,
          method,
          inputs,
          key: word(action.key),
          value: word(action.value, 8192)
        })
      );
      const p = object(out.prompt);
      if (pendingInputs.size > 32) pendingInputs.clear();
      pendingInputs.set(slot, fields(out.inputs));
      return {
        state,
        prompt: out.prompt
          ? {
              key: word(p.key),
              label: word(p.message),
              type: word(p.type),
              placeholder: word(p.placeholder),
              options: list(p.options).map((option) => {
                const o = object(option);
                return { label: word(o.label), value: word(o.value) };
              })
            }
          : null,
        inputs: {}
      };
    }
    signIn = magpieSignIn(
      await request(c, '/api/plugin-signin', {
        provider: action.agent,
        method,
        inputs,
        key: word(action.key, 16_384)
      })
    );
    if (signIn.id) flows.add(signIn.id);
    pendingInputs.delete(slot);
  } else if (
    action.action === 'signin-status' ||
    action.action === 'signin-cancel' ||
    action.action === 'signin-callback'
  ) {
    const flow = id(action.id);
    if (!flows.has(flow))
      throw new MagpieError('This sign-in does not belong to the current Oddboro connection.', 404);
    const path = `/api/signin/${encodeURIComponent(flow)}`;
    if (action.action === 'signin-status') signIn = magpieSignIn(await request(c, path));
    else if (action.action === 'signin-cancel') {
      await request(c, `${path}/cancel`, {});
      flows.delete(flow);
    } else if (action.action === 'signin-callback') {
      if (typeof action.url !== 'string' || action.url.length > 16_384)
        throw new MagpieError('Paste a valid callback response.');
      await request(c, `${path}/callback`, { url: action.url });
    }
  } else if (action.action === 'discovery') {
    // Gateway detection does not authorize account discovery. It needs this explicit
    // owner action and, for the private runtime, an advertised supported capability.
    if (c.location === 'server')
      throw new MagpieError(
        'Local account discovery is unavailable for a Magpie server connection.'
      );
    if (action.enabled !== true)
      throw new MagpieError('Choose whether to search supported local sign-ins first.');
    discoveredSources.clear();
    if (c.mode === 'managed') {
      if (!c.capabilities?.includes('discovery:codex-file'))
        throw new MagpieError('This built-in runtime does not support sign-in discovery.');
      const result = object(await request(c, '/api/integration/discovery', {}));
      discoveries = list(result.sources).map((value) => {
        const source = object(value);
        const opaque = randomUUID();
        discoveredSources.set(opaque, word(source.ref, 4096));
        return {
          source: word(source.source),
          ref: opaque,
          name: word(source.user),
          status: 'shared-read-only',
          canImport: source.source === 'codex-file'
        };
      });
    } else {
      const sources = list(await request(c, '/api/importapps'));
      discoveries = sources.flatMap((value) => {
        const source = object(value);
        return list(source.items).map((item) => {
          const i = object(item);
          return {
            source: word(source.id),
            ref: word(i.ref),
            name: word(object(i.provider).name),
            status: word(i.status),
            canImport: !i.skip && i.status !== 'same'
          };
        });
      });
    }
    discovered = discoveries;
  } else if (action.action === 'import-selected') {
    if (!Array.isArray(action.picks) || action.picks.length > 100)
      throw new MagpieError('Choose accounts from the opt-in discovery list.');
    const picks = action.picks.map((pick) => {
      const found = discoveries.find(
        (d) => d.source === pick.source && d.ref === pick.ref && d.canImport
      );
      if (!found)
        throw new MagpieError('Discover accounts first, then choose a supported account.');
      return { source: found.source, ref: found.ref, mode: 'add' };
    });
    if (c.mode === 'managed') {
      if (
        !c.capabilities?.includes('discovery:codex-file') ||
        picks.length !== 1 ||
        picks[0].source !== 'codex-file'
      )
        throw new MagpieError('Choose one supported file-backed Codex sign-in.');
      const ref = discoveredSources.get(picks[0].ref);
      if (!ref) throw new MagpieError('Discover supported sign-ins again before choosing one.');
      await request(c, '/api/integration/discovery/select', { ref });
    } else await request(c, '/api/importapps', { picks });
    discoveries = [];
    discoveredSources.clear();
  } else {
    throw new MagpieError('Unsupported Magpie action.');
  }
  return {
    state: await snapshot(c),
    ...(signIn ? { signIn } : {}),
    ...(discovered ? { discovered } : {})
  };
}

/** Resume only a saved owned runtime, with a fresh process, key pair and instance nonce. */
export async function initializeMagpie(): Promise<void> {
  if (load()?.mode !== 'managed' || managedRunning()) return;
  try {
    await magpieAction({ action: 'start-managed' });
  } catch {
    /* Readiness reports the local startup failure. */
  }
}

/** Office shutdown retains settings and stops only the child this process started. */
export const shutdownMagpie = stopManagedMagpie;
