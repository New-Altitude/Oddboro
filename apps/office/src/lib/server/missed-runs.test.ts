// The office clock with jobs whose time passed while the office was off, in
// an office under test (office-under-test.ts) whose stand-in Claude Code
// sends back the brief each run got. Every run is told the time it is for; a
// late `latest` job catches up once or skips to the desk's While you were
// away card; a `record` job fills its missed periods in one run, or asks
// first past ten; and catch-ups start one after another. The jobs' times are
// made up, so nothing waits on the clock. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { JobRow, MissedRuns, Schedule } from '@oddboro/ledger';
import { L, folder, request, type Gave } from './office-under-test.ts';

const { lookAtJobs, lineDone } = await import('./jobs.ts');
const { jobBrief } = await import('./job-brief.ts');
const { runJob, inProgress } = await import('./staff.ts');
const { runTime, setZone } = await import('@oddboro/ledger/time');

setZone('America/New_York');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A job of Sam's, due at `next`. */
async function aJob(
  name: string,
  schedule: Schedule,
  next: Date,
  missed: MissedRuns = 'latest',
  instructions = 'Do it.'
): Promise<JobRow> {
  const j = await L.addJob({ staffId: 'sam', name, instructions, schedule, missed });
  await L.setNextRun(j.id, next);
  return { ...j, nextRunAt: next };
}

/** Each run of a job that ended, oldest first, with the brief the stand-in says it got. */
async function runsOf(id: number): Promise<{ trigger: string; system: string }[]> {
  const rows = await L.pg<{ trigger: string; summary: string | null }[]>`
    select trigger, summary from runs where job_id = ${id} and status <> 'running' order by id`;
  return rows.map((r) => {
    const s = r.summary ?? '';
    const gave = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)) as Gave;
    return { trigger: r.trigger, system: gave.system };
  });
}

/** The clock's look at `now`, then every catch-up it put in line, run to its end. */
async function look(now: Date): Promise<void> {
  await lookAtJobs(now);
  await lineDone();
}

/** Waits until `fn` holds, a check every 20 ms, for at most 20 seconds. */
async function until(fn: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 1000 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(await fn(), 'it never happened');
}

const jobRow = async (id: number) => (await L.job(id))!;
/** The time a scheduled run is for, as a brief says it. */
const forLine = (t: Date) => `This run is for ${runTime(t)}.`;

test('every run is told the time it is for and the time it is now, and a catch-up lists each period', () => {
  const job = { name: 'Count the chairs', report: false };
  const at = new Date('2026-11-10T14:00:00Z');
  const now = new Date('2026-11-10T14:00:05Z');
  const onTime = jobBrief(job, 'schedule', [at], now);
  assert.ok(
    onTime.includes(
      'This run is for Tue, Nov 10, 2026, 9:00 AM EST. It is now Tue, Nov 10, 2026, 9:00 AM EST. Count and label what this run makes by the time it is for, never by now.'
    ),
    onTime
  );
  const byHand = jobBrief(job, 'manual', [now], now);
  assert.match(byHand, /They started this run by hand just now/);
  assert.ok(byHand.includes(forLine(now)), byHand);
  const periods = [0, 1, 2].map((d) => new Date(at.getTime() + d * DAY));
  const caught = jobBrief(job, 'schedule', periods, new Date(at.getTime() + 2 * DAY + HOUR));
  assert.ok(
    caught.includes(
      [
        'This run catches up 3 periods this job missed while the office was off. It is now Thu, Nov 12, 2026, 10:00 AM EST. The periods, oldest first:',
        '',
        '- Tue, Nov 10, 2026, 9:00 AM EST',
        '- Wed, Nov 11, 2026, 9:00 AM EST',
        '- Thu, Nov 12, 2026, 9:00 AM EST',
        '',
        'Write one entry for each period, labelled with its own time, never with now. When a period\'s data cannot be fetched after the fact, record "no data for <period>" for it. Never fill a past period with current numbers.'
      ].join('\n')
    ),
    caught
  );
});

test('a job on time runs at once, for its scheduled time, and moves on to its next', async () => {
  const now = new Date();
  const at = new Date(now.getTime() - 5_000);
  const j = await aJob('Water the plants', { every: 'minutes', n: 30 }, at);
  await lookAtJobs(now);
  await until(async () => (await runsOf(j.id)).length === 1);
  const [run] = await runsOf(j.id);
  assert.ok(run.system.includes(forLine(at)), run.system);
  assert.ok((await jobRow(j.id)).nextRunAt! > now);
});

test("a 'latest' job missed by more than half a period skips to its next time and waits on the desk", async () => {
  const now = new Date();
  // Its newest missed time is 45 minutes ago, past half its hour.
  const at = new Date(now.getTime() - 3 * DAY - 45 * 60_000);
  const j = await aJob('Sweep the inbox', { every: 'minutes', n: 60 }, at);
  await look(now);
  assert.deepEqual(await runsOf(j.id), [], 'a skipped job ran');
  const row = await jobRow(j.id);
  assert.ok(row.nextRunAt! > now);
  const away = (await L.desk()).away.find((x) => x.id === j.id);
  assert.ok(away, 'the skipped job is not on the desk');
  assert.equal(now.getTime() - away.skippedAt.getTime(), 45 * 60_000);
  // Run now runs it, and takes it off the card.
  await request('/api/jobs/[id]', 'POST', { params: { id: String(j.id) }, body: { op: 'run' } });
  await until(async () => (await runsOf(j.id)).length === 1);
  assert.equal((await runsOf(j.id))[0].trigger, 'manual');
  assert.equal(
    (await L.desk()).away.some((x) => x.id === j.id),
    false
  );
});

test('Dismiss takes every job off the While you were away card', async () => {
  const now = new Date();
  const missed = new Date(now.getTime() - 2 * DAY - 45 * 60_000);
  await aJob('Read the news', { every: 'minutes', n: 60 }, missed);
  await aJob('Tidy the desk', { every: 'minutes', n: 60 }, missed);
  await look(now);
  const names = (await L.desk()).away.map((x) => x.name);
  assert.ok(names.includes('Read the news') && names.includes('Tidy the desk'), names.join());
  await request('/api/jobs/away', 'DELETE');
  assert.deepEqual((await L.desk()).away, []);
});

test("a 'record' job with a few missed periods fills them in one run that lists each", async () => {
  const now = new Date();
  const first = new Date(now.getTime() - 3 * HOUR - 10 * 60_000);
  const j = await aJob('Count visitors', { every: 'minutes', n: 60 }, first, 'record');
  await look(now);
  const runs = await runsOf(j.id);
  assert.equal(runs.length, 1, 'the missed periods ran in more than one run');
  const times = [0, 1, 2, 3].map((h) => new Date(first.getTime() + h * HOUR));
  assert.ok(runs[0].system.includes('This run catches up 4 periods'), runs[0].system);
  for (const t of times) assert.ok(runs[0].system.includes(`- ${runTime(t)}\n`), runTime(t));
  assert.equal((await jobRow(j.id)).owed, null);
});

test("a 'record' job with more than ten missed periods asks first, and runs only on the yes", async () => {
  const now = new Date();
  const j = await aJob(
    'Log the weather',
    { every: 'minutes', n: 60 },
    new Date(now.getTime() - 36 * HOUR + 60_000),
    'record'
  );
  await look(now);
  assert.deepEqual(await runsOf(j.id), [], 'it ran before the owner said yes');
  const asks = (await L.desk()).asks.filter((a) => a.kind === 'catch_up');
  assert.equal(asks.length, 1);
  assert.equal(asks[0].staffId, 'sam');
  assert.match(asks[0].title, /^Fill 36 missed periods of Log the weather, /);
  // A second look raises no second ask.
  await look(now);
  assert.equal((await L.desk()).asks.filter((a) => a.kind === 'catch_up').length, 1);

  await L.decideAsk(asks[0].id, 'approve', null);
  // The yes writes the owed periods; the clock's next look starts the one run.
  await look(new Date());
  const runs = await runsOf(j.id);
  assert.equal(runs.length, 1);
  assert.ok(runs[0].system.includes('This run catches up 36 periods'), runs[0].system);
});

test('catch-ups start one after another, while a job on time still starts at once', async (t) => {
  const now = new Date();
  const missed = new Date(now.getTime() - 2 * HOUR - 60_000);
  const holds = { boats: join(folder, 'boats-done'), cars: join(folder, 'cars-done') };
  const a = await aJob(
    'Count the boats',
    { every: 'minutes', n: 60 },
    missed,
    'record',
    `Hold until ${holds.boats} exists.`
  );
  const b = await aJob(
    'Count the cars',
    { every: 'minutes', n: 60 },
    missed,
    'record',
    `Hold until ${holds.cars} exists.`
  );
  // A failed check still lets both runs end, so the file's office can close.
  t.after(() => Object.values(holds).forEach((f) => writeFileSync(f, '')));
  const c = await aJob(
    'Check the oven',
    { every: 'minutes', n: 30 },
    new Date(now.getTime() - 1_000)
  );
  const catchingUp = () =>
    (inProgress().sam ?? []).filter((w) => w.label.startsWith('Catching up 3 periods of '));
  await lookAtJobs(now);
  // The job on time runs while the first catch-up holds.
  await until(() => catchingUp().length === 1);
  await until(async () => (await runsOf(c.id)).length === 1);
  for (let turn = 0; turn < 2; turn++) {
    await until(() => catchingUp().length === 1);
    const [going] = catchingUp();
    assert.equal(catchingUp().length, 1, 'two catch-ups started together');
    writeFileSync(going.label.endsWith('boats') ? holds.boats : holds.cars, '');
    await until(() => !catchingUp().some((w) => w.id === going.id));
  }
  await lineDone();
  assert.equal((await runsOf(a.id)).length, 1);
  assert.equal((await runsOf(b.id)).length, 1);
});

test('Run now on a job is for now', async () => {
  const j = await aJob('Feed the cat', { every: 'day', at: '07:00' }, new Date(Date.now() + DAY));
  const r = await runJob(j, 'manual');
  assert.ok(r.ok, r.text);
  const { system } = JSON.parse(r.text.slice(0, r.text.lastIndexOf('}') + 1)) as Gave;
  const said = /This run is for (.+?)\. It is now (.+?)\./.exec(system);
  assert.ok(said, system);
  assert.equal(said[1], said[2]);
});
