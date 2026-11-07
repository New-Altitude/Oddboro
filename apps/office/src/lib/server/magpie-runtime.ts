import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join } from 'node:path';
import { CODE, IN_APP, home } from '@oddboro/ledger';
import { MagpieError, magpieRequest, object } from './magpie-http.ts';

export type MagpieConnection = {
  mode: 'managed' | 'existing';
  location?: 'local' | 'server';
  managementCookie?: string;
  managementUrl: string;
  managementKey: string;
  gatewayUrl: string;
  inferenceToken: string;
  version: string;
  capabilities?: string[];
  instanceId?: string;
  connectionId?: string;
};
let owned: ChildProcess | undefined;
let starting = false;

export function magpieBinary(): string {
  return (
    process.env.ODDBORO_MAGPIE_BINARY ||
    join(
      CODE,
      ...(IN_APP ? ['magpie'] : ['apps', 'desktop', 'stage', 'magpie']),
      `magpie${process.platform === 'win32' ? '.exe' : ''}`
    )
  );
}
export const managedAvailable = (): boolean =>
  existsSync(magpieBinary()) && existsSync(join(dirname(magpieBinary()), 'magpie-runtime.json'));
export const managedRunning = (): boolean =>
  !!owned && owned.exitCode === null && owned.signalCode === null;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** A child handle is the only authority to stop a process. Never signal a saved PID. */
export async function stopManagedMagpie(): Promise<void> {
  const child = owned;
  if (!child) return;
  owned = undefined;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const term = setTimeout(() => child.kill('SIGTERM'), 1000);
    const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
    const done = () => {
      clearTimeout(term);
      clearTimeout(kill);
      resolve();
    };
    child.once('exit', done);
    child.once('error', done);
    child.stdin?.end();
  });
}

export async function startManagedMagpie(): Promise<MagpieConnection> {
  if (starting) throw new MagpieError('Magpie startup is already running.', 409);
  starting = true;
  try {
    return await start();
  } finally {
    starting = false;
  }
}

async function start(): Promise<MagpieConnection> {
  if (owned) throw new MagpieError('The built-in Magpie process is already running.', 409);
  const binary = magpieBinary();
  if (!isAbsolute(binary) || !managedAvailable())
    throw new MagpieError(
      'The built-in Magpie runtime is missing. Build it with npm run magpie:build or reinstall Oddboro.',
      503
    );
  let manifest: Record<string, unknown>;
  try {
    manifest = object(
      JSON.parse(readFileSync(join(dirname(binary), 'magpie-runtime.json'), 'utf8'))
    );
    const digest = createHash('sha256').update(readFileSync(binary)).digest('hex');
    if (
      manifest.apiVersion !== 1 ||
      manifest.embedded !== true ||
      manifest.sha256 !== digest ||
      manifest.platform !== process.platform ||
      manifest.arch !== process.arch ||
      typeof manifest.version !== 'string' ||
      !manifest.version ||
      !/^[a-f0-9]{40}$/.test(String(manifest.sourceCommit)) ||
      !/^[a-f0-9]{64}$/.test(String(manifest.patchSha256))
    )
      throw new Error('Invalid runtime');
  } catch {
    throw new MagpieError(
      'The built-in Magpie runtime failed its version, platform or checksum check. Rebuild or reinstall it.',
      503
    );
  }
  // Free ports are only hints. Both authenticated listeners must later prove our
  // nonce, so a collision cannot turn an unrelated local service into our child.
  const [webPort, gatewayPort] = await Promise.all([freePort(), freePort()]);
  if (webPort === gatewayPort)
    throw new MagpieError('Could not reserve separate Magpie ports. Try again.', 503);
  const directory = home('magpie', 'runtime');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const connection: MagpieConnection = {
    mode: 'managed',
    managementUrl: `http://127.0.0.1:${webPort}`,
    gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
    managementKey: randomBytes(32).toString('hex'),
    inferenceToken: randomBytes(32).toString('hex'),
    version: String(manifest.version),
    instanceId: randomBytes(32).toString('hex')
  };
  // Embedded mode is the containment contract. A private folder alone is insufficient.
  const child = spawn(
    binary,
    ['web', '--embedded', '--data-dir', directory, '--addr', `127.0.0.1:${webPort}`, '--no-open'],
    {
      // Parent EOF retires this child even if the office exits without a shutdown hook.
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
      env: {
        // Keep OS paths for opt-in discovery, not inherited agent homes or provider keys.
        // Global account/profile isolation still depends on the embedded contract.
        ...Object.fromEntries(
          [
            'PATH',
            'HOME',
            'USERPROFILE',
            'APPDATA',
            'LOCALAPPDATA',
            'SystemRoot',
            'WINDIR',
            'TEMP',
            'TMP',
            'TMPDIR',
            'LANG',
            'LC_ALL',
            'HTTPS_PROXY',
            'HTTP_PROXY',
            'NO_PROXY',
            'MAGPIE_NO_ACCOUNTS'
          ].flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]]))
        ),
        MAGPIE_ADDR: `127.0.0.1:${gatewayPort}`,
        MAGPIE_WEB_KEY: connection.managementKey,
        MAGPIE_EMBEDDED_GATEWAY_KEY: connection.inferenceToken,
        MAGPIE_EMBEDDED_INSTANCE_ID: connection.instanceId
      }
    }
  );
  owned = child;
  let failed = false;
  child.once('error', () => {
    failed = true;
    if (owned === child) owned = undefined;
  });
  child.once('exit', () => {
    failed = true;
    if (owned === child) owned = undefined;
  });
  try {
    const until = Date.now() + 10_000;
    while (Date.now() < until && !failed) {
      try {
        const handshake = object(
          await magpieRequest(
            connection.managementUrl,
            connection.managementKey,
            '/api/integration'
          )
        );
        if (
          handshake.app !== 'magpie' ||
          handshake.apiVersion !== 1 ||
          handshake.embedded !== true ||
          handshake.version !== connection.version ||
          handshake.instanceId !== connection.instanceId ||
          !Array.isArray(handshake.capabilities) ||
          !['providers', 'groups'].every((cap) =>
            (handshake.capabilities as unknown[]).includes(cap)
          )
        )
          throw new MagpieError(
            'The built-in runtime does not provide the required embedded contract.',
            503
          );
        const gateway = object(
          await magpieRequest(
            connection.gatewayUrl,
            connection.inferenceToken,
            '/v1/magpie/integration',
            undefined,
            true
          )
        );
        if (
          gateway.instanceId !== connection.instanceId ||
          gateway.version !== connection.version ||
          gateway.app !== 'magpie' ||
          gateway.apiVersion !== 1 ||
          gateway.embedded !== true
        )
          throw new MagpieError(
            'Magpie inference ownership did not match its embedded contract.',
            503
          );
        connection.capabilities = (handshake.capabilities as unknown[]).filter(
          (c): c is string => typeof c === 'string'
        );
        return connection;
      } catch (error) {
        if (error instanceof MagpieError && error.message.includes('embedded contract'))
          throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new MagpieError('The built-in Magpie runtime did not become ready.', 503);
  } catch (error) {
    await stopManagedMagpie();
    throw error;
  }
}
