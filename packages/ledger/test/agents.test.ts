// Which coding tools the office offers on each system. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AGENT_PLATFORMS,
  AGENTS,
  agentsOn,
  commandsHow,
  EFFORTS,
  effortFor,
  filesViaOffice,
  MODELS,
  modelFor,
  offeredAgent
} from '../src/agents.ts';

test('a Mac, Linux and Windows office each offer Claude Code, Grok and Codex, and not Gemini yet', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    assert.deepEqual(agentsOn(platform), ['claude', 'grok', 'codex'], platform);
    for (const tool of ['claude', 'grok', 'codex'])
      assert.equal(offeredAgent(tool, platform), tool, `${tool} on ${platform}`);
    assert.equal(offeredAgent('gemini', platform), undefined, platform);
  }
});

test('the office carries the files of Claude Code, Codex and Grok on every system, and never of Gemini', () => {
  const want = {
    claude: { darwin: true, linux: true, win32: true },
    codex: { darwin: true, linux: true, win32: true },
    grok: { darwin: true, linux: true, win32: true },
    gemini: { darwin: false, linux: false, win32: false }
  };
  for (const agent of AGENTS)
    for (const platform of ['darwin', 'linux', 'win32'] as const)
      assert.equal(
        filesViaOffice(agent, platform),
        want[agent][platform],
        `${agent} on ${platform}`
      );
});

test("an Odd's level is its own pick on its tool, Medium when none, the nearest below when its tool lacks it, and never below Medium for the Office Manager", () => {
  assert.equal(effortFor('claude', null, false), 'medium');
  assert.equal(effortFor('claude', 'low', false), 'low');
  assert.equal(effortFor('codex', 'ultra', false), 'ultra');
  assert.equal(effortFor('claude', 'ultra', false), 'max');
  assert.equal(effortFor('grok', 'xhigh', false), 'high');
  assert.equal(effortFor('claude', 'nonsense', false), 'medium');
  assert.equal(effortFor('claude', 'low', true), 'medium');
  assert.equal(effortFor('codex', 'high', true), 'high');
  assert.equal(effortFor('gemini', 'high', false), undefined);
  // Every tool that takes levels takes Medium, so the default and the floor always fit.
  for (const [tool, menu] of Object.entries(EFFORTS))
    if (menu.length) assert.ok(menu.includes('medium'), tool);
});

test("an Odd's model is one its tool lists, or the office's, and its levels follow the model", () => {
  assert.equal(modelFor('codex', 'gpt-6-astra'), 'gpt-6-astra');
  assert.equal(modelFor('claude', 'gpt-6-astra'), undefined);
  assert.equal(modelFor('grok', null), undefined);
  // Luna stops at Max, so an Ultra kept from Sol becomes Max.
  assert.equal(effortFor('codex', 'ultra', false, 'gpt-6-luna'), 'max');
  assert.equal(effortFor('codex', 'ultra', false, 'gpt-6.1-sol'), 'ultra');
  for (const [tool, list] of Object.entries(MODELS))
    for (const m of list)
      assert.ok((m.efforts ?? EFFORTS[tool as keyof typeof EFFORTS]).includes('medium'), m.id);
});

test("a tool's commands reach the internet only on a system where it runs commands and that was measured", () => {
  for (const agent of AGENTS)
    for (const platform of AGENT_PLATFORMS[agent].networkWithWeb) {
      assert.ok(AGENT_PLATFORMS[agent].runs.includes(platform), `${agent} on ${platform}`);
      assert.notEqual(commandsHow(agent, platform).state, 'never', `${agent} on ${platform}`);
    }
});
