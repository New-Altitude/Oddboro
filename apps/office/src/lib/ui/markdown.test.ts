// What an Odd's text links outside the office. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from './markdown.ts';

test('a bare file name stays text, and only a written-out address links', () => {
  assert.equal(renderMarkdown('plan.md').html.trim(), '<p>plan.md</p>');
  assert.equal(renderMarkdown('www.example.com').html.trim(), '<p>www.example.com</p>');
  assert.equal(
    renderMarkdown('https://x.y').html.trim(),
    '<p><a href="https://x.y" target="_blank" rel="noopener noreferrer">https://x.y</a></p>'
  );
});
