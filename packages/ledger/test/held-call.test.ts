// An Odd at Draft calls a tool that changes something, and the gateway holds
// the call as a `call` ask on the owner's desk. The same call held twice at
// once, as two of the Odd's tool calls in one turn can be, goes on the desk
// once: the second hears the one there. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { asks, staff } from '../src/schema.ts';
import { db } from './pglite.ts';

// The precedent a raise looks up embeds nothing: no Ollama answers here.
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { raiseCall } = await import('../src/office.ts');

await db.insert(staff).values({
  id: 'paige',
  name: 'Paige',
  role: 'Mail clerk',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Paige.'
});

test('the same call held twice at once goes on the desk once, and the second hears the one there', async () => {
  const hold = () =>
    raiseCall(
      { staffId: 'paige', run: 'k-1' },
      { connector: 'gmail', tool: 'archive', arguments: { ids: ['m1', 'm2'] } },
      'Gmail',
      { title: 'Archive two emails', why: 'They are read.' }
    );
  const both = await Promise.all([hold(), hold()]);
  const open = await db
    .select()
    .from(asks)
    .where(and(eq(asks.staffId, 'paige'), eq(asks.kind, 'call'), eq(asks.status, 'open')));
  assert.equal(open.length, 1, 'one call ask on the desk');
  assert.deepEqual(both.map((r) => r.already).sort(), [false, true]);
  assert.deepEqual(
    both.map((r) => r.ask.id),
    [open[0].id, open[0].id]
  );
});
