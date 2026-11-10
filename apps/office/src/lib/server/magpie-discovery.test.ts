import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { magpieAppAccess, magpieConfigDirectory } from './magpie-discovery.ts';

const folder = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-magpie-descriptor-')));
const file = join(folder, 'web-page.json');
const descriptor = { mode: 'local', port: 45555, key: 'synthetic-official-web-key' };
const write = (value: unknown = descriptor) => {
  rmSync(file, { recursive: true, force: true });
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
};
after(() => rmSync(folder, { recursive: true, force: true }));

async function onPlatform<T>(platform: NodeJS.Platform, fn: () => T | Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', descriptor!);
  }
}

test('official descriptor absence is distinct from disabled and valid access', () => {
  assert.equal(magpieAppAccess(join(folder, 'missing')).status, 'absent');
  write({ mode: '', port: 3430 });
  assert.equal(magpieAppAccess(folder).status, 'authorization-required');
  write();
  if (process.platform !== 'win32')
    assert.deepEqual(magpieAppAccess(folder), {
      status: 'available',
      managementUrl: 'http://127.0.0.1:45555',
      key: descriptor.key
    });
});

test('bounded malformed, invalid-key, oversized and nonregular descriptors fail closed', () => {
  for (const value of [
    { ...descriptor, key: 'short' },
    { ...descriptor, port: 65536 },
    { ...descriptor, mode: 'other' },
    { ...descriptor, key: 'x'.repeat(5000) }
  ]) {
    write(value);
    assert.equal(magpieAppAccess(folder).status, 'authorization-required');
  }
  writeFileSync(file, '{broken');
  assert.equal(magpieAppAccess(folder).status, 'authorization-required');
  rmSync(file);
  mkdirSync(file);
  assert.equal(magpieAppAccess(folder).status, 'authorization-required');
});

test(
  'POSIX descriptor requires restrictive permissions and current uid',
  { skip: process.platform === 'win32' },
  () => {
    write();
    chmodSync(file, 0o644);
    assert.equal(magpieAppAccess(folder).status, 'authorization-required');
    chmodSync(file, 0o600);
    const uid = process.getuid!();
    const original = Object.getOwnPropertyDescriptor(process, 'getuid')!;
    Object.defineProperty(process, 'getuid', { value: () => uid + 1 });
    try {
      assert.equal(magpieAppAccess(folder).status, 'authorization-required');
    } finally {
      Object.defineProperty(process, 'getuid', original);
    }
  }
);

test('descriptor and parent directory symlinks fail closed', (t) => {
  write();
  const target = join(folder, 'target.json');
  writeFileSync(target, JSON.stringify(descriptor), { mode: 0o600 });
  rmSync(file);
  try {
    symlinkSync(target, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('Synthetic symlink is unavailable on this system.');
      return;
    }
    throw error;
  }
  assert.equal(magpieAppAccess(folder).status, 'authorization-required');
  const linked = join(folder, 'linked');
  symlinkSync(folder, linked, 'dir');
  assert.equal(magpieAppAccess(linked).status, 'authorization-required');
});

test(
  'FIFO descriptor promptly refuses before opening',
  { skip: process.platform === 'win32' },
  () => {
    rmSync(file, { force: true });
    execFileSync('mkfifo', [file]);
    const before = Date.now();
    assert.equal(magpieAppAccess(folder).status, 'authorization-required');
    assert.ok(Date.now() - before < 500);
  }
);

test('platform policy permits checked POSIX descriptor and requires explicit Windows authorization', async () => {
  write();
  const nativePlatform = process.platform;
  for (const platform of ['linux', 'darwin', 'win32'] as const)
    await onPlatform(platform, () =>
      assert.equal(
        magpieAppAccess(folder).status,
        platform === 'win32' || nativePlatform === 'win32' ? 'authorization-required' : 'available'
      )
    );
  const previous = process.env.ODDBORO_MAGPIE_CONFIG_DIR;
  process.env.ODDBORO_MAGPIE_CONFIG_DIR = folder;
  try {
    assert.equal(magpieConfigDirectory(), folder);
  } finally {
    if (previous === undefined) delete process.env.ODDBORO_MAGPIE_CONFIG_DIR;
    else process.env.ODDBORO_MAGPIE_CONFIG_DIR = previous;
  }
});
