import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cachedRuntimeMatches,
  checkArchiveEntries,
  digest,
  noticesMatch,
  sourceOf,
  thirdPartyNotices
} from './magpie-runtime.ts';

const source = {
  repository: 'https://github.com/yetone/magpie',
  commit: 'a'.repeat(40),
  archiveSha256: 'b'.repeat(64),
  patchSha256: 'c'.repeat(64),
  version: '0.1.3261-oddboro.1',
  apiVersion: 1,
  goVersion: '1.27.3'
};

test('the runtime build accepts only a pinned source and patch', () => {
  assert.deepEqual(sourceOf(source), source);
  for (const change of [
    { repository: 'https://example.invalid/another' },
    { commit: 'main' },
    { patchSha256: '' },
    { apiVersion: 2 },
    { version: '1; echo bad' }
  ])
    assert.throws(() => sourceOf({ ...source, ...change }));
  assert.throws(() => sourceOf(null));
});

test('source extraction refuses paths outside the pinned tree', () => {
  const root = `magpie-${source.commit}`;
  checkArchiveEntries([`${root}/`, `${root}/go.mod`, `${root}/internal/gui/web.go`], source.commit);
  for (const entry of [
    '/etc/config',
    `${root}/../escape`,
    `${root}/./alias`,
    `${root}\\escape`,
    `${root}/bad\nfile`,
    'another/go.mod'
  ])
    assert.throws(() => checkArchiveEntries([entry], source.commit));
  assert.throws(() => checkArchiveEntries([], source.commit));
});

test('runtime artifact digests change when the bytes change', () => {
  assert.equal(
    digest(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.notEqual(digest(Buffer.from('abc')), digest(Buffer.from('abd')));
});

test('a cached runtime must retain its embedding and build contract', () => {
  const manifest = {
    apiVersion: 1,
    embedded: true,
    sourceCommit: source.commit,
    patchSha256: source.patchSha256,
    version: source.version,
    goVersion: source.goVersion,
    platform: process.platform,
    arch: process.arch,
    signingIdentity: '',
    sha256: 'digest'
  };
  assert.equal(cachedRuntimeMatches(manifest, source, 'digest', ''), true);
  for (const change of [
    { apiVersion: 2 },
    { embedded: false },
    { goVersion: '1.0.0' },
    { patchSha256: 'changed' },
    { platform: 'unsupported' },
    { sha256: 'changed' },
    { signingIdentity: 'another signer' }
  ])
    assert.equal(cachedRuntimeMatches({ ...manifest, ...change }, source, 'digest', ''), false);
  assert.equal(cachedRuntimeMatches(null, source, 'digest', ''), false);
});

test('the notice inventory includes module, replacement, nested and Go runtime notices', () => {
  const temp = mkdtempSync(join(tmpdir(), 'magpie-notices-test-'));
  try {
    const go = join(temp, 'go');
    const module = join(temp, 'module');
    mkdirSync(join(go, 'src', 'vendor', 'example'), { recursive: true });
    mkdirSync(join(module, 'sub'), { recursive: true });
    writeFileSync(join(go, 'LICENSE'), 'go license');
    writeFileSync(join(go, 'PATENTS'), 'go patents');
    writeFileSync(join(go, 'src', 'vendor', 'modules.txt'), '# example v1.0.0\n');
    writeFileSync(join(go, 'src', 'vendor', 'example', 'LICENSE'), 'vendored license');
    writeFileSync(join(module, 'LICENSE'), 'module license');
    writeFileSync(join(module, 'sub', 'NOTICE'), 'nested notice');
    const modules = [
      {
        Path: 'old.example/mod',
        Version: 'v1',
        Replace: { Path: 'new.example/mod', Version: 'v2', Dir: module }
      }
    ];
    const result = thirdPartyNotices(modules, go, 'go1.2.3');
    for (const part of [
      'go license',
      'go patents',
      'vendored license',
      'module license',
      'nested notice',
      'old.example/mod@v1 => new.example/mod@v2'
    ])
      assert.ok(result.includes(part), part);
    assert.equal(result, thirdPartyNotices([...modules, ...modules], go, 'go1.2.3'));
    rmSync(join(go, 'src', 'vendor', 'example', 'LICENSE'));
    assert.throws(() => thirdPartyNotices(modules, go, 'go1.2.3'), /Missing Go vendor license/);
    writeFileSync(join(go, 'src', 'vendor', 'example', 'LICENSE'), 'vendored license');
    rmSync(join(module, 'LICENSE'));
    assert.throws(() => thirdPartyNotices(modules, go, 'go1.2.3'), /Missing Go module license/);
    rmSync(join(go, 'PATENTS'));
    assert.throws(() => thirdPartyNotices([], go, 'go1.2.3'), /Missing Go runtime notice/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('a cached binary requires intact staged notices and license', () => {
  const temp = mkdtempSync(join(tmpdir(), 'magpie-notices-cache-'));
  try {
    writeFileSync(join(temp, 'LICENSE'), 'license');
    writeFileSync(join(temp, 'THIRD_PARTY_NOTICES.txt'), 'notices');
    const manifest = {
      licenseSha256: digest(Buffer.from('license')),
      noticeSha256: digest(Buffer.from('notices'))
    };
    assert.equal(noticesMatch(temp, manifest), true);
    writeFileSync(join(temp, 'THIRD_PARTY_NOTICES.txt'), 'changed');
    assert.equal(noticesMatch(temp, manifest), false);
    rmSync(join(temp, 'LICENSE'));
    assert.equal(noticesMatch(temp, manifest), false);
    assert.equal(noticesMatch(temp, {}), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
