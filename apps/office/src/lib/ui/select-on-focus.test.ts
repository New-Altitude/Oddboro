// A prefilled field selects its text on focus. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectOnFocus } from './select-on-focus.ts';

/** A stand-in input: real events, and a count of select() calls. */
function field() {
  const node = Object.assign(new EventTarget(), { selected: 0 }) as EventTarget & {
    selected: number;
    select: () => void;
  };
  node.select = () => void node.selected++;
  return node;
}
const mouseup = () => new Event('mouseup', { cancelable: true });

test('focus selects the prefilled text, and the click that focused keeps it selected', () => {
  const node = field();
  selectOnFocus(node as unknown as HTMLInputElement);
  node.dispatchEvent(new Event('focus'));
  assert.equal(node.selected, 1);
  const first = mouseup();
  node.dispatchEvent(first);
  assert.equal(first.defaultPrevented, true);
  const later = mouseup();
  node.dispatchEvent(later);
  assert.equal(later.defaultPrevented, false);
});

test('a click after typing places the caret as usual', () => {
  const node = field();
  selectOnFocus(node as unknown as HTMLInputElement);
  node.dispatchEvent(new Event('focus'));
  node.dispatchEvent(new Event('keydown'));
  const click = mouseup();
  node.dispatchEvent(click);
  assert.equal(click.defaultPrevented, false);
});

test('once detached, focus selects nothing', () => {
  const node = field();
  selectOnFocus(node as unknown as HTMLInputElement)();
  node.dispatchEvent(new Event('focus'));
  assert.equal(node.selected, 0);
});
