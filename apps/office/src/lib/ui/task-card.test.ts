// What Copy on a chat card copies, and when a response starts as the Odd's
// draft. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardText, startsFromOdd } from './task-card.ts';

test('a card copies its kind and title, why, numbered steps, then the response', () => {
  assert.equal(
    cardText({
      kind: 'Task for you',
      title: 'Correct the client list',
      why: 'I need it right before I send invoices.',
      steps: [{ text: 'Read the list.' }, { text: 'Fix any name that is wrong.' }],
      response: 'Acme\nPine and Pixel Studio\n'
    }),
    [
      'Task for you: Correct the client list',
      'I need it right before I send invoices.',
      '1. Read the list.\n2. Fix any name that is wrong.',
      'Response:\nAcme\nPine and Pixel Studio'
    ].join('\n\n')
  );
});

test('a card leaves out the parts it has no words for', () => {
  assert.equal(
    cardText({ kind: 'Ask', title: 'Unsubscribe you', why: ' ', steps: [], response: null }),
    'Ask: Unsubscribe you'
  );
  assert.equal(
    cardText({ kind: 'Task for you', title: 'Is it a client?', why: 'To file it.', response: '' }),
    'Task for you: Is it a client?\n\nTo file it.'
  );
});

test('a choice step copies its options under it', () => {
  assert.equal(
    cardText({
      kind: 'Task for you',
      title: 'Should this email reach you?',
      steps: [{ text: 'Choose one.', action: { kind: 'choice', options: ['Yes', 'No'] } }]
    }),
    'Task for you: Should this email reach you?\n\n1. Choose one.\n   - Yes\n   - No'
  );
});

test("the Odd's words before any save are its draft", () => {
  assert.equal(startsFromOdd({ response: 'Acme', responseVersion: 0 }, false), true);
});

test("an empty start, the owner's save, or the owner's draft is not the Odd's", () => {
  assert.equal(startsFromOdd({ response: '', responseVersion: 0 }, false), false);
  assert.equal(startsFromOdd({ response: '  \n', responseVersion: 0 }, false), false);
  assert.equal(startsFromOdd({ response: null, responseVersion: 0 }, false), false);
  assert.equal(startsFromOdd({ response: 'Acme', responseVersion: 1 }, false), false);
  assert.equal(startsFromOdd({ response: 'Acme', responseVersion: 0 }, true), false);
});
