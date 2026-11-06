// TOML as a Codex run's `-c` values and its config.toml take it (`toml` in
// launch.ts). Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toml } from './launch.ts';

test('a string with U+007F is escaped, as TOML requires of every control character', () => {
  assert.equal(toml('a\x7fb\nc'), '"a\\u007fb\\nc"');
  assert.equal(toml({ 'k\x7f': 'v' }), '{ "k\\u007f" = "v" }');
});

test('a lone surrogate becomes U+FFFD, since TOML refuses one escaped, and a whole emoji stays', () => {
  assert.equal(toml('a\ud83d'), '"a�"');
  assert.equal(toml('\ude00b'), '"�b"');
  assert.equal(toml(['😀']), '["😀"]');
});
