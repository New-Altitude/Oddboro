import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { LIMITS } from './roster.ts';
import { readAgentFile, readAgentMarkdown } from './agent-file.ts';

const readClaudeAgent = (text: string) => readAgentMarkdown(text, 'claude');

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
  assert.deepEqual(draft.settings, {
    tools: ['Read', 'Grep'],
    excluded: undefined,
    skills: ['check-claims'],
    skipped: ['permissionMode']
  });
});

test('an unsupported model is named and the job description is never silently cut', () => {
  const draft = readClaudeAgent(agent.replace('model: sonnet', 'model: unknown'));
  assert.equal(draft.model, null);
  assert.ok(draft.settings.skipped.includes('model'));
  assert.throws(() => readClaudeAgent(agent + 'a'.repeat(LIMITS.desk)), /Shorten/);
  assert.throws(() => readClaudeAgent('ordinary Markdown'), /header/);
  assert.throws(() => readClaudeAgent('---\nname: example\n---'), /description/);
});

test('the original agent name survives a shortened display name', () => {
  const sourceName = 'fact-checker-'.repeat(5);
  const draft = readClaudeAgent(agent.replace('name: fact-checker', 'name: ' + sourceName));
  assert.equal(draft.source.name, sourceName);
  assert.equal(draft.name, sourceName.slice(0, LIMITS.name));
});

test('a Grok Build agent keeps its source and lists settings the office leaves behind', () => {
  const file =
    '---\nname: orchard\ndescription: Count crates.\npromptMode: extend\ntools: [read_file]\n---\nCheck each batch.';
  const draft = readAgentMarkdown(file, 'grok');
  assert.deepEqual(draft.source, { format: 'grok', name: 'orchard' });
  assert.deepEqual(draft.settings.tools, ['read_file']);
  assert.deepEqual(draft.settings.skipped, ['promptMode']);
  assert.equal(draft.model, null);
  assert.equal(draft.desk, 'Count crates.\n\nCheck each batch.');
  assert.throws(
    () => readAgentMarkdown(file.replace('extend', 'full') + ' ${{ tools.read_file }}', 'grok'),
    /template/
  );
});

test('a Hermes profile export supplies the name, description and instructions', async () => {
  const archive = await readFile(new URL('./fixtures/orchard-auditor.tar.gz', import.meta.url));
  const file = new File([new Uint8Array(archive)], 'renamed-archive.tgz');
  const draft = await readAgentFile(file, 'hermes');
  assert.deepEqual(draft.source, { format: 'hermes', name: 'orchard-auditor' });
  assert.equal(draft.remit, 'Reconcile a fictional orchard harvest.');
  assert.equal(draft.model, null);
  assert.match(draft.desk, /Count only undamaged crates/);
  assert.match(draft.desk, /ORCHARD-RECEIPT-VERIFIED/);
  await assert.rejects(
    readAgentFile(new File(['not a profile'], 'empty.tgz'), 'hermes'),
    /readable Hermes/
  );
});

test('a source can declare no tools or name a provider-specific exclusion', () => {
  const file =
    '---\nname: checker\ndescription: Review work.\ntools: []\ndisallowedTools: [Write, Edit]\n---\nRead it.';
  const draft = readAgentMarkdown(file, 'grok');
  assert.deepEqual(draft.settings.tools, []);
  assert.deepEqual(draft.settings.excluded, ['Write', 'Edit']);
  assert.equal(draft.settings.skills, undefined);
});
