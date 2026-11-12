import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserDraft, failedReply, formStart, ISSUES } from './bug-report.ts';

test("Report a bug starts with the last Odd line's error when that line is a failed reply", () => {
  const error = 'This server did not offer a sign-in.\nThe task is still open.';
  const owner = { from: 'owner', text: 'Connect the calendar.' } as const;
  assert.equal(failedReply([owner, { from: 'staff', text: `${error}\n`, failed: true }]), error);
  // A run the owner's answer on a card started, which failed.
  assert.equal(failedReply([{ from: 'staff', text: 'Run failed', runFailed: true }]), 'Run failed');
  // The owner wrote after it: the last Odd line still decides.
  assert.equal(failedReply([{ from: 'staff', text: error, failed: true }, owner]), error);
});

test('Report a bug starts empty when the last Odd line is no failed reply', () => {
  assert.equal(failedReply([]), '');
  assert.equal(failedReply([{ from: 'owner', text: 'Hello.' }]), '');
  assert.equal(
    failedReply([
      { from: 'staff', text: 'Old error', failed: true },
      { from: 'staff', text: 'Done. The calendar is connected.' }
    ]),
    ''
  );
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

test("File this opens the form with the Odd's title and details as it drafted them", () => {
  const draft = {
    title: 'Chat lost an attached file',
    body: 'What happened\n\nThe file vanished.'
  };
  assert.deepEqual(formStart(draft), draft);
});

test("the plus menu's details start the title with their first line", () => {
  assert.deepEqual(formStart({ body: '  Run failed\nThe task is still open.' }), {
    title: 'Run failed',
    body: '  Run failed\nThe task is still open.'
  });
  assert.deepEqual(formStart({ body: '' }), { title: '', body: '' });
});
