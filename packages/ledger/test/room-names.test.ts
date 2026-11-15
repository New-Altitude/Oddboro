import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from './pglite.ts';

const { renameRoom, roomNamesFor, RoomNameConflict } = await import('../src/office-pokes.ts');
const { ledger } = await import('../src/schema.ts');

test('two edits from the same room name keep one new name until the owner resolves the conflict', async () => {
  const start = 'Workroom';
  const rename = (name: string, was?: string) => renameRoom('sample', 'work', name, { was, start });
  const results = await Promise.allSettled([rename('Dispatch', start), rename('Packing', start)]);
  const saved = results.find((r) => r.status === 'fulfilled');
  const rejected = results.find((r) => r.status === 'rejected');
  assert.ok(saved && rejected && rejected.reason instanceof RoomNameConflict);
  assert.equal(rejected.reason.current, saved.value);
  assert.deepEqual(await roomNamesFor('sample'), { work: saved.value });
  assert.equal((await db.select().from(ledger)).length, 1);
  assert.equal(await rename(saved.value, start), saved.value);
  assert.equal(await rename('Receiving', saved.value), 'Receiving');
  await assert.rejects(rename('', saved.value), RoomNameConflict);
  assert.equal(await rename('', 'Receiving'), start);
  assert.deepEqual(await roomNamesFor('sample'), {});
  assert.equal((await db.select().from(ledger)).length, 3);
  assert.equal(await rename('Legacy client'), 'Legacy client');
});
