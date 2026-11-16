// How a task on an Odd's own work ends. Run with `npm test -w @oddboro/ledger`.
import {
  odd,
  byId,
  onThread,
  runs,
  threadOf,
  ownWork,
  parksOn,
  aTask,
  fails
} from './pick-up-work.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { followUps, staff, tasks, threads } from '../src/schema.ts';
import { db } from './pglite.ts';

const H = await import('../src/hand-offs.ts');
const O = await import('../src/office.ts');
const P = await import('../src/task-parking.ts');

/**
 * A lead's own work with a task given on it, and, unless `parked` is false, a
 * second piece of work of the same lead parked on that task, as in the run
 * where both picked up at once and did the parked work twice.
 */
async function taskOnOwnWork(name: string, parked = true) {
  const { lead, colleague, work } = await ownWork(name);
  const task = await O.giveTask(lead, {
    title: `Approve\nthe ${name} copy`,
    why: 'w',
    steps: ['Approve it'],
    threadId: work
  });
  const other = parked
    ? await H.handOff({
        from: lead,
        to: colleague,
        work: { title: `Print of ${name}`, brief: 'Print it.' },
        thread: { title: `Print\nrun of ${name}` }
      })
    : undefined;
  const otherWork = other && 'id' in other ? ((await byId(other.id)).threadId ?? 0) : undefined;
  if (otherWork) await parksOn(lead, otherWork, task.id);
  return { work, otherWork, task: task.id, owner: await O.ownerName() };
}

test('a finished task tells its own work which parked work picked up, so the lead leaves it to that work', async () => {
  const { work, otherWork, task } = await taskOnOwnWork('told-own');
  await O.finishTask(task, true, 'Looks right.\nShip it.');
  const [done] = await onThread(work, 'task_done');
  assert.deepEqual(done.pickedUp, ['Print\nrun of told-own']);
  assert.equal(done.note, 'Looks right.\nShip it.', "the note stays the owner's words alone");
  const [woken] = await onThread(otherWork ?? 0, 'resume');
  assert.match(
    woken.note ?? '',
    /"Work on told-own", the work that task was given on, picks up too, and its lead carries that work's own part: do only this work's here\. Pick it up now: Looks right\. Ship it\.$/
  );
});

test('a finished task with nothing parked on it gives its own work the note alone', async () => {
  const { work, task } = await taskOnOwnWork('alone', false);
  await O.finishTask(task, true, 'Looks right.\nShip it.');
  const [done] = await onThread(work, 'task_done');
  assert.equal(done.pickedUp, null);
  assert.equal(done.note, 'Looks right.\nShip it.');
});

test('a dropped task tells its own work which parked work picked up, and the parked work hears of its own', async () => {
  const { work, otherWork, task, owner } = await taskOnOwnWork('dropped-own');
  await O.finishTask(task, false, 'Not needed.');
  const [answer] = await onThread(work, 'resume');
  assert.equal(
    answer.note,
    `${owner} dropped "Approve\nthe dropped-own copy": Not needed. "Print run of dropped-own" was waiting on this too and has picked up on its own; leave that work to it.`
  );
  const [woken] = await onThread(otherWork ?? 0, 'resume');
  assert.match(woken.note ?? '', /"Work on dropped-own", the work that task was given on/);

  const lone = await taskOnOwnWork('dropped-alone', false);
  await O.finishTask(lone.task, false, 'Not needed.');
  const [alone] = await onThread(lone.work, 'resume');
  assert.equal(alone.note, `${owner} dropped "Approve\nthe dropped-alone copy": Not needed.`);
});

test('a lead run that ended a park on a task given on other work fails after the task was finished: the work hears a run on that work was set going back then', async () => {
  const { work, otherWork = 0, task } = await taskOnOwnWork('fails-own');
  const [h] = await onThread(otherWork, 'hand_off');
  await runs(h, 'done', 'Printed a proof.');
  const [back] = await onThread(otherWork, 'handed_back');
  assert.deepEqual((await O.startFollowUp(back.id))?.unparked, {
    task: 'Approve\nthe fails-own copy'
  });
  await O.finishTask(task, true, null);
  const [done] = await onThread(work, 'task_done');
  assert.equal(done.pickedUp, null, 'the park was lifted, so that run was told of no parked work');
  await fails(back);
  const woken = await onThread(otherWork, 'resume');
  assert.equal(woken.length, 1);
  assert.match(
    woken[0].note ?? '',
    /the task you parked this work on\. A run on "Work on fails-own", the work that task was given on, was set going when the task ended, and its lead carries that work's own part: do only this work's part here\. Pick it up now\.$/
  );
});

/**
 * A lead's access ask, raised on its own work or, with `onWork` false, from a
 * chat, approved, so its connect task is on the desk; and, unless `parked` is
 * false, a second piece of the lead's work parked on that connect task.
 */
async function connectWithParked(name: string, { onWork = true, parked = true } = {}) {
  const { lead, colleague, work } = await ownWork(name);
  const { ask } = await O.raiseAsk(lead, {
    title: `Connect Gmail for ${name}`,
    why: 'w',
    ifApproved: 'i',
    access: { connector: 'gmail', level: 'read' },
    threadId: onWork ? work : undefined
  });
  await O.decideAsk(ask.id, 'approve', null);
  const [connect] = await db.select().from(tasks).where(eq(tasks.askId, ask.id));
  assert.ok(connect, 'the yes made no connect task');
  const other = parked
    ? await H.handOff({
        from: lead,
        to: colleague,
        work: { title: `Mail of ${name}`, brief: 'Sort it.' },
        thread: { title: `Inbox of ${name}` }
      })
    : undefined;
  const otherWork = other && 'id' in other ? ((await byId(other.id)).threadId ?? 0) : undefined;
  if (otherWork) await parksOn(lead, otherWork, connect.id);
  return { lead, work, otherWork, ask: ask.id, connect: connect.id };
}
const carryOuts = (askId: number) =>
  db
    .select()
    .from(followUps)
    .where(and(eq(followUps.askId, askId), eq(followUps.kind, 'carry_out')));

test("a connect task's end tells the carry-out on the ask's work which parked work picked up, and tells that work the ask's work picks up too", async () => {
  const { work, otherWork, ask, connect } = await connectWithParked('carry-on-work');
  await O.finishTask(connect, true, null);
  const [carry] = await carryOuts(ask);
  assert.equal(carry.threadId, work);
  assert.deepEqual(carry.pickedUp, ['Inbox of carry-on-work']);
  const [woken] = await onThread(otherWork ?? 0, 'resume');
  assert.match(
    woken.note ?? '',
    /"Work on carry-on-work", the work that task was given on, picks up too, and its lead carries that work's own part: do only this work's here\. Pick it up now\.$/
  );
});

test('a connect task for an ask raised in a chat tells its carry-out which parked work picked up, and tells that work another run of its own carries the access work', async () => {
  const { otherWork, ask, connect } = await connectWithParked('carry-from-chat', {
    onWork: false
  });
  await O.finishTask(connect, true, null);
  const [carry] = await carryOuts(ask);
  assert.equal(carry.threadId, null);
  assert.deepEqual(carry.pickedUp, ['Inbox of carry-from-chat']);
  const [woken] = await onThread(otherWork ?? 0, 'resume');
  assert.match(
    woken.note ?? '',
    /the task you parked this work on\. Another run of yours picks up from that task too and carries its own part: do only this work's here\. Pick it up now\.$/
  );
});

test('a connect task with nothing parked on it starts its carry-out with nothing picked up', async () => {
  const { ask, connect } = await connectWithParked('carry-alone', { parked: false });
  await O.finishTask(connect, true, null);
  const [carry] = await carryOuts(ask);
  assert.equal(carry.pickedUp, null);
});

test('a dropped connect task for an ask raised in a chat answers its Odd with a run of its own, and the work parked on it hears of that run', async () => {
  const { otherWork, connect } = await connectWithParked('carry-dropped', { onWork: false });
  await O.finishTask(connect, false, null);
  assert.deepEqual(
    (await db.select().from(followUps).where(eq(followUps.taskId, connect))).map((f) => f.kind),
    ['answered']
  );
  const [woken] = await onThread(otherWork ?? 0, 'resume');
  assert.match(
    woken.note ?? '',
    /dropped "Connect Gmail .+", the task you parked this work on, so it will not be finished\. Another run of yours picks up from that task too and carries its own part: do only this work's here\. Decide what comes of the work now\.$/
  );
});

test("a dropped task given on a hand-off answers the lead that handed the work, and the work its Odd parked on it hears that the hand-off's work picks up", async () => {
  const { lead, colleague, h } = await ownWork('dropped-hand-off');
  const task = await O.giveTask(colleague, {
    title: 'Check the hall',
    why: 'w',
    steps: ['Do it'],
    handOffId: h.id,
    threadId: h.threadId ?? undefined
  });
  const own = await H.handOff({
    from: colleague,
    to: lead,
    work: { title: 'Hall of dropped-hand-off', brief: 'Book it.' },
    thread: { title: 'Venue of dropped-hand-off' }
  });
  assert.ok('id' in own, JSON.stringify(own));
  const parked = (await byId(own.id)).threadId ?? 0;
  await parksOn(colleague, parked, task.id);
  await O.finishTask(task.id, false, 'Not needed.');
  assert.deepEqual(
    (await onThread(h.threadId ?? 0, 'handed_back')).map((f) => f.staffId),
    [lead]
  );
  assert.deepEqual(await db.select().from(followUps).where(eq(followUps.taskId, task.id)), []);
  const [woken] = await onThread(parked, 'resume');
  assert.match(
    woken.note ?? '',
    /dropped "Check the hall", the task you parked this work on, so it will not be finished\. "Work on dropped-hand-off", the work that task was given on, picks up too, and its lead carries that work's own part: do only this work's here\. Decide what comes of the work now: Not needed\.$/
  );
});

test("work parks only on a task its lead gave or a task on work it is on, and another Odd's task reads as no task at all", async () => {
  const { lead, work } = await ownWork('park-reach');
  const other = 'other-lead-park-reach';
  await db.insert(staff).values(odd(other, 'Other lead'));
  // The lead works on the other lead's work, so a task there is one it can see.
  const handed = await H.handOff({
    from: other,
    to: lead,
    work: { title: 'Help with the stall', brief: 'Help.' },
    thread: { title: 'The stall' }
  });
  assert.ok('id' in handed, JSON.stringify(handed));
  const stall = (await byId(handed.id)).threadId ?? 0;
  const onTheirWork = await O.giveTask(other, {
    title: 'Book the stall',
    why: 'w',
    steps: ['Book it'],
    threadId: stall
  });
  await parksOn(lead, work, onTheirWork.id);

  const theirs = await O.giveTask('rex', { title: 'Rex private errand', why: 'w', steps: ['Go'] });
  const theirsDone = await O.giveTask('rex', { title: 'Rex done errand', why: 'w', steps: ['Go'] });
  await O.finishTask(theirsDone.id, true, null);
  const elsewhere = await ownWork('park-elsewhere');
  const onOtherWork = await O.giveTask(elsewhere.lead, {
    title: 'Sign the elsewhere copy',
    why: 'w',
    steps: ['Sign it'],
    threadId: elsewhere.work
  });
  for (const id of [theirs.id, theirsDone.id, onOtherWork.id])
    assert.deepEqual(await P.parkOnTask(lead, work, id), { problem: `There is no task ${id}.` });
  assert.equal((await threadOf(work)).resumeOnTask, onTheirWork.id, 'a refusal left the park');

  await O.finishTask(theirs.id, true, 'SENTINEL only for Rex');
  assert.ok(
    !(await onThread(work, 'resume')).some((f) => f.note?.includes('SENTINEL')),
    "the other Odd's note reached the work"
  );

  const own = await aTask(lead, 'Own finished errand');
  await O.finishTask(own.id, true, null);
  assert.deepEqual(await P.parkOnTask(lead, work, own.id), {
    problem: 'Already finished: do it now, in this run.'
  });
});

test('work that has ended cannot be parked on a task', async () => {
  const { lead, work } = await ownWork('park-ended');
  const task = await aTask(lead, 'Proof the ended copy');
  await db.update(threads).set({ status: 'done', endedAt: new Date() }).where(eq(threads.id, work));
  assert.deepEqual(await P.parkOnTask(lead, work, task.id), {
    problem: `Work ${work} has ended, or is not work you lead.`
  });
  assert.equal((await threadOf(work)).resumeOnTask, null);
});
