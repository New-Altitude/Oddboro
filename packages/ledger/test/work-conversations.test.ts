import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { staff, goals, staffGoals, threads, workMessages } from '../src/schema.ts';
import { db } from './pglite.ts';
const {
  workConversation,
  keepWorkMessage,
  conversationMessages,
  conversationBrief,
  finishWorkMessage,
  closeStaleConversations,
  CONVERSATION_CHARS
} = await import('../src/work-conversations.ts');
const { threadStory } = await import('../src/lead-brief.ts');

await db.insert(staff).values(
  ['lead', 'peer', 'other'].map((id) => ({
    id,
    name: id,
    role: 'Tester',
    remit: 'Test.',
    variant: 'a',
    portrait: 'a',
    desk: 'Test.',
    web: false
  }))
);
const [goal] = await db
  .insert(goals)
  .values({ title: 'Grow herbs', why: 'Fresh herbs.' })
  .returning();
await db.insert(staffGoals).values({ goalId: goal.id, staffId: 'peer', part: 'Check soil.' });
const [work, separate] = await db
  .insert(threads)
  .values([
    { title: 'Herbs', hubId: 'lead', holderId: 'lead', goalId: goal.id },
    { title: 'Other work', hubId: 'lead', holderId: 'lead' }
  ])
  .returning();
const input = (message: string, staffId = 'lead') => ({
  threadId: work.id,
  staffId,
  requestId: randomUUID(),
  message
});

test('a work conversation includes its lead and assigned colleagues, but not unrelated Odds', async () => {
  assert.deepEqual((await workConversation(work.id)).people.map((p) => p.id).sort(), [
    'lead',
    'peer'
  ]);
  await assert.rejects(keepWorkMessage(input('No', 'other')), /Choose an Odd/);
  assert.equal((await conversationMessages(work.id)).length, 0);
});

test('a repeated submission is saved once and cannot be moved to another work', async () => {
  const sent = input('Use the east bed.');
  const [one, two] = await Promise.all([keepWorkMessage(sent), keepWorkMessage(sent)]);
  assert.equal(one.id, two.id);
  await assert.rejects(keepWorkMessage({ ...sent, threadId: separate.id }), /already belongs/);
  await assert.rejects(keepWorkMessage({ ...sent, message: 'Different' }), /already belongs/);
  assert.equal((await conversationMessages(work.id)).length, 1);
});

test('the owner message reaches the same work story every participant reads and no other work', async () => {
  const story = await threadStory(work);
  assert.equal(story.said.at(-1)?.words, 'Use the east bed.');
  assert.equal((await threadStory(separate)).said.length, 0);
});

test('shared replies respect both current and saved tool access after the author loses a tool', async () => {
  const safe = await keepWorkMessage(input('How is the soil?'));
  await finishWorkMessage(safe.id, { status: 'done', reply: 'The soil needs water.' });
  const secret = await keepWorkMessage(input('What did the private file say?'));
  await db
    .update(workMessages)
    .set({ tools: [{ id: 'private', name: 'Private source' }] })
    .where(eq(workMessages.id, secret.id));
  await finishWorkMessage(secret.id, { status: 'done', reply: 'Private answer to withhold.' });
  const brief = await conversationBrief({
    threadId: work.id,
    reader: 'peer',
    after: 0,
    before: secret.id + 1
  });
  assert.match(brief, /The soil needs water/);
  assert.match(brief, /What did the private file say/);
  assert.match(brief, /Reply withheld/);
  assert.doesNotMatch(brief, /Private answer to withhold/);
  assert.equal(
    await conversationBrief({
      threadId: separate.id,
      reader: 'lead',
      after: 0,
      before: secret.id + 1
    }),
    ''
  );
});

test('a resumed conversation receives only new exchanges and the replay is bounded', async () => {
  const one = await keepWorkMessage(input('Before the saved session.'));
  await finishWorkMessage(one.id, { status: 'done', reply: 'Remembered.' });
  const two = await keepWorkMessage(input('New since then.'));
  await finishWorkMessage(two.id, { status: 'done', reply: 'New reply.' });
  const brief = await conversationBrief({
    threadId: work.id,
    reader: 'peer',
    after: one.id,
    before: two.id + 1
  });
  assert.match(brief, /New since then/);
  assert.doesNotMatch(brief, /Remembered/);
  const large = await keepWorkMessage(input('x'.repeat(CONVERSATION_CHARS * 2)));
  const bounded = await conversationBrief({
    threadId: work.id,
    reader: 'peer',
    after: 0,
    before: large.id + 1
  });
  assert.ok(bounded.length <= CONVERSATION_CHARS);
});

test('an office restart preserves messages and marks unfinished replies failed without running them', async () => {
  await closeStaleConversations();
  const all = await conversationMessages(work.id);
  assert.ok(all.some((m) => m.status === 'failed' && m.reply?.includes('office closed')));
  assert.ok(all.some((m) => m.status === 'done' && m.reply === 'Remembered.'));
  assert.ok(all.every((m) => m.status !== 'replying'));
});

test('stopped work keeps its history but cannot start a new reply', async () => {
  await db.update(threads).set({ status: 'stopped' }).where(eq(threads.id, work.id));
  await assert.rejects(keepWorkMessage(input('Start again.')), /work is stopped/);
  assert.ok((await conversationMessages(work.id)).length > 0);
});
