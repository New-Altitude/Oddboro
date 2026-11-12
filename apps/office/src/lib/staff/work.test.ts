// How the floor and the chat name the tool an Odd is using. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  GEMINI_FILE_TOOLS,
  GROK_FILE_TOOLS,
  gerund,
  OFFICE_TOOL_WORDS,
  runningFor,
  toolWords
} from './work.ts';

test('how long work has run reads in whole minutes, so nothing redraws every second', () => {
  const since = '2026-11-07T18:00:00Z';
  const at = (min: number) => Date.parse(since) + min * 60_000;
  assert.equal(runningFor(since, at(0.9)), 'just started');
  assert.equal(runningFor(since, at(4.5)), '4 min');
  assert.equal(runningFor(since, at(65)), '1 h 5 min');
  assert.equal(runningFor(since, at(-1)), 'just started');
});

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

test('an outside tool reads as what the Odd is doing, with its server', () => {
  assert.equal(
    toolWords('mcp__aws-secrets__list_secret_names'),
    'Listing secret names (aws-secrets)'
  );
  assert.equal(toolWords('mcp__brain__search_thoughts'), 'Searching thoughts (brain)');
  assert.equal(toolWords('mcp__brain__capture_thought'), 'Capturing thought (brain)');
  assert.equal(toolWords('mcp__gh__get_issue'), 'Getting issue (gh)');
  // A name that does not start with a verb never reads as "is thought stats".
  assert.equal(toolWords('mcp__brain__thought_stats'), 'Using thought stats (brain)');
});

test("an outside tool's service shows by the name the owner knows it by", () => {
  const names = { 'aws-secrets': 'AWS Secrets Manager', 'nkebu-supabase-co': 'Open Brain' };
  assert.equal(
    toolWords('mcp__aws-secrets__list_secret_names', names),
    'Listing secret names (AWS Secrets Manager)'
  );
  assert.equal(
    toolWords('mcp__nkebu-supabase-co__search_thoughts', names),
    'Searching thoughts (Open Brain)'
  );
  // The office's own tools never take a service's name.
  assert.equal(toolWords('mcp__office__my_access', { office: 'Other' }), 'Checking its access');
});

test('a verb takes -ing the way English spells it', () => {
  const cases = {
    list: 'listing',
    write: 'writing',
    get: 'getting',
    run: 'running',
    tag: 'tagging',
    read: 'reading',
    edit: 'editing',
    open: 'opening',
    fix: 'fixing',
    see: 'seeing',
    tie: 'tying',
    view: 'viewing'
  };
  for (const [verb, ing] of Object.entries(cases)) assert.equal(gerund(verb), ing, verb);
});

test('every office tool an Odd can call has its own words, each starting with -ing', () => {
  // mcp.ts registers its tools through a chain of modules, each importing the
  // one before it, so this follows the chain: a module left off it fails here.
  const src = new URL('../../../../../packages/ledger/src/', import.meta.url);
  const seen = new Set<string>();
  const follow = (file: string): string => {
    if (seen.has(file)) return '';
    seen.add(file);
    const text = readFileSync(new URL(file, src), 'utf8');
    const next = [...text.matchAll(/(?:import|from) '\.\/(mcp-[a-z-]+\.ts)'/g)].map((m) => m[1]);
    return text + next.map(follow).join('');
  };
  const mcp = follow('mcp.ts');
  const registered = [...mcp.matchAll(/\btool\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(registered.length > 20, `found ${registered.length} office tools`);
  for (const name of registered) {
    const words = toolWords(`mcp__office__${name}`);
    assert.equal(words, OFFICE_TOOL_WORDS[name], name);
    assert.match(words, /^[A-Z][a-z]+ing\b/, name);
  }
  assert.deepEqual(Object.keys(OFFICE_TOOL_WORDS).sort(), [...new Set(registered)].sort());
});

test('every built-in tool line starts with -ing too', () => {
  for (const name of ['WebSearch', 'WebFetch', 'google_web_search', 'web_search', 'web_fetch'])
    assert.match(toolWords(name), /^[A-Z][a-z]+ing\b/, name);
});
