import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  magpieCandidate,
  magpieEndpoint,
  magpieLoopback,
  magpieProviders,
  magpieRequest,
  magpieSignIn
} from './magpie-http.ts';

const folder = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-magpie-')));
Object.assign(process.env, {
  ODDBORO_HOME: folder,
  ODDBORO_APP: '0',
  USERPROFILE: folder,
  ODDBORO_ENV: join(folder, 'none.env'),
  HOME: folder
});
const { magpieAction, magpieState, magpieRunConnection, magpieConnectionIdentity } =
  await import('./magpie.ts');
const runtime = await import('./magpie-runtime.ts');
const managementKey = 'management-key-123456789';
const inferenceToken = 'inference-token-123456789';
const secret = 'do-not-show-provider-secret';
const changes: { path: string; body: Record<string, unknown> }[] = [];
const observedPaths: string[] = [];
let redirect = false;
let upstreamError = false;
let oversized = false;
let existingGatewayRunning = true;
let localLanKey: string | undefined;
let signinState = 'waiting';
let snapshotUsage: unknown;
let routeUsage: unknown = [{ in: 12, out: 6, cache_read: 4 }];
const server = createServer(async (request, response) => {
  const url = request.url || '';
  observedPaths.push(url);
  if (url === '/manifest.json') {
    response.setHeader('Content-Type', 'application/manifest+json');
    response.end(JSON.stringify({ name: 'magpie', short_name: 'magpie' }));
    return;
  }
  if (request.headers.cookie !== `magpie_web_${port}=${managementKey}`) {
    response.writeHead(403).end(secret);
    return;
  }
  if (redirect) {
    response.writeHead(302, { Location: 'http://192.0.2.1/private' }).end();
    return;
  }
  if (upstreamError) {
    response.writeHead(500).end(secret);
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  if (oversized) {
    response.end(JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  if (request.method === 'POST') changes.push({ path: url, body });
  const providers = {
    providers: [
      {
        id: 'fake',
        name: 'Fake',
        preset: '',
        ready: true,
        off: false,
        key: { set: true, masked: secret },
        keyList: [{ id: 'fingerprint-1', name: 'Main', on: true, active: true, masked: secret }],
        balanceToken: { takes: false, set: true },
        headers: { Authorization: secret },
        extraBody: { custom: 'keep' },
        chat: `https://provider.test/v1?key=${secret}`,
        chosen: ['one'],
        models: [
          { id: 'one', name: 'One', on: true, images: true },
          { id: 'hidden', on: false }
        ]
      }
    ],
    presets: [{ id: 'fake-preset', name: 'Fake preset', key: secret }],
    gateway: {
      running: existingGatewayRunning,
      url: gatewayUrl,
      calls: [
        {
          model: 'fake/one',
          provider: 'fake',
          status: 200,
          ms: 5,
          time: '2026-01-01',
          usage: snapshotUsage,
          requestBody: secret,
          error: secret
        }
      ]
    },
    plugins: [
      {
        pid: 'fake-login',
        id: 'plugin-fake',
        name: 'Fake login',
        signedIn: false,
        methods: [{ type: 'oauth', label: 'Browser' }]
      }
    ]
  };
  const groups = {
    groups: [
      {
        id: 'team',
        name: 'Team',
        ref: 'group/team',
        ready: true,
        routing: 'order',
        members: ['fake/one'],
        rules: [{ intent: 'keep' }],
        accounts: { fake: ['keep'] },
        patience: -1,
        firstToken: 10
      }
    ],
    models: [{ id: 'fake/one', name: 'One', provider: 'fake', images: true }]
  };
  if (url === '/api/settings')
    response.end(
      JSON.stringify({ version: 'dev', gateway: gatewayUrl, lanKey: localLanKey, key: secret })
    );
  else if (url === '/api/groups') response.end(JSON.stringify(groups));
  else if (url === '/api/gateway/trace')
    response.end(
      JSON.stringify({
        routes: [
          {
            model: 'group/team',
            provider: 'fake',
            status: 200,
            time: '2026-01-01',
            ms: 12,
            order: [{ id: 'seat-1', provider: 'fake', model: 'one', who: secret }],
            tries: [
              { id: 'seat-1', status: 429, error: secret, fail: secret, model: 'one' },
              { id: 'seat-1', status: 200, model: 'one' }
            ],
            usage: routeUsage,
            requestBody: secret
          }
        ]
      })
    );
  else if (url === '/api/importapps')
    response.end(
      JSON.stringify([
        {
          id: 'fake-source',
          path: '/private/auth.json',
          items: [
            { ref: 'account-1', status: 'new', provider: { name: 'Selected account', key: secret } }
          ]
        }
      ])
    );
  else if (url === '/api/plugin-signin' || url === '/api/signin')
    response.end(
      JSON.stringify({
        id: 'flow-1',
        agent: 'fake-login',
        state: signinState,
        url: 'https://login.test/authorize?state=test',
        code: 'CODE',
        refreshToken: secret
      })
    );
  else if (url === '/api/signin/flow-1')
    response.end(
      JSON.stringify({
        id: 'flow-1',
        state: signinState,
        error: signinState === 'failed' ? secret : undefined
      })
    );
  else if (url === '/api/signin/flow-1/cancel' || url === '/api/signin/flow-1/callback')
    response.writeHead(204).end();
  else response.end(JSON.stringify(providers));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const managementUrl = `http://127.0.0.1:${port}`;
const gatewayUrl = 'http://127.0.0.1:19991';
after(async () => {
  await runtime.stopManagedMagpie();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

const connect = () =>
  magpieAction({
    action: 'connect',
    managementUrl,
    managementKey,
    gatewayUrl,
    inferenceToken,
    shared: true
  });

test('literal loopback accepts IPv4/IPv6 and refuses ambiguous addresses and paths', () => {
  assert.equal(magpieLoopback('http://127.0.0.1:2000/'), 'http://127.0.0.1:2000');
  assert.equal(magpieLoopback('http://[::1]:2000'), 'http://[::1]:2000');
  for (const value of [
    'http://localhost:2000',
    'http://127.1:2000',
    'http://2130706433:2000',
    'http://0x7f000001:2000',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:2000/x',
    'http://127.0.0.1:2000?key=x',
    'http://user@127.0.0.1:2000',
    'https://127.0.0.1:2000'
  ])
    assert.throws(() => magpieLoopback(value));
});

test('candidate probing reads the public manifest without a credential session', async () => {
  assert.equal(await magpieCandidate(managementUrl), true);
  await assert.rejects(magpieCandidate('http://outside.test:3430'));
});

test('normalizers remove secrets and refuse hidden model/link surfaces', () => {
  const normalized = magpieProviders({
    providers: [
      {
        id: 'fake',
        key: { set: true, masked: secret },
        keyList: [{ id: 'fingerprint-1', name: 'Main', on: true, active: true, masked: secret }],
        balanceToken: { takes: false, set: true },
        headers: { authorization: secret },
        chat: `https://a.test/path?key=${secret}`,
        models: [
          { id: 'yes', on: true },
          { id: 'hidden', on: false },
          { id: 'bad', on: true, noAPI: true }
        ]
      }
    ]
  });
  assert.equal(JSON.stringify(normalized).includes(secret), false);
  assert.deepEqual(
    normalized[0].models.map((m) => m.id),
    ['fake/yes']
  );
  assert.equal(
    magpieSignIn({ url: 'javascript:alert(1)', error: secret, accessToken: secret }).url,
    ''
  );
  assert.equal(JSON.stringify(magpieSignIn({ error: secret })).includes(secret), false);
});

test(
  'one-click setup uses a synthetic official descriptor and coalesces concurrent clicks',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = join(folder, 'existing-magpie');
    mkdirSync(directory);
    writeFileSync(
      join(directory, 'web-page.json'),
      JSON.stringify({ mode: 'local', port, key: managementKey }),
      { mode: 0o600 }
    );
    const before = process.env.ODDBORO_MAGPIE_CONFIG_DIR;
    process.env.ODDBORO_MAGPIE_CONFIG_DIR = directory;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(String(input));
      if (url.origin === 'http://127.0.0.1:3425')
        return Promise.reject(
          new Error('Synthetic absent gateway', { cause: { code: 'ECONNREFUSED' } })
        );
      assert(
        [managementUrl, gatewayUrl].includes(url.origin),
        `Unexpected fixture request: ${url.origin}`
      );
      return realFetch(input, init);
    };
    try {
      const [first, second] = await Promise.all([
        magpieAction({ action: 'setup' }),
        magpieAction({ action: 'setup' })
      ]);
      assert.equal(first, second);
      assert.equal(first.setup?.status, 'connected');
      assert.equal(first.state.mode, 'existing');
      assert.equal(first.state.managementUrl, managementUrl);
      assert.equal(first.state.gatewayUrl, gatewayUrl);
      assert.equal(JSON.stringify(first).includes(managementKey), false);
      assert.equal(JSON.stringify(first).includes(secret), false);
      assert.equal((await magpieRunConnection('fake/one')).apiKey, 'oddboro-local');
      assert.equal((await magpieAction({ action: 'setup' })).setup?.reused, true);
    } finally {
      globalThis.fetch = realFetch;
      if (before === undefined) delete process.env.ODDBORO_MAGPIE_CONFIG_DIR;
      else process.env.ODDBORO_MAGPIE_CONFIG_DIR = before;
    }
  }
);

test('local Browser access link attaches safely and failed or mixed credentials preserve the active connection', async () => {
  await connect();
  const prior = magpieConnectionIdentity();
  const wrongKey = 'wrong-synthetic-web-key-123';
  const invalid = [
    { accessLink: `${managementUrl}/?k=${managementKey}&extra=x` },
    { accessLink: `${managementUrl}/?k=${managementKey}`, managementUrl: '', managementKey: '' },
    { accessLink: `${managementUrl}/?k=${wrongKey}` }
  ];
  for (const fields of invalid) {
    const before = magpieConnectionIdentity();
    await assert.rejects(
      magpieAction({
        action: 'connect',
        gatewayUrl,
        inferenceToken,
        shared: true,
        ...fields
      } as Parameters<typeof magpieAction>[0]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes(managementKey) && !error.message.includes(wrongKey));
        return true;
      }
    );
    assert.equal(magpieConnectionIdentity(), before);
  }
  assert.equal(magpieConnectionIdentity(), prior);
  const link = `${managementUrl}/?k=${managementKey}`;
  localLanKey = inferenceToken;
  let attached: Awaited<ReturnType<typeof magpieAction>>;
  try {
    attached = await magpieAction({ action: 'connect', accessLink: link, shared: true });
  } finally {
    localLanKey = undefined;
  }
  assert.equal(attached.state.ready, true);
  assert.equal(attached.state.managementUrl, managementUrl);
  assert.equal(attached.state.gatewayUrl, gatewayUrl);
  assert.deepEqual(await magpieRunConnection('fake/one'), {
    baseUrl: gatewayUrl,
    apiKey: inferenceToken,
    model: 'fake/one'
  });
  assert.ok(!JSON.stringify(attached).includes(managementKey));
  assert.ok(!JSON.stringify(attached).includes(inferenceToken));
  assert.ok(!readFileSync(join(folder, 'magpie', 'connection.json'), 'utf8').includes('?k='));
  assert.ok(observedPaths.every((path) => !path.includes('?')));
});

test('existing unpatched instance connects through its cookie contract; all reads redact secrets', async () => {
  const result = await connect();
  assert.equal(result.state.ready, true);
  assert.equal(result.state.shared, true);
  assert.equal(result.state.version, 'dev');
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(managementKey), false);
  assert.equal(JSON.stringify(result).includes(inferenceToken), false);
  assert.match(magpieConnectionIdentity(), /^[a-f0-9]{64}$/);
  if (process.platform !== 'win32')
    assert.equal(statSync(join(folder, 'magpie', 'connection.json')).mode & 0o777, 0o600);
  assert.deepEqual(await magpieRunConnection('fake/one'), {
    baseUrl: gatewayUrl,
    apiKey: inferenceToken,
    model: 'fake/one'
  });
  assert.equal((await magpieRunConnection('group/team')).model, 'group/team');
  await assert.rejects(magpieRunConnection('fake/hidden'));
  await assert.rejects(magpieRunConnection('missing'));
});

test('redirects and upstream error bodies never reach the page or get followed', async () => {
  redirect = true;
  assert.equal(await magpieEndpoint(managementUrl, 'gateway'), 'unknown');
  await assert.rejects(magpieRequest(managementUrl, managementKey, '/api/providers'), /redirected/);
  redirect = false;
  upstreamError = true;
  const state = await magpieState();
  assert.equal(state.ready, false);
  assert.equal(JSON.stringify(state).includes(secret), false);
  upstreamError = false;
  oversized = true;
  await assert.rejects(magpieRequest(managementUrl, managementKey, '/api/providers'), /too large/);
  oversized = false;
  await assert.rejects(magpieRequest(managementUrl, managementKey, '/api/../secret'));
});

test('editing preserves raw advanced state and credential-bearing endpoint URLs server side', async () => {
  await magpieAction({
    action: 'provider-save',
    provider: { id: 'fake', name: 'New name', chat: 'https://provider.test/v1' }
  });
  const provider = changes.at(-1)!.body;
  assert.equal(provider.chat, `https://provider.test/v1?key=${secret}`);
  assert.deepEqual(provider.headers, { Authorization: secret });
  assert.deepEqual(provider.extraBody, { custom: 'keep' });
  assert.equal(provider.key, undefined);
  assert.deepEqual(provider.models, ['one']);
  await magpieAction({
    action: 'group-save',
    group: { id: 'team', name: 'New group', members: ['fake/one'], routing: 'rotate' }
  });
  const group = changes.at(-1)!.body;
  assert.deepEqual(group.rules, [{ intent: 'keep' }]);
  assert.deepEqual(group.accounts, { fake: ['keep'] });
  assert.equal(group.patience, -1);
  assert.equal(group.firstToken, 10);
  await assert.rejects(
    magpieAction({
      action: 'group-save',
      group: { id: 'team', name: 'Bad', members: ['missing/model'], routing: 'order' }
    })
  );
});

test('API key actions use checked fingerprints and never return submitted credentials', async () => {
  await magpieAction({ action: 'key-add', id: 'fake', name: 'Spare', key: secret });
  assert.equal(changes.at(-1)!.path, '/api/keys/add');
  assert.deepEqual(changes.at(-1)!.body, { id: 'fake', name: 'Spare', key: secret });
  const replace = await magpieAction({
    action: 'key-replace',
    id: 'fake',
    ref: 'fingerprint-1',
    key: secret
  });
  assert.equal(changes.at(-1)!.path, '/api/keys/replace');
  assert.equal(JSON.stringify(replace).includes(secret), false);
  await magpieAction({ action: 'key-toggle', id: 'fake', ref: 'fingerprint-1', on: false });
  assert.equal(changes.at(-1)!.path, '/api/keys/off');
  await magpieAction({ action: 'key-remove', id: 'fake', ref: 'fingerprint-1' });
  assert.equal(changes.at(-1)!.path, '/api/keys/remove');
  await assert.rejects(magpieAction({ action: 'key-remove', id: 'fake', ref: 'unknown-key' }));
  await assert.rejects(magpieAction({ action: 'key-add', id: 'fake', key: '' }));
});

test('sign-in supports built-in and plugin contracts, status, callback, cancellation and failures', async () => {
  const state = await magpieState();
  assert.equal(
    state.logins.some((l) => l.id === 'codex' && l.supported),
    true
  );
  assert.equal(
    state.logins.some((l) => l.id === 'fake-login' && l.supported),
    true
  );
  await magpieAction({ action: 'signin-start', agent: 'codex' });
  assert.equal(changes.at(-1)!.path, '/api/signin');
  const start = await magpieAction({ action: 'signin-start', agent: 'fake-login' });
  assert.equal(start.signIn?.state, 'waiting');
  assert.equal(JSON.stringify(start).includes(secret), false);
  signinState = 'done';
  assert.equal(
    (await magpieAction({ action: 'signin-status', id: 'flow-1' })).signIn?.state,
    'done'
  );
  await magpieAction({
    action: 'signin-callback',
    id: 'flow-1',
    url: 'http://localhost/callback?code=synthetic'
  });
  signinState = 'failed';
  assert.equal(
    JSON.stringify(await magpieAction({ action: 'signin-status', id: 'flow-1' })).includes(secret),
    false
  );
  await magpieAction({ action: 'signin-cancel', id: 'flow-1' });
  await assert.rejects(magpieAction({ action: 'signin-status', id: 'flow-1' }));
  await assert.rejects(magpieAction({ action: 'signin-start', agent: 'missing-provider' }));
});

test('discovery is explicit and selected import sends references without credentials', async () => {
  await assert.rejects(
    magpieAction({
      action: 'import-selected',
      picks: [{ source: 'fake-source', ref: 'account-1' }]
    })
  );
  const result = await magpieAction({ action: 'discovery', enabled: true });
  assert.deepEqual(result.discovered, [
    {
      source: 'fake-source',
      ref: 'account-1',
      name: 'Selected account',
      status: 'new',
      canImport: true
    }
  ]);
  assert.equal(JSON.stringify(result).includes('/private/auth.json'), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  await magpieAction({
    action: 'import-selected',
    picks: [{ source: 'fake-source', ref: 'account-1' }]
  });
  assert.deepEqual(changes.at(-1)!.body, {
    picks: [{ source: 'fake-source', ref: 'account-1', mode: 'add' }]
  });
});

test('route inspection names attempted providers and token usage without returning upstream errors', async () => {
  const result = await magpieAction({ action: 'inspect' });
  assert.equal(result.state.calls[0].inputTokens, 12);
  assert.equal(result.state.calls[0].outputTokens, 6);
  assert.equal(result.state.calls[0].cachedTokens, 4);
  assert.deepEqual(result.state.calls[0].attempts, [
    { provider: 'fake', model: 'one', status: 429, failed: true },
    { provider: 'fake', model: 'one', status: 200, failed: false }
  ]);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('request usage preserves unknown and partial counters while measured zero stays zero', async () => {
  const expected = (inputTokens?: number, outputTokens?: number, cachedTokens?: number) => ({
    inputTokens,
    outputTokens,
    cachedTokens
  });
  const counters = (call: { inputTokens?: number; outputTokens?: number; cachedTokens?: number }) =>
    expected(call.inputTokens, call.outputTokens, call.cachedTokens);
  const cases = [
    { snapshot: undefined, trace: undefined, want: expected() },
    { snapshot: {}, trace: [], want: expected() },
    { snapshot: null, trace: [null], want: expected() },
    { snapshot: { input: 3 }, trace: [{ in: 3 }], want: expected(3) },
    {
      snapshot: { input: 0, output: 0, cache_read: 0 },
      trace: [{ in: 0, out: 0, cache_read: 0 }],
      want: expected(0, 0, 0)
    },
    {
      snapshot: { input: -1, output: '3', cache_read: 1.5 },
      trace: [{ in: -1, out: '3', cache_read: 1.5 }],
      want: expected()
    },
    {
      snapshot: { input: NaN, output: Infinity, cache_read: Number.MAX_SAFE_INTEGER + 1 },
      trace: [{ in: NaN, out: Infinity, cache_read: Number.MAX_SAFE_INTEGER + 1 }],
      want: expected()
    }
  ];
  try {
    await connect();
    for (const entry of cases) {
      snapshotUsage = entry.snapshot;
      routeUsage = entry.trace;
      const snapshotCall = (await magpieState()).calls[0];
      const traceCall = (await magpieAction({ action: 'inspect' })).state.calls[0];
      assert.deepEqual(counters(snapshotCall), entry.want);
      assert.deepEqual(counters(traceCall), entry.want);
      const publicCall = JSON.parse(JSON.stringify(traceCall));
      for (const field of ['inputTokens', 'outputTokens', 'cachedTokens'] as const)
        assert.equal(Object.hasOwn(publicCall, field), entry.want[field] !== undefined);
    }
    routeUsage = [
      { in: 3, out: 5, cache_read: 1 },
      { in: 7, out: 0, cache_read: 2 }
    ];
    assert.deepEqual(
      counters((await magpieAction({ action: 'inspect' })).state.calls[0]),
      expected(10, 5, 3)
    );
    routeUsage = [{ in: 3, out: 5 }, { in: 2 }];
    assert.deepEqual(
      counters((await magpieAction({ action: 'inspect' })).state.calls[0]),
      expected(5)
    );
    routeUsage = [
      { in: Number.MAX_SAFE_INTEGER, out: 0, cache_read: 0 },
      { in: 1, out: 0, cache_read: 0 }
    ];
    assert.deepEqual(
      counters((await magpieAction({ action: 'inspect' })).state.calls[0]),
      expected(undefined, 0, 0)
    );
  } finally {
    snapshotUsage = undefined;
    routeUsage = [{ in: 12, out: 6, cache_read: 4 }];
  }
});

test('disconnect forgets shared connection without stopping its service', async () => {
  await magpieAction({ action: 'disconnect' });
  assert.equal((await magpieState()).connected, false);
  assert.equal(magpieConnectionIdentity(), '');
  const response = await fetch(`${managementUrl}/api/settings`, {
    headers: { Cookie: `magpie_web_${port}=${managementKey}` }
  });
  assert.equal(response.status, 200);
  await assert.rejects(magpieRunConnection('fake/one'));
});

test('initial existing management attach can remain connected while its gateway is offline', async () => {
  existingGatewayRunning = false;
  try {
    const attached = await connect();
    assert.equal(attached.state.connected, true);
    assert.equal(attached.state.mode, 'existing');
    assert.equal(attached.state.ready, false);
    assert.equal(runtime.managedRunning(), false);
  } finally {
    existingGatewayRunning = true;
    await magpieAction({ action: 'disconnect' });
  }
});

test('managed manifest refuses corrupt binary, wrong target, and absent embedded ownership', async () => {
  const binary = join(folder, 'magpie-fake');
  writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  process.env.ODDBORO_MAGPIE_BINARY = binary;
  const manifest = {
    apiVersion: 1,
    embedded: true,
    version: 'test',
    sha256: '0'.repeat(64),
    platform: process.platform,
    arch: process.arch,
    sourceCommit: 'a'.repeat(40),
    patchSha256: 'b'.repeat(64)
  };
  writeFileSync(join(folder, 'magpie-runtime.json'), JSON.stringify(manifest));
  await assert.rejects(runtime.startManagedMagpie(), /checksum/);
  manifest.sha256 = createHash('sha256').update(readFileSync(binary)).digest('hex');
  writeFileSync(
    join(folder, 'magpie-runtime.json'),
    JSON.stringify({ ...manifest, arch: 'wrong-arch' })
  );
  await assert.rejects(runtime.startManagedMagpie(), /platform/);
  writeFileSync(join(folder, 'magpie-runtime.json'), JSON.stringify(manifest));
  const first = runtime.startManagedMagpie();
  await assert.rejects(runtime.startManagedMagpie(), /already running/);
  await assert.rejects(first, /did not become ready/);
  assert.equal(runtime.managedRunning(), false);
  delete process.env.ODDBORO_MAGPIE_BINARY;
});

test(
  'managed process proves both nonces, filters inherited credentials, and disconnect stops only its child',
  {
    skip:
      process.platform === 'win32'
        ? 'Synthetic executable uses a POSIX shebang; Windows process acceptance is a separate release check.'
        : false
  },
  async () => {
    const binary = join(folder, 'managed-fixture');
    const source = readFileSync(new URL('./fixtures/magpie-fake.mjs', import.meta.url), 'utf8');
    writeFileSync(binary, `#!${process.execPath}\n${source}`, { mode: 0o700 });
    const manifest = {
      apiVersion: 1,
      embedded: true,
      version: 'fixture-1',
      sha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
      platform: process.platform,
      arch: process.arch,
      sourceCommit: 'a'.repeat(40),
      patchSha256: 'b'.repeat(64)
    };
    writeFileSync(join(folder, 'magpie-runtime.json'), JSON.stringify(manifest));
    writeFileSync(
      join(folder, 'fixture.json'),
      JSON.stringify({ capabilities: ['signin:codex', 'discovery:codex-file'] })
    );
    process.env.ODDBORO_MAGPIE_BINARY = binary;
    process.env.AWS_SECRET_ACCESS_KEY = 'synthetic-parent-key';
    const result = await magpieAction({ action: 'start-managed' });
    assert.equal(result.state.ready, true);
    assert.equal(result.state.shared, false);
    assert.equal(runtime.managedRunning(), true);
    const receipt = JSON.parse(
      readFileSync(join(folder, 'magpie', 'runtime', 'fixture-process.json'), 'utf8')
    );
    assert.equal(receipt.inherited, false);
    assert.ok(receipt.args.includes('--embedded'));
    assert.equal((await magpieRunConnection('fixture/one')).model, 'fixture/one');
    assert.equal(result.state.logins.find((l) => l.id === 'codex')?.supported, true);
    assert.equal(result.state.logins.find((l) => l.id === 'claude')?.supported, false);
    await assert.rejects(magpieAction({ action: 'signin-start', agent: 'claude' }));
    const signin = await magpieAction({ action: 'signin-start', agent: 'codex' });
    assert.equal(signin.signIn?.state, 'waiting');
    await magpieAction({
      action: 'signin-callback',
      id: 'codex-fixture',
      url: 'http://localhost/auth/callback?code=synthetic'
    });
    assert.equal(
      (await magpieAction({ action: 'signin-status', id: 'codex-fixture' })).signIn?.state,
      'done'
    );
    const discovery = await magpieAction({ action: 'discovery', enabled: true });
    assert.equal(discovery.discovered?.[0].source, 'codex-file');
    assert.equal(JSON.stringify(discovery).includes('/synthetic/private/codex-home'), false);
    await assert.rejects(
      magpieAction({
        action: 'import-selected',
        picks: [{ source: 'codex-file', ref: '/synthetic/private/codex-home' }]
      })
    );
    await magpieAction({
      action: 'import-selected',
      picks: [{ source: 'codex-file', ref: discovery.discovered![0].ref }]
    });
    assert.deepEqual(
      JSON.parse(readFileSync(join(folder, 'magpie', 'runtime', 'selected-source.json'), 'utf8')),
      { ref: '/synthetic/private/codex-home' }
    );

    await magpieAction({ action: 'disconnect' });
    assert.equal(runtime.managedRunning(), false);
    assert.throws(() => process.kill(receipt.pid, 0));
    assert.equal((await magpieState()).connected, false);
    // The independently owned existing service still answers.
    assert.equal(
      (
        await fetch(`${managementUrl}/api/settings`, {
          headers: { Cookie: `magpie_web_${port}=${managementKey}` }
        })
      ).status,
      200
    );
    writeFileSync(join(folder, 'fixture.json'), JSON.stringify({ wrongNonce: true }));
    await assert.rejects(magpieAction({ action: 'start-managed' }), /ownership/);
    assert.equal(runtime.managedRunning(), false);
    writeFileSync(join(folder, 'fixture.json'), JSON.stringify({ wrongVersion: true }));
    await assert.rejects(magpieAction({ action: 'start-managed' }), /embedded contract/);
    assert.equal(runtime.managedRunning(), false);
    writeFileSync(join(folder, 'fixture.json'), JSON.stringify({}));
    await magpieAction({ action: 'start-managed' });
    const oldIdentity = magpieConnectionIdentity();
    await runtime.stopManagedMagpie();
    const restarted = (await import(
      new URL('./magpie.ts?restart-test', import.meta.url).href
    )) as typeof import('./magpie.ts');
    assert.equal((await restarted.magpieState()).mode, 'managed');
    assert.equal((await restarted.magpieState()).ready, false);
    await restarted.initializeMagpie();
    assert.equal((await restarted.magpieState()).ready, true);
    assert.notEqual(restarted.magpieConnectionIdentity(), oldIdentity);
    await restarted.magpieAction({ action: 'disconnect' });
    assert.equal(runtime.managedRunning(), false);
    delete process.env.ODDBORO_MAGPIE_BINARY;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  }
);

test(
  'switching to existing keeps the built-in route on offline or bad auth and replaces it only when ready',
  {
    skip:
      process.platform === 'win32'
        ? 'Synthetic executable uses a POSIX shebang; Windows process acceptance is a separate release check.'
        : false
  },
  async () => {
    process.env.ODDBORO_MAGPIE_BINARY = join(folder, 'managed-fixture');
    writeFileSync(join(folder, 'fixture.json'), JSON.stringify({}));
    try {
      await magpieAction({ action: 'start-managed' });
      const identity = magpieConnectionIdentity();
      const route = await magpieRunConnection('fixture/one');
      const stored = readFileSync(join(folder, 'magpie', 'connection.json'), 'utf8');
      const preserved = async () => {
        assert.equal(runtime.managedRunning(), true);
        assert.equal(magpieConnectionIdentity(), identity);
        assert.equal(readFileSync(join(folder, 'magpie', 'connection.json'), 'utf8'), stored);
        assert.deepEqual(await magpieRunConnection('fixture/one'), route);
        const current = await magpieState();
        assert.equal(current.mode, 'managed');
        assert.equal(current.ready, true);
      };

      existingGatewayRunning = false;
      await assert.rejects(connect(), (error: unknown) => {
        assert.equal((error as { status: number }).status, 409);
        assert.match((error as Error).message, /existing Magpie gateway is not running/);
        assert.match((error as Error).message, /Start it and retry/);
        assert.match((error as Error).message, /built-in connection was kept/);
        return true;
      });
      await preserved();

      existingGatewayRunning = true;
      await assert.rejects(
        magpieAction({
          action: 'connect',
          managementUrl,
          managementKey: 'wrong-management-key-123',
          gatewayUrl,
          inferenceToken,
          shared: true
        }),
        /refused its management key/
      );
      await preserved();

      const switched = await connect();
      assert.equal(switched.state.mode, 'existing');
      assert.equal(switched.state.ready, true);
      assert.equal(runtime.managedRunning(), false);
      assert.notEqual(magpieConnectionIdentity(), identity);
      assert.equal((await magpieRunConnection('fake/one')).baseUrl, gatewayUrl);
      await assert.rejects(magpieRunConnection('fixture/one'));
    } finally {
      existingGatewayRunning = true;
      await magpieAction({ action: 'disconnect' });
      delete process.env.ODDBORO_MAGPIE_BINARY;
    }
  }
);

test(
  'abrupt synthetic office exit closes its child pipe and retires the managed runtime',
  {
    skip:
      process.platform === 'win32'
        ? 'Synthetic executable uses a POSIX shebang; Windows process acceptance is a separate release check.'
        : false
  },
  async () => {
    const binary = join(folder, 'managed-fixture');
    writeFileSync(join(folder, 'fixture.json'), JSON.stringify({}));
    const hostHome = join(folder, 'abrupt-host');
    const module = new URL('./magpie.ts', import.meta.url).href;
    const parent = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(module)}); const r = await m.magpieAction({action:'start-managed'}); console.log(r.state.ready ? 'ready' : 'failed');`
      ],
      {
        env: { ...process.env, ODDBORO_HOME: hostHome, ODDBORO_MAGPIE_BINARY: binary },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Synthetic host did not start')), 5000);
        parent.once('error', reject);
        parent.stdout.once('data', (data) => {
          clearTimeout(timer);
          data.toString().includes('ready')
            ? resolve()
            : reject(new Error('Synthetic host failed'));
        });
      });
      const receipt = JSON.parse(
        readFileSync(join(hostHome, 'magpie', 'runtime', 'fixture-process.json'), 'utf8')
      );
      const exited = new Promise<void>((resolve) => parent.once('exit', () => resolve()));
      parent.kill('SIGKILL');
      await exited;
      let running = true;
      for (let attempt = 0; attempt < 100 && running; attempt++) {
        try {
          process.kill(receipt.pid, 0);
          if (process.platform === 'linux')
            running = !/\) Z /.test(readFileSync(`/proc/${receipt.pid}/stat`, 'utf8'));
        } catch {
          running = false;
        }
        if (running) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(running, false, 'Managed child survived its synthetic parent');
    } finally {
      parent.kill('SIGKILL');
    }
  }
);

async function onPlatform<T>(platform: NodeJS.Platform, fn: () => T | Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', descriptor!);
  }
}

test('the server resolves its owned runtime name for Mac, Linux and Windows', async () => {
  const before = process.env.ODDBORO_MAGPIE_BINARY;
  delete process.env.ODDBORO_MAGPIE_BINARY;
  try {
    for (const platform of ['darwin', 'linux', 'win32'] as const)
      await onPlatform(platform, () => {
        assert.equal(
          runtime.magpieBinary().endsWith(platform === 'win32' ? 'magpie.exe' : 'magpie'),
          true
        );
        assert.equal(runtime.magpieBinary().includes('stage'), true);
      });
  } finally {
    if (before !== undefined) process.env.ODDBORO_MAGPIE_BINARY = before;
  }
});

test('corrupt saved connection is unavailable rather than fresh absence', async () => {
  const file = join(folder, 'magpie', 'connection.json');
  writeFileSync(file, '{synthetic-corruption', { mode: 0o600 });
  const fresh = (await import(
    new URL('./magpie.ts?corrupt-setup-test', import.meta.url).href
  )) as typeof import('./magpie.ts');
  try {
    const result = await fresh.magpieAction({ action: 'setup' });
    assert.equal(result.setup?.status, 'unavailable');
    assert.match(result.setup?.message || '', /saved Magpie connection/);
    assert.equal(result.state.connected, false);
    assert.equal(runtime.managedRunning(), false);
  } finally {
    rmSync(file, { force: true });
  }
});

test('a fresh model-only office choice persists Pi, while existing and refused choices remain unchanged', async () => {
  const previousAgent = process.env.OFFICE_AGENT;
  const previousModel = process.env.OFFICE_MAGPIE_MODEL;
  const agents = await import('../../routes/api/agents/+server.ts');
  const put = (body: object) =>
    agents.PUT({
      request: new Request('http://office/api/agents', {
        method: 'PUT',
        body: JSON.stringify(body)
      })
    } as Parameters<typeof agents.PUT>[0]);
  try {
    await connect();
    delete process.env.OFFICE_AGENT;
    delete process.env.OFFICE_MAGPIE_MODEL;
    await put({ magpieModel: 'magpie:fake/one' });
    assert.equal(process.env.OFFICE_AGENT, 'pi');
    assert.equal(process.env.OFFICE_MAGPIE_MODEL, 'fake/one');
    const saved = readFileSync(join(folder, 'none.env'), 'utf8');
    assert.match(saved, /^OFFICE_AGENT=pi$/m);
    await assert.rejects(
      async () => await put({ office: 'pi', magpieModel: 'magpie:fake/missing' })
    );
    assert.equal(readFileSync(join(folder, 'none.env'), 'utf8'), saved);
    assert.equal(process.env.OFFICE_AGENT, 'pi');
    await put({ office: 'claude', magpieModel: null });
    assert.equal(process.env.OFFICE_AGENT, 'claude');
    assert.equal(process.env.OFFICE_MAGPIE_MODEL, '');
    // A pre-existing model with no explicit runner used Claude before Pi was added.
    delete process.env.OFFICE_AGENT;
    process.env.OFFICE_MAGPIE_MODEL = 'fake/one';
    await put({ magpieModel: 'magpie:fake/one' });
    assert.equal(process.env.OFFICE_AGENT, undefined);
    assert.equal((await import('@oddboro/ledger')).officeAgent(), 'claude');
    process.env.OFFICE_AGENT = 'codex';
    await put({ magpieModel: 'magpie:fake/one' });
    assert.equal(process.env.OFFICE_AGENT, 'codex');
  } finally {
    if (previousAgent === undefined) delete process.env.OFFICE_AGENT;
    else process.env.OFFICE_AGENT = previousAgent;
    if (previousModel === undefined) delete process.env.OFFICE_MAGPIE_MODEL;
    else process.env.OFFICE_MAGPIE_MODEL = previousModel;
  }
});
