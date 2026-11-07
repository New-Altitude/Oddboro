import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { MagpieAction } from '../magpie.ts';

const folder = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-magpie-use-')));
Object.assign(process.env, {
  ODDBORO_HOME: folder,
  ODDBORO_ENV: join(folder, 'absent.env'),
  ODDBORO_MAGPIE_CONFIG_DIR: join(folder, 'descriptor'),
  ODDBORO_MAGPIE_BINARY: join(folder, 'missing-binary'),
  HOME: folder,
  USERPROFILE: folder
});
let sequence = 0;
const fresh = () => import(`./magpie.ts?gateway-fixture=${++sequence}`);
let api = await fresh();
const file = join(folder, 'magpie', 'connection.json');
const webKey = 'synthetic-management-key-123456';
const sentinel = 'private-value-not-in-public-data';
const observed: { path: string; headers: IncomingHttpHeaders }[] = [];
let behavior = 'valid';
let gatewayRunning = true;
let advertised = '';
const rows = () => [
  {
    id: 'fake/model-one',
    object: 'model',
    owned_by: 'fake',
    display_name: 'Model one',
    modalities: { input: ['text', 'image'] },
    secret: sentinel
  },
  { id: 'group/exact-alias', object: 'model', owned_by: 'group', display_name: 'My routing alias' },
  { id: 'bare-model-id', object: 'model', owned_by: 'fake' }
];
const gateway = createServer((request, response) => {
  const path = request.url || '';
  observed.push({ path, headers: request.headers });
  response.setHeader('Content-Type', 'application/json');
  if (behavior === 'redirect') {
    response.writeHead(302, { Location: `${origin}/trap` }).end();
    return;
  }
  if (behavior === 'auth') {
    response.writeHead(401).end(JSON.stringify({ error: sentinel }));
    return;
  }
  if (path === '/' || path === '/v1') {
    response.end(
      JSON.stringify({
        name: behavior === 'wrong-name' ? 'another-api' : 'magpie',
        ...(behavior === 'unknown-version'
          ? {}
          : { version: behavior === 'new-version' ? '2.0.0' : '1.0.0' })
      })
    );
    return;
  }
  if (path !== '/v1/models') {
    response.writeHead(500).end(JSON.stringify({ error: sentinel }));
    return;
  }
  let data: unknown = rows();
  if (behavior === 'empty') data = [];
  if (behavior === 'invalid-data') data = {};
  if (behavior === 'bad-row') data = [null];
  if (behavior === 'unsafe-id') data = [{ ...rows()[0], id: 'bad?key=secret' }];
  if (behavior === 'duplicate') data = [rows()[0], rows()[0]];
  if (behavior === 'too-many')
    data = Array.from({ length: 10_001 }, (_, i) => ({ ...rows()[0], id: `model-${i}` }));
  if (behavior === 'oversized') data = [{ ...rows()[0], secret: 'x'.repeat(2 * 1024 * 1024) }];
  response.end(
    JSON.stringify({
      object: behavior === 'invalid-list' ? 'model' : 'list',
      data,
      secret: sentinel
    })
  );
});
await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
advertised = origin;
const management = createServer((request, response) => {
  const path = request.url || '';
  observed.push({ path, headers: request.headers });
  if (request.headers.cookie !== `magpie_web_${managementPort}=${webKey}`) {
    response.writeHead(403).end(sentinel);
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  if (path === '/api/settings')
    response.end(JSON.stringify({ version: '1.0.0', gateway: advertised }));
  else if (path === '/api/providers')
    response.end(
      JSON.stringify({
        providers: [
          {
            id: 'fake',
            name: 'Fake',
            ready: true,
            off: false,
            models: [{ id: 'model-one', on: true }]
          }
        ],
        presets: [],
        gateway: { url: advertised, running: gatewayRunning }
      })
    );
  else if (path === '/api/groups')
    response.end(
      JSON.stringify({
        groups: [],
        models: [{ id: 'fake/model-one', name: 'Model one', provider: 'fake' }]
      })
    );
  else response.writeHead(404).end('{}');
});
await new Promise<void>((resolve) => management.listen(0, '127.0.0.1', resolve));
const managementPort = (management.address() as { port: number }).port;
const managementUrl = `http://127.0.0.1:${managementPort}`;
after(async () => {
  await api.magpieAction({ action: 'disconnect' });
  await Promise.all([
    new Promise<void>((resolve) => gateway.close(() => resolve())),
    new Promise<void>((resolve) => management.close(() => resolve()))
  ]);
  rmSync(folder, { recursive: true, force: true });
});
const connect = () => api.magpieAction({ action: 'connect-gateway', gatewayUrl: origin });

test('one-click setup prefers a verified keyless gateway over an unusable management descriptor; concurrent clicks coalesce', async () => {
  mkdirSync(join(folder, 'descriptor'), { recursive: true });
  writeFileSync(join(folder, 'descriptor', 'web-page.json'), '{invalid descriptor', {
    mode: 0o600
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    assert(url.startsWith('http://127.0.0.1:3425/'), `Unexpected discovery: ${url}`);
    return realFetch(url.replace('http://127.0.0.1:3425', origin), init);
  };
  try {
    const [first, second] = await Promise.all([
      api.magpieAction({ action: 'setup' }),
      api.magpieAction({ action: 'setup' })
    ]);
    assert.deepEqual(second, first);
    assert.equal(first.state.access, 'use');
    assert.equal(first.state.ready, true);
    assert.equal(first.setup?.status, 'connected');
    assert.equal(first.state.gatewayUrl, 'http://127.0.0.1:3425');
    assert.equal(first.state.managementUrl, '');
    assert.deepEqual(
      first.state.models.map((m: { id: string }) => m.id),
      rows().map((m) => m.id)
    );
    assert.equal(first.state.models[1].kind, 'group');
    for (const field of ['providers', 'groups', 'logins', 'calls'] as const)
      assert.deepEqual(first.state[field], []);
    assert.equal(JSON.stringify(first).includes(sentinel), false);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.access, 'use');
    assert.equal(saved.managementKey, '');
    assert.equal(saved.inferenceToken, '');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(
      observed.some((r) => r.path.startsWith('/api')),
      false
    );
    assert(
      observed.every(
        (r) =>
          !r.headers.authorization &&
          !r.headers.cookie &&
          !r.headers.origin &&
          !r.headers['sec-fetch-site']
      )
    );
    await api.magpieAction({ action: 'disconnect' });
    behavior = 'unknown-version';
    const unknown = await api.magpieAction({ action: 'setup' });
    assert.equal(unknown.state.access, 'use');
    assert.equal(unknown.state.version, '');
    assert.equal(unknown.state.ready, true);
  } finally {
    behavior = 'valid';
    globalThis.fetch = realFetch;
    await api.magpieAction({ action: 'disconnect' });
  }
});

test('use-only run validation preserves exact group and model IDs without management requests', async () => {
  observed.length = 0;
  const state = (await connect()).state;
  assert.equal(state.access, 'use');
  assert.equal(state.models[0].images, true);
  for (const row of rows())
    assert.deepEqual(await api.magpieRunConnection(row.id), {
      baseUrl: origin,
      apiKey: 'oddboro-local',
      model: row.id
    });
  await assert.rejects(api.magpieRunConnection('not-listed'), /unavailable/);
  assert(observed.every((r) => r.path === '/v1' || r.path === '/v1/models'));
  assert(observed.every((r) => !r.headers.authorization && !r.headers.cookie));
});

test('every management mutation and inspection refuses before any outbound request', async () => {
  await connect();
  for (const action of [
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
  ]) {
    observed.length = 0;
    await assert.rejects(
      api.magpieAction({ action } as MagpieAction),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 403
    );
    assert.deepEqual(observed, [], action);
  }
});

test('invalid gateways and catalogs preserve the existing connection and identity', async () => {
  await connect();
  const before = readFileSync(file, 'utf8');
  const identity = api.magpieConnectionIdentity();
  for (const bad of [
    'wrong-name',
    'redirect',
    'auth',
    'invalid-list',
    'invalid-data',
    'bad-row',
    'unsafe-id',
    'duplicate',
    'too-many',
    'oversized'
  ]) {
    behavior = bad;
    observed.length = 0;
    await assert.rejects(connect());
    assert.equal(readFileSync(file, 'utf8'), before, bad);
    assert.equal(api.magpieConnectionIdentity(), identity, bad);
    assert.equal(
      observed.some((r) => r.path === '/trap' || r.path.startsWith('/api')),
      false
    );
  }
  behavior = 'valid';
  for (const gatewayUrl of [
    'http://localhost:3425',
    'http://127.1:3425',
    'https://127.0.0.1:3425',
    'http://192.0.2.1:3425',
    `${origin}/v1`,
    `${origin}?key=secret`
  ])
    await assert.rejects(api.magpieAction({ action: 'connect-gateway', gatewayUrl }));
});

test('saved use-only reconnect revalidates its selected endpoint; failed refresh never scans descriptors or another listener', async () => {
  await connect();
  const identity = api.magpieConnectionIdentity();
  api = await fresh();
  observed.length = 0;
  assert.equal((await api.magpieAction({ action: 'setup' })).setup?.reused, true);
  assert.equal(api.magpieConnectionIdentity(), identity);
  assert(observed.every((r) => r.path === '/v1' || r.path === '/v1/models'));
  behavior = 'new-version';
  const state = await api.magpieState();
  assert.equal(state.access, 'use');
  assert.equal(state.ready, false);
  assert.match(state.problem, /changed version/);
  await assert.rejects(api.magpieRunConnection('group/exact-alias'), /changed version/);
  observed.length = 0;
  const retry = await api.magpieAction({ action: 'setup' });
  assert.equal(retry.setup?.status, 'unavailable');
  assert.equal(retry.state.gatewayUrl, origin);
  assert(observed.every((r) => r.path === '/v1'));
  behavior = 'valid';
});

test('management upgrade failures preserve use-only identity and route, successful upgrade rotates it', async () => {
  await connect();
  const before = readFileSync(file, 'utf8');
  const identity = api.magpieConnectionIdentity();
  await assert.rejects(
    api.magpieAction({
      action: 'connect',
      managementUrl,
      managementKey: 'wrong-management-key',
      shared: true
    }),
    /management key/
  );
  gatewayRunning = false;
  await assert.rejects(
    api.magpieAction({ action: 'connect', managementUrl, managementKey: webKey, shared: true }),
    /current connection was kept/
  );
  gatewayRunning = true;
  advertised = 'http://127.0.0.1:65533';
  await assert.rejects(
    api.magpieAction({ action: 'connect', managementUrl, managementKey: webKey, shared: true }),
    /another gateway/
  );
  advertised = origin;
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(api.magpieConnectionIdentity(), identity);
  assert.equal((await api.magpieRunConnection('group/exact-alias')).model, 'group/exact-alias');
  const upgraded = await api.magpieAction({
    action: 'connect',
    managementUrl,
    managementKey: webKey,
    shared: true
  });
  assert.equal(upgraded.state.access, 'manage');
  assert.notEqual(api.magpieConnectionIdentity(), identity);
  const managedIdentity = api.magpieConnectionIdentity();
  await connect();
  assert.notEqual(api.magpieConnectionIdentity(), managedIdentity);
});

test('empty catalogs connect but are not ready, and missing version stays unknown', async () => {
  behavior = 'empty';
  const empty = await connect();
  assert.equal(empty.state.connected, true);
  assert.equal(empty.state.ready, false);
  await assert.rejects(api.magpieRunConnection('fake/model-one'), /unavailable/);
  behavior = 'unknown-version';
  assert.equal((await connect()).state.version, '');
  behavior = 'valid';
});

test('malformed or mixed saved use-only credentials fail closed without discovery', async () => {
  await connect();
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  for (const changes of [
    { mode: 'managed' },
    { location: 'server' },
    { managementKey: webKey },
    { managementUrl },
    { inferenceToken: webKey },
    { managementCookie: 'magpie_web_3430' },
    { capabilities: ['providers'] },
    { instanceId: 'pretend-owned' },
    { version: 1 },
    { version: 'bad version' },
    { connectionId: '' },
    { gatewayUrl: 'http://localhost:3425' }
  ]) {
    writeFileSync(file, JSON.stringify({ ...saved, ...changes }));
    api = await fresh();
    observed.length = 0;
    const result = await api.magpieAction({ action: 'setup' });
    assert.equal(result.setup?.status, 'unavailable');
    assert.deepEqual(observed, []);
  }
  await api.magpieAction({ action: 'disconnect' });
});
