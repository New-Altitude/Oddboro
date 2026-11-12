// The same ask and task routes serve chat and the Desk in this throwaway office.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { L, followThrough, refusal } from './office-under-test.ts';

const goalRoute = await import('../../routes/api/goals/+server.ts');
const asks = await import('../../routes/api/asks/[id]/+server.ts');
const tasks = await import('../../routes/api/tasks/[id]/+server.ts');
const { chatLog } = await import('./staff.ts');

const post = async <E>(
  route: (event: E) => ReturnType<typeof asks.POST>,
  id: number,
  body: unknown
) =>
  route({
    params: { id: String(id) },
    request: new Request('http://office', { method: 'POST', body: JSON.stringify(body) })
  } as E);

const propose = async (title: string, revises?: number) =>
  (
    await L.raiseAsk('lead', {
      kind: 'goal',
      revises,
      title,
      why: 'The owner asked about this.',
      ifApproved: 'Plan it.',
      goal: { title, area: 'work', horizon: 'quarter' }
    })
  ).ask;

test('one proposal sets one goal, even from two open cards or on a repeated click', async () => {
  await L.pg`update staff set role = ${L.MANAGER_ROLE} where id = 'lead'`;
  const a = await propose('Map the orchard');
  const b = await propose('Map the garden');
  const decide = () => post(asks.POST, b.id, { decision: 'approve' });
  const both = await Promise.allSettled([decide(), decide()]);
  assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await refusal(decide())).status, 409);
  const goals = await L.allGoals();
  assert.deepEqual(
    goals.map((g) => g.title),
    [b.title]
  );
  const planning =
    await L.pg`select * from follow_ups where kind = 'goal' and goal_id = ${goals[0].id}`;
  assert.equal(planning.length, 1);
  const desk = await L.desk();
  assert.ok(desk.asks.some((r) => r.id === a.id));
  assert.ok(!desk.asks.some((r) => r.id === b.id));
  // Setting it is one decision, so the Desk lists it once, not the goal set again.
  assert.deepEqual(
    desk.recent.filter((r) => r.title.includes(b.title)).map((r) => r.title),
    [`Approved: ${b.title}`]
  );
  const chat = await chatLog('lead');
  assert.equal(
    chat.find((l) => l.item?.kind === 'ask' && l.item.id === b.id)?.item?.status,
    'approved'
  );
});

test('approving a replaced card never accepts its replacement', async () => {
  const a = await propose('Survey the paths');
  const replacement = await propose('Survey just the north path', a.id);
  assert.equal((await refusal(post(asks.POST, a.id, { decision: 'approve' }))).status, 409);
  assert.equal((await L.ask(replacement.id))?.status, 'open');
  assert.ok(
    !(await L.allGoals()).some((g) => g.title === a.title || g.title === replacement.title)
  );
});

test('a plan applies the ticked part of an owner-created goal', async () => {
  const g = await L.addGoal({ title: 'Plan a field day', horizon: 'quarter', area: 'work' });
  const { ask } = await L.raiseAsk('lead', {
    kind: 'plan',
    title: 'Field day assignments',
    why: 'One Odd maps the site.',
    ifApproved: 'Assign the work.',
    plan: {
      goalId: g.id,
      items: [
        { kind: 'assign', staff: 'paige', part: 'Map the route.' },
        { kind: 'assign', staff: 'cleo', part: 'Mark the turn.' }
      ]
    }
  });
  await post(asks.POST, ask.id, { decision: 'approve', picks: [1] });
  const saved = (await L.allGoals()).find((row) => row.id === g.id);
  assert.deepEqual(
    saved?.staff.map((s) => s.staffId),
    ['cleo']
  );
  const reason = (await L.ask(ask.id))?.reason;
  assert.match(reason ?? '', /Approved: Cleo: Mark the turn/);
  assert.match(reason ?? '', /Left out: Paige: Map the route/);
  // One line for the plan's yes, not another for Cleo serving the goal.
  const recent = (await L.desk()).recent;
  assert.deepEqual(
    recent.filter((row) => row.reason === reason).map((row) => row.title),
    ['Approved: Field day assignments']
  );
  assert.ok(!recent.some((row) => row.title.includes('serves the goal')));
  assert.ok(
    (await chatLog('lead')).some((line) => line.item?.id === ask.id && line.item.note === reason)
  );
});

test('finishing with a written answer commits one note and gives it to one follow-up', async () => {
  const question = await L.giveTask('paige', {
    title: 'When should the map be ready?',
    why: 'Set the deadline.',
    steps: ['Give a date.']
  });
  const note = 'Friday, before the first tour.';
  const finish = () => post(tasks.POST, question.id, { op: 'finish', done: true, note });
  const both = await Promise.allSettled([finish(), finish()]);
  assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await refusal(finish())).status, 409);
  const desk = await L.desk();
  assert.ok(!desk.tasks.some((row) => row.id === question.id));
  assert.ok(desk.recent.some((row) => row.reason === note));
  const shown = (await chatLog('paige')).find(
    (l) => l.item?.kind === 'task' && l.item.id === question.id
  );
  assert.equal(shown?.item?.status, 'done');
  assert.equal(shown?.item?.note, note);
  const waiting = (await L.followUpsToDo()).filter((f) => f.task?.id === question.id);
  assert.equal(waiting.length, 1);
  const f = await L.startFollowUp(waiting[0].id);
  assert.equal(f?.kind, 'task_done');
  assert.equal(f?.note, note);
  const result = await followThrough(f!, undefined, undefined, waiting[0].task);
  assert.equal(result.outcome, 'done', result.text);
  assert.ok(JSON.parse(result.text).system.includes(note));
});

test('a failed follow-up leaves the question on the Desk to answer again', async () => {
  const q = await L.giveTask('paige', {
    title: 'Which trail should we map?',
    why: 'Pick the route.',
    steps: ['Name the trail.']
  });
  // Fail just this pickup, after the task and its ledger entry have been written.
  await L.pg`alter table follow_ups add constraint refuse_test_pickup check (note <> 'Ridge trail')`;
  try {
    await assert.rejects(post(tasks.POST, q.id, { op: 'finish', note: 'Ridge trail' }));
    assert.equal((await L.task(q.id))?.status, 'open');
    assert.equal((await L.pg`select id from ledger where task_id = ${q.id}`).length, 0);
  } finally {
    await L.pg`alter table follow_ups drop constraint refuse_test_pickup`;
  }
  await post(tasks.POST, q.id, { op: 'finish', note: 'Ridge trail' });
  assert.equal((await L.pg`select id from follow_ups where task_id = ${q.id}`).length, 1);
});

test("one explicit manager chat submission sets the owner's goal and starts planning once", async () => {
  const request = {
    managerId: 'lead',
    requestId: '12345678-1234-4234-8123-456712345678',
    title: 'Measure the north field'
  };
  const set = (body: unknown) => post(goalRoute.POST, 0, body).then((r) => r.json());
  const [one, two] = await Promise.all([set(request), set(request)]);
  assert.equal(one.id, two.id);
  assert.equal(one.title, request.title);
  assert.ok(
    (await L.desk()).recent.some((entry) => entry.title === `Set a goal: ${request.title}`)
  );
  assert.equal((await set(request)).id, one.id);
  assert.equal(
    (await L.pg`select id from follow_ups where goal_id = ${one.id} and kind = 'goal'`).length,
    1
  );
  assert.equal(
    (await L.pg`select id from ledger where title = ${'Set a goal: ' + request.title}`).length,
    1
  );
  assert.ok((await chatLog('lead')).some((l) => l.thread?.line.title === request.title));
  await assert.rejects(set({ ...request, title: 'Measure another field' }), { status: 409 });
  await assert.rejects(set({ ...request, managerId: 'paige' }), { status: 409 });
  await assert.rejects(set({ ...request, title: 'a'.repeat(141) }), { status: 400 });
  const manual = await set({ title: 'Count the fruit', horizon: 'year', area: 'garden' });
  assert.equal(manual.horizon, 'year');
  assert.equal(manual.requestId, null);
});

test('the Desk lists each decision and answer once', async () => {
  const back = await propose('Weed the beds');
  await post(asks.POST, back.id, { decision: 'iterate', reason: 'Just the front beds.' });
  const set = await propose('Plant the bulbs');
  await post(asks.POST, set.id, { decision: 'approve' });
  const chore = await L.giveTask('paige', {
    title: 'Buy the bulbs',
    why: 'They go in this week.',
    steps: ['Buy them.']
  });
  await post(tasks.POST, chore.id, { op: 'finish', done: true, note: 'Bought forty.' });
  const recent = (await L.desk()).recent.map((r) => r.title);
  assert.deepEqual(recent.slice(0, 3), [
    `Done by ${await L.ownerName()}: Buy the bulbs`,
    'Approved: Plant the bulbs',
    'Sent back: Weed the beds'
  ]);
});
