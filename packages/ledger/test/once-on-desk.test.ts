// An Odd puts a thing on the owner's desk once. raise_ask and
// give_owner_a_task refuse a title the Odd already has open there (case and
// spacing ignored), naming that item, and a raise_ask that revises it goes
// through. The office's own tasks may repeat, and a question with one answer
// needs no steps. `stillOnDesk` is the list every run's prompt shows the Odd. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { eq } from 'drizzle-orm';
import { db, toolServer } from './tool-server.ts';

const { staff, tasks } = await import('../src/schema.ts');
const { STARTER_TOOLS } = await import('../src/tools.ts');
const { ask, giveTask, raiseAsk, stillOnDesk } = await import('../src/office.ts');

await db.insert(staff).values(
  ['rae', 'tom'].map((id) => ({
    id,
    name: id === 'rae' ? 'Rae' : 'Tom',
    role: 'Clerk',
    remit: 'Tests.',
    variant: 'a',
    portrait: 'a',
    permission: 'draft' as const,
    desk: 'You are a clerk.',
    tools: STARTER_TOOLS
  }))
);

const said = (r: Awaited<ReturnType<Client['callTool']>>) =>
  (r.content as { type: string; text: string }[])[0]?.text ?? '';
const raise = (c: Client, title: string, revises?: number) =>
  c.callTool({
    name: 'raise_ask',
    arguments: { title, why: 'w', if_approved: 'i', ...(revises ? { revises } : {}) }
  });

test('raise_ask refuses a title already open, case and spacing ignored, and revises goes through', async () => {
  const c = await toolServer('rae', { RUN_KEY: 'k-ask' });
  const first = await raise(c, 'Book the hall');
  assert.notEqual(first.isError, true, said(first));
  const id = Number(/^Ask (\d+) /.exec(said(first))?.[1]);
  const again = await raise(c, '  book   THE hall ');
  assert.equal(again.isError, true);
  assert.equal(
    said(again),
    `Nothing went on the owner's desk. Your ask #${id}, "Book the hall", is already there. To change it, raise it again with revises: ${id}. Never raise the same thing twice.`
  );
  const revised = await raise(c, 'Book the hall', id);
  assert.notEqual(revised.isError, true, said(revised));
  assert.equal((await ask(id))?.status, 'revise');
  // Another Odd's item is its own.
  const other = await raise(await toolServer('tom', { RUN_KEY: 'k-tom' }), 'Book the hall');
  assert.notEqual(other.isError, true, said(other));
});

test('give_owner_a_task refuses a title already open; the office may repeat its own', async () => {
  const c = await toolServer('rae', { RUN_KEY: 'k-task' });
  const give = () =>
    c.callTool({
      name: 'give_owner_a_task',
      arguments: { title: 'Sign the form', why: 'w', steps: ['Sign it.'] }
    });
  const first = await give();
  assert.notEqual(first.isError, true, said(first));
  const id = Number(/^Task (\d+) /.exec(said(first))?.[1]);
  const again = await give();
  assert.equal(again.isError, true);
  assert.equal(
    said(again),
    `Nothing went on the owner's desk. Your task #${id}, "Sign the form", is already there. Never give the same thing twice.`
  );
  await giveTask('rae', { title: 'Sign the form', why: 'w', steps: ['Sign it.'], byOffice: true });
});

test('give_owner_a_task takes a question with one answer and no steps', async () => {
  const c = await toolServer('rae', { RUN_KEY: 'k-question' });
  const r = await c.callTool({
    name: 'give_owner_a_task',
    arguments: { title: 'What hour does your studio day start?', why: 'To set the reminders.' }
  });
  assert.notEqual(r.isError, true, said(r));
  const id = Number(/^Task (\d+) /.exec(said(r))?.[1]);
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  assert.deepEqual(row.steps, []);
});

test("the desk list holds an Odd's open asks and tasks, newest first, at most 15 with a count of the rest, and nothing when empty", async () => {
  assert.deepEqual(await stillOnDesk('nobody'), { items: [], more: 0 });
  const reply = await raiseAsk('tom', {
    kind: 'reply',
    title: 'Reply to Ada <ada@example.com>: Re: Lunch',
    why: 'w',
    ifApproved: 'i',
    reply: { to: ['ada@example.com'], cc: [], subject: 'Re: Lunch', body: 'Yes.', summary: 's' }
  });
  for (let n = 1; n <= 15; n++)
    await giveTask('tom', { title: `Chore ${n}`, why: 'w', steps: ['Do it.'] });
  const { items, more } = await stillOnDesk('tom');
  assert.equal(items.length, 15);
  assert.deepEqual(items[0], { kind: 'task', id: items[0].id, title: 'Chore 15' });
  // Tom's "Book the hall" ask, his reply, then 15 chores: two left over.
  assert.equal(more, 2);
  const all = await stillOnDesk('tom', 50);
  assert.ok(
    all.items.some(
      (i) => i.kind === 'ask' && i.id === reply.ask.id && i.title === 'Reply to Re: Lunch'
    )
  );
});
