// What a tap on the floor does: a switch first, then a library shelf. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tapAt } from './engine.ts';

/** A shelf two tiles wide and three tall, drawn early, with a lamp standing on it drawn later. */
const shelf = { box: [0, 0, 32, 48] as [number, number, number, number], rank: 1 };
const lamp = { obj: 'library#0/lamp#0', box: [8, 0, 16, 16] as typeof shelf.box, rank: 2 };

test('a tap on a library shelf opens the Lessons', () => {
  assert.equal(tapAt([lamp], [shelf], [4, 40]), 'shelf');
});

test('a tap on a lamp over a shelf switches the lamp, even when the shelf is drawn later', () => {
  assert.deepEqual(tapAt([lamp], [shelf], [12, 8]), { switch: lamp.obj });
  assert.deepEqual(tapAt([lamp], [{ ...shelf, rank: 9 }], [12, 8]), { switch: lamp.obj });
});

test('a tap on neither does nothing', () => {
  assert.equal(tapAt([lamp], [shelf], [40, 8]), undefined);
});
