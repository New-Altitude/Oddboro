import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { L, folder, bin, chatOf, history, type Gave } from './office-under-test.ts';
import type { ChatEvent } from '#lib/staff/chat.ts';
const { replyOnWork, conversationView, conversationRun, stopWorkReply, WORK_CONVERSATION_BRIEF } =
  await import('./work-conversations.ts');
const { POST, GET } = await import('../../routes/api/work/[id]/conversation/+server.ts');

// This test needs real session IDs from the external stand-in to check reuse.
const claude = join(bin, 'claude');
writeFileSync(
  claude,
  readFileSync(claude, 'utf8').replace(
    "subtype: 'success', result:",
    "subtype: 'success', session_id: args.includes('--resume') ? after('--resume') : require('node:crypto').randomUUID(), result:"
  )
);

const [one, two] =
  await L.pg`insert into threads (title,hub_id,holder_id) values ('Orchard discussion','lead','lead'),('Garden discussion','lead','lead') returning id`;
const [goal] = await L.pg`insert into goals(title) values ('Garden plan') returning id`;
await L.pg`update threads set goal_id=${goal.id} where id=${two.id}`;
await L.pg`insert into staff_goals(staff_id,goal_id,part) values ('paige',${goal.id},'Check the layout')`;

const input = (threadId: number, message: string, staffId = 'lead') => ({
  threadId,
  message,
  staffId,
  requestId: randomUUID()
});
async function say(threadId: number, message: string, staffId = 'lead') {
  const events: ChatEvent[] = [];
  await replyOnWork(input(threadId, message, staffId), (e) => events.push(e));
  const last = events.at(-1);
  assert.equal(last?.type, 'done', JSON.stringify(last));
  assert.ok(last?.type === 'done');
  return JSON.parse(last.text.split('\nOutcome:')[0]) as Gave;
}

test(
  'work replies use separate sessions from the main chat and from other work',
  { timeout: 60_000 },
  async (t) => {
    t.assert.snapshot(WORK_CONVERSATION_BRIEF);
    const a = await say(one.id, 'Orchard marker violet-174.');
    assert.ok(!a.args.includes('--resume'));
    assert.equal(a.env.THREAD_ID, String(one.id));
    assert.ok(
      a.claudeSettings?.permissions.deny.some((rule) => rule.includes('/work-conversations')),
      'private conversation sessions must stay outside the Odd readable folders'
    );
    assert.equal(a.env.OWNER_SAID, 'Orchard marker violet-174.');
    const b = await say(two.id, 'Garden marker green-213.');
    assert.ok(!b.args.includes('--resume'));
    assert.doesNotMatch(b.message + b.system, /violet-174/);
    assert.equal(history('lead').length, 0);
    const again = await say(one.id, 'Continue this discussion.');
    assert.ok(again.args.includes('--resume'));
    assert.doesNotMatch(again.message, /green-213/);
    const main = await chatOf('lead', 'A separate main-chat question.');
    assert.ok(!main.args.includes('--resume'));
    assert.equal(history('lead').filter((l) => l.from === 'owner').length, 1);
  }
);

test(
  'another participant receives shared history and its own session, with no unrelated work',
  { timeout: 60_000 },
  async () => {
    const peer = await say(two.id, 'Which garden marker did I give?', 'paige');
    assert.ok(!peer.args.includes('--resume'));
    assert.match(peer.message, /Garden marker green-213/);
    assert.doesNotMatch(peer.message + peer.system, /violet-174/);
    assert.equal(peer.env.THREAD_ID, String(two.id));
    assert.equal(history('paige').length, 0);
  }
);

test(
  'repeating a completed request does not run or append it twice',
  { timeout: 60_000 },
  async () => {
    const send = input(one.id, 'A single delivery.');
    const first: ChatEvent[] = [];
    await replyOnWork(send, (e) => first.push(e));
    const second: ChatEvent[] = [];
    await replyOnWork(send, (e) => second.push(e));
    assert.deepEqual(second, [first.at(-1)]);
    assert.equal(
      (await conversationView(one.id)).messages.filter((m) => m.requestId === send.requestId)
        .length,
      1
    );
  }
);

test(
  'two work conversations and the main chat can run independently, while duplicate work replies are refused',
  { timeout: 60_000 },
  async (t) => {
    const hold = join(folder, 'work-hold');
    const first = replyOnWork(input(one.id, `Hold until ${hold} exists.`), () => {});
    try {
      await t.waitFor(() => assert.ok(conversationRun(one.id)), { timeout: 10_000 });
      await assert.rejects(
        replyOnWork(input(one.id, 'Do not overlap.'), () => {}),
        /still waiting/
      );
      const other = await say(two.id, 'This can finish while the orchard waits.');
      assert.match(other.message, /This can finish/);
      const main = await chatOf('lead', 'Main chat can finish too.');
      assert.match(main.message, /Main chat can finish/);
      assert.ok(conversationRun(one.id));
    } finally {
      writeFileSync(hold, 'go');
      await first;
    }
  }
);

test(
  'Stop names the exact work reply and preserves its saved message',
  { timeout: 60_000 },
  async (t) => {
    const hold = join(folder, 'stopped-work-hold');
    const pending = replyOnWork(input(one.id, `Hold until ${hold} exists.`), () => {});
    await t.waitFor(() => assert.ok(conversationRun(one.id)), { timeout: 10_000 });
    const live = conversationRun(one.id)!; // The check above waits for this run.
    assert.equal(await stopWorkReply(two.id, live.key), false);
    assert.equal(await stopWorkReply(one.id, randomUUID()), false);
    assert.equal(await stopWorkReply(one.id, live.key), true);
    await pending;
    const state = await conversationView(one.id);
    assert.equal(state.active, undefined);
    assert.equal(state.messages.at(-1)?.status, 'stopped');
  }
);

function request(id: number, body: unknown) {
  return {
    params: { id: String(id) },
    request: new Request('http://office/api/work', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

test(
  'closing the response stream leaves the saved reply running and a reopened view reads the result',
  { timeout: 60_000 },
  async (t) => {
    const hold = join(folder, 'closed-work-view');
    const req = input(two.id, `Hold until ${hold} exists.`);
    const response = await POST(request(two.id, req));
    await response.body!.cancel(); // POST always returns a streaming response.
    await t.waitFor(() => assert.ok(conversationRun(two.id)), { timeout: 10_000 });
    writeFileSync(hold, 'go');
    await t.waitFor(() => assert.equal(conversationRun(two.id), undefined), { timeout: 30_000 });
    const reopened = await GET({ params: { id: String(two.id) } } as Parameters<typeof GET>[0]);
    const data = await reopened.json();
    assert.equal(data.messages.at(-1).status, 'done');
    assert.equal(data.messages.at(-1).requestId, req.requestId);
  }
);

test('invalid requests fail before a message or run exists', async () => {
  await assert.rejects(
    async () => POST(request(one.id, { message: 'Missing speaker and ID.' })),
    (e: unknown) => !!e && typeof e === 'object' && 'status' in e && e.status === 400
  );
  const n = (await conversationView(one.id)).messages.length;
  const rejected: ChatEvent[] = [];
  await replyOnWork(input(one.id, 'Not on this work.', 'sam'), (e) => rejected.push(e));
  assert.equal(rejected.at(-1)?.type, 'error');
  assert.equal((await conversationView(one.id)).messages.length, n);
});
