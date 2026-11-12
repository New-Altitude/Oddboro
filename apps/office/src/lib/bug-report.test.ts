import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserDraft, bugRequest, ISSUES } from './bug-report.ts';

test('a pasted error takes precedence over the previous chat message', () => {
  const error = 'This server did not offer a sign-in.\nThe task is still open.';
  assert.equal(
    bugRequest(`please report this message as a bug: ${error}`, 'private context'),
    error
  );
  assert.equal(bugRequest('Report this as a bug.', 'Last error'), 'Last error');
  assert.equal(bugRequest('File a bug report', 'unrelated text'), '');
  assert.equal(bugRequest('/bug The screen froze', ''), 'The screen froze');
  assert.equal(bugRequest('/bug', 'unrelated text'), '');
});

test('questions, quoted requests and bug reports for other products stay in chat', () => {
  for (const text of [
    'How do I report a bug?',
    'She said "report this as a bug".',
    'Report a bug to the calendar vendor',
    '/bugfix'
  ]) {
    assert.equal(bugRequest(text, 'previous'), undefined);
  }
});

test('the browser gets only the reviewed fields at the fixed repository', () => {
  const title = 'Bad & unexpected #1';
  const body = 'Steps\n1. Select “Connect”.\n2. Read #error?labels=other';
  const draft = browserDraft(title, body);
  const url = new URL(draft.url);
  assert.equal(draft.copyBody, false);
  assert.equal(url.origin + url.pathname, ISSUES + '/new');
  assert.deepEqual(Object.fromEntries(url.searchParams), { title, body });
});

test('a long encoded body stays available to copy instead of being cut short', () => {
  const draft = browserDraft('Sign-in', '🪴'.repeat(1200));
  assert.equal(draft.copyBody, true);
  assert.deepEqual(Object.fromEntries(new URL(draft.url).searchParams), { title: 'Sign-in' });
});
