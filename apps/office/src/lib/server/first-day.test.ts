// A new hire's first minutes: whether its first day starts, and what its hello
// says comes next. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstDayOf } from './first-day.ts';

const goal = { title: 'Learn the Game of Life' };

test("a hire that serves a goal and has no job starts no first day: the goal's lead hands it its first piece", () => {
  const day = firstDayOf({ jobs: 0, goal });
  assert.equal(day.starts, false);
  assert.match(day.hello.join('\n'), /The Odd who leads it hands you your first piece/);
});

test('a hire with a job starts its first day, with or without a goal, and its hello says nothing of the goal', () => {
  for (const g of [undefined, goal]) {
    const day = firstDayOf({ jobs: 1, goal: g });
    assert.equal(day.starts, true);
    assert.doesNotMatch(day.hello.join('\n'), /goal/);
  }
});

test('a hire with no job and no goal starts nothing and says it can be given a job', () => {
  const day = firstDayOf({ jobs: 0 });
  assert.equal(day.starts, false);
  assert.match(day.hello.join('\n'), /give you a job on your Jobs tab/);
});
