// What the owner sees of token use, in a throwaway office
// (office-under-test.ts): a job's run keeps its tokens under the job's name,
// for the Odd's list of recent runs, and the chat says how many tokens its
// session holds and where it starts fresh. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { L, chatOf, odd } from './office-under-test.ts';
import { saveSession } from './resume.ts';

const { runJob } = await import('./staff.ts');
const { ROLLOVER_TOKENS } = await import('./chat-rollover.ts');
const chatRoute = await import('../../routes/api/staff/[id]/chat/+server.ts');

// Codex's stand-in reports its tokens, so its runs keep usage rows.
await L.pg`insert into staff ${L.pg([{ ...odd('tess', 'Tess'), agent: 'codex' }, odd('tim', 'Tim')])}`;

/** What the chat page loads for an Odd. */
const chatPage = async (id: string) =>
  (await (await chatRoute.GET({ params: { id } } as never)).json()) as {
    size?: { tokens: number; limit: number };
  };

test("a job's run keeps its tokens under the job's name", async () => {
  const job = await L.addJob({
    staffId: 'tess',
    name: 'Count the chairs',
    instructions: 'Count them.',
    schedule: { every: 'day', at: '07:00' }
  });
  try {
    assert.equal((await runJob(job, 'manual')).ok, true);
    // The run keeps its tokens as it ends, a moment after the reply.
    let runs: Awaited<ReturnType<typeof L.recentRuns>> = [];
    for (let i = 0; i < 100 && !runs.length; i++) {
      runs = await L.recentRuns('tess');
      if (!runs.length) await new Promise((r) => setTimeout(r, 20));
    }
    assert.deepEqual(
      runs.map((r) => [r.kind, r.label]),
      [['job', 'Count the chairs']]
    );
    assert.ok(runs[0].tokens > 0);
  } finally {
    await L.pg`delete from usage where staff_id = 'tess'`;
    await L.pg`delete from runs where job_id = ${job.id}`;
    await L.pg`delete from jobs where id = ${job.id}`;
  }
});

test('the chat says how many tokens its session holds, and nothing once the next message starts fresh', async () => {
  assert.equal((await chatPage('tim')).size, undefined, 'a chat with no session');
  const first = await chatOf('tim');
  const home = first.configDir ?? '';
  saveSession(L.chatSession('tim'), { sessionId: 'tims-chat', seen: {}, home, context: 61_500 });
  assert.deepEqual((await chatPage('tim')).size, { tokens: 61_500, limit: ROLLOVER_TOKENS });
  // A session made in another tool folder does not resume here, so it holds nothing for the chat.
  saveSession(L.chatSession('tim'), {
    sessionId: 'tims-chat',
    seen: {},
    home: `${home}-elsewhere`,
    context: 61_500
  });
  assert.equal((await chatPage('tim')).size, undefined);
});
