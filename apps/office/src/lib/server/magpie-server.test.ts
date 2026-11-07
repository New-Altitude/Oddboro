import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { test } from 'node:test';
import { magpieLoopback, magpieServer } from './magpie-http.ts';

const managementKey = 'synthetic-server-management-key';
const inferenceToken = 'synthetic-server-inference-token';
const privateSentinel = 'synthetic-provider-secret-never-return';

test('explicit server URLs require root HTTPS and do not weaken local URL checks', () => {
  assert.equal(magpieServer('https://magpie.example.ts.net/'), 'https://magpie.example.ts.net');
  assert.equal(magpieServer('https://100.64.1.2:8443'), 'https://100.64.1.2:8443');
  for (const value of [
    'http://magpie.example.ts.net',
    'https://key@magpie.test',
    'https://@magpie.test',
    'https://u:p@magpie.test',
    'https://magpie.test/v1',
    'https://magpie.test?key=x',
    'https://magpie.test#x',
    'https://magpie.test\\bad',
    ' https://magpie.test'
  ])
    assert.throws(() => magpieServer(value));
  assert.throws(() => magpieLoopback('https://magpie.example.ts.net'));
  assert.throws(() => magpieLoopback('http://100.64.1.2:3425'));
});

test('trusted synthetic TLS server authenticates separate sessions, verifies catalog, persists and preserves a working owned connection on refusal', async (t) => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
  } catch {
    t.skip('OpenSSL is required to create this process-only synthetic certificate authority.');
    return;
  }
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-magpie-server-')));
  const originalCAs = getCACertificates('default');
  const servers: Server[] = [];
  const previous = {
    home: process.env.ODDBORO_HOME,
    app: process.env.ODDBORO_APP,
    env: process.env.ODDBORO_ENV,
    binary: process.env.ODDBORO_MAGPIE_BINARY,
    userHome: process.env.HOME,
    profile: process.env.USERPROFILE
  };
  Object.assign(process.env, {
    ODDBORO_HOME: folder,
    ODDBORO_APP: '0',
    ODDBORO_ENV: join(folder, 'none.env'),
    HOME: folder,
    USERPROFILE: folder
  });
  const openssl = (...args: string[]) =>
    execFileSync('openssl', args, { cwd: folder, stdio: 'ignore' });
  openssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=Oddboro synthetic test CA',
    '-keyout',
    'ca.key',
    '-out',
    'ca.crt',
    '-addext',
    'basicConstraints=critical,CA:TRUE'
  );
  openssl(
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=127.0.0.1',
    '-keyout',
    'server.key',
    '-out',
    'server.csr'
  );
  writeFileSync(
    join(folder, 'extensions'),
    'subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n'
  );
  openssl(
    'x509',
    '-req',
    '-in',
    'server.csr',
    '-CA',
    'ca.crt',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-days',
    '1',
    '-out',
    'server.crt',
    '-extfile',
    'extensions'
  );
  openssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
    '-keyout',
    'untrusted.key',
    '-out',
    'untrusted.crt',
    '-addext',
    'subjectAltName=IP:127.0.0.1'
  );
  setDefaultCACertificates([...originalCAs, readFileSync(join(folder, 'ca.crt'), 'utf8')]);
  const { magpieAction, magpieState, magpieRunConnection, magpieConnectionIdentity } =
    await import('./magpie.ts');
  const runtime = await import('./magpie-runtime.ts');
  const log: {
    path: string;
    cookie?: string;
    authorization?: string;
    origin?: string;
    site?: string;
    body: string;
  }[] = [];
  let loginMode = 'good';
  let redirectApi = false;
  let redirectGateway = false;
  let wrongVersion = false;
  let gatewayRunning = true;
  let trapCount = 0;
  const listen = async (server: Server) => {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `https://127.0.0.1:${(server.address() as { port: number }).port}`;
  };
  const trusted = {
    key: readFileSync(join(folder, 'server.key')),
    cert: readFileSync(join(folder, 'server.crt'))
  };
  const trapUrl = await listen(
    createServer(trusted, (_request, response) => {
      trapCount++;
      response.end();
    })
  );
  const handler: Parameters<typeof createServer>[1] = async (request, response) => {
    const path = request.url || '';
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    log.push({
      path,
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
      origin: request.headers.origin,
      site: request.headers['sec-fetch-site'] as string | undefined,
      body
    });
    if (path === '/_magpie/sign-in') {
      if (new URLSearchParams(body).get('key') !== managementKey) {
        response.writeHead(401).end(privateSentinel);
        return;
      }
      response
        .writeHead(303, {
          Location: loginMode === 'cross-origin' ? `${trapUrl}/` : '/',
          'Set-Cookie': `magpie_web_3430=${loginMode === 'forged-cookie' ? 'wrong-key' : managementKey}; Path=/; HttpOnly; SameSite=Lax`
        })
        .end();
      return;
    }
    if (path.startsWith('/api/')) {
      if (request.headers.cookie !== `magpie_web_3430=${managementKey}`) {
        response.writeHead(403).end(privateSentinel);
        return;
      }
      if (redirectApi) {
        response.writeHead(302, { Location: `${trapUrl}/` }).end();
        return;
      }
    } else if (path === '/v1' || path === '/v1/models') {
      if (request.headers.authorization !== `Bearer ${inferenceToken}`) {
        response.writeHead(403).end(privateSentinel);
        return;
      }
      if (redirectGateway) {
        response.writeHead(302, { Location: `${trapUrl}/` }).end();
        return;
      }
    }
    response.setHeader('Content-Type', 'application/json');
    if (path === '/api/settings')
      response.end(
        JSON.stringify({
          version: 'server-fixture-1',
          gateway: 'http://127.0.0.1:9',
          lanKey: '',
          managementSecret: privateSentinel
        })
      );
    else if (path === '/api/providers')
      response.end(
        JSON.stringify({
          providers: [
            {
              id: 'remote',
              name: 'Remote',
              ready: true,
              off: false,
              key: { set: true, masked: privateSentinel },
              models: [
                { id: 'one', on: true },
                { id: 'denied', on: true }
              ]
            }
          ],
          presets: [],
          plugins: [],
          gateway: { running: gatewayRunning, url: 'http://127.0.0.1:9', calls: [] }
        })
      );
    else if (path === '/api/groups')
      response.end(
        JSON.stringify({
          groups: [
            { id: 'team', ref: 'group/team', name: 'Team', ready: true, members: ['remote/one'] },
            {
              id: 'denied',
              ref: 'group/denied',
              name: 'Denied',
              ready: true,
              members: ['remote/denied']
            }
          ],
          models: [
            { id: 'remote/one', provider: 'remote' },
            { id: 'remote/denied', provider: 'remote' }
          ]
        })
      );
    else if (path === '/v1')
      response.end(
        JSON.stringify({ name: 'magpie', version: wrongVersion ? 'wrong' : 'server-fixture-1' })
      );
    else if (path === '/v1/models')
      response.end(
        JSON.stringify({ object: 'list', data: [{ id: 'remote/one' }, { id: 'group/team' }] })
      );
    else response.writeHead(404).end('{}');
  };
  const managementUrl = await listen(createServer(trusted, handler));
  const separateGateway = await listen(createServer(trusted, handler));
  const untrustedUrl = await listen(
    createServer(
      {
        key: readFileSync(join(folder, 'untrusted.key')),
        cert: readFileSync(join(folder, 'untrusted.crt'))
      },
      handler
    )
  );
  const stopped = createServer(trusted, handler);
  const offlineUrl = await listen(stopped);
  await new Promise<void>((resolve) => stopped.close(() => resolve()));
  const connect = (overrides: Record<string, unknown> = {}) =>
    magpieAction({
      action: 'connect',
      location: 'server',
      managementUrl,
      managementKey,
      gatewayUrl: managementUrl,
      inferenceToken,
      shared: true,
      ...overrides
    } as Parameters<typeof magpieAction>[0]);
  try {
    const connected = await connect();
    assert.equal(connected.state.location, 'server');
    assert.equal(connected.state.ready, true);
    assert.equal(connected.state.gatewayUrl, managementUrl);
    assert.equal(connected.state.discoverySupported, false);
    assert.deepEqual(
      connected.state.models.map((m) => m.id),
      ['remote/one']
    );
    assert.equal(connected.state.groups.find((g) => g.ref === 'group/denied')?.ready, false);
    for (const value of [managementKey, inferenceToken, privateSentinel])
      assert.equal(JSON.stringify(connected).includes(value), false);
    assert.equal(
      log
        .filter((r) => r.path.startsWith('/api/'))
        .every(
          (r) =>
            r.cookie === `magpie_web_3430=${managementKey}` &&
            r.authorization === undefined &&
            r.origin === managementUrl &&
            r.site === 'same-origin'
        ),
      true
    );
    assert.equal(
      log
        .filter((r) => r.path === '/v1' || r.path === '/v1/models')
        .every(
          (r) =>
            r.cookie === undefined &&
            r.authorization === `Bearer ${inferenceToken}` &&
            r.origin === undefined &&
            r.site === undefined
        ),
      true
    );
    assert.equal(
      log.every(
        (r) =>
          !r.path.includes(managementKey) &&
          !r.path.includes(inferenceToken) &&
          !r.path.includes('?')
      ),
      true
    );
    assert.deepEqual(await magpieRunConnection('remote/one'), {
      baseUrl: managementUrl,
      apiKey: inferenceToken,
      model: 'remote/one'
    });
    assert.equal((await magpieRunConnection('group/team')).model, 'group/team');
    await assert.rejects(magpieRunConnection('remote/denied'));
    await assert.rejects(magpieRunConnection('group/denied'));
    const accessLink = `${managementUrl}/?k=${managementKey}`;
    const linked = await magpieAction({
      action: 'connect',
      location: 'server',
      accessLink,
      gatewayUrl: managementUrl,
      inferenceToken,
      shared: true
    });
    assert.equal(linked.state.ready, true);
    assert.equal(linked.state.managementUrl, managementUrl);
    assert.equal(linked.state.gatewayUrl, managementUrl);
    assert.ok(!JSON.stringify(linked).includes(managementKey));
    assert.ok(!readFileSync(join(folder, 'magpie', 'connection.json'), 'utf8').includes('?k='));
    assert.ok(log.every((entry) => !entry.path.includes('?')));
    const stored = JSON.parse(readFileSync(join(folder, 'magpie', 'connection.json'), 'utf8'));
    assert.equal(stored.managementCookie, 'magpie_web_3430');
    const reloaded = (await import(
      new URL('./magpie.ts?server-persisted-test', import.meta.url).href
    )) as typeof import('./magpie.ts');
    assert.equal((await reloaded.magpieState()).location, 'server');
    assert.equal((await reloaded.magpieAction({ action: 'setup' })).setup?.reused, true);
    assert.equal(
      (await connect({ gatewayUrl: separateGateway })).state.gatewayUrl,
      separateGateway
    );
    const identity = magpieConnectionIdentity();
    const preserved = async () => {
      assert.equal(magpieConnectionIdentity(), identity);
      assert.equal((await magpieState()).location, 'server');
    };
    for (const extra of [
      { accessLink: `${managementUrl}/?k=${managementKey}&extra=x` },
      { accessLink, managementUrl: '' },
      { accessLink, inferenceToken: managementKey },
      { accessLink, inferenceToken: '' },
      { accessLink, gatewayUrl: 'http://127.0.0.1:3425' }
    ]) {
      const before = log.length;
      const attempt = {
        action: 'connect',
        location: 'server',
        gatewayUrl: separateGateway,
        inferenceToken,
        shared: true,
        ...extra
      };
      await assert.rejects(
        magpieAction(attempt as Parameters<typeof magpieAction>[0]),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(!error.message.includes(managementKey));
          return true;
        }
      );
      assert.equal(log.length, before);
      await preserved();
    }
    for (const overrides of [
      { managementUrl: 'http://127.0.0.1:3430' },
      { gatewayUrl: 'http://127.0.0.1:3425' },
      { inferenceToken: '' },
      { inferenceToken: managementKey },
      { managementKey: inferenceToken },
      { inferenceToken: 'wrong-inference-token' },
      { managementUrl: untrustedUrl },
      { gatewayUrl: untrustedUrl },
      { managementUrl: offlineUrl },
      { gatewayUrl: offlineUrl }
    ]) {
      await assert.rejects(connect(overrides));
      await preserved();
    }
    for (const mode of ['cross-origin', 'forged-cookie']) {
      loginMode = mode;
      await assert.rejects(connect());
      loginMode = 'good';
      await preserved();
    }
    redirectApi = true;
    await assert.rejects(connect(), /redirected/);
    redirectApi = false;
    await preserved();
    redirectGateway = true;
    await assert.rejects(connect(), /redirected/);
    redirectGateway = false;
    await preserved();
    wrongVersion = true;
    await assert.rejects(connect(), /version and catalog/);
    wrongVersion = false;
    await preserved();
    gatewayRunning = false;
    await assert.rejects(connect(), /gateway is not running/);
    gatewayRunning = true;
    await preserved();
    assert.equal(trapCount, 0);
    if (process.platform !== 'win32') {
      await magpieAction({ action: 'disconnect' });
      const binary = join(folder, 'managed-fixture');
      writeFileSync(
        binary,
        `#!${process.execPath}\n${readFileSync(new URL('./fixtures/magpie-fake.mjs', import.meta.url), 'utf8')}`,
        { mode: 0o700 }
      );
      writeFileSync(join(folder, 'fixture.json'), '{}');
      writeFileSync(
        join(folder, 'magpie-runtime.json'),
        JSON.stringify({
          apiVersion: 1,
          embedded: true,
          version: 'fixture-1',
          sha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
          platform: process.platform,
          arch: process.arch,
          sourceCommit: 'a'.repeat(40),
          patchSha256: 'b'.repeat(64)
        })
      );
      process.env.ODDBORO_MAGPIE_BINARY = binary;
      await magpieAction({ action: 'start-managed' });
      const ownedIdentity = magpieConnectionIdentity();
      const ownedRoute = await magpieRunConnection('fixture/one');
      for (const overrides of [
        { inferenceToken: 'wrong-inference-token' },
        { managementUrl: untrustedUrl },
        { gatewayUrl: untrustedUrl },
        { managementUrl: offlineUrl },
        { gatewayUrl: offlineUrl }
      ]) {
        await assert.rejects(connect(overrides));
        assert.equal(runtime.managedRunning(), true);
        assert.equal(magpieConnectionIdentity(), ownedIdentity);
        assert.deepEqual(await magpieRunConnection('fixture/one'), ownedRoute);
      }
      gatewayRunning = false;
      await assert.rejects(connect(), /built-in connection was kept/);
      gatewayRunning = true;
      assert.equal(runtime.managedRunning(), true);
      assert.equal(magpieConnectionIdentity(), ownedIdentity);
      assert.equal((await connect()).state.location, 'server');
      assert.equal(runtime.managedRunning(), false);
    }
  } finally {
    await magpieAction({ action: 'disconnect' });
    await runtime.stopManagedMagpie();
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    setDefaultCACertificates(originalCAs);
    for (const [name, value] of Object.entries({
      ODDBORO_HOME: previous.home,
      ODDBORO_APP: previous.app,
      ODDBORO_ENV: previous.env,
      ODDBORO_MAGPIE_BINARY: previous.binary,
      HOME: previous.userHome,
      USERPROFILE: previous.profile
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(folder, { recursive: true, force: true });
  }
});
