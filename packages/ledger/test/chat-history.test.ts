// Each Odd's chat as searchable rows: lines kept as they are written, a chat
// file loaded once as the office starts, and a search that reads the Odd's own
// chats and the chat turns that started work it was handed. The office's own
// code on every migration, in an in-memory PGlite that stands in for db.ts
// (pglite.ts). With no search model here, a search goes by words. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import { asc, eq } from 'drizzle-orm';
import { chatHistory, staff } from '../src/schema.ts';
import { db, sql } from './pglite.ts';

const { exchangesOf, keepChatLine, loadChats, searchChats } =
  await import('../src/chat-history.ts');
const { home, OFFICE_FILES } = await import('../src/home.ts');

await db.insert(staff).values(
  ['ava', 'ben', 'cy'].map((id) => ({
    id,
    name: id,
    role: 'r',
    variant: 'v',
    portrait: 'p',
    remit: 'r',
    desk: 'd'
  }))
);

beforeEach(async () => {
  await sql`delete from follow_ups`;
  await sql`delete from threads`;
  await db.delete(chatHistory);
});

const rowsOf = (staffId: string) =>
  db
    .select({ key: chatHistory.key, owner: chatHistory.owner, reply: chatHistory.reply })
    .from(chatHistory)
    .where(eq(chatHistory.staffId, staffId))
    .orderBy(asc(chatHistory.id));

test('a turn is one row: the owner words, Send now added, and the last reply that did not fail', () => {
  const rows = exchangesOf([
    { at: '2026-11-17T10:00:00Z', from: 'owner', text: 'Book the dentist.', turnId: 't1' },
    { at: '2026-11-17T10:00:05Z', from: 'owner', text: 'Tuesday works.', turnId: 't1' },
    { at: '2026-11-17T10:00:09Z', from: 'staff', text: 'Gone wrong.', turnId: 't1', failed: true },
    { at: '2026-11-17T10:01:00Z', from: 'staff', text: 'Booked for Tuesday.', turnId: 't1' },
    { at: '2026-11-17T11:00:00Z', from: 'staff', text: 'Hello, I am Ava.' },
    { at: '2026-11-17T12:00:00Z', from: 'staff', text: '', turnId: 't2' }
  ]);
  assert.deepEqual(
    rows.map((r) => [r.key, r.owner, r.reply]),
    [
      ['t1', 'Book the dentist.\n\nTuesday works.', 'Booked for Tuesday.'],
      ['at:2026-11-17T11:00:00Z:staff', '', 'Hello, I am Ava.']
    ]
  );
});

test('a chat from before turn ids pairs each reply with the owner lines before it, and a told line stands alone', () => {
  const rows = exchangesOf([
    { at: '2026-11-07T09:00:00Z', from: 'staff', text: 'Hello, I am Penny.' },
    { at: '2026-11-07T09:01:00Z', from: 'owner', text: 'Check the mail.' },
    { at: '2026-11-07T09:01:30Z', from: 'staff', text: 'Gone wrong.', failed: true },
    { at: '2026-11-07T09:02:00Z', from: 'owner', text: 'Try again.' },
    { at: '2026-11-07T09:02:10Z', from: 'staff', text: 'A note from the office.', told: true },
    { at: '2026-11-07T09:03:00Z', from: 'staff', text: 'Two new messages.' },
    { at: '2026-11-07T09:04:00Z', from: 'owner', text: 'Thanks.' },
    { at: '2026-11-07T09:05:00Z', from: 'owner', text: 'Newer.', turnId: 't9' },
    { at: '2026-11-07T09:05:10Z', from: 'staff', text: 'Newer reply.', turnId: 't9' }
  ]);
  assert.deepEqual(
    rows.map((r) => [r.owner, r.reply]),
    [
      ['', 'Hello, I am Penny.'],
      ['Check the mail.\n\nTry again.', 'Two new messages.'],
      ['', 'A note from the office.'],
      ['Thanks.', ''],
      ['Newer.', 'Newer reply.']
    ]
  );
});

test('lines kept as they are written fill one row per turn', async () => {
  await keepChatLine('ava', {
    at: '2026-11-17T10:00:00Z',
    from: 'owner',
    text: 'Find the lease.',
    turnId: 't1'
  });
  await keepChatLine('ava', {
    at: '2026-11-17T10:00:03Z',
    from: 'owner',
    text: 'The new one.',
    turnId: 't1'
  });
  await keepChatLine('ava', {
    at: '2026-11-17T10:00:09Z',
    from: 'staff',
    text: 'Stopped.',
    turnId: 't1',
    interrupted: true
  });
  await keepChatLine('ava', {
    at: '2026-11-17T10:01:00Z',
    from: 'staff',
    text: 'It is in Documents.',
    turnId: 't1',
    runId: 'run-1'
  });
  assert.deepEqual(await rowsOf('ava'), [
    { key: 't1', owner: 'Find the lease.\n\nThe new one.', reply: 'It is in Documents.' }
  ]);
});

test("each Odd's chat file loads once, whole, and a second start adds nothing", async () => {
  const file = home('staff', 'ben', OFFICE_FILES.chat);
  mkdirSync(home('staff', 'ben'), { recursive: true });
  writeFileSync(
    file,
    [
      { at: '2026-11-10T09:00:00Z', from: 'owner', text: 'Track the van repair.', turnId: 'a' },
      { at: '2026-11-10T09:01:00Z', from: 'staff', text: 'On it.', turnId: 'a' },
      'not json',
      { at: '2026-11-11T09:00:00Z', from: 'staff', text: 'The van is ready.' }
    ]
      .map((l) => (typeof l === 'string' ? l : JSON.stringify(l)))
      .join('\n')
  );
  assert.equal(await loadChats(), 2);
  assert.equal(await loadChats(), 0);
  assert.deepEqual(
    (await rowsOf('ben')).map((r) => r.reply),
    ['On it.', 'The van is ready.']
  );
});

test("a search reads the Odd's own chats and the chat turns that started work it was handed, and no one else's", async () => {
  const say = (staffId: string, turnId: string, owner: string, reply: string, runId: string) =>
    Promise.all([
      keepChatLine(staffId, { at: '2026-11-12T10:00:00Z', from: 'owner', text: owner, turnId }),
      keepChatLine(staffId, {
        at: '2026-11-12T10:01:00Z',
        from: 'staff',
        text: reply,
        turnId,
        runId
      })
    ]);
  await say('ava', 'a1', 'What is the boiler model?', 'The boiler is a Vaillant.', 'ava-run');
  // Ben's chat started a thread Cy was handed a step of, and another nobody shares.
  await say('ben', 'b1', 'Get the boiler serviced.', 'Handing the boiler to Cy.', 'ben-run');
  await say('ben', 'b2', 'Boiler budget is private.', 'Noted, boiler budget kept.', 'ben-other');
  const [{ id: thread }] = await sql<{ id: number }>`
    insert into threads (title, hub_id, holder_id, runs) values ('Boiler', 'ben', 'ben', ${['ben-run']}) returning id`;
  await sql`insert into follow_ups (staff_id, kind, thread_id) values ('cy', 'hand_off', ${thread})`;
  const found = async (who: string) =>
    (await searchChats(who, 'boiler')).map((r) => `${r.staffId}: ${r.reply}`).sort();
  assert.deepEqual(await found('ava'), ['ava: The boiler is a Vaillant.']);
  assert.deepEqual(await found('cy'), ['ben: Handing the boiler to Cy.']);
  assert.deepEqual(await found('ben'), [
    'ben: Handing the boiler to Cy.',
    'ben: Noted, boiler budget kept.'
  ]);
  // An empty query lists the newest the Odd may read.
  assert.equal((await searchChats('cy', '')).length, 1);
});
