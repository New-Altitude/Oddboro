// What a line of a tool's own stream tells the floor about the tool in use.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeReader, streamTools } from './claude.ts';
import { codexReader } from './codex.ts';
import { toolWords } from '../staff/work.ts';

/** A tool call starting, as Claude Code and Grok stream it. */
const started = (name: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_start', content_block: { type: 'tool_use', name } }
});

test('a Codex file change and a Grok edit reach the floor and the chat as a Claude Code Edit, in the same words', () => {
  const claude = streamTools('claude', started('Edit'));
  const grok = streamTools('grok', started('search_replace'));
  const codex = codexReader('codex')({
    type: 'item.completed',
    item: { id: 'i1', type: 'file_change', changes: [], status: 'completed' }
  }).flatMap((e) => (e.type === 'tool' ? [e.name] : []));
  assert.deepEqual([claude, grok, codex], [['Edit'], ['Edit'], ['Edit']]);
  assert.equal(toolWords(grok[0]), 'Editing files');
});

test("a Codex shell command reaches the floor as Claude Code's Bash, and Grok looking for a tool as ToolSearch", () => {
  const codex = codexReader('codex')({
    type: 'item.started',
    item: { id: 'i2', type: 'command_execution', command: 'ls', status: 'in_progress' }
  });
  assert.deepEqual(codex, [{ type: 'tool', name: 'Bash' }]);
  assert.deepEqual(streamTools('grok', started('search_tool')), ['ToolSearch']);
});

test("Claude Code's and Codex's usage names the session it totals, and Grok's does not", () => {
  const result = {
    type: 'result',
    subtype: 'success',
    session_id: 's1',
    modelUsage: { 'claude-opus-5-5': { inputTokens: 4, cacheReadInputTokens: 4011 } }
  };
  const usageOf = (events: ReturnType<ReturnType<typeof claudeReader>>) =>
    events.flatMap((e) => (e.type === 'usage' ? [e.session] : []));
  assert.deepEqual(usageOf(claudeReader('claude')(result)), ['s1']);
  assert.deepEqual(usageOf(claudeReader('grok')(result)), [undefined]);
  const codex = codexReader('gpt');
  codex({ type: 'thread.started', thread_id: 't1' });
  assert.deepEqual(
    usageOf(
      codex({ type: 'turn.completed', usage: { input_tokens: 37973, cached_input_tokens: 27392 } })
    ),
    ['t1']
  );
});
