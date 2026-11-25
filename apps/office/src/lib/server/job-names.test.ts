// One Odd never has two jobs of one name, an Odd fixes a pair from before
// that rule by naming a job by its id, and the owner removes any paused job,
// one that ran included, keeping its runs: in an office under test
// (office-under-test.ts), through the ledger and through the Odd's own
// `edit_my_job` on the real staff tool server (#306). Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { L } from './office-under-test.ts';

const job = (name: string) => ({
  staffId: 'sam',
  name,
  instructions: 'Write the brief.',
  schedule: { every: 'day' as const, at: '06:45' }
});

test('a second job of the same name is refused when it is added or renamed, whatever its case or spaces', async () => {
  const first = await L.addJob(job('Daily calendar brief'));
  try {
    await assert.rejects(
      L.addJob(job('  daily CALENDAR brief ')),
      /already has a job with that name/
    );
    const second = await L.addJob(job('Weekly review'));
    await assert.rejects(
      L.updateJob(second.id, { name: 'Daily calendar brief' }),
      /already has a job with that name/
    );
    // A job keeps its own name, and another Odd may use it.
    await L.updateJob(first.id, { name: 'Daily Calendar Brief' });
    const other = await L.addJob({ ...job('Daily calendar brief'), staffId: 'lead' });
    await L.pg`delete from jobs where id in (${other.id}, ${second.id})`;
  } finally {
    await L.pg`delete from jobs where id = ${first.id}`;
  }
});

test('the owner removes a paused job that ran: it leaves the list and the clock, its runs stay, and its name is free again', async () => {
  const kept = await L.addJob(job('Morning brief'));
  const extra = await L.addJob(job('Evening brief'));
  const [run] = await L.pg<{ id: number }[]>`
    insert into runs (job_id, staff_id, status) values (${extra.id}, 'sam', 'done') returning id`;
  try {
    await assert.rejects(L.deleteJob(extra.id), /Pause this job before you remove it/);
    await L.updateJob(extra.id, { enabled: false });
    await L.deleteJob(extra.id);
    assert.deepEqual(
      (await L.jobsFor('sam')).map((j) => j.id).filter((id) => id === kept.id || id === extra.id),
      [kept.id]
    );
    assert.ok((await L.job(extra.id))?.removedAt, 'it stays in the table, removed');
    assert.equal((await L.pg`select id from runs where id = ${run.id}`).length, 1);
    assert.ok(!(await L.enabledJobs()).some((j) => j.id === extra.id));
    // Its name is free for a new job, and a paused job that never ran simply goes.
    const again = await L.addJob(job('Evening brief'));
    await L.updateJob(again.id, { enabled: false });
    await L.deleteJob(again.id);
    assert.equal(await L.job(again.id), undefined);
  } finally {
    await L.pg`delete from runs where id = ${run.id}`;
    await L.pg`delete from jobs where id in (${kept.id}, ${extra.id})`;
  }
});

test("an Odd with two jobs of one name, from before names had to differ, pauses one by its id with the owner's yes in chat", async () => {
  // Made the way a goal plan once made them: straight into the table.
  const [a, b] = await L.pg<{ id: number }[]>`
    insert into jobs (staff_id, name, instructions, schedule, next_run_at)
    values ('sam', 'Daily calendar brief', 'Write the brief.', '{"every":"day","at":"06:45"}', now()),
           ('sam', 'Daily calendar brief', 'Write the brief again.', '{"every":"day","at":"06:45"}', now())
    returning id`;
  const client = new Client({ name: 'job-names-test', version: '1' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [L.STAFF_SERVER],
        env: {
          ...(process.env as Record<string, string>),
          STAFF_ID: 'sam',
          OWNER_SAID: 'Switch off the second calendar brief.'
        }
      })
    );
    const call = async (args: Record<string, unknown>) => {
      const r = (await client.callTool({ name: 'edit_my_job', arguments: args })) as CallToolResult;
      return r.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
    };
    const listed = (await client.callTool({ name: 'my_jobs', arguments: {} })) as CallToolResult;
    const jobs = listed.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
    assert.match(jobs, new RegExp(`Daily calendar brief \\(id ${a.id}\\)`));
    assert.match(jobs, new RegExp(`Daily calendar brief \\(id ${b.id}\\)`));

    // By its name, neither one: the Odd hears both ids.
    assert.match(
      await call({ job: 'Daily calendar brief', paused: true }),
      new RegExp(`ids ${a.id} and ${b.id}`)
    );
    // By its id, the second stops running and the first keeps going.
    assert.match(await call({ job: b.id, paused: true }), /It is paused/);
    // The owner's editor saves the name it shows, so either one stays editable.
    await L.updateJob(a.id, {
      name: 'Daily calendar brief',
      instructions: 'Write the brief once.'
    });
    assert.equal((await L.job(a.id))?.instructions, 'Write the brief once.');
    assert.equal((await L.job(a.id))?.enabled, true);
    assert.equal((await L.job(b.id))?.enabled, false);
    const [line] = await L.pg<{ body: string }[]>`
      select body from ledger where actor = 'sam' and title = 'Changed its job: Daily calendar brief'
      order by id desc limit 1`;
    assert.match(line.body, /Paused/);
    // And it renames the one it paused, so the pair is gone.
    assert.match(
      await call({ job: b.id, new_name: 'Old calendar brief' }),
      /Changed "Old calendar brief"/
    );
    assert.match(await call({ job: 999_999 }), /no job with id 999999/);
  } finally {
    await client.close();
    await L.pg`delete from jobs where id in (${a.id}, ${b.id})`;
  }
});
