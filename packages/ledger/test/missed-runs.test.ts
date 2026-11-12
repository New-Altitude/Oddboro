// Runs a job missed while the office was off: the missed times from the
// job's own schedule (`runsBetween`, which steps through `nextRun`), what the
// clock does with each kind of job (`dueNow`), and the writes that settle it
// (missed-runs.ts), against the office's own code on every migration in an
// in-memory PGlite (pglite.ts). Every time is made up: nothing waits. Run
// with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { asks, jobs, staff, type MissedRuns, type Schedule } from '../src/schema.ts';
import { db } from './pglite.ts';

const { instant, nextRun, runsBetween, setZone } = await import('../src/time.ts');
const { FILL_WITHOUT_ASKING, askToCatchUp, awayJobs, clearAway, dueNow, owe, skip, takeOwed } =
  await import('../src/missed-runs.ts');
const { decideAsk, desk } = await import('../src/office.ts');

setZone('America/New_York');
/** An office wall-clock time in November 2026, New York time. */
const nov = (d: number, h: number, min = 0) => instant(2026, 11, d, h, min);
const iso = (times: Date[]) => times.map((t) => t.toISOString());

await db.insert(staff).values({
  id: 'ada',
  name: 'Ada',
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Ada.'
});

/** A job of Ada's, due at `next`. */
async function aJob(name: string, schedule: Schedule, next: Date, missed: MissedRuns = 'latest') {
  const [j] = await db
    .insert(jobs)
    .values({ staffId: 'ada', name, instructions: 'Do it.', schedule, missed, nextRunAt: next })
    .returning();
  return j;
}
const row = async (id: number) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];

test('the missed times come from the schedule itself, for minutes, days, weekdays and weeks', () => {
  assert.deepEqual(
    iso(runsBetween({ every: 'minutes', n: 30 }, nov(10, 9), nov(10, 10, 40))),
    iso([nov(10, 9), nov(10, 9, 30), nov(10, 10), nov(10, 10, 30)])
  );
  // Across the end of daylight time on Nov 1, each run stays at 9:00 on the wall.
  assert.deepEqual(
    iso(runsBetween({ every: 'day', at: '09:00' }, nov(1, 9), nov(3, 10))),
    iso([nov(1, 9), nov(2, 9), nov(3, 9)])
  );
  // Friday the 6th to Tuesday the 10th: the weekend has no runs.
  assert.deepEqual(
    iso(runsBetween({ every: 'weekday', at: '09:00' }, nov(6, 9), nov(10, 10))),
    iso([nov(6, 9), nov(9, 9), nov(10, 9)])
  );
  assert.deepEqual(
    iso(runsBetween({ every: 'week', day: 'Fri', at: '16:00' }, nov(6, 16), nov(20, 16))),
    iso([nov(6, 16), nov(13, 16), nov(20, 16)])
  );
  // Each step is the next run the clock would set.
  const s: Schedule = { every: 'weekday', at: '09:00' };
  const times = runsBetween(s, nov(6, 9), nov(17, 9));
  times.slice(1).forEach((t, i) => assert.equal(t.getTime(), nextRun(s, times[i]).getTime()));
});

test("a 'latest' job on time runs; late, it catches up once inside half a period and skips after", () => {
  const daily = { schedule: { every: 'day', at: '09:00' }, missed: 'latest' } as const;
  assert.deepEqual(dueNow(daily, nov(10, 9), nov(10, 9, 0)), { do: 'run' });
  // Half of a day is 12 hours: 8:59 PM still catches up, 9:01 PM skips.
  assert.deepEqual(dueNow(daily, nov(10, 9), nov(10, 20, 59)), { do: 'owe', times: [nov(10, 9)] });
  assert.deepEqual(dueNow(daily, nov(10, 9), nov(10, 21, 1)), { do: 'skip', at: nov(10, 9) });
  // Away three days: only the newest missed time counts.
  assert.deepEqual(dueNow(daily, nov(7, 9), nov(10, 10)), { do: 'owe', times: [nov(10, 9)] });
  const half = { schedule: { every: 'minutes', n: 30 }, missed: 'latest' } as const;
  assert.deepEqual(dueNow(half, nov(10, 10), nov(10, 10, 14)), {
    do: 'owe',
    times: [nov(10, 10)]
  });
  assert.deepEqual(dueNow(half, nov(10, 10), nov(10, 10, 16)), { do: 'skip', at: nov(10, 10) });
  // Friday's weekday run has a period of three days, to Monday's.
  const weekdays = { schedule: { every: 'weekday', at: '09:00' }, missed: 'latest' } as const;
  assert.deepEqual(dueNow(weekdays, nov(6, 9), nov(7, 10)), { do: 'owe', times: [nov(6, 9)] });
});

test(`a 'record' job owes every missed period up to ${FILL_WITHOUT_ASKING}, and asks past that`, () => {
  const daily = { schedule: { every: 'day', at: '09:00' }, missed: 'record' } as const;
  assert.deepEqual(dueNow(daily, nov(10, 9), nov(10, 9, 0)), { do: 'run' });
  assert.deepEqual(dueNow(daily, nov(10, 9), nov(10, 22)), { do: 'owe', times: [nov(10, 9)] });
  assert.deepEqual(dueNow(daily, nov(1, 9), nov(10, 10)), {
    do: 'owe',
    times: runsBetween(daily.schedule, nov(1, 9), nov(10, 10))
  });
  const ten = dueNow(daily, nov(1, 9), nov(10, 10));
  assert.equal(ten.do === 'owe' && ten.times.length, FILL_WITHOUT_ASKING);
  const hourly = { schedule: { every: 'minutes', n: 60 }, missed: 'record' } as const;
  const asked = dueNow(hourly, nov(10, 0), nov(11, 11, 30));
  assert.equal(asked.do, 'ask');
  assert.equal(asked.do === 'ask' && asked.times.length, 36);
});

test('owing and skipping each move the job on once, and the owed times go to one run', async () => {
  const s: Schedule = { every: 'day', at: '09:00' };
  const j = await aJob('Count the cakes', s, nov(8, 9), 'record');
  const times = [nov(8, 9), nov(9, 9), nov(10, 9)];
  assert.equal(await owe(j, nov(8, 9), times, nov(11, 9)), true);
  // A second look that read the job before the first moved it changes nothing.
  assert.equal(await owe(j, nov(8, 9), times, nov(11, 9)), false);
  assert.deepEqual((await row(j.id)).owed, iso(times));
  assert.deepEqual((await row(j.id)).nextRunAt, nov(11, 9));
  assert.deepEqual(iso(await takeOwed(j.id)), iso(times));
  assert.deepEqual(await takeOwed(j.id), []);

  const sweep = await aJob('Sweep the inbox', s, nov(9, 9));
  assert.equal(await skip(sweep, nov(9, 9), nov(9, 9), nov(11, 9)), true);
  assert.equal(await skip(sweep, nov(9, 9), nov(9, 9), nov(11, 9)), false);
  assert.deepEqual((await row(sweep.id)).nextRunAt, nov(11, 9));
});

test('the While you were away card lists the skipped jobs until they run or the owner dismisses it', async () => {
  await clearAway();
  const s: Schedule = { every: 'day', at: '07:00' };
  const a = await aJob('Morning brief', s, nov(9, 7));
  const b = await aJob('Check the post', s, nov(9, 7));
  await skip(a, nov(9, 7), nov(9, 7), nov(11, 7));
  await skip(b, nov(9, 7), nov(10, 7), nov(11, 7));
  assert.deepEqual(
    (await desk()).away.map((x) => [x.name, x.staffId, x.skippedAt.toISOString()]),
    [
      ['Morning brief', 'ada', nov(9, 7).toISOString()],
      ['Check the post', 'ada', nov(10, 7).toISOString()]
    ]
  );
  await clearAway(a.id);
  assert.deepEqual(
    (await awayJobs()).map((x) => x.name),
    ['Check the post']
  );
  await clearAway();
  assert.deepEqual(await awayJobs(), []);
});

test('more missed periods than it fills alone raise one ask per job, and only a yes owes the run', async () => {
  const hourly: Schedule = { every: 'minutes', n: 60 };
  const j = await aJob('Count visitors', hourly, nov(10, 0), 'record');
  const first = runsBetween(hourly, nov(10, 0), nov(11, 11, 30));
  assert.equal(await askToCatchUp(j, nov(10, 0), first, nov(11, 12, 30)), true);
  const open = () =>
    db
      .select()
      .from(asks)
      .where(eq(asks.kind, 'catch_up'))
      .then((r) => r.filter((a) => a.status === 'open'));
  let [ask] = await open();
  assert.equal(ask.staffId, 'ada');
  assert.equal(
    ask.title,
    'Fill 36 missed periods of Count visitors, Nov 10, 12:00 AM to Nov 11, 11:00 AM?'
  );
  assert.equal((await row(j.id)).owed, null, 'the run was owed before the yes');
  // Away again before the owner answered: the same ask grows, and no second one comes.
  const again = runsBetween(hourly, nov(11, 12, 30), nov(12, 11, 45));
  assert.equal(again.length, 24);
  assert.equal(await askToCatchUp(j, nov(11, 12, 30), again, nov(12, 12, 45)), true);
  // A look that read the job before that moved it on changes nothing.
  assert.equal(await askToCatchUp(j, nov(11, 12, 30), again, nov(12, 12, 45)), false);
  const asked = await open();
  assert.equal(asked.length, 1);
  [ask] = asked;
  assert.equal(ask.catchUp?.times.length, 60);
  assert.equal(
    ask.title,
    'Fill 60 missed periods of Count visitors, Nov 10, 12:00 AM to Nov 12, 11:30 AM?'
  );

  await decideAsk(ask.id, 'approve', null);
  assert.deepEqual((await row(j.id)).owed, ask.catchUp?.times);
  assert.deepEqual(iso(await takeOwed(j.id)), ask.catchUp?.times);

  const k = await aJob('Count cars', hourly, nov(10, 0), 'record');
  await askToCatchUp(k, nov(10, 0), first, nov(11, 12, 30));
  const [no] = await open();
  await decideAsk(no.id, 'deny', null);
  assert.equal((await row(k.id)).owed, null, 'a no owed the runs');
  assert.deepEqual((await row(k.id)).nextRunAt, nov(11, 12, 30));
});
