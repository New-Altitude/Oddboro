import assert from 'node:assert/strict';
import { test } from 'node:test';
import { magpieAccessLink } from './magpie-http.ts';

const key = 'synthetic-management-key-123';

test('Browser access links expose only their origin and single decoded key', () => {
  assert.deepEqual(magpieAccessLink(`http://127.0.0.1:3430/?k=${key}`, 'local'), {
    origin: 'http://127.0.0.1:3430',
    key
  });
  assert.deepEqual(magpieAccessLink(`http://[::1]:3430?k=${key}`, 'local'), {
    origin: 'http://[::1]:3430',
    key
  });
  assert.deepEqual(magpieAccessLink(`https://magpie.example:8443/?k=${key}`, 'server'), {
    origin: 'https://magpie.example:8443',
    key
  });
  assert.equal(
    magpieAccessLink('http://127.0.0.1:3430/?k=synthetic%2Dmanagement%2Dkey%2D123', 'local').key,
    key
  );
});

test('access links reject ambiguous URLs, nonliteral local origins and mixed queries without leaking input', () => {
  const invalid: [string, 'local' | 'server'][] = [
    [`http://localhost:3430/?k=${key}`, 'local'],
    [`http://127.1:3430/?k=${key}`, 'local'],
    [`http://2130706433:3430/?k=${key}`, 'local'],
    [`http://0x7f000001:3430/?k=${key}`, 'local'],
    [`http://user@127.0.0.1:3430/?k=${key}`, 'local'],
    [`http://127.0.0.1:3430/a/../?k=${key}`, 'local'],
    [`http://127.0.0.1:3430/\\?k=${key}`, 'local'],
    [`http://127.0.0.1:3430/?k=${key}#`, 'local'],
    [`http://127.0.0.1:3430/?k=${key}&k=${key}`, 'local'],
    [`http://127.0.0.1:3430/?k=${key}&extra=x`, 'local'],
    [`http://127.0.0.1:3430/?k=${key}&`, 'local'],
    [`http://127.0.0.1:3430/?other=${key}`, 'local'],
    [`http://127.0.0.1:3430/?k=short`, 'local'],
    [`http://127.0.0.1:3430/?k=${key}\u0000`, 'local'],
    [`http://127.0.0.1:3430/?k=${key}`, 'server'],
    [`https://user:password@magpie.example/?k=${key}`, 'server'],
    [`https://magpie.example/a/../?k=${key}`, 'server'],
    [`https://magpie.example/?k=${key}#fragment`, 'server'],
    [`https://magpie.example/?k=${'a'.repeat(8193)}`, 'server']
  ];
  for (const [value, location] of invalid) {
    assert.throws(
      () => magpieAccessLink(value, location),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /synthetic-management-key|password/);
        return true;
      },
      value.replaceAll(key, '[key]')
    );
  }
});
