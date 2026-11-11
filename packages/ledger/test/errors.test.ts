// A fixed message is the only kind an error report keeps as written. The
// type errors below are part of the test: the ledger's check-types runs tsc
// over test/, and it fails if either call stops being an error.
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixedError, isFixedError } from '../src/errors.ts';

test('a fixed message is kept as written, and a template or a variable does not compile', () => {
  const e = fixedError('No such Odd');
  assert.equal(isFixedError(e), true);
  assert.ok(e instanceof Error);
  assert.equal(e.message, 'No such Odd');
  assert.equal(isFixedError(new Error('No such Odd')), false);

  // Typed string, as an id read from a request would be.
  const id: string = 'ada';
  // @ts-expect-error A template can carry what the owner typed.
  assert.equal(isFixedError(fixedError(`No such ${id}`)), true);
  // @ts-expect-error A variable can carry what the owner typed.
  assert.equal(isFixedError(fixedError(id)), true);
});
