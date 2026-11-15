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

test('a venue search reaches the member email at every pair of positions in a 12-job office', async () => {
  const register = { id: 'register', text: 'Member pickup is booking C-17.', date: '2026-11-10' };
  const amendment = { id: 'amend', text: 'C-17 moved to the Copper Room.', date: '2026-11-11' };
  // Each group fits. Together they exceed one page. The search that finds the
  // amendment also supplies the register that explains who uses the booking.
  const old = { ...move, id: 'old', text: 'x'.repeat(2400) };
  const archive = Array.from({ length: 13 }, (_, i) => ({ ...old, id: String(i) }));
  const longRegister = { ...register, text: register.text.padEnd(2400) };
  const venueHits = [amendment, longRegister];
  const source: DreamSource = {
    read: async (jobs) =>
      jobs.some((j) => j.name === 'Venue') ? [archive, venueHits, venueHits] : [archive]
  };
  for (let email = 0; email < 12; email++) {
    for (let venue = 0; venue < 12; venue++) {
      if (email === venue) continue;
      const jobs = Array.from({ length: 12 }, (_, id) => ({
        ...invoice,
        id,
        name: id === email ? 'Member email' : id === venue ? 'Venue' : 'Accounts'
      }));
      const review = await reviewWork(jobs, source, async (data) => {
        const input: { work: DreamWork[]; evidence: { id: string; text: string }[] } =
          JSON.parse(data);
        assert.ok(input.work.length <= 4);
        assert.ok(input.evidence.reduce((size, item) => size + item.text.length, 0) <= 32000);
        const ids = input.evidence.map((r) => r.id);
        const linked = ids.includes(register.id) && ids.includes(amendment.id);
        return JSON.stringify(
          input.work.map((j) => ({
            job: j.id,
            sources: linked && j.name !== 'Accounts' ? [register.id, amendment.id] : []
          }))
        );
      });
      assert.deepEqual(review.byJob, {
        [email]: [amendment, longRegister],
        [venue]: [amendment, longRegister]
      });
    }
  }
});
