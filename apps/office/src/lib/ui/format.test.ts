// How a piece of work reads on its chat card and in the Goals window: by who
// has it and what is next, never by thread, number or count. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ThreadStage } from '@oddboro/ledger';
import { ownerWords } from '../../../../../packages/ledger/test/owner-words.ts';
import { workLine, type Work } from './format.ts';

const work = (w: Partial<Work> & { stage: ThreadStage }): Work => ({
  lead: 'Marshall',
  holder: 'Priya',
  held: false,
  ...w
});
const at = new Date('2026-11-03T21:00:00Z');

test('work under way says who has it', () => {
  assert.deepEqual(workLine(work({ stage: 'under_way' })), { text: 'With Priya', yours: false });
});

test('work the lead parked says when the lead picks it up', () => {
  assert.match(
    workLine(work({ stage: 'under_way', resumeAt: at })).text,
    /^Marshall picks it up at /
  );
});

test("work paused for the plan's window says when the window resets", () => {
  assert.match(
    workLine(work({ stage: 'under_way', resumeAt: at, held: true })).text,
    /^Paused until your Claude plan's window resets at /
  );
});

test('work waiting on the owner is theirs to act on', () => {
  assert.deepEqual(workLine(work({ stage: 'waiting_on_you' })), {
    text: 'Waiting on you',
    yours: true
  });
});

test('finished, failed and stopped work each say so plainly', () => {
  assert.equal(workLine(work({ stage: 'done' })).text, 'Done');
  assert.equal(workLine(work({ stage: 'failed' })).text, 'Marshall could not finish it');
  assert.equal(workLine(work({ stage: 'stopped' })).text, 'You stopped it');
});

test('no line the owner reads says thread, hand-off or a number', () => {
  const stages: ThreadStage[] = ['under_way', 'waiting_on_you', 'done', 'failed', 'stopped'];
  for (const stage of stages)
    for (const resumeAt of [undefined, at])
      for (const held of [false, true]) ownerWords(workLine(work({ stage, resumeAt, held })).text);
});
