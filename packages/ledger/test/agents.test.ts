// Which coding tools the office offers on each system. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentsOn,
  drawsLooks,
  AGENTS,
  EFFORTS,
  effortFor,
  filesViaOffice,
  MODELS,
  modelFor,
  isMagpieModel,
  offeredAgent
} from '../src/agents.ts';

test('a Mac, Linux and Windows office each offer Pi, Claude Code, Grok and Codex, and not Gemini yet', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    assert.deepEqual(agentsOn(platform), ['pi', 'claude', 'grok', 'codex'], platform);
    for (const tool of ['pi', 'claude', 'grok', 'codex'])
      assert.equal(offeredAgent(tool, platform), tool, `${tool} on ${platform}`);
    assert.equal(offeredAgent('gemini', platform), undefined, platform);
  }
});

test('the office carries the files of Pi, Claude Code, Codex and Grok on every system, and never of Gemini', () => {
  const want = {
    pi: { darwin: true, linux: true, win32: true },
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
  assert.equal(modelFor('claude', 'magpie:group/opus'), 'magpie:group/opus');
  assert.equal(modelFor('pi', 'magpie:group/opus'), 'magpie:group/opus');
  assert.equal(modelFor('pi', 'gpt-6-astra'), undefined);
  assert.equal(modelFor('claude', 'magpie:bare-model-id'), 'magpie:bare-model-id');
  assert.equal(modelFor('pi', 'magpie:bare-model-id'), 'magpie:bare-model-id');
  assert.equal(drawsLooks('claude', 'magpie:group/opus'), false);
  assert.equal(drawsLooks('codex', 'magpie:provider/astra'), false);
  // Luna stops at Max, so an Ultra kept from Sol becomes Max.
  assert.equal(effortFor('codex', 'ultra', false, 'gpt-6-luna'), 'max');
  assert.equal(effortFor('codex', 'ultra', false, 'gpt-6.1-sol'), 'ultra');
  for (const [tool, list] of Object.entries(MODELS))
    for (const m of list)
      assert.ok((m.efforts ?? EFFORTS[tool as keyof typeof EFFORTS]).includes('medium'), m.id);
});

test('Magpie model references accept bounded catalog IDs and reject malformed input', () => {
  for (const id of [
    'bare-model-id',
    'provider/model',
    'group/team',
    'org/provider/model:latest',
    'provider//model',
    'provider/model/',
    '/model',
    'x'.repeat(256)
  ]) {
    assert.equal(isMagpieModel(`magpie:${id}`), true, id);
    assert.equal(modelFor('pi', `magpie:${id}`), `magpie:${id}`);
  }
  for (const invalid of [
    'magpie:',
    'magpie:a b',
    'magpie:a\nb',
    'magpie:a\u0000b',
    'magpie:a?b',
    `magpie:${'x'.repeat(257)}`
  ]) {
    assert.equal(isMagpieModel(invalid), false, JSON.stringify(invalid));
    assert.equal(modelFor('pi', invalid), undefined);
  }
  assert.equal(isMagpieModel(null), false);
  assert.equal(isMagpieModel(undefined), false);
  assert.equal(modelFor('pi', 'gpt-6-astra'), undefined);
  assert.equal(drawsLooks('claude', 'magpie:opus'), false);
});
