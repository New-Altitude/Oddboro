import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepUnsent, unsentFor } from './chat-unsent.ts';

test('a chat left with words in it gets them back', () => {
  keepUnsent('jo', { text: 'Half a thought', intent: 'reply', files: [] });
  assert.equal(unsentFor('jo')?.text, 'Half a thought');
});

test('each Odd keeps its own box', () => {
  keepUnsent('jo', { text: 'For Jo', intent: 'reply', files: [] });
  keepUnsent('sam', { text: 'For Sam', intent: 'reply', files: [] });
  assert.equal(unsentFor('jo')?.text, 'For Jo');
  assert.equal(unsentFor('sam')?.text, 'For Sam');
});

test('an emptied or sent box keeps nothing', () => {
  keepUnsent('jo', { text: 'Gone soon', intent: 'reply', files: [] });
  keepUnsent('jo', { text: '  ', intent: 'reply', files: [] });
  assert.equal(unsentFor('jo'), undefined);
});

test('a file with no words is still kept', () => {
  const file = { key: 0, tag: 'Image #1', mediaType: 'image/png', size: 1, inline: true };
  keepUnsent('jo', { text: '', intent: 'reply', files: [file] });
  assert.deepEqual(unsentFor('jo')?.files, [file]);
});
