import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvalTarget } from './chat-approval.ts';

const one = { kind: 'ask' as const, id: 12, title: 'Map the orchard' };
const two = { kind: 'ask' as const, id: 14, title: 'Map the garden' };

test('a typed Approve takes the single visible proposal, or the one named by Reply', () => {
  assert.equal(approvalTarget('Approve', 'Approve', undefined, one, one), one);
  // Neither ask is the only one when two are waiting.
  assert.equal(approvalTarget('Approve', 'Approve', undefined, undefined, undefined), undefined);
  assert.equal(approvalTarget('Approve', 'Approve', two, undefined, undefined), two);
});

test('a replacement, a second ask arriving or another kind of message never supplies a yes', () => {
  assert.equal(approvalTarget('approve', 'approve', undefined, one, two), undefined);
  assert.equal(approvalTarget('approve', 'approve', undefined, one, undefined), undefined);
  assert.equal(approvalTarget('approve', '', one, one, one), undefined);
  assert.equal(approvalTarget('yes', 'yes', undefined, one, one), undefined);
  assert.equal(approvalTarget('yes', 'yes', one, undefined, undefined), one);
});
