// How the office reads its env file (src/env.ts): as Node's own parser does,
// the one db.ts loads it with, so a key written by hand reads the same in
// both; and how it writes a key that readEnv reads. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readEnv, writeEnv } from '../src/env.ts';

test('a quoted value, an export line and a trailing comment each read as the bare value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-env-'));
  try {
    const file = join(dir, 'office.env');
    writeFileSync(
      file,
      [
        '# Written by hand.',
        'DOUBLE="double-value"',
        "SINGLE='single-value'",
        'export EXPORTED=exported-value',
        'COMMENTED=commented-value # the key for Gemini',
        'PLAIN=plain-value'
      ].join('\n')
    );
    assert.deepEqual(readEnv(file), {
      DOUBLE: 'double-value',
      SINGLE: 'single-value',
      EXPORTED: 'exported-value',
      COMMENTED: 'commented-value',
      PLAIN: 'plain-value'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writing a key changes its export line in place, and clearing one removes it, as readEnv reads them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-env-'));
  try {
    const file = join(dir, 'office.env');
    writeFileSync(
      file,
      ['export CHANGED=old-value', '  export  CLEARED = cleared-value'].join('\n')
    );
    writeEnv({ CHANGED: 'new-value', CLEARED: '' }, file);
    assert.deepEqual(readEnv(file), { CHANGED: 'new-value' });
    assert.equal(readFileSync(file, 'utf8'), 'CHANGED=new-value\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a key on several lines is set on its first and cleared from all, since readEnv reads the last', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-env-'));
  try {
    const file = join(dir, 'office.env');
    writeFileSync(
      file,
      [
        'SET=first',
        'KEPT=kept-value',
        'export SET=second',
        'CLEARED=first',
        '  export CLEARED = second'
      ].join('\n')
    );
    writeEnv({ SET: 'new-value', CLEARED: '' }, file);
    assert.deepEqual(readEnv(file), { SET: 'new-value', KEPT: 'kept-value' });
    assert.equal(readFileSync(file, 'utf8'), 'SET=new-value\nKEPT=kept-value\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
