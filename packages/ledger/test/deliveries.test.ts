// What an Odd put on the owner's desk, as its chat lists it: the office's own
// code on every migration, in an in-memory PGlite that stands in for db.ts
// (pglite.ts). Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { staff } from '../src/schema.ts';
import { db } from './pglite.ts';

// The ledger rows a decision writes embed nothing: no Ollama answers here.
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { decideAsk, deliveries, raiseAsk } = await import('../src/office.ts');

await db.insert(staff).values({
  id: 'cole',
  name: 'Cole',
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Cole.'
});

test('each ask says when the owner decided it, so a resumed chat hears of decisions since', async () => {
  const open = await raiseAsk('cole', { title: 'Book the band', why: 'w', ifApproved: 'i' });
  const decided = await raiseAsk('cole', { title: 'Book the hall', why: 'w', ifApproved: 'i' });
  await decideAsk(decided.ask.id, 'approve', null);
  const asks = (await deliveries('cole')).filter((d) => d.kind === 'ask');
  const at = (id: number) => asks.find((d) => d.id === id)?.decidedAt;
  assert.ok(at(decided.ask.id) instanceof Date, 'a decided ask lost when it was decided');
  assert.equal(at(open.ask.id), null);
});
