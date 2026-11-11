// The chat box's attachments: tags, and tokens in and out of the text.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasToken, tagFor, withTokens, withoutToken } from './chat-attach.ts';
import { attachableType, refusal } from '#lib/attachments.ts';

const file = (name: string, type: string) => new File(['x'], name, { type });

test('a pasted picture is numbered after every image already tagged', () => {
  const shot = file('image.png', 'image/png');
  assert.equal(tagFor(shot, true, []), 'Image #1');
  assert.equal(tagFor(shot, true, ['Image #1', 'lease.pdf', 'Image #3']), 'Image #4');
});

test('a dropped or picked file keeps its own name, made unique, without brackets', () => {
  assert.equal(tagFor(file('lease.pdf', 'application/pdf'), false, []), 'lease.pdf');
  assert.equal(tagFor(file('lease.pdf', ''), false, ['lease.pdf']), 'lease (2).pdf');
  assert.equal(tagFor(file('a[1].png', 'image/png'), false, []), 'a1.png');
  // A pasted file that is not a picture keeps its name too.
  assert.equal(tagFor(file('notes.md', ''), true, []), 'notes.md');
});

test('tokens go in at the caret, spaced from the words around them', () => {
  assert.deepEqual(withTokens('', 0, 0, ['Image #1']), { text: '[Image #1]', caret: 10 });
  assert.deepEqual(withTokens('look at this', 7, 7, ['Image #1']), {
    text: 'look at [Image #1] this',
    caret: 18
  });
  assert.deepEqual(withTokens('see', 3, 3, ['a.png', 'b.png']), {
    text: 'see [a.png] [b.png]',
    caret: 19
  });
  // Over a selection, which goes.
  assert.equal(withTokens('swap THIS out', 5, 9, ['x.png']).text, 'swap [x.png] out');
});

test('a token comes out with one space beside it', () => {
  assert.equal(withoutToken('look at [Image #1] this', 'Image #1'), 'look at this');
  assert.equal(withoutToken('[Image #1] first', 'Image #1'), 'first');
  assert.equal(withoutToken('[Image #1]', 'Image #1'), '');
  assert.equal(withoutToken('nothing here', 'Image #1'), 'nothing here');
  assert.ok(hasToken('a [b.png] c', 'b.png'));
  assert.ok(!hasToken('a [b.png c', 'b.png'));
});

test('the office takes pictures, PDFs and text, by name, else by a picture type', () => {
  assert.equal(attachableType('a.PDF', ''), 'application/pdf');
  assert.equal(attachableType('a.md', ''), 'text/markdown');
  assert.equal(attachableType('', 'image/png'), 'image/png');
  assert.equal(attachableType('a.docx', 'application/msword'), undefined);
  assert.equal(attachableType('a.svg', 'image/svg+xml'), undefined);
  assert.match(refusal('a.docx', '', 10)!, /picture, a PDF or a text file/);
  assert.match(refusal('big.png', 'image/png', 11 * 1024 * 1024)!, /over 10 MB/);
  assert.equal(refusal('ok.png', 'image/png', 10), undefined);
});
