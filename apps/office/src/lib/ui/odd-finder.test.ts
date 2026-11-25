// The ⌘K finder filters Odds as the owner types and moves by keyboard. Run
// with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finderKey, findOdds } from './odd-finder.ts';

const odds = [
  { id: 'a', name: 'Rosa', role: 'Office Manager' },
  { id: 'b', name: 'Amos', role: 'Researcher' },
  { id: 'c', name: 'Ines', role: 'Inbox keeper' },
  { id: 'd', name: 'Marisol', role: 'Writer' }
];
const ids = (list: { id: string }[]) => list.map((p) => p.id);

test('an empty box lists every Odd in roster order', () => {
  assert.deepEqual(ids(findOdds(odds, '  ')), ['a', 'b', 'c', 'd']);
});

test('typing filters by name or role, ignoring case', () => {
  assert.deepEqual(ids(findOdds(odds, 'RESEARCH')), ['b']);
  assert.deepEqual(ids(findOdds(odds, 'zz')), []);
});

test('names that start with the words come first, then names, then roles', () => {
  // "ma": Marisol starts with it, and Rosa's role holds it. "os": both names hold it.
  assert.deepEqual(ids(findOdds(odds, 'ma')), ['d', 'a']);
  assert.deepEqual(ids(findOdds(odds, 'os')), ['a', 'b']);
});

test('Up and Down move and wrap at the ends', () => {
  assert.deepEqual(finderKey('ArrowDown', 0, 3), { to: 1 });
  assert.deepEqual(finderKey('ArrowDown', 2, 3), { to: 0 });
  assert.deepEqual(finderKey('ArrowUp', 0, 3), { to: 2 });
  assert.deepEqual(finderKey('Home', 2, 3), { to: 0 });
  assert.deepEqual(finderKey('End', 0, 3), { to: 2 });
});

test('Enter opens the row on, kept inside a list that shrank', () => {
  assert.deepEqual(finderKey('Enter', 1, 3), { pick: 1 });
  assert.deepEqual(finderKey('Enter', 5, 2), { pick: 1 });
});

test('no rows, or any other key, does nothing', () => {
  assert.equal(finderKey('Enter', 0, 0), undefined);
  assert.equal(finderKey('ArrowDown', 0, 0), undefined);
  assert.equal(finderKey('a', 0, 3), undefined);
});
