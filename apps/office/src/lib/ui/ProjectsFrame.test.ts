// The Projects window's frame as the page shows it: rendered on the server, so
// each test reads the real markup Focus folds away.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { compiledForServer } from './onboarding/compiled-for-server.ts';
import type ProjectsFrameComponent from './ProjectsFrame.svelte';

const ProjectsFrame = await compiledForServer<typeof ProjectsFrameComponent>(
  join(dirname(fileURLToPath(import.meta.url)), 'ProjectsFrame.svelte')
);

const shown = (focused: boolean) =>
  render(ProjectsFrame, {
    props: {
      focused,
      list: createRawSnippet(() => ({ render: () => '<p>The sessions</p>' })),
      children: createRawSnippet(() => ({ render: () => '<p>The terminal</p>' }))
    }
  }).body;

const TITLE_ROW = /<header[^>]*>\s*<h2[^>]*>Projects<\/h2>/;
const LIST = /<nav[^>]*aria-label="Sessions"[^>]*>\s*<p>The sessions<\/p>/;

test('Without Focus the window shows the Projects title row and the session list', () => {
  const html = shown(false);
  assert.match(html, TITLE_ROW);
  assert.match(html, LIST);
  assert.match(html, /<p>The terminal<\/p>/);
});

test('Focus folds away the title row and the session list, and keeps the session', () => {
  const html = shown(true);
  assert.doesNotMatch(html, /<header/);
  assert.doesNotMatch(html, /<nav/);
  assert.doesNotMatch(html, /The sessions/);
  assert.match(html, /<section[^>]*aria-label="Projects"[^>]*>[\s\S]*<p>The terminal<\/p>/);
});
