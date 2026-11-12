// The same requests as two office windows, with real staff runs in a throwaway office.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { L, bus, folder, history, followThrough } from './office-under-test.ts';

const { GET, POST, DELETE } = await import('../../routes/api/staff/[id]/chat/+server.ts');
const { runJob, inProgress } = await import('./staff.ts');

function request(id: string, body: object, method = 'POST') {
  return {
    params: { id },
    request: new Request('http://office/chat', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}
const state = async (id: string) =>
  (await GET({ params: { id } } as Parameters<typeof GET>[0])).json();
const stop = async (id: string, runId: string) =>
  (await DELETE(request(id, { runId }, 'DELETE'))).json();
const send = (id: string, body: object) => POST(request(id, body));
const last = async (r: Response) =>
  JSON.parse((await r.text()).trim().split('\n\n').at(-1)!.slice(6));

test(
  'a screenshot corrects just the selected reply, keeps completed work and starts once',
  { timeout: 60_000 },
  async (t) => {
    const id = 'cleo';
    const old = randomUUID();
    const turnId = randomUUID();
    const ready = join(folder, 'old-reply');
    const jobReady = join(folder, 'job-ready');
    const job = await L.addJob({
      staffId: id,
      name: 'Count the seats',
      instructions: `Hold until ${jobReady} exists.`,
      schedule: { every: 'day', at: '09:00' }
    });
    const running = runJob(job, 'manual');
    try {
      const stream = await send(id, { turnId: old, message: `Hold until ${ready} exists.` });
      await t.waitFor(() => assert.equal(L.runsGoing.size, 2), { timeout: 20_000 });
      const { reply } = await state(id);
      assert.equal(reply.turnId, old);
      assert.ok(L.runsGoing.has(reply.runId));
      const task = await L.giveTask(id, {
        title: 'Pick the room',
        why: 'For the meeting.',
        steps: ['Pick one.']
      });
      const bytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
        'base64'
      );
      const correction = {
        turnId,
        instead: reply.runId,
        message: 'Use the room in this picture.',
        files: [{ name: 'room.png', data: bytes.toString('base64') }]
      };
      let ends = 0;
      const count = () => ends++;
      bus.on('run-ended', count);
      t.after(() => {
        bus.off('run-ended', count);
      });
      const next = await send(id, correction);
      const ended = await last(stream);
      assert.match(ended.text, /^You stopped the reply to “Hold until /);
      assert.equal(
        history(id).find((e) => e.turnId === old && e.from === 'staff')?.interrupted,
        true
      );
      // The held line is also in the test tool's replay of the conversation.
      // The repeat is the same accepted correction, not a third run.
      assert.equal((await last(await send(id, correction))).type, 'error');
      writeFileSync(ready, '');
      assert.deepEqual(await stop(id, reply.runId), { stopped: false });
      const answer = await last(next);
      assert.equal(answer.type, 'done', answer.message);
      const blocks = JSON.parse(JSON.parse(answer.text.split('\nOutcome:')[0]).message).message
        .content;
      assert.equal(blocks[0].source.data, bytes.toString('base64'));
      assert.ok(blocks.at(-1).text.includes(correction.message));
      assert.equal((await L.task(task.id))?.status, 'open');
      assert.equal(inProgress()[id]?.[0].about?.id, job.id);
      assert.deepEqual(await last(await send(id, correction)), answer);
      assert.equal(history(id).filter((e) => e.turnId === turnId).length, 2);
      assert.deepEqual(history(id).find((e) => e.turnId === turnId)?.source, {
        kind: 'correction',
        id: old,
        revision: reply.runId
      });
      assert.equal(L.runsGoing.size, 1);
      assert.equal(ends, 2);
    } finally {
      writeFileSync(ready, '');
      writeFileSync(jobReady, '');
      assert.equal((await running).ok, true);
    }
  }
);

test(
  'disconnect leaves a reply running; a correction racing completion starts after it, and Stop stands alone',
  { timeout: 60_000 },
  async (t) => {
    const id = 'paige';
    const first = randomUUID();
    const ready = join(folder, 'window-closed');
    const res = await send(id, { turnId: first, message: `Hold until ${ready} exists.` });
    const before = (await state(id)).reply;
    await res.body!.cancel();
    assert.equal((await state(id)).reply.runId, before.runId);
    writeFileSync(ready, '');
    await t.waitFor(
      () => assert.ok(history(id).some((e) => e.turnId === first && e.from === 'staff')),
      { timeout: 20_000 }
    );
    const second = randomUUID();
    const lastTurn = await last(
      await send(id, {
        turnId: second,
        instead: before.runId,
        message: 'Count the blue seats too.'
      })
    );
    assert.equal(lastTurn.type, 'done');
    assert.equal(
      history(id).some((e) => e.interrupted),
      false
    );
    rmSync(ready);
    t.after(() => writeFileSync(ready, ''));
    const third = await send(id, { message: `Hold until ${ready} exists.` });
    const active = (await state(id)).reply;
    assert.deepEqual(await stop(id, before.runId), { stopped: false });
    assert.deepEqual(await stop(id, active.runId), { stopped: true });
    assert.match((await last(third)).text, /^You stopped the reply to “Hold until /);
  }
);

test(
  'a correction about a colleague’s goal goes to its lead and never stops the other work',
  { timeout: 60_000 },
  async (t) => {
    const [goal] = await L.pg<
      { id: number }[]
    >`insert into goals (title) values ('Plan the fair') returning id`;
    const ready = join(folder, 'hand-off-ready');
    const h = await L.handOff({
      from: 'lead',
      to: 'paige',
      work: { title: `Hold until ${ready} exists.`, brief: 'Count the seats.' },
      thread: { title: 'Fair seating', goalId: goal.id }
    });
    assert.ok('id' in h);
    const f = await L.startFollowUp(h.id);
    assert.ok(f);
    const run = followThrough(f);
    try {
      await t.waitFor(() => assert.ok(inProgress().paige?.[0].about), { timeout: 20_000 });
      const about = inProgress().paige[0].about!;
      assert.equal(about.leadId, 'lead');
      assert.equal(about.title, 'Plan the fair');
      const correction = {
        turnId: randomUUID(),
        about: about.key,
        message: 'Leave room for the band.'
      };
      await assert.rejects(async () => send('paige', correction), { status: 400 });
      const answer = await send('lead', correction);
      const result = await last(answer);
      assert.equal(result.type, 'done', result.message);
      assert.ok(
        JSON.parse(result.text.split('\nOutcome:')[0]).message.includes(
          `goal #${goal.id}, "Plan the fair"`
        )
      );
      assert.deepEqual(history('lead').find((e) => e.turnId === correction.turnId)?.about, about);
      assert.equal(inProgress().paige[0].about?.key, about.key);
    } finally {
      writeFileSync(ready, '');
      await run;
    }
  }
);

test('a correction tells the lead which saved turn or work it changes, without repeating completed actions', async (t) => {
  const { correctionBrief } = await import('./chat-run.ts');
  const old = {
    from: 'owner' as const,
    at: '2026-01-01T00:00:00.000Z',
    text: 'Prepare the room.',
    turnId: 'earlier'
  };
  t.assert.snapshot(
    correctionBrief(
      { ...old, text: 'Leave room for the band.', source: { kind: 'correction', id: 'earlier' } },
      [old]
    )
  );
  t.assert.snapshot(
    correctionBrief(
      {
        ...old,
        about: {
          key: 'goal-work',
          kind: 'goal',
          id: 7,
          title: 'Plan the fair',
          leadId: 'lead',
          lead: 'Lena'
        }
      },
      []
    )
  );
  assert.deepEqual(correctionBrief(old, []), []);
});
