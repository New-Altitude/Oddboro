// What the office tells the page an Odd has in progress (`/api/office`): its
// runs going, and each follow-up yet to start, such as a lead's pick-up after
// a task the owner finished while the chat that gave it still goes. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { L, request } from './office-under-test.ts';
import type { Work } from '../staff/work.ts';

/** Each Odd's follow-ups yet to start, as the page gets them with the office. */
async function toStart(): Promise<Record<string, Work[]>> {
  const r = await request('/api/office', 'GET');
  return ((await r.json()) as { toStart: Record<string, Work[]> }).toStart;
}

test("a lead's pick-up after a task, and work it handed over, show as waiting to start until each starts", async () => {
  // Lena's chat hands Paige work, then gives the owner a task on that work.
  const chat = randomUUID();
  L.reserveRun({ key: chat, staffId: 'lead', kind: 'chat' });
  const h = await L.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Fit the lights', brief: 'Fit them.' },
    thread: { title: 'The party' },
    run: chat
  });
  assert.ok('id' in h, JSON.stringify(h));
  const t = await L.giveTask('lead', {
    title: 'Buy the bulbs',
    why: 'The lights need them.',
    steps: ['Buy them'],
    threadId: h.thread,
    run: chat
  });
  // The owner finishes it while the chat still goes, so the pick-up waits.
  await L.finishTask(t.id, true, 'Bought.');
  const [after] = await L.pg<{ id: number }[]>`
    select id from follow_ups where task_id = ${t.id} and kind = 'task_done'`;
  assert.deepEqual(
    (await L.followUpsToDo()).map((f) => f.id).filter((id) => id === after.id),
    [],
    'the pick-up started beside the chat'
  );

  const waiting = await toStart();
  assert.deepEqual(
    waiting.lead.map(({ id, kind, label, detail, queued, toStart }) => ({
      id,
      kind,
      label,
      detail,
      queued,
      toStart
    })),
    [
      {
        id: -after.id,
        kind: 'follow-up',
        label: 'Buy the bulbs',
        detail: 'Picking up after your task',
        queued: true,
        toStart: true
      }
    ]
  );
  assert.deepEqual(
    waiting.paige.map(({ id, label, detail }) => ({ id, label, detail })),
    [{ id: -h.id, label: 'Fit the lights', detail: 'Work Lena handed over' }]
  );

  // Once each starts, its run lists it (`inProgress`), and it waits no more.
  L.runsGoing.delete(chat);
  for (const id of [after.id, h.id]) assert.ok(await L.startFollowUp(id));
  const now = await toStart();
  assert.equal(now.lead, undefined, JSON.stringify(now.lead));
  assert.equal(now.paige, undefined, JSON.stringify(now.paige));
});
