// Which coding tools the office offers on each system. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentsOn, offeredAgent } from '../src/agents.ts';

test('a Windows office offers Claude Code and no other tool', () => {
  assert.deepEqual(agentsOn('win32'), ['claude']);
  for (const tool of ['grok', 'codex', 'gemini'])
    assert.equal(offeredAgent(tool, 'win32'), undefined, tool);
  assert.equal(offeredAgent('claude', 'win32'), 'claude');
});
