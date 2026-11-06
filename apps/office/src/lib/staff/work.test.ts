// How the floor and the chat name the tool an Odd is using. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GEMINI_FILE_TOOLS, GROK_FILE_TOOLS, toolWords } from './work.ts';

test("each of Claude Code's tools an Odd's run uses reads in plain words", () => {
  const names = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'ToolSearch'];
  assert.deepEqual(Object.fromEntries(names.map((n) => [n, toolWords(n)])), {
    Read: 'Reading files',
    Glob: 'Looking for files',
    Grep: 'Searching files',
    Edit: 'Editing files',
    Write: 'Writing a file',
    Bash: 'Running a command',
    ToolSearch: 'Looking for a tool'
  });
});

test("every Claude Code name Grok's and Gemini's file tools stand for reads in words, never as the name", () => {
  for (const claude of [...Object.values(GROK_FILE_TOOLS), ...Object.values(GEMINI_FILE_TOOLS)])
    assert.notEqual(toolWords(claude), claude, claude);
});

test('an MCP call reads as the tool it names, with its server', () => {
  assert.equal(toolWords('mcp__office__my_access'), 'my access (office)');
});
