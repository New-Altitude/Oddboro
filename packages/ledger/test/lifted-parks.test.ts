// A park lifted: what the lead is told and where the work goes. Run with `npm test -w @oddboro/ledger`.
import {
  byId,
  onThread,
  runs,
  threadOf,
  raises,
  deskItems,
  ownWork,
  parksOn,
  aTask,
  parkedOnColleaguesTask,
  toldLead,
  fails
} from './pick-up-work.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { asks, followUps, ledger, pokes, reports, tasks, threads } from '../src/schema.ts';
import { db } from './pglite.ts';
import { ownerWords } from './owner-words.ts';

const O = await import('../src/office.ts');
const T = await import('../src/threads.ts');
const { answerLeadNow } = await import('./answer-lead.ts');
const L = await import('../src/leaving.ts');

/**
 * Work parked on a task of `title`, whose lead's pick-up of a hand-back ended
 * the park as it started: that pick-up as listed, before its claim, still running.
 */
async function liftedPark(name: string, title: string) {
  const { lead, h, work } = await ownWork(name);
  const task = await aTask(lead, title);
  await parksOn(lead, work, task.id);
  await runs(h, 'done', 'Drew it.');
  const [back] = await onThread(work, 'handed_back');
  assert.deepEqual((await O.startFollowUp(back.id))?.unparked, { task: title });
  return { lead, work, task, back };
}

test('a lead run that ended a park on a task and then fails parks the work on that task again, and its end wakes it once', async () => {
  const { lead, work, task, back } = await liftedPark('fails-open', 'Sign the flyer');
  assert.equal((await threadOf(work)).resumeOnTask, null, 'the claim ended the park');
  await fails(back);
  const after = await threadOf(work);
  assert.equal(after.resumeOnTask, task.id);
  assert.equal(after.status, 'open');
  assert.equal(after.endedAt, null);
  const card = (await T.threadsFor(lead)).find((t) => t.id === work);
  // What the chat's card reads to say who picks it up and when (`workLine` in the office).
  assert.equal(card?.parkedOn, 'Sign the flyer');
  assert.equal(card?.stage, 'under_way');
  assert.equal(card?.holder, card?.hub);
  await O.finishTask(task.id, true, null);
  await O.finishTask(task.id, true, null);
  const woken = await onThread(work, 'resume');
  assert.equal(woken.length, 1);
  assert.match(
    woken[0].note ?? '',
    /finished "Sign the flyer", the task you parked this work on\./
  );
});

test('a lead run that ended a park on a task fails after the task was finished: the work wakes once, told it was finished and that its other run was set going back then', async () => {
  const { work, task, back } = await liftedPark('fails-finished', 'Proof the flyer');
  await O.finishTask(task.id, true, 'Looks right.');
  assert.deepEqual(await onThread(work, 'resume'), [], 'nothing was parked on it as it ended');
  await fails(back);
  const woken = await onThread(work, 'resume');
  assert.equal(woken.length, 1);
  assert.match(
    woken[0].note ?? '',
    /finished "Proof the flyer", the task you parked this work on\. Another run of yours was set going when the task ended and carries its own part: do only this work's part here\. Pick it up now: Looks right\.$/
  );
  const after = await threadOf(work);
  assert.equal(after.resumeOnTask, null);
  assert.equal(after.endedAt, null);
  await O.finishTask(task.id, true, null);
  assert.equal((await onThread(work, 'resume')).length, 1);
});

test('a lead run that ended a park on a task fails after the task was dropped: the work wakes once, told it was dropped and that its other run was set going back then', async () => {
  const { work, task, back } = await liftedPark('fails-dropped', 'Print the flyer');
  await O.finishTask(task.id, false, null);
  assert.deepEqual(
    (await db.select().from(followUps).where(eq(followUps.taskId, task.id))).map((f) => f.kind),
    ['answered']
  );
  await fails(back);
  const woken = await onThread(work, 'resume');
  assert.equal(woken.length, 1);
  assert.match(
    woken[0].note ?? '',
    /dropped "Print the flyer", the task you parked this work on, so it will not be finished\. Another run of yours was set going when the task ended and carries its own part: do only this work's part here\. Decide what comes of the work now\.$/
  );
  assert.equal((await threadOf(work)).resumeOnTask, null);
});

test('a failed run that gives back a park on a task that ended wakes the work in the same transaction', async () => {
  const { work, task, back } = await liftedPark('fails-wake-refused', 'Fold the flyer');
  await O.finishTask(task.id, true, null);
  // The wake's own write fails, wherever the code makes it. Written with the
  // run's end, it takes the end with it, so the run can end again; written
  // after, the run has ended and nothing wakes the work again.
  await db.execute(
    sql.raw(`create function refuse_wake() returns trigger language plpgsql as $$
      begin
        if new.thread_id = ${work} and new.kind = 'resume' then raise exception 'wake refused'; end if;
        return new;
      end $$`)
  );
  await db.execute(
    sql.raw(
      'create trigger refuse_wake before insert on follow_ups for each row execute function refuse_wake()'
    )
  );
  try {
    // The database's own error, which drizzle wraps as the cause of its own.
    await assert.rejects(fails(back), (err: Error) => /wake refused/.test(String(err.cause)));
  } finally {
    await db.execute(sql.raw('drop trigger refuse_wake on follow_ups'));
    await db.execute(sql.raw('drop function refuse_wake()'));
  }
  assert.equal((await byId(back.id)).outcome, null, 'the run did not end without its wake');
  assert.equal(await fails(back), true);
  assert.equal((await onThread(work, 'resume')).length, 1);
});

test('a lead run that ended a park on a task and ends waiting on the owner leaves the park ended, so the task wakes nothing', async () => {
  const { lead, work, task, back } = await liftedPark('waits', 'Sign the leaflet');
  // What the run waits on, which brings its lead back once the owner answers.
  await O.raiseAsk(lead, { title: 'Which leaflet?', why: 'w', ifApproved: 'i', threadId: work });
  await O.finishFollowUp(back, 'work', 'waiting', 'Asked which leaflet first.');
  const after = await threadOf(work);
  assert.equal(after.resumeOnTask, null);
  assert.equal(after.endedAt, null);
  await O.finishTask(task.id, true, null);
  assert.deepEqual(await onThread(work, 'resume'), [], "the task's end woke nothing");
});

test("a colleague's run claimed on parked work that fails after its lead's run ended the park gives nothing back", async () => {
  const { lead, colleague, h, work } = await ownWork('colleague-fails');
  const task = await aTask(lead, 'Sign the brochure');
  await parksOn(lead, work, task.id);
  assert.ok(await O.startFollowUp(h.id));
  const goAhead = await toldLead(colleague, work);
  assert.deepEqual((await O.startFollowUp(goAhead.id))?.unparked, { task: 'Sign the brochure' });
  await O.finishFollowUp(goAhead, 'work', 'done', 'Went ahead.');
  await fails(h);
  const after = await threadOf(work);
  assert.equal(after.resumeOnTask, null, 'the park its lead ended stays ended');
  assert.equal(after.endedAt, null);
  await O.finishTask(task.id, true, null);
  assert.equal((await onThread(work, 'resume')).length, 1, "the task's end woke nothing");
});

test('a lead run that ended a park and parked again before it failed keeps the park it made, on another task or a time', async () => {
  const onTask = await liftedPark('fails-reparked', 'Sign the menu');
  const other = await aTask(onTask.lead, 'Price the menu');
  await parksOn(onTask.lead, onTask.work, other.id);
  await fails(onTask.back);
  assert.equal((await threadOf(onTask.work)).resumeOnTask, other.id);

  const onTime = await liftedPark('fails-retimed', 'Sign the card');
  const at = new Date(Date.now() + 3_600_000);
  assert.ok(await T.parkThread(onTime.lead, onTime.work, at));
  await fails(onTime.back);
  const timed = await threadOf(onTime.work);
  assert.equal(timed.resumeOnTask, null);
  assert.equal(timed.resumeAt?.getTime(), at.getTime());
});

test('a lead run that ended a park on a task fails after the owner stopped the work: it stays stopped, parked on nothing', async () => {
  const { work, back } = await liftedPark('fails-stopped', 'Sign the poster');
  // As the owner's no to more hand-offs stops it (`answerHandOffs`).
  await db
    .update(threads)
    .set({ status: 'stopped', endedAt: new Date() })
    .where(eq(threads.id, work));
  await fails(back);
  const after = await threadOf(work);
  assert.equal(after.status, 'stopped');
  assert.equal(after.resumeOnTask, null);
});

test('a lead run that ended a park on a task fails after its lead left the office: no park comes back and nothing wakes', async () => {
  const { lead, work, back } = await liftedPark('lead-leaves-mid-run', 'Sign the sticker');
  assert.equal(await L.removeOdd(lead), undefined);
  // As the office's stop of the run going (`whenOddLeaves`) ends it.
  await fails(back);
  const after = await threadOf(work);
  assert.equal(after.status, 'stopped');
  assert.equal(after.resumeOnTask, null, 'no park comes back on work its lead left');
  assert.deepEqual(await onThread(work, 'resume'), []);
});

/**
 * `parkedOnColleaguesTask`, with the parker's pick-up of its helper's result
 * ending the park as it started: that pick-up as listed, still running.
 */
async function liftedColleaguesPark(name: string) {
  const parked = await parkedOnColleaguesTask(name);
  const [step] = await onThread(parked.parked, 'hand_off');
  await runs(step, 'done', 'Laid it out.');
  const [back] = await onThread(parked.parked, 'handed_back');
  assert.deepEqual((await O.startFollowUp(back.id))?.unparked, { task: `Check the ${name} copy` });
  return { ...parked, back };
}

test("a lead run that ended a park on another Odd's task fails after that Odd left the office: the work wakes once, told the task was taken off the desk, never that the owner dropped it", async () => {
  const { hub, parked, back, owner } = await liftedColleaguesPark('hub-leaves-mid-run');
  assert.equal(await L.removeOdd(hub), undefined);
  assert.deepEqual(await onThread(parked, 'resume'), [], 'nothing was parked on it as it ended');
  await fails(back);
  const woken = await onThread(parked, 'resume');
  assert.equal(woken.length, 1);
  assert.equal(
    woken[0].note,
    `"Check the hub-leaves-mid-run copy", the task you parked this work on, was taken off ${owner}'s desk, so it will not be finished. Decide what comes of the work now: Lead hub-leaves-mid-run left the office, so this will not go ahead.`
  );
  assert.equal((await threadOf(parked)).resumeOnTask, null);
});

test("a lead run that ended a park on another Odd's task fails after that Odd left and was brought back: the work is still told the task was taken off the desk, and that no run carries the Odd's stopped work", async () => {
  const { hub, parked, back, owner } = await liftedColleaguesPark('hub-back-mid-run');
  assert.equal(await L.removeOdd(hub), undefined);
  // Back before the run fails: nothing about the Odd says it ever left.
  assert.equal(await L.bringBack(hub), undefined);
  await fails(back);
  const woken = await onThread(parked, 'resume');
  assert.equal(woken.length, 1);
  assert.equal(
    woken[0].note,
    `"Check the hub-back-mid-run copy", the task you parked this work on, was taken off ${owner}'s desk, so it will not be finished. Decide what comes of the work now: Lead hub-back-mid-run left the office, so this will not go ahead.`
  );
  assert.equal((await threadOf(parked)).resumeOnTask, null);
});

test("a lead run that ended a park on another Odd's task fails after that Odd took it off the desk itself: the work is told so, never that the owner dropped it", async () => {
  const { parked, back, task, owner } = await liftedColleaguesPark('hub-withdraws-mid-run');
  await O.withdrawTask(task, 'Not needed now.');
  await fails(back);
  const woken = await onThread(parked, 'resume');
  assert.equal(woken.length, 1);
  assert.equal(
    woken[0].note,
    `"Check the hub-withdraws-mid-run copy", the task you parked this work on, was taken off ${owner}'s desk, so it will not be finished. A run on "Work on hub-withdraws-mid-run", the work that task was given on, was set going when the task ended, and its lead carries that work's own part: do only this work's part here. Decide what comes of the work now: Not needed now.`
  );
});

test("a lead run that ended a park on another Odd's task fails after the owner dropped it: the work is told it was dropped, even when that Odd left after the drop", async () => {
  const plain = await liftedColleaguesPark('dropped-mid-run');
  await O.finishTask(plain.task, false, 'Not this week.');
  await fails(plain.back);
  const told = await onThread(plain.parked, 'resume');
  assert.equal(told.length, 1);
  assert.equal(
    told[0].note,
    `${plain.owner} dropped "Check the dropped-mid-run copy", the task you parked this work on, so it will not be finished. A run on "Work on dropped-mid-run", the work that task was given on, was set going when the task ended, and its lead carries that work's own part: do only this work's part here. Decide what comes of the work now: Not this week.`
  );

  const thenLeft = await liftedColleaguesPark('dropped-then-left');
  await O.finishTask(thenLeft.task, false, 'Not this week.');
  const [ended] = await db.select().from(tasks).where(eq(tasks.id, thenLeft.task));
  // The Odd leaves strictly after the drop, as two actions of the owner's do.
  while (Date.now() <= (ended.doneAt?.getTime() ?? 0)) await new Promise((r) => setTimeout(r, 5));
  assert.equal(await L.removeOdd(thenLeft.hub), undefined);
  await fails(thenLeft.back);
  const heard = await onThread(thenLeft.parked, 'resume');
  assert.equal(heard.length, 1);
  // No run on the task's own work is named: its lead left, so it runs nothing.
  assert.equal(
    heard[0].note,
    `${thenLeft.owner} dropped "Check the dropped-then-left copy", the task you parked this work on, so it will not be finished. Decide what comes of the work now: Not this week.`
  );
});

test('an Odd that leaves while its work is parked on its own task wakes nothing: taking that task off the desk finds no park', async () => {
  const { lead, work } = await ownWork('own-task-leaves');
  const task = await aTask(lead, 'Sign the badge');
  await parksOn(lead, work, task.id);
  assert.equal(await L.removeOdd(lead), undefined);
  const [withdrawn] = await db.select().from(tasks).where(eq(tasks.id, task.id));
  assert.equal(withdrawn.status, 'dropped', 'leaving took the task off the desk');
  assert.deepEqual(await onThread(work, 'resume'), [], 'no wake for an Odd that left');
  assert.equal(
    (await threadOf(work)).resumeOnTask,
    null,
    "leaving ends the park, as the owner's stop does"
  );
});

test('work its lead parked until a time, and then left the office, is never woken by the clock', async () => {
  const { lead, work } = await ownWork('time-leaves');
  assert.ok(await T.parkThread(lead, work, new Date(Date.now() + 3_600_000)));
  assert.equal(await L.removeOdd(lead), undefined);
  // The time comes after the Odd left.
  await db
    .update(threads)
    .set({ resumeAt: new Date(Date.now() - 1000) })
    .where(eq(threads.id, work));
  assert.ok(!(await T.parkedThreads()).some((p) => p.id === work), 'the clock finds nothing due');
  await T.wakeThread(work);
  assert.deepEqual(await onThread(work, 'resume'), []);
});

test("a lead that leaves takes its work out of the usage window's hold, so at the reset only the other work it held wakes, and the wake leaves the ask to the clock", async () => {
  const gone = await ownWork('held-lead-leaves');
  const stays = await ownWork('held-lead-stays');
  const { ask: hold } = await O.raiseAsk(stays.lead, {
    title: 'Hold both for the window',
    why: 'w',
    ifApproved: 'i'
  });
  const reset = new Date(Date.now() + 3_600_000);
  for (const work of [gone.work, stays.work])
    await db.update(threads).set({ heldBy: hold.id, resumeAt: reset }).where(eq(threads.id, work));
  assert.equal(await L.removeOdd(gone.lead), undefined);
  const stopped = await threadOf(gone.work);
  assert.equal(stopped.heldBy, null, 'nothing holds work its lead left');
  assert.equal(stopped.resumeAt, null, 'nothing wakes it at the reset');
  // The window resets.
  await db
    .update(threads)
    .set({ resumeAt: new Date(Date.now() - 1000) })
    .where(eq(threads.id, stays.work));
  await T.wakeThread(stays.work);
  const [ask] = await db.select().from(asks).where(eq(asks.id, hold.id));
  assert.equal(ask.status, 'open', 'the office clock takes the ask off the desk, not the wake');
  assert.equal((await onThread(stays.work, 'resume')).length, 1);
  assert.deepEqual(await onThread(gone.work, 'resume'), []);
});

/** Every report an Odd ever put on the desk, read or not. */
const reportsOf = (staffId: string) =>
  db.select().from(reports).where(eq(reports.staffId, staffId));

test('a lead that leaves with a task open on its own work is woken by nothing, and no report says it could not pick the work back up, even once it is back', async () => {
  const { lead, work } = await ownWork('leaves-with-own-task');
  await O.giveTask(lead, { title: 'Sign the lease', why: 'w', steps: ['Sign it'], threadId: work });
  assert.equal(await L.removeOdd(lead), undefined);
  assert.deepEqual(await onThread(work, 'resume'), [], 'nothing wakes a lead that left');
  assert.deepEqual(await reportsOf(lead), []);
  assert.equal(await L.bringBack(lead), undefined);
  assert.deepEqual(
    (await O.desk()).reports.filter((r) => r.staffId === lead),
    []
  );
  const toEnd = await db
    .select()
    .from(followUps)
    .where(and(eq(followUps.staffId, lead), isNull(followUps.outcome)));
  assert.deepEqual(toEnd, [], 'nothing runs on the work it left');
});

test('a pick-up still to start when its lead leaves ends failed, with no report on the desk', async () => {
  const { lead, work } = await ownWork('leaves-with-pick-up');
  await answerLeadNow(work, 'Use blue.');
  assert.equal(await L.removeOdd(lead), undefined);
  const [pickUp] = await onThread(work, 'resume');
  assert.equal(pickUp.outcome, 'failed');
  assert.deepEqual(await reportsOf(lead), []);
});

/** What the owner hears of a colleague's result that no lead takes: its pokes, and its Ledger lines. */
async function heardOf(colleague: string) {
  const poked = await db.select().from(pokes).where(eq(pokes.staffId, colleague));
  const lines = await db.select().from(ledger).where(eq(ledger.actor, colleague));
  return { poked, lines };
}

test('a colleague that finishes after its lead left hands nothing back: it pokes the owner, the Ledger says nothing picks the work up, and the desk gets nothing', async () => {
  const { lead, colleague, h, work } = await ownWork('lead-leaves-mid-step');
  assert.ok(await O.startFollowUp(h.id));
  assert.equal(await L.removeOdd(lead), undefined);
  const before = await deskItems();
  await O.finishFollowUp(h, 'Step of lead-leaves-mid-step', 'done', 'Drew it.');
  assert.deepEqual(await onThread(work, 'handed_back'), [], 'nothing waits on a lead that left');
  assert.equal(await deskItems(), before);
  const { poked, lines } = await heardOf(colleague);
  assert.equal(poked.length, 1);
  assert.equal(
    poked[0].message,
    'Colleague lead-leaves-mid-step finished "Step of lead-leaves-mid-step", but could not hand it back to Lead lead-leaves-mid-step because Lead lead-leaves-mid-step is no longer here.'
  );
  assert.equal(poked[0].status, 'waiting');
  assert.ok(poked[0].at <= new Date(), 'it goes now');
  const line = lines.find((l) => l.title.startsWith('Finished, but Lead lead-leaves-mid-step'));
  assert.ok(line, lines.map((l) => l.title).join('\n'));
  assert.match(
    line.body ?? '',
    /nothing picks the work up\. What .+ did stays in the work's folder\./
  );
  ownerWords(line.title, line.body, poked[0].message);
});

test('a step that starts after its lead left, and fails, hands nothing back, and the colleague says it could not finish', async () => {
  const { lead, colleague, h, work } = await ownWork('lead-left-before-step');
  assert.equal(await L.removeOdd(lead), undefined);
  await runs(h, 'failed', 'The ink ran out.');
  assert.deepEqual(await onThread(work, 'handed_back'), []);
  assert.deepEqual(await reportsOf(colleague), [], 'the poke tells the owner, not the desk');
  const { poked } = await heardOf(colleague);
  assert.deepEqual(
    poked.map((p) => p.message),
    [
      'Colleague lead-left-before-step could not finish "Step of lead-left-before-step", and could not hand it back to Lead lead-left-before-step because Lead lead-left-before-step is no longer here.'
    ]
  );
});

test('a result waiting for its lead when the lead leaves ends there: the colleague pokes the owner, and no report says the lead could not pick it up', async () => {
  const { lead, colleague, h, work } = await ownWork('lead-leaves-with-result');
  await runs(h, 'done', 'Drew it.');
  const [back] = await onThread(work, 'handed_back');
  assert.equal(back.startedAt, null);
  assert.equal(await L.removeOdd(lead), undefined);
  assert.equal((await byId(back.id)).outcome, 'failed');
  assert.deepEqual(await reportsOf(lead), []);
  const { poked } = await heardOf(colleague);
  assert.deepEqual(
    poked.map((p) => p.message),
    [
      'Colleague lead-leaves-with-result finished "Step of lead-leaves-with-result", but could not hand it back to Lead lead-leaves-with-result because Lead lead-leaves-with-result is no longer here.'
    ]
  );
});

test("the owner's answer to what a colleague raised goes back to no lead that left, and leaves nothing waiting", async () => {
  const { lead, h, work } = await ownWork('lead-leaves-before-answer');
  const ask = await raises(h, 'Which ink?');
  await runs(h, 'waiting', 'Asked which ink.');
  const [waiting] = await onThread(work, 'handed_back');
  await runs(waiting, 'done', 'Waited.');
  assert.equal(await L.removeOdd(lead), undefined);
  await O.decideAsk(ask.id, 'deny', 'No ink this week.');
  const open = (await onThread(work, 'handed_back')).filter((f) => f.outcome === null);
  assert.deepEqual(open, [], 'no result waits on a lead that left');
});

test('a lead run that ended no park and fails ends the work failed, parked on nothing', async () => {
  const { h, work } = await ownWork('fails-unparked');
  await runs(h, 'done', 'Drew it.');
  const [back] = await onThread(work, 'handed_back');
  assert.equal((await O.startFollowUp(back.id))?.unparkedTask, null);
  await fails(back);
  const after = await threadOf(work);
  assert.equal(after.status, 'failed');
  assert.equal(after.resumeOnTask, null);
});

test('a lead run on work the usage window holds that fails leaves the hold as it was and parks on no task', async () => {
  const { lead, colleague, work } = await ownWork('fails-held');
  const { ask: hold } = await O.raiseAsk(lead, {
    title: 'Hold the failed run for the window',
    why: 'w',
    ifApproved: 'i'
  });
  const reset = new Date(Date.now() + 3_600_000);
  await db
    .update(threads)
    .set({ heldBy: hold.id, resumeAt: reset, resumeOnTask: null })
    .where(eq(threads.id, work));
  const pickUp = await toldLead(colleague, work);
  const claimed = await O.startFollowUp(pickUp.id);
  assert.equal(claimed?.unparkedAt, null, 'the hold is not a time the run lifted');
  await fails(pickUp);
  const after = await threadOf(work);
  assert.equal(after.heldBy, hold.id);
  assert.equal(after.resumeAt?.getTime(), reset.getTime());
  assert.equal(after.resumeOnTask, null);
  assert.equal(after.status, 'open');
});

/**
 * Work its lead parked until `at`, whose lead's pick-up of the owner's words
 * ended the park as it started: that pick-up as listed, before its claim, still running.
 */
async function liftedTime(name: string, at: Date) {
  const { lead, colleague, h, work } = await ownWork(name);
  await runs(h, 'done', 'Drew it.');
  const [back] = await onThread(work, 'handed_back');
  assert.ok(await O.startFollowUp(back.id));
  assert.ok(await T.parkThread(lead, work, at));
  await O.finishFollowUp(back, 'work', 'done', 'Parked it till later.');
  const early = await toldLead(colleague, work);
  const claimed = await O.startFollowUp(early.id);
  assert.equal(claimed?.unparked && 'at' in claimed.unparked && +claimed.unparked.at, +at);
  assert.equal((await threadOf(work)).resumeAt, null, 'the claim ended the park');
  return { lead, work, early };
}

test('a lead run that ended a park on a time still to come and then fails parks the work until that time again', async () => {
  const at = new Date(Date.now() + 3_600_000);
  const { lead, work, early } = await liftedTime('fails-timed', at);
  await fails(early);
  const after = await threadOf(work);
  assert.equal(after.resumeAt?.getTime(), at.getTime());
  assert.equal(after.resumeOnTask, null);
  assert.equal(after.heldBy, null);
  assert.equal(after.status, 'open');
  const parked = (await T.parkedThreads()).find((p) => p.id === work);
  assert.equal(parked?.resumeAt.getTime(), at.getTime(), 'the clock wakes it at that time');
  // What the chat's card reads to say when its lead picks it up (`workLine` in the office).
  const card = (await T.threadsFor(lead)).find((t) => t.id === work);
  assert.equal(card?.resumeAt?.getTime(), at.getTime());
  const waking = (await onThread(work, 'resume')).filter((f) => f.startedAt === null);
  assert.deepEqual(waking, [], 'nothing wakes it before then');
});

test('a lead run that ended a park on a time that passed while it ran, then fails, leaves the work for the clock to wake once', async () => {
  const at = new Date(Date.now() + 200);
  const { work, early } = await liftedTime('fails-time-passed', at);
  while (Date.now() <= at.getTime()) await new Promise((r) => setTimeout(r, 20));
  const before = (await onThread(work, 'resume')).length;
  await fails(early);
  assert.equal((await onThread(work, 'resume')).length, before, 'the failure itself wakes nothing');
  const due = (await T.parkedThreads()).find((p) => p.id === work);
  assert.ok(due && due.resumeAt <= new Date(), 'the clock finds it due');
  // Two looks of the clock at once, as a change to threads and its timer can bring.
  await Promise.all([T.wakeThread(work), T.wakeThread(work)]);
  const woken = await onThread(work, 'resume');
  assert.equal(woken.length, before + 1);
  assert.equal(woken.at(-1)?.startedAt, null);
  assert.equal((await threadOf(work)).resumeAt, null);
  assert.ok(!(await T.parkedThreads()).some((p) => p.id === work), 'nothing is left to wake');
});

test('a lead run that ended a park on a time and parked again before it failed keeps the park it made, on another time or a task', async () => {
  const later = new Date(Date.now() + 7_200_000);
  const onTime = await liftedTime('timed-retimed', new Date(Date.now() + 3_600_000));
  assert.ok(await T.parkThread(onTime.lead, onTime.work, later));
  await fails(onTime.early);
  assert.equal((await threadOf(onTime.work)).resumeAt?.getTime(), later.getTime());

  const onTask = await liftedTime('timed-retasked', new Date(Date.now() + 3_600_000));
  const task = await aTask(onTask.lead, 'Sign the timetable');
  await parksOn(onTask.lead, onTask.work, task.id);
  await fails(onTask.early);
  const tasked = await threadOf(onTask.work);
  assert.equal(tasked.resumeOnTask, task.id);
  assert.equal(tasked.resumeAt, null);
});
