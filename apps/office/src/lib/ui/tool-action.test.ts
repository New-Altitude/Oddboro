import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandsHow } from '@oddboro/ledger/agents';
import type { AgentTool } from '../../routes/api/agents/+server.ts';
import { offersSignOut, offersUpdate, toolAction } from './tool-action.ts';

const pi: AgentTool = {
  id: 'pi',
  name: 'Pi (built-in)',
  installed: true,
  magpieReady: false,
  commandsHow: commandsHow('pi', 'linux'),
  version: '1.5.0'
};

test('included Pi never offers a standalone CLI install, update, API key or sign-in action', () => {
  for (const tool of [
    pi,
    { ...pi, installed: false },
    {
      ...pi,
      tooOld: '2.0.0',
      newer: '2.0.0',
      signIn: { how: 'key' as const, installing: false, signedIn: true }
    },
    { ...pi, signIn: { how: 'browser' as const, installing: true, signedIn: true } }
  ]) {
    assert.equal(toolAction(tool), 'none');
    assert.equal(offersUpdate(tool), false);
    assert.equal(offersSignOut(tool), false);
  }
});

test('a direct vendor tool retains its real sign-in and update controls', () => {
  const codex: AgentTool = {
    ...pi,
    id: 'codex',
    name: 'Codex',
    newer: '9.0.0',
    signIn: { how: 'browser', installing: false, signedIn: true }
  };
  assert.equal(toolAction(codex), 'sign-in-again');
  assert.equal(offersUpdate(codex), true);
  assert.equal(offersSignOut(codex), true);
});
