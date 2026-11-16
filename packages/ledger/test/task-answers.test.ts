// What reaches the Odd when a task ends or a goal's status changes, and what the
// owner's answers on a task count as. Run with `npm test -w @oddboro/ledger`.
import { thread, aGoal, markNow, reached, heard } from './desk-answers-setup.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { ledger, staffGoals, tasks, type Step } from '../src/schema.ts';
import { db } from './pglite.ts';

const { finishTask, giveTask, officeActivity, raiseAsk, task, TaskResponseConflict, tickStep } =
  await import('../src/office.ts');
const { ownerAnswers } = await import('../src/desk-answers.ts');
const { updateGoal } = await import('../src/goals.ts');
const { GOAL_ANSWERS, OWNER_ANSWERS } = await import('../src/desk-answers.ts');

test("a done or dropped task, a done task with no Odd, and a goal's pause, met or drop have the rows pinned here and reach the Odd as pinned, and a none names its Linear row", async () => {
  assert.deepEqual(OWNER_ANSWERS.task, {
    done: {
      fromAccess: ['carry_out', 'wake_parked'],
      other: ['task_done', 'wake_parked'],
      noOdd: ['wake_parked']
    },
    dropped: ['answer_back', 'wake_parked']
  });
  const steps: Step[] = [{ text: 'Do it', done: false }];
  // A connect task from Ada's access ask.
  const { ask: access } = await raiseAsk('ada', {
    title: 'Read Gmail',
    why: 'w',
    ifApproved: 'i',
    access: { connector: 'gmail', level: 'read' }
  });
  const [connect] = await db
    .insert(tasks)
    .values({ staffId: 'ada', askId: access.id, title: 'Connect Gmail', why: 'w', steps })
    .returning();
  let mark = await markNow();
  await finishTask(connect.id, true, null);
  assert.deepEqual(await reached(mark), ['carry_out:ada']);

  const other = await giveTask('ada', { title: 'Pick a blue', why: 'w', steps: ['Pick one'] });
  mark = await markNow();
  await finishTask(other.id, true, 'Navy.');
  assert.deepEqual(await reached(mark), ['task_done:ada']);

  const [nobodys] = await db
    .insert(tasks)
    .values({ title: 'Water the plants', why: 'w', steps })
    .returning();
  mark = await markNow();
  await finishTask(nobodys.id, true, null);
  assert.deepEqual(await reached(mark), []);

  // A dropped task goes back to the thread it was given on, and on none wakes the Odd that gave it.
  for (const onThread of [true, false]) {
    const threadId = onThread ? await thread() : undefined;
    const t = await giveTask('ada', {
      title: 'Call the baker',
      why: 'w',
      steps: ['Call'],
      threadId
    });
    mark = await markNow();
    await finishTask(t.id, false, 'Not needed.');
    const want = onThread ? ['resume:ada'] : ['answered:ada'];
    assert.deepEqual(await reached(mark), want, onThread ? 'on a thread' : 'on none');
  }

  // Ada serves a goal the owner pauses, meets or drops: nothing reaches her.
  for (const status of ['paused', 'met', 'dropped'] as const) {
    const goalId = await aGoal(`Fair ${status}`);
    await db.insert(staffGoals).values({ staffId: 'ada', goalId, part: 'All of it' });
    mark = await markNow();
    await updateGoal(goalId, { status }, { owner: true });
    assert.deepEqual(await reached(mark), [], status);
    assert.ok(
      GOAL_ANSWERS[status].every((e) => /^NEW-\d+$/.test(e.none)),
      status
    );
  }
});

test('dropping a task given on no work wakes the Odd that gave it, once, with the drop and the note', async () => {
  const t = await giveTask('ada', { title: 'Book the van', why: 'w', steps: ['Book it'] });
  const mark = await markNow();
  assert.equal(await finishTask(t.id, false, 'not now'), true);
  assert.deepEqual(await reached(mark), ['answered:ada']);
  const woke = await heard(mark);
  assert.equal(woke.length, 1);
  assert.equal(woke[0].kind, 'answered');
  assert.match(woke[0].note ?? '', /dropped "Book the van": not now/);
});

// The office's task route shows the owner this error's words; a false would read
// as "This task was already answered" and hide that the response is not saved.
test('finishing a task whose response the owner has not saved rejects as a response conflict, and the task stays open', async () => {
  const t = await giveTask('ada', {
    title: 'Word the notice',
    why: 'w',
    steps: ['Read it'],
    response: 'Draft'
  });
  await assert.rejects(finishTask(t.id, true, null, { responseVersion: 1 }), (e: unknown) => {
    assert.ok(e instanceof TaskResponseConflict, String(e));
    assert.equal(e.message, 'Review and save your response before marking this task done.');
    return true;
  });
  assert.equal((await task(t.id))?.status, 'open');
});

test("only a choice step's answer counts as what the owner said", () => {
  const steps: Step[] = [
    {
      text: 'Paste the key',
      done: true,
      action: { kind: 'secret', connector: 'c', name: 'n' },
      answer: 'From AWS: the-secret'
    },
    { text: 'Pick one', done: true, action: { kind: 'choice', options: ['Navy'] }, answer: 'Navy' }
  ];
  assert.deepEqual(ownerAnswers(steps), [{ step: 'Pick one', answer: 'Navy' }]);
});

test("the office report says what the owner answered on a finished task, and a finished task's ledger row opens with it", async () => {
  const since = new Date();
  const answered = await giveTask('ada', {
    title: 'Choose a shade',
    why: 'w'.repeat(600),
    steps: [{ text: 'Pick one', done: false, action: { kind: 'choice', options: ['Navy'] } }]
  });
  await tickStep(answered.id, 0, 'Navy');
  await finishTask(answered.id, true, null);
  const silent = await giveTask('ada', { title: 'Sweep the yard', why: 'w', steps: ['Sweep'] });
  await finishTask(silent.id, true, null);

  const { done } = (await officeActivity(since)).tasksForOwner;
  assert.equal(done.find((t) => t.title === 'Choose a shade')?.answer, 'Pick one: Navy');
  const none = done.find((t) => t.title === 'Sweep the yard');
  assert.ok(none && !('answer' in none), 'a task with nothing said has no answer key');

  const [row] = await db.select().from(ledger).where(eq(ledger.taskId, answered.id));
  assert.ok(row.body?.startsWith('Pick one Navy'), row.body ?? '');
});
