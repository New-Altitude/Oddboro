import assert from 'node:assert/strict';
import test from 'node:test';
import { bindingProblem, chord, defaultKeys, readKeys } from './hud-keys.ts';

test('reloads changed and disabled shortcuts without claiming native Tab or the Workspace switcher', () => {
  const keys = { ...defaultKeys(), next: 'J', previous: 'K', review: '', open: 'Control+Shift+H' };
  assert.deepEqual(readKeys(JSON.stringify(keys)), keys);
  for (const bad of ['K', 'Tab', 'Alt+ArrowDown', 'Escape']) {
    assert.ok(bindingProblem(keys, 'next', bad));
  }
  assert.ok(bindingProblem(keys, 'open', 'H'));
  assert.deepEqual(readKeys('{"next":"K","previous":"K"}'), defaultKeys());
  assert.deepEqual(readKeys('null'), defaultKeys());
});

test('recognizes Option and the letter on Mac keyboard layouts', () => {
  assert.equal(chord({ key: '˙', code: 'KeyH', altKey: true } as KeyboardEvent), 'Alt+H');
});
