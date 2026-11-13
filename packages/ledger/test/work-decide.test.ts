// What the run deciders make of one event on rows in memory: the cases a
// past bug or a ruling names. Pure: no database.
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HandOff } from '../src/schema.ts';
import { decide } from '../src/work/decide.ts';
import type { Claimed, RunEnded } from '../src/work/events.ts';
import { applyChange, type Change, type WorkRows } from '../src/work/snapshot.ts';
import type { FollowUp, Thread } from '../src/work/state.ts';
import { minutes, odd, rowsOf, run, T0, task, thread } from './work-rows.ts';

const NOW = minutes(10);
const TITLE = 'Sort the invoices';

/** A change the decider made, failing the test on a refusal. */
function changed<R>(d: { refused: string } | { change: Change<R> }): Change<R> {
  if ('refused' in d) assert.fail(`refused: ${d.refused}`);
  return d.change;
}

const pokesOf = (c: Change) => c.outside.flatMap((o) => (o.kind === 'poke' ? [o] : []));
const reportsOf = (c: Change) => c.outside.flatMap((o) => (o.kind === 'report' ? [o] : []));

/**
 * Ada led thread 1 and left the office, which stopped it. Rico did the work
 * she handed him, and her pick-up of his result was running when she left.
 */
function leadLeftWhilePickingUp(result: Partial<HandOff>): WorkRows {
  return rowsOf({
    staff: [odd('ada', { leftAt: T0 }), odd('rico')],
    threads: [thread(1, 'ada', { status: 'stopped', endedAt: T0 })],
    followUps: [
      run(
        1,
        'rico',
        'hand_off',
        { is: 'ended', outcome: 'done', result: 'Sorted', doneAt: T0, startedAt: T0 },
        { threadId: 1, handOff: { from: 'ada', title: TITLE, brief: 'Sort them.' } }
      ),
      run(
        2,
        'ada',
        'handed_back',
        { is: 'running', startedAt: T0, unparked: null },
        {
          threadId: 1,
          handOff: {
            from: 'rico',
            title: TITLE,
            brief: 'Sort them.',
            outcome: 'done',
            id: 1,
            ...result
          }
        }
      )
    ]
  });
}

const failed: RunEnded = { outcome: 'failed', result: 'Stopped', joined: [] };

test("a lead removed while it picks up a colleague's result leaves nothing on the desk, and the colleague pokes the owner once", () => {
  const rows = leadLeftWhilePickingUp({});
  const d = decide(rows, { kind: 'runFinished', id: 2, about: TITLE, ended: failed }, NOW);
  const c = changed(d);
  assert.deepEqual(reportsOf(c), []);
  assert.deepEqual(pokesOf(c), [
    {
      kind: 'poke',
      staffId: 'rico',
      message: `Rico finished "${TITLE}", but could not hand it back to Ada because Ada is no longer here.`
    }
  ]);
  // The Ledger gets the run's own line first, then the one for the result no lead takes.
  assert.ok('after' in d);
  assert.deepEqual(
    d.after.map((a) => ('record' in a ? a.record.title : a.then)),
    [
      `Could not pick up what a colleague finished: ${TITLE}`,
      `Finished, but Ada has left: ${TITLE}`
    ]
  );
});

test("no 'could not hand it back' poke when the result is the owner's own answer", () => {
  const rows = leadLeftWhilePickingUp({ answered: true });
  const c = changed(decide(rows, { kind: 'runFinished', id: 2, about: TITLE, ended: failed }, NOW));
  assert.deepEqual(pokesOf(c), []);
  assert.deepEqual(reportsOf(c), []);
});

test("no poke when the colleague's run ended waiting, since its item is on the desk already", () => {
  const rows = leadLeftWhilePickingUp({ outcome: 'waiting' });
  const c = changed(decide(rows, { kind: 'runFinished', id: 2, about: TITLE, ended: failed }, NOW));
  assert.deepEqual(pokesOf(c), []);
  assert.deepEqual(reportsOf(c), []);
});

test('an Odd brought back does not start work its leaving already failed', () => {
  // Jo's leaving failed this run before it started; she is back now.
  const rows = rowsOf({
    staff: [odd('jo')],
    followUps: [
      run(1, 'jo', 'task_done', {
        is: 'ended',
        outcome: 'failed',
        result: 'Jo left.',
        doneAt: T0,
        startedAt: null
      })
    ]
  });
  assert.deepEqual(decide(rows, { kind: 'runClaimed', id: 1 }, NOW), {
    refused: 'That run is not waiting to start.'
  });
});

test('a run that ended already is refused a second finish', () => {
  const rows = leadLeftWhilePickingUp({});
  const first = changed(
    decide(rows, { kind: 'runFinished', id: 2, about: TITLE, ended: failed }, NOW)
  );
  const after = applyChange(rows, first);
  assert.deepEqual(
    decide(after, { kind: 'runFinished', id: 2, about: TITLE, ended: failed }, minutes(11)),
    { refused: 'That run has ended already.' }
  );
});

/** Ada's pick-up on thread 1 lifted her park on task 2 as it started. */
function parkLifted(taskOpen: boolean): WorkRows {
  return rowsOf({
    staff: [odd('ada')],
    threads: [thread(1, 'ada')],
    tasks: [task(2, 'ada', taskOpen ? {} : { status: 'done', doneAt: minutes(5) })],
    followUps: [
      run(
        1,
        'ada',
        'resume',
        { is: 'running', startedAt: T0, unparked: { task: 2 } },
        { threadId: 1 }
      )
    ]
  });
}

test('a failed run gives back the park its claim lifted while the task is still open', () => {
  const rows = parkLifted(true);
  const after = applyChange(
    rows,
    changed(decide(rows, { kind: 'runFinished', id: 1, about: 'the work', ended: failed }, NOW))
  );
  const t = after.threads.get(1);
  assert.deepEqual(t?.status === 'open' && t.park, { on: 'task', task: 2 });
  assert.equal(after.followUps.size, 1);
});

test('a failed run that gives back a park on a task that ended wakes the work in the same change', () => {
  const rows = parkLifted(false);
  const d = decide(rows, { kind: 'runFinished', id: 1, about: 'the work', ended: failed }, NOW);
  const after = applyChange(rows, changed(d));
  const t = after.threads.get(1);
  assert.deepEqual(t?.status === 'open' && t.park, { on: 'none' });
  const woken = [...after.followUps.values()].filter((f) => f.id !== 1);
  assert.equal(woken.length, 1);
  assert.equal(woken[0].staffId, 'ada');
  assert.equal(woken[0].kind, 'resume');
  assert.equal(woken[0].threadId, 1);
  assert.equal(woken[0].run.is, 'queued');
  // Ada's task_done run for the task started as the task ended, before this wake.
  assert.match(woken[0].note ?? '', /finished "Task 2".*was set going when the task ended/);
  // No step after the commit does the wake: the only After is the Ledger line.
  assert.ok('after' in d);
  assert.deepEqual(
    d.after.map((a) => ('record' in a ? a.record.kind : a.then)),
    ['work']
  );
});

test("a lead's claim never lifts a usage-window hold, which is the office's", () => {
  const held: Thread = thread(1, 'ada', { park: { on: 'window', at: minutes(60), ask: 7 } });
  const rows = rowsOf({
    staff: [odd('ada')],
    threads: [held],
    followUps: [run(1, 'ada', 'resume', { is: 'queued' }, { threadId: 1 })]
  });
  const c = changed(decide(rows, { kind: 'runClaimed', id: 1 }, NOW));
  const claimed: Claimed = c.result;
  assert.equal(claimed.unparked, undefined);
  assert.deepEqual(applyChange(rows, c).threads.get(1), held);
});

test("a project's result owed only while its work is open puts nothing once that work ended, and is not refused", () => {
  // finishProject in project-sessions.ts skips the pick-up on ended work and
  // writes the result's report itself, outside this decider, either way.
  const rows = rowsOf({
    staff: [odd('ada')],
    threads: [thread(1, 'ada', { status: 'done', endedAt: T0 })]
  });
  const owed = { staffId: 'ada', kind: 'resume', threadId: 1, note: 'The result.' } as const;
  assert.deepEqual(decide(rows, { kind: 'runQueued', run: owed, onlyWhileOpen: true }, NOW), {
    change: { put: [], outside: [], result: null },
    after: []
  });
  // Every other source puts its run on ended work too.
  const put = changed(decide(rows, { kind: 'runQueued', run: owed }, NOW)).put;
  const added: FollowUp[] = [
    ...applyChange(rows, { put, outside: [], result: null }).followUps.values()
  ];
  assert.equal(added.length, 1);
  assert.equal(added[0].threadId, 1);
});
