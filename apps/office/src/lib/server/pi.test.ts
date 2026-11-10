import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { PiRun } from './pi.ts';

const dir = mkdtempSync(join(tmpdir(), 'oddboro-pi-launch-'));
process.env.ODDBORO_HOME = dir;
const { piLaunch, piReader } = await import('./pi.ts');
const { FILES_SERVER, home } = await import('@oddboro/ledger');
const fileWalls = {
  cwd: dir,
  reads: [],
  writes: [dir],
  noWrite: [],
  noAccess: [home('pi-sessions'), home('magpie'), home('accounts')]
};
const fileServer = {
  command: process.execPath,
  args: [FILES_SERVER],
  env: { ODDBORO_FILES: JSON.stringify(fileWalls) }
};
const run: PiRun = {
  key: 'one',
  staffId: 'one',
  account: 'one',
  dir,
  reads: [],
  writes: [dir],
  granted: [],
  sourceIdentity: 'source',
  system: 'System.',
  input: 'Hello.',
  servers: { office: { command: 'example' }, files: fileServer },
  allowed: ['mcp__office', 'mcp__files'],
  timeoutMs: 2000,
  web: false,
  commands: false,
  network: false,
  connection: { baseUrl: 'http://127.0.0.1:1234', apiKey: 'fixture-key', model: 'group/test' }
};

test('launch limits environment and keeps the gateway key out of input and arguments', () => {
  process.env.ANTHROPIC_API_KEY = 'other-secret';
  process.env.NODE_OPTIONS = '--require=bad';
  try {
    const launch = piLaunch(run);
    assert.ok(!('refused' in launch));
    if ('refused' in launch) return;
    assert.equal(launch.env.ODDBORO_PI_API_KEY, 'fixture-key');
    assert.equal(launch.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(launch.env.NODE_OPTIONS, undefined);
    assert.ok(!launch.stdin.includes('fixture-key'));
    assert.ok(!JSON.stringify(launch.command).includes('fixture-key'));
    const payload = JSON.parse(launch.stdin);
    assert.equal(payload.denyRoots, undefined);
    assert.equal(payload.writes, undefined);
    assert.deepEqual(payload.servers, run.servers);
    assert.deepEqual(payload.allowed, run.allowed);
    assert.deepEqual(piReader({ type: 'delta', text: 'hello' }), [
      { type: 'delta', text: 'hello' }
    ]);
    assert.deepEqual(piReader({ type: 'unknown', value: 'hello' }), []);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.NODE_OPTIONS;
  }
});

test('a staff run refuses missing, malformed or spoofed private file walls', () => {
  assert.ok('refused' in piLaunch({ ...run, allowed: ['mcp__office'] }));
  assert.ok('refused' in piLaunch({ ...run, servers: { office: run.servers.office } }));
  const changed = (walls: unknown) => ({
    ...fileServer,
    env: { ODDBORO_FILES: JSON.stringify(walls) }
  });
  for (const walls of [
    null,
    {},
    { noAccess: [] },
    { noAccess: ['relative'] },
    { noAccess: [home('pi-sessions'), home('magpie')] },
    { noAccess: [...fileWalls.noAccess, null] }
  ]) {
    assert.ok(
      'refused' in piLaunch({ ...run, servers: { ...run.servers, files: changed(walls) } })
    );
  }
  assert.ok(
    'refused' in
      piLaunch({
        ...run,
        servers: { ...run.servers, files: { ...fileServer, args: ['untrusted'] } }
      })
  );
  for (const files of [
    { ...fileServer, type: 'http', url: 'https://example.invalid' },
    { ...fileServer, args: [FILES_SERVER, 'extra'] },
    { ...fileServer, env: { ...fileServer.env, NODE_OPTIONS: '--require=untrusted' } }
  ]) {
    assert.ok('refused' in piLaunch({ ...run, servers: { ...run.servers, files } }));
  }
});

test('office runs carry no tools and unavailable connections refuse', () => {
  const launch = piLaunch({ ...run, bare: true });
  assert.ok(!('refused' in launch));
  if ('refused' in launch) return;
  assert.deepEqual(JSON.parse(launch.stdin).servers, {});
  assert.deepEqual(JSON.parse(launch.stdin).allowed, []);
  assert.ok('refused' in piLaunch({ ...run, connection: undefined }));
  assert.ok('refused' in piLaunch({ ...run, commands: true }));
  assert.ok('refused' in piLaunch({ ...run, sourceIdentity: '' }));
  rmSync(dir, { recursive: true, force: true });
});
