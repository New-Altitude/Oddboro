// Which of a task's steps hold up Mark done: only those the office does
// something for. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Step } from '@oddboro/ledger';
import { chatAnswer, mustDo, stepsToGo, stepText } from './task-steps.ts';

const signIn: Step = {
  text: 'Click Sign in.',
  done: false,
  key: 'oauth:gmail',
  action: { kind: 'oauth', connector: 'gmail' }
};
const landed: Step = { text: 'Approve access on that page.', done: false, key: 'oauth:gmail' };
const secret: Step = {
  text: 'Paste your key below.',
  done: false,
  action: { kind: 'secret', connector: 'x', name: 'Authorization' }
};
const tools: Step = {
  text: 'Click Connect.',
  done: false,
  action: { kind: 'tools', connector: 'x' }
};
const choice: Step = {
  text: 'Which one?',
  done: false,
  action: { kind: 'choice', options: ['A', 'B'] }
};
const plain: Step = { text: 'Have a look at the draft.', done: false };

test('a step with an action, or the sign-in step that ticks itself, must be done first', () => {
  for (const s of [signIn, landed, secret, tools, choice]) assert.equal(mustDo(s), true, s.text);
});

test('a plain step never holds up Mark done', () => {
  assert.equal(mustDo(plain), false);
  assert.equal(mustDo({ ...plain, key: 'something-else' }), false);
  assert.equal(stepsToGo([plain, plain]), 0);
});

test('the count to go is the undone steps that must be done', () => {
  assert.equal(stepsToGo([signIn, landed, tools, plain]), 3);
  assert.equal(stepsToGo([{ ...signIn, done: true }, { ...landed, done: true }, tools, plain]), 1);
  assert.equal(stepsToGo([{ ...tools, done: true }, plain]), 0);
});

test('a task answered with one response is answered in chat; anything more stays on the Desk', () => {
  const task = (steps: Step[], askId: number | null = null) => ({ steps, askId });
  assert.deepEqual(chatAnswer(task([]), false), { steps: [] });
  assert.deepEqual(chatAnswer(task([plain]), false), { steps: [plain] });
  assert.deepEqual(chatAnswer(task([plain, choice]), false), {
    steps: [plain],
    choice: { index: 1, options: ['A', 'B'] }
  });
  // A choice made on the Desk already: what is left is a written answer.
  assert.deepEqual(chatAnswer(task([{ ...choice, done: true, answer: 'A' }]), false), {
    steps: []
  });
  assert.equal(chatAnswer(task([choice, choice]), false), undefined);
  for (const s of [signIn, landed, secret, tools])
    assert.equal(chatAnswer(task([s]), false), undefined, s.text);
  assert.equal(chatAnswer(task([plain]), true), undefined);
  assert.equal(chatAnswer(task([], 4), false), undefined);
});

test('a bare email address in a step becomes code the owner copies, never a mail link', () => {
  assert.equal(
    stepText('In the From box, type dmarc@newaltitude.ai'),
    'In the From box, type `dmarc@newaltitude.ai`'
  );
  // Already code, or inside a link: left as it is.
  assert.equal(stepText('Type `a@b.co` here'), 'Type `a@b.co` here');
  assert.equal(
    stepText('Open [Gmail for a@b.co](https://mail.google.com/)'),
    'Open [Gmail for a@b.co](https://mail.google.com/)'
  );
  assert.equal(stepText('Open https://mail.google.com/'), 'Open https://mail.google.com/');
});
