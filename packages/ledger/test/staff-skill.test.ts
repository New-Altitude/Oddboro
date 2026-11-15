// Two open windows must not replace a skill the other window already changed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from './pglite.ts';
import { staff } from '../src/schema.ts';

process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { setStaffSkill, staffer } = await import('../src/office.ts');

test('only one change to the reviewed skill wins, and removal preserves the job and grants', async () => {
  const [before] = await db
    .insert(staff)
    .values({
      id: 'reader',
      name: 'Reader',
      role: 'Reviewer',
      remit: 'Review invoices.',
      variant: 'a',
      portrait: 'a',
      desk: 'Review the batch.'
    })
    .returning();
  assert.equal(before.skill, null);
  const changes = await Promise.all([
    setStaffSkill(before.id, null, 'Check every receipt.'),
    setStaffSkill(before.id, null, 'Check every total.')
  ]);
  assert.equal(changes.filter(Boolean).length, 1);
  const who = await staffer(before.id);
  assert.ok(who?.skill);
  assert.equal(await setStaffSkill(before.id, null, null), false);
  assert.ok(await setStaffSkill(before.id, who.skill, null));
  assert.deepEqual(await staffer(before.id), before);
});
