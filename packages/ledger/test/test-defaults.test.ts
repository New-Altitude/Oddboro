// The ledger's tests run away from the developer's own world: the test script
// loads test-defaults.ts, which gives each test process a home of its own and
// a PATH of node and the system's folders, and secrets.ts refuses under test
// until a test stands a store in. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { homedir, userInfo } from 'node:os';
import { test } from 'node:test';
import { AGENTS } from '../src/agents.ts';
import { getSecret } from '../src/secrets.ts';
import { toolsOnPath } from './tools-on-path.ts';

test('a test that reads a secret with no stand-in fails and says which stand-in to load', () => {
  assert.throws(() => getSecret('x', 'Y'), /office-under-test/);
});

test('a test runs in a home of its own, with no Claude folder named, and finds none of the AI tools', () => {
  assert.notEqual(homedir(), userInfo().homedir, "HOME is still the developer's own");
  assert.ok(!('CLAUDE_CONFIG_DIR' in process.env), "CLAUDE_CONFIG_DIR is still the developer's");
  assert.deepEqual(toolsOnPath(AGENTS), [], 'an AI tool a test process could start');
});
