// What a name tag says about a thread a colleague holds. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heldThreads, threadTag } from './thread-tags.ts';

const names: Record<string, string> = { ada: 'Ada', paige: 'Paige', rex: 'Rex' };
const nameOf = (id: string) => names[id] ?? id;
/** Ada leads the gravity sim, which Paige holds now. */
const sim = {
  title: 'Build a gravity sim',
  hubId: 'ada',
  holderId: 'paige',
  stage: 'under_way' as const
};
const tag = (id: string, working: boolean, threads = heldThreads([sim])) =>
  threadTag({ id, threads, working, nameOf });

test('a colleague holding a thread shows it and whose it is', () => {
  assert.deepEqual(tag('paige', true), { text: 'Build a gravity sim · with Ada' });
});

test('a lead whose thread a colleague holds shows it while working, and waits on them otherwise', () => {
  assert.deepEqual(tag('ada', true), { text: 'Build a gravity sim · with Paige' });
  assert.deepEqual(tag('ada', false), { text: 'Waiting on Paige', waitsOn: 'paige' });
});

test('a thread waiting on the owner still shows who holds it', () => {
  const waiting = heldThreads([{ ...sim, stage: 'waiting_on_you' }]);
  assert.deepEqual(tag('ada', false, waiting), { text: 'Waiting on Paige', waitsOn: 'paige' });
});

test('a lead holding its own thread gets no tag, so its working label stays', () => {
  const own = heldThreads([{ ...sim, holderId: 'ada' }]);
  assert.equal(tag('ada', true, own), undefined);
  assert.equal(tag('ada', false, own), undefined);
});

test('an ended thread is no tag, even where its holder stayed on a colleague', () => {
  for (const stage of ['stopped', 'done', 'failed'] as const)
    assert.equal(tag('ada', false, heldThreads([{ ...sim, stage }])), undefined, stage);
});

test('an Odd on no thread gets no tag', () => {
  assert.equal(tag('rex', false), undefined);
});
