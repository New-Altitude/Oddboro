import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decisionBrief, reviewWork, type DreamSource, type DreamWork } from './dream-review.ts';

const prep = {
  id: 1,
  staffId: 'alex',
  name: 'Rehearsal preparation',
  instructions: 'Prepare before the rehearsal.'
};
const invoice = {
  id: 2,
  staffId: 'sam',
  name: 'Invoice summary',
  instructions: 'List unpaid balances.'
};
const move = {
  id: 'event-41',
  text: 'The rehearsal moved from Thursday to Wednesday.',
  date: '2026-11-10'
};

test('a second reader supplies evidence without knowing which Odd needs it', async () => {
  const calendar: DreamSource = { read: async () => [move] };
  const work = [prep, invoice];
  let reviews = 0;
  const judge = async (data: string) => {
    reviews++;
    const input = JSON.parse(data);
    assert.deepEqual(input.evidence, [move]);
    return JSON.stringify([
      ...input.work.map((j: DreamWork) => ({
        job: j.id,
        sources: j.name === prep.name ? [move.id] : []
      }))
    ]);
  };
  const reviewed = await reviewWork(work, calendar, judge);
  assert.match(decisionBrief(reviewed.byJob[prep.id]), /Wednesday/);
  assert.equal(decisionBrief(reviewed.byJob[invoice.id] ?? []), '');
  assert.equal(await reviewWork(work, calendar, judge, reviewed), reviewed);
  await reviewWork([{ ...prep, staffId: 'lee' }, invoice], calendar, judge, reviewed);
  assert.equal(reviews, 2);
  await assert.rejects(
    reviewWork(work, calendar, async () => '[]'),
    /each assignment/
  );
  const revoked = await reviewWork(work, { read: async () => [] }, judge, reviewed);
  assert.deepEqual(revoked.byJob, {});
});

test('a review cannot attach an unknown job or substitute a different record', async () => {
  for (const result of [
    [{ job: 99, sources: [move.id] }],
    [{ job: 1, sources: ['missing'] }],
    [{ job: 1, sources: [0] }]
  ]) {
    await assert.rejects(
      reviewWork([prep], { read: async () => [move] }, async () => JSON.stringify(result)),
      /unknown work or evidence/
    );
  }
});
