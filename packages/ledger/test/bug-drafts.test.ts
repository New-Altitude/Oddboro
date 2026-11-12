// An Odd drafts a bug report in a chat with `draft_bug_report`. The tool keeps
// the title and details for the run's reply and files nothing. The tool runs
// in the tool server's own process, as the office starts one for each run.
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { db, sql, toolServer } from './tool-server.ts';

const { staff } = await import('../src/schema.ts');
const { home, OFFICE_FILES } = await import('../src/home.ts');
const { keepBugDraft, takeBugDraft } = await import('../src/bug-drafts.ts');

beforeEach(async () => {
  for (const t of ['ledger', 'follow_ups', 'attachments', 'tasks', 'asks'])
    await sql.unsafe(`delete from ${t}`);
  await sql`delete from staff`;
  await db.insert(staff).values({
    id: 'wren',
    name: 'Wren',
    role: 'Mail Clerk',
    remit: 'Tests.',
    variant: 'a',
    portrait: 'a',
    permission: 'draft',
    desk: 'You are Wren.'
  });
});

async function call(c: Client, name: string, args: Record<string, unknown>) {
  const r = await c.callTool({ name, arguments: args });
  return { text: (r.content as { text: string }[])[0]?.text ?? '', error: r.isError === true };
}
const tools = async (c: Client) => (await c.listTools()).tools.map((t) => t.name);
const said = { OWNER_SAID: 'The chat lost my file. Please report this bug.' };

test('draft_bug_report is offered only in a chat', async () => {
  assert.ok(
    !(await tools(await toolServer('wren', { RUN_KEY: 'k-1' }))).includes('draft_bug_report')
  );
  assert.ok(
    (await tools(await toolServer('wren', { RUN_KEY: 'k-2', ...said }))).includes(
      'draft_bug_report'
    )
  );
});

test('draft_bug_report keeps the title and details for its run, and files nothing', async () => {
  const c = await toolServer('wren', { RUN_KEY: 'k-3', ...said });
  const draft = {
    title: 'Chat lost an attached file',
    body: 'What happened\n\nThe file vanished.'
  };
  const r = await call(c, 'draft_bug_report', { title: `  ${draft.title} `, body: draft.body });
  assert.equal(r.error, false, r.text);
  assert.match(r.text, /File this/);
  assert.match(r.text, /Nothing is filed yet/);
  // Nothing reached the desk or the ledger.
  assert.equal((await sql`select count(*)::int as n from asks`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from ledger`)[0].n, 0);
  // A later draft in the same run replaces the first.
  await call(c, 'draft_bug_report', { title: 'Second title', body: 'Second details' });
  assert.equal(takeBugDraft('wren', 'another-run'), undefined);
  // That take removed it: a draft never outlives the run it was kept for.
  assert.equal(existsSync(home('staff', 'wren', OFFICE_FILES.bugDraft)), false);
  await call(c, 'draft_bug_report', draft);
  assert.deepEqual(takeBugDraft('wren', 'k-3'), draft);
  assert.equal(takeBugDraft('wren', 'k-3'), undefined);
});

test('draft_bug_report refuses an empty title or details and keeps nothing', async () => {
  const c = await toolServer('wren', { RUN_KEY: 'k-4', ...said });
  for (const args of [
    { title: ' ', body: 'Details' },
    { title: 'Title', body: '' },
    { title: 'x'.repeat(257), body: 'Details' }
  ]) {
    const r = await call(c, 'draft_bug_report', args);
    assert.equal(r.error, true, JSON.stringify(args));
  }
  assert.equal(takeBugDraft('wren', 'k-4'), undefined);
});

test('a damaged draft file gives no draft and is removed', () => {
  keepBugDraft('wren', 'k-5', { title: 'T', body: 'B' });
  const file = home('staff', 'wren', OFFICE_FILES.bugDraft);
  assert.ok(existsSync(file));
  // A file the Odd wrote over by hand reads as no draft.
  writeFileSync(file, '{not json');
  assert.equal(takeBugDraft('wren', 'k-5'), undefined);
  assert.equal(existsSync(file), false);
});
