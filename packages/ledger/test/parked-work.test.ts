// Parked work: a failed wake, a park that holds, and work that waits. Run with `npm test -w @oddboro/ledger`.
import {
  type Row,
  onThread,
  runs,
  threadOf,
  ownWork,
  parksOn,
  aTask,
  parkedOnColleaguesTask,
  toldLead
} from './pick-up-work.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { followUps, goals, tasks, threads } from '../src/schema.ts';
import { db } from './pglite.ts';

const H = await import('../src/hand-offs.ts');
const O = await import('../src/office.ts');
const T = await import('../src/threads.ts');
const B = await import('../src/lead-brief.ts');
const L = await import('../src/leaving.ts');

/** The lead's run on `f`, which parks its work on `task` as it goes, as resume_at does, then ends done. */
async function runsAndParks(f: Row, task: number) {
  assert.ok(await O.startFollowUp(f.id), `follow-up ${f.id} could not start`);
  await parksOn(f.staffId, f.threadId ?? 0, task);
  await O.finishFollowUp(f, 'work', 'done', 'Parked it.');
}

test('a failed wake leaves the task open, its checked steps intact, and its work parked', async () => {
  const work = await ownWork('failed-wake');
  const task = await aTask(work.lead, 'Confirm the route');
  await O.tickStep(task.id, 0);
  await parksOn(work.lead, work.work, task.id);
  await db.execute(
    sql`alter table follow_ups add constraint refuse_test_wake check (kind <> 'resume' or note not like '%Confirm the route%')`
  );
  try {
    await assert.rejects(O.finishTask(task.id, true, 'Use the north path.'));
    assert.equal((await O.task(task.id))?.status, 'open');
    assert.equal((await O.task(task.id))?.steps[0].done, true);
    assert.equal((await threadOf(work.work)).resumeOnTask, task.id);
    assert.deepEqual(await onThread(work.work, 'resume'), []);
    assert.equal(
      (await db.select().from(followUps).where(eq(followUps.taskId, task.id))).length,
      0
    );
  } finally {
    await db.execute(sql`alter table follow_ups drop constraint refuse_test_wake`);
  }
  const attempts = await Promise.all([
    O.finishTask(task.id, true, 'Use the north path.'),
    O.finishTask(task.id, true, 'Use the north path.')
  ]);
  assert.deepEqual(attempts.sort(), [false, true]);
  assert.equal((await onThread(work.work, 'resume')).length, 1);
  assert.equal((await O.task(task.id))?.note, 'Use the north path.');
});

test('finishing a task wakes the thread parked on it once, and a dropped task wakes it too and says so, each telling the work of the run its end starts for the Odd', async () => {
  const finished = await ownWork('finished');
  const proof = await aTask(finished.lead, 'Proof the banner');
  await parksOn(finished.lead, finished.work, proof.id);
  await O.finishTask(proof.id, true, null);
  await O.finishTask(proof.id, true, null);
  const woken = await onThread(finished.work, 'resume');
  assert.equal(woken.length, 1);
  assert.match(
    woken[0].note ?? '',
    /finished "Proof the banner", the task you parked this work on\. Another run of yours picks up from that task too and carries its own part: do only this work's here\. Pick it up now\.$/
  );
  assert.equal((await threadOf(finished.work)).resumeOnTask, null);

  const dropped = await ownWork('dropped');
  const print = await aTask(dropped.lead, 'Print\nthe banner');
  await parksOn(dropped.lead, dropped.work, print.id);
  await O.finishTask(print.id, false, 'Not needed\nany more.');
  // A drop on no work answers the Odd that gave the task with a run of its own.
  const answered = await db.select().from(followUps).where(eq(followUps.taskId, print.id));
  assert.deepEqual(
    answered.map((f) => [f.kind, f.staffId]),
    [['answered', dropped.lead]]
  );
  const told = await onThread(dropped.work, 'resume');
  assert.equal(told.length, 1);
  assert.match(
    told[0].note ?? '',
    /dropped "Print the banner", the task you parked this work on, so it will not be finished\. Another run of yours picks up from that task too and carries its own part: do only this work's here\. Decide what comes of the work now: Not needed any more\.$/
  );
  assert.equal((told[0].note ?? '').split('\n').length, 1, 'answers() splits a note on newlines');
  assert.equal((await threadOf(dropped.work)).resumeOnTask, null);

  // Work that ended another way while parked stays ended. An ended thread
  // keeps the park it had, as the owner's answer past the hand-off limit leaves it.
  const ended = await ownWork('ended');
  const frame = await aTask(ended.lead, 'Frame the banner');
  await parksOn(ended.lead, ended.work, frame.id);
  await db
    .update(threads)
    .set({ status: 'done', endedAt: new Date() })
    .where(eq(threads.id, ended.work));
  await O.finishTask(frame.id, true, null);
  assert.deepEqual(await onThread(ended.work, 'resume'), []);
});

/**
 * A goal's work parked on a task of its own, stopped by the owner's no to more
 * hand-offs, with every run on it ended, so only the park could still hold it.
 */
async function stoppedWhileParked(name: string) {
  const [goal] = await db
    .insert(goals)
    .values({ title: `Goal of ${name}` })
    .returning();
  const { lead, colleague, h, work } = await ownWork(name, goal.id);
  const task = await aTask(lead, `Task of ${name}`);
  await runs(h, 'done', 'Did it.');
  await runsAndParks((await onThread(work, 'handed_back'))[0], task.id);
  await db.update(threads).set({ handOffsUsed: T.HAND_OFF_LIMIT }).where(eq(threads.id, work));
  const more = await H.handOff({
    from: lead,
    to: colleague,
    work: { title: `More of ${name}`, brief: 'Do more.' },
    thread: { id: work }
  });
  assert.ok('asked' in more, JSON.stringify(more));
  await O.decideAsk(more.asked, 'deny', null);
  assert.equal((await threadOf(work)).status, 'stopped');
  // Read before the lead's pick-up, whose claim would end the park anyway.
  const parkAfterStop = (await threadOf(work)).resumeOnTask;
  await runs((await onThread(work, 'resume'))[0], 'done', 'Said where it stands.');
  return { lead, colleague, goalId: goal.id, work, task: task.id, parkAfterStop };
}
type Stopped = Awaited<ReturnType<typeof stoppedWhileParked>>;

/** A new plan for the goal, which is the one thing that opens stopped work again. */
async function planReopens({ lead, colleague, goalId, work }: Stopped) {
  const { ask } = await O.raiseAsk(lead, {
    kind: 'plan',
    title: `Plan for goal ${goalId}`,
    why: 'w',
    ifApproved: 'i',
    plan: { goalId, items: [{ kind: 'assign', staff: colleague, part: 'A part' }] }
  });
  assert.equal(ask.threadId, work);
  assert.equal((await threadOf(work)).endedAt, null);
  return ask;
}

/** The reopened work names no task it waits on, and can end once the plan is answered. */
async function notHeldByPark(stopped: Stopped, plan: { id: number }) {
  const { work } = stopped;
  assert.equal((await B.threadStory(await threadOf(work))).parkedOn, undefined);
  await O.decideAsk(plan.id, 'deny', null);
  const pickUp = (await onThread(work, 'resume')).find((f) => f.outcome === null);
  assert.ok(pickUp, "the owner's answer to the plan started no pick-up");
  await runs(pickUp, 'done', 'Closed the plan.');
  assert.equal((await threadOf(work)).status, 'done');
}

test('stopping work parked on a task stops it waiting on that task', async () => {
  const { parkAfterStop } = await stoppedWhileParked('stop-clears');
  assert.equal(parkAfterStop, null);
});

test('work reopened by a plan while its task is still open is not held by the park the owner stopped', async () => {
  const stopped = await stoppedWhileParked('planned-task-open');
  await notHeldByPark(stopped, await planReopens(stopped));
});

test('work reopened by a plan after its task ended is not held by the park the owner stopped', async () => {
  const stopped = await stoppedWhileParked('planned-task-ended');
  await O.finishTask(stopped.task, true, null);
  await notHeldByPark(stopped, await planReopens(stopped));
});

test("a task's end does not answer work that was stopped while parked on it", async () => {
  const stillStopped = await stoppedWhileParked('stays-stopped');
  const reopened = await stoppedWhileParked('reopened-before-task-ends');
  await planReopens(reopened);
  for (const { work, task } of [stillStopped, reopened]) {
    const before = await onThread(work, 'resume');
    await O.finishTask(task, true, null);
    assert.deepEqual(await onThread(work, 'resume'), before);
  }
});

test('a connect task the office drops wakes the work parked on it, and says it was dropped', async () => {
  const { lead, work } = await ownWork('connect');
  const [connect] = await db
    .insert(tasks)
    .values({
      staffId: lead,
      title: 'Connect the printer',
      why: 'w',
      steps: [
        {
          text: 'Paste the key',
          done: false,
          action: { kind: 'secret', connector: 'printer', name: 'key' }
        }
      ]
    })
    .returning();
  await parksOn(lead, work, connect.id);
  await O.reconfigureConnector('printer', {});
  const woken = await onThread(work, 'resume');
  assert.equal(woken.length, 1);
  assert.match(woken[0].note ?? '', /dropped "Connect the printer".+so it will not be finished/);
  assert.equal((await threadOf(work)).resumeOnTask, null);
});

test('a task its Odd takes off the desk wakes the work parked on it once, and says so', async () => {
  const { lead, work } = await ownWork('withdrawn');
  const task = await aTask(lead, 'Sign the form');
  await parksOn(lead, work, task.id);
  await O.withdrawTask(task.id, 'Not needed now.');
  await O.withdrawTask(task.id, 'Not needed now.');
  const woken = await onThread(work, 'resume');
  assert.equal(woken.length, 1);
  assert.match(
    woken[0].note ?? '',
    /^"Sign the form", the task you parked this work on, was taken off .+'s desk, so it will not be finished\. Decide what comes of the work now: Not needed now\.$/
  );
  assert.equal((await threadOf(work)).resumeOnTask, null);
});

test("the task's Odd leaving takes the task off the desk: the work parked on it wakes once, told so, and is not left to the run of an Odd that left", async () => {
  const { hub, parked, owner } = await parkedOnColleaguesTask('hub-leaves');
  assert.equal(await L.removeOdd(hub), undefined);
  const woken = await onThread(parked, 'resume');
  assert.equal(woken.length, 1);
  assert.equal(
    woken[0].note,
    `"Check the hub-leaves copy", the task you parked this work on, was taken off ${owner}'s desk, so it will not be finished. Decide what comes of the work now: Lead hub-leaves left the office, so this will not go ahead.`
  );
  assert.equal((await threadOf(parked)).resumeOnTask, null);
});

test("an Odd that leaves stops the work it parked on another's task, and that task's end wakes nothing", async () => {
  const { parker, parked, task } = await parkedOnColleaguesTask('parker-leaves');
  assert.equal(await L.removeOdd(parker), undefined);
  const stopped = await threadOf(parked);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.resumeOnTask, null, "leaving ends the park, as the owner's stop does");
  await O.finishTask(task, true, null);
  assert.deepEqual(await onThread(parked, 'resume'), []);
});

test("a colleague's run leaves the lead's park, and a lead's run that parks again on the same task stays open and parked, and wakes once at the task's end", async () => {
  const { lead, h, work } = await ownWork('stays-open');
  const sign = await aTask(lead, 'Sign the banner');
  await parksOn(lead, work, sign.id);
  await runs(h, 'done', 'Drew it.');
  assert.equal((await threadOf(work)).resumeOnTask, sign.id, "a colleague's run lifts no park");
  const [back] = await onThread(work, 'handed_back');
  await runsAndParks(back, sign.id);
  const after = await threadOf(work);
  assert.equal(after.resumeOnTask, sign.id, 'a park made during the run outlives its claim');
  assert.equal(after.status, 'open');
  assert.equal(after.endedAt, null);
  await O.finishTask(sign.id, true, null);
  await O.finishTask(sign.id, true, null);
  assert.equal((await onThread(work, 'resume')).length, 1, 'the wake found it still open');
});

test("a parked thread's lead is told what it waits on", async () => {
  const { lead, work } = await ownWork('told');
  const check = await aTask(lead, 'Check the\nspelling');
  await parksOn(lead, work, check.id);
  const story = await B.threadStory(await threadOf(work));
  assert.ok(
    B.threadKnown({ story }).includes(
      'It is parked until {owner} finishes or drops "Check the spelling". You pick it up then.'
    )
  );
  assert.match(
    B.threadBrief({ story }).join('\n'),
    /resume_at after_task, when it waits on a task/
  );
  const card = (await T.threadsFor(lead)).find((t) => t.id === work);
  assert.equal(card?.parkedOn, 'Check the\nspelling');
  const row = (await T.goalThreads()).find((t) => t.id === work);
  assert.equal(row?.parkedOn, 'Check the\nspelling');

  const at = new Date(Date.now() + 3_600_000);
  assert.ok(await T.parkThread(lead, work, at), 'a time replaces the task');
  const timed = await threadOf(work);
  assert.equal(timed.resumeOnTask, null);
  assert.ok(
    B.threadKnown({ story: await B.threadStory(timed) }).some((l) =>
      l.startsWith('It picks back up at ')
    )
  );

  await parksOn(lead, work, check.id);
  assert.equal((await threadOf(work)).resumeAt, null, 'a task replaces the time');
});

const parkedLine = async (work: number) =>
  B.threadKnown({ story: await B.threadStory(await threadOf(work)) }).find((l) =>
    l.startsWith('It is parked until')
  );

test("work parked on a task that the owner's words pick up ends when that run ends done, waits on nothing, and the task's later end wakes nothing", async () => {
  const { lead, colleague, h, work } = await ownWork('go-ahead');
  const sign = await aTask(lead, 'Sign\nthe poster');
  await runs(h, 'done', 'Drew it.');
  await runsAndParks((await onThread(work, 'handed_back'))[0], sign.id);
  const goAhead = await toldLead(colleague, work);
  const claimed = await O.startFollowUp(goAhead.id);
  assert.deepEqual(claimed?.unparked, { task: 'Sign\nthe poster' });
  assert.equal(await parkedLine(work), undefined, 'the run is not told it is still parked');
  await O.finishFollowUp(goAhead, 'work', 'done', 'Went ahead.');
  const after = await threadOf(work);
  assert.equal(after.resumeOnTask, null);
  assert.equal(after.status, 'done');
  assert.notEqual(after.endedAt, null);
  const card = (await T.threadsFor(lead)).find((t) => t.id === work);
  assert.equal(card?.parkedOn, undefined);
  assert.equal(card?.stage, 'done');
  await O.finishTask(sign.id, false, null);
  assert.equal((await onThread(work, 'resume')).length, 1, "the task's end woke nothing");
});

test('a hand-back that picks up work parked on a task ends the park, and its claim names the wait it ended', async () => {
  const { lead, h, work } = await ownWork('hand-back');
  const sign = await aTask(lead, 'Sign the flyer');
  await parksOn(lead, work, sign.id);
  await runs(h, 'done', 'Drew it.');
  const [back] = await onThread(work, 'handed_back');
  assert.deepEqual((await O.startFollowUp(back.id))?.unparked, { task: 'Sign the flyer' });
  assert.equal((await threadOf(work)).resumeOnTask, null);
  assert.equal(await parkedLine(work), undefined);
});

test('work parked on a time that the owner picks up early is parked no more, so the clock never wakes it', async () => {
  const { lead, colleague, h, work } = await ownWork('early');
  await runs(h, 'done', 'Drew it.');
  const [back] = await onThread(work, 'handed_back');
  assert.ok(await O.startFollowUp(back.id));
  const at = new Date(Date.now() + 3_600_000);
  assert.ok(await T.parkThread(lead, work, at));
  await O.finishFollowUp(back, 'work', 'done', 'Parked it till later.');
  const early = await toldLead(colleague, work);
  const claimed = await O.startFollowUp(early.id);
  assert.equal(claimed?.unparked && 'at' in claimed.unparked && +claimed.unparked.at, +at);
  assert.equal((await threadOf(work)).resumeAt, null);
  assert.ok(!(await T.parkedThreads()).some((p) => p.id === work), 'the clock has no wake for it');
});

test("work the usage window holds stays held whatever picks it up: the hold is the office's, not the lead's", async () => {
  const { lead, colleague, work } = await ownWork('held');
  const { ask: hold } = await O.raiseAsk(lead, {
    title: 'Hold for the window',
    why: 'w',
    ifApproved: 'i'
  });
  const reset = new Date(Date.now() + 3_600_000);
  await db
    .update(threads)
    .set({ heldBy: hold.id, resumeAt: reset, resumeOnTask: null })
    .where(eq(threads.id, work));
  const pickUp = await toldLead(colleague, work);
  assert.equal((await O.startFollowUp(pickUp.id))?.unparked, undefined);
  const after = await threadOf(work);
  assert.equal(after.heldBy, hold.id);
  assert.equal(after.resumeAt?.getTime(), reset.getTime());
});

test("a pick-up that waits on the lead's run still going ends no park, so the park that run made stands", async () => {
  const { lead, colleague, h, work } = await ownWork('queued');
  const sign = await aTask(lead, 'Sign the menu');
  await runs(h, 'done', 'Drew it.');
  const [back] = await onThread(work, 'handed_back');
  assert.ok(await O.startFollowUp(back.id));
  await parksOn(lead, work, sign.id);
  const waiting = await toldLead(colleague, work);
  assert.equal(await O.startFollowUp(waiting.id), undefined, 'it waits for the run going');
  assert.equal((await threadOf(work)).resumeOnTask, sign.id);
  await O.finishFollowUp(back, 'work', 'done', 'Parked it.');
  assert.equal(
    (await threadOf(work)).resumeOnTask,
    sign.id,
    'a pick-up never started ends no park'
  );
});

test("a task's end that wakes parked work leaves its pick-up no wait to end", async () => {
  const { lead, work } = await ownWork('woken');
  const proof = await aTask(lead, 'Proof the menu');
  await parksOn(lead, work, proof.id);
  await O.finishTask(proof.id, true, null);
  const [woken] = await onThread(work, 'resume');
  const claimed = await O.startFollowUp(woken.id);
  assert.ok(claimed);
  assert.equal(claimed.unparked, undefined);
});
