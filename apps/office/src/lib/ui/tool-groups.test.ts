// The Settings tab's office tools: every tool an Odd always has is listed,
// and the search filters both lists. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OFFICE_TOOLS } from '@oddboro/ledger/tools';
import { toolGroups } from './tool-groups.ts';

const names = (tools: readonly { name: string }[]) => tools.map((t) => t.name);
const odd = {};
const manager = { manager: true };

test('with no search, every office tool is in one list, and Always on holds the chat and Gmail ones while see_office keeps its switch', () => {
  const { grantable, alwaysOn } = toolGroups('', odd);
  assert.deepEqual([...names(grantable), ...names(alwaysOn)].sort(), names(OFFICE_TOOLS).sort());
  for (const n of ['Its tasks', 'Ask to leave', 'Tell the lead', 'Propose replies'])
    assert.ok(names(alwaysOn).includes(n), n);
  assert.ok(names(grantable).includes("Sees who's in the office"));
  assert.ok(!names(alwaysOn).includes("Sees who's in the office"));
});

test("the Office Manager's Always on leaves out Ask to leave, which it is never offered, and nothing else", () => {
  const theirs = names(toolGroups('', manager).alwaysOn);
  assert.deepEqual(
    names(toolGroups('', odd).alwaysOn).filter((n) => !theirs.includes(n)),
    ['Ask to leave']
  );
  assert.deepEqual(toolGroups('', manager).grantable, toolGroups('', odd).grantable);
});

test('a search for tasks keeps Its tasks under Always on and drops what does not say it', () => {
  const { grantable, alwaysOn } = toolGroups('  Tasks ', odd);
  assert.ok(names(alwaysOn).includes('Its tasks'));
  assert.ok(!names(alwaysOn).includes('Ask you'));
  assert.ok(names(grantable).includes('Give you tasks'));
  assert.ok(!names(grantable).includes('Find tools'));
});

test('a search that matches no tool leaves both lists empty', () => {
  assert.deepEqual(toolGroups('zzz no such tool', odd), { grantable: [], alwaysOn: [] });
});
