// A task an Odd gives the owner in a chat keeps the owner's message there
// (`OWNER_SAID`), so the run that picks it up hears what they asked for once
// it ends. A task given outside a chat keeps nothing. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { db, toolServer } from './tool-server.ts';

const { staff, tasks } = await import('../src/schema.ts');
const { STARTER_TOOLS } = await import('../src/tools.ts');

await db.insert(staff).values({
  id: 'mae',
  name: 'Mae',
  role: 'Clerk',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft' as const,
  desk: 'You are a clerk.',
  tools: STARTER_TOOLS
});

const said = (r: Awaited<ReturnType<Client['callTool']>>) =>
  (r.content as { type: string; text: string }[])[0]?.text ?? '';
const give = async (c: Client, title: string) => {
  const r = await c.callTool({
    name: 'give_owner_a_task',
    arguments: { title, why: 'Only you know.', steps: ['Pick one.'] }
  });
  assert.notEqual(r.isError, true, said(r));
  const id = Number(/^Task (\d+) /.exec(said(r))?.[1]);
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return row;
};

test("a task given in a chat keeps the owner's message, and one given outside a chat keeps nothing", async () => {
  const words = 'Give me a task asking for my favourite colour. Then write it to colour.md.';
  const chat = await toolServer('mae', { OWNER_SAID: words, RUN_KEY: 'k-chat' });
  assert.equal((await give(chat, 'Pick a colour')).ownerSaid, words);
  const job = await toolServer('mae', { RUN_KEY: 'k-job' });
  assert.equal((await give(job, 'Pick a font')).ownerSaid, null);
});
