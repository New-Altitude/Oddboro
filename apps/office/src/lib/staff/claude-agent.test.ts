import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS } from './roster.ts';
import { readClaudeAgent } from './claude-agent.ts';

const agent = [
  '---',
  'name: fact-checker',
  'description: >-',
  '  Check each claim',
  '  against its source.',
  'model: sonnet',
  'tools: [Read, Grep]',
  'skills: [check-claims]',
  'permissionMode: plan',
  '---',
  'Quote the passage and flag any mismatch.',
  '---',
  'Return a list of corrections.'
].join('\n');

test('a Claude agent opens as an editable job with its other settings named', () => {
  const draft = readClaudeAgent('\uFEFF' + agent.replaceAll('\n', '\r\n'));
  assert.equal(draft.name, 'fact-checker');
  assert.equal(draft.role, 'fact checker');
  assert.equal(draft.remit, 'Check each claim against its source.');
  assert.equal(
    draft.desk,
    draft.remit + '\n\nQuote the passage and flag any mismatch.\n---\nReturn a list of corrections.'
  );
  assert.match(draft.model ?? '', /^claude-sonnet-/);
  assert.deepEqual(draft.skipped, ['tools', 'skills', 'permissionMode']);
});

test('an unsupported model is named and the job description is never silently cut', () => {
  const draft = readClaudeAgent(agent.replace('model: sonnet', 'model: unknown'));
  assert.equal(draft.model, null);
  assert.ok(draft.skipped.includes('model'));
  assert.throws(() => readClaudeAgent(agent + 'a'.repeat(LIMITS.desk)), /Shorten/);
  assert.throws(() => readClaudeAgent('ordinary Markdown'), /header/);
  assert.throws(() => readClaudeAgent('---\nname: example\n---'), /description/);
});

test('the original agent name survives a shortened display name', () => {
  const sourceName = 'fact-checker-'.repeat(5);
  const draft = readClaudeAgent(agent.replace('name: fact-checker', 'name: ' + sourceName));
  assert.equal(draft.sourceName, sourceName);
  assert.equal(draft.name, sourceName.slice(0, LIMITS.name));
});
