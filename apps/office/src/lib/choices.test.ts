// The choices an Odd ends a chat reply with, which the page shows as buttons.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hideChoiceLines, splitChoices } from './choices.ts';

test('the choices a reply ends with come off its text, in order, as bullets or not', () => {
  assert.deepEqual(
    splitChoices(
      'Nate is an Odd here and a Gmail contact. Which do you mean?\n\n[choice] Hand it to Nate in the office\n- [choice] Email Nate at nate@example.com\n'
    ),
    {
      text: 'Nate is an Odd here and a Gmail contact. Which do you mean?',
      choices: ['Hand it to Nate in the office', 'Email Nate at nate@example.com']
    }
  );
});

test('a reply with no choices, or with them anywhere but the end, stays as it is', () => {
  const plain = 'Done. I archived them.';
  assert.deepEqual(splitChoices(plain), { text: plain, choices: [] });
  const middle = '[choice] One\n\nThen I carried on.';
  assert.deepEqual(splitChoices(middle), { text: middle, choices: [] });
});

test('at most five choices, each once and cut to 200 characters; an empty one is dropped', () => {
  const lines = ['A', 'B', 'A', 'C', 'D', 'E', 'F'].map((c) => `[choice] ${c}`);
  const r = splitChoices(['Pick one.', ...lines, '[choice]'].join('\n'));
  assert.equal(r.text, 'Pick one.');
  assert.deepEqual(r.choices, ['A', 'B', 'C', 'D', 'E']);
  assert.equal(splitChoices(`Q\n[choice] ${'x'.repeat(300)}`).choices[0].length, 200);
});

test('while a reply streams, its choice lines are hidden', () => {
  assert.equal(hideChoiceLines('Which?\n[choice] One\n[choi'), 'Which?\n[choi');
});
