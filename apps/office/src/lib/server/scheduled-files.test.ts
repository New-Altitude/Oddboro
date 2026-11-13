import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { test } from 'node:test';
import { L, bin, gave, setOwn } from './office-under-test.ts';
const { startClock } = await import('./jobs.ts');

// The test driver replaces only the model. Its file calls go over stdio to
// the server the real run registered, with exactly the folders that run got.
test('two jobs exchange a checked file on their clocks', async (t) => {
  const { thread } = await gave('lead', 'paige', { title: 'Synthetic edition' });
  await gave('lead', 'sam', { id: thread });
  const other = await gave('lead', 'cleo', { title: 'Another piece of work' });
  const wire = join(L.threadPart(thread, 'lead'), 'wire.md');
  const edition = join(L.threadPart(thread, 'paige'), 'edition.md');
  const unrelated = join(L.threadPart(other.thread, 'cleo'), 'other.md');
  for (const [p, text] of [
    [edition, 'Edition\n'],
    [wire, 'Earlier wire\n'],
    [unrelated, 'Another edition']
  ]) {
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  mkdirSync(L.accountHome('claude', 'office'), { recursive: true });
  writeFileSync(join(L.accountHome('claude', 'office'), 'signed-in'), 'fixture@example.test');
  const cli = join(bin, 'claude');
  renameSync(cli, cli + '-usual');
  writeFileSync(
    cli,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (!args.includes('--mcp-config')) { require(${JSON.stringify(cli + '-usual')}); }
else (async () => {
  const { Client } = await import(${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/client/index.js'))});
  const { StdioClientTransport } = await import(${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/client/stdio.js'))});
  const config = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
  const c = new Client({name:'schedule-test', version:'1'});
  await c.connect(new StdioClientTransport(config.mcpServers.files));
  const call = (name, args) => c.callTool({name, arguments: args});
  const assert = require('node:assert/strict');
  let message = ''; for await (const chunk of process.stdin) message += chunk;
  const wire = ${JSON.stringify(wire)}, edition = ${JSON.stringify(edition)};
  assert.equal((await call('read_file',{path:${JSON.stringify(unrelated)}})).isError, true);
  if (message.includes('Independent writer')) {
    assert.equal((await call('write_file',{path:wire,content:'Wrong part'})).isError, true);
  } else if (message.includes('Independent check')) {
    assert.equal((await call('read_file',{path:wire})).isError,true);
  } else if (message.includes('Write the wire')) {
    assert.equal((await call('write_file',{path:edition,content:'Wrong part'})).isError, true);
    assert.ok(!(await call('write_file',{path:wire,content:'Source: fixture-27'})).isError);
  } else if (message.includes('Read the wire')) {
    const read = await call('read_file',{path:wire});
    assert.ok(!read.isError);
    const line = read.content[0].text.split('\\t')[1];
    assert.equal(line, 'Source: fixture-27');
    assert.ok(!(await call('edit_file',{path:edition,old_string:'Edition',new_string:'Edition: '+line})).isError);
  }
  await c.close();
  console.log(JSON.stringify({type:'result',subtype:'success',result:message.includes('Independent writer') ? 'I could not write the shared wire.' : message.includes('Independent check') ? 'I could not read the shared wire.' : 'I completed the job.'}));
})().catch(e=>{ console.error(e); process.exitCode=1; });
`
  );
  chmodSync(cli, 0o755);
  const schedule = { every: 'minutes', n: 15 } as const;
  await setOwn('lead', { web: true });
  const writer = await L.addJob({
    staffId: 'lead',
    name: 'Wire',
    schedule,
    instructions: 'Independent writer.'
  });
  const reader = await L.addJob({
    staffId: 'paige',
    name: 'Old name',
    schedule,
    instructions: 'Independent check.'
  });
  // Due now: the change wakes the clock, which runs a job up to a minute late
  // on time (ON_TIME_MS), so no test waits for a time to come.
  const due = async (id: number) => {
    const time = new Date();
    await L.setNextRun(id, time);
    return time;
  };
  const result = async (j: typeof writer, since: Date) => {
    const limit = Date.now() + 60000;
    while (Date.now() < limit) {
      const [r] =
        await L.pg`select runs.* from runs join ledger on ledger.run_id = runs.id where job_id = ${j.id} and started_at >= ${since.toISOString()} and finished_at is not null order by runs.id desc limit 1`;
      if (r) {
        assert.equal(r.trigger, 'schedule');
        assert.ok(new Date(r.finished_at) >= new Date(r.started_at));
        assert.ok((await L.job(j.id))!.nextRunAt! > new Date(r.finished_at));
        return r;
      }
      await wait(80);
    }
    assert.fail('The clock did not finish ' + j.name);
  };
  const state = async () => {
    const job = (await L.officeActivity(new Date(0))).staff.find((p) => p.id === 'paige')!.jobs[0];
    return job;
  };
  // The existing owner job editor approves just this file. A stale form cannot
  // apply the same yes to different sources or a different result.
  const { GET, POST } = await import('../../routes/api/jobs/[id]/+server.ts');
  const review = async (id: number) =>
    (await GET({ params: { id: String(id) } } as Parameters<typeof GET>[0])).json();
  const share = async (expected: unknown) =>
    POST({
      params: { id: String(writer.id) },
      request: new Request('http://office/api/jobs/' + writer.id, {
        method: 'POST',
        body: JSON.stringify({ op: 'update', share: true, expectedFiles: expected })
      })
    } as Parameters<typeof POST>[0]);
  const stop = startClock();
  try {
    const oldWriter = await result(writer, await due(writer.id));
    assert.equal(oldWriter.status, 'done', oldWriter.summary);
    assert.match(oldWriter.summary, /could not write/);
    assert.equal(oldWriter.checked_files, null);
    const independent = await result(reader, await due(reader.id));
    assert.equal(independent.status, 'done', independent.summary);
    assert.equal(independent.checked_files, null);
    assert.match(independent.summary, /could not read/);
    assert.equal((await state()).state, 'configured');
    assert.equal((await state()).lastVerified, null);
    const linked = await L.editOwnJob(
      'lead',
      'Wire',
      {
        instructions: 'Write the wire.',
        files: { thread, output: 'wire.md', sources: ['web'] }
      },
      { said: 'Use the wire from this work.' }
    );
    assert.equal(linked?.id, writer.id);
    const renamed = await L.editOwnJob(
      'paige',
      'Old name',
      {
        name: 'Edition',
        instructions: 'Read the wire.',
        files: { thread, input: 'lead/wire.md', output: 'edition.md' },
        report: true
      },
      { said: 'Call it Edition and check the wire.' }
    );
    assert.equal(renamed?.id, reader.id);
    assert.equal(renamed.name, 'Edition');
    assert.equal((await state()).state, 'configured');
    const { scheduledFiles } = await import('./scheduled-files.ts');
    const checked = await scheduledFiles(
      (await L.staffer('paige'))!,
      renamed,
      renamed.files!,
      'review'
    );
    t.assert.snapshot(
      checked.brief
        .replaceAll(realpathSync.native(L.home()), '<office>')
        .replaceAll(String(thread), '<work>')
    );
    const pending = await review(reader.id);
    assert.match(pending.waiting, /Waiting for "Wire"/);
    assert.equal(pending.checkedAt, null);
    const before = (await L.job(writer.id))!.nextRunAt;
    const setup = await review(writer.id);
    assert.match(setup.blocks.join('\n'), /permission.*web/);
    assert.equal(setup.checkedAt, null);
    assert.deepEqual((await L.job(writer.id))!.nextRunAt, before);
    assert.equal((await L.pg`select id from runs`).length, 2);
    await assert.rejects(() => share({}), /changed/);
    await share(linked.files);
    const w = await result(writer, await due(writer.id));
    assert.equal(w.status, 'done', w.summary);
    assert.equal(w.checked_files.output, 'lead/wire.md');
    assert.equal(w.checked_files.periods.length, 1);
    assert.equal(readFileSync(wire, 'utf8'), 'Source: fixture-27');
    const r = await result(reader, await due(reader.id));
    assert.equal(r.status, 'done', r.summary);
    assert.ok(r.checked_files.sha256);
    assert.equal(r.checked_files.input, 'lead/wire.md');
    assert.equal(r.checked_files.inputRun, w.id);
    for (const row of [w, r])
      t.diagnostic(
        JSON.stringify({
          run: row.id,
          trigger: row.trigger,
          at: row.finished_at,
          next: (await L.job(row.job_id))?.nextRunAt,
          file: row.checked_files
        })
      );
    assert.equal(readFileSync(edition, 'utf8'), 'Edition: Source: fixture-27\n');
    assert.equal((await state()).state, 'verified files');
    assert.ok((await L.desk()).reports.some((p) => p.title === 'Edition'));

    // Today's writer fails while yesterday's wire stays byte-for-byte intact.
    await L.updateJob(writer.id, { instructions: 'Say it is done.' });
    const failedWriter = await result(writer, await due(writer.id));
    assert.equal(failedWriter.status, 'failed');
    assert.equal((await state()).state, 'blocked');
    assert.equal((await state()).lastVerified?.inputRun, w.id);
    const stale = await result(reader, await due(reader.id));
    assert.match(stale.summary, /"Wire" ran for .* and left no checked lead\/wire.md/);
    assert.equal(stale.checked_files.sha256, undefined);
    assert.equal(readFileSync(edition, 'utf8'), 'Edition: Source: fixture-27\n');
    await L.updateJob(writer.id, { instructions: 'Write the wire.' });
    assert.equal((await result(writer, await due(writer.id))).status, 'done');
    await L.updateJob(reader.id, { instructions: 'Say it is done.' });
    const empty = await result(reader, await due(reader.id));
    assert.equal(empty.status, 'failed');
    assert.equal(empty.checked_files.sha256, undefined);
    assert.match(empty.summary, /did not leave a checked result/);
    assert.equal((await state()).state, 'blocked');
    await L.updateJob(reader.id, {
      files: { thread, input: 'lead/wire.md', output: 'edition.md', sources: ['web'] }
    });
    await setOwn('lead', { web: true });
    await setOwn('paige', { web: false });
    const signed = join(L.accountHome('claude', 'office'), 'signed-in');
    unlinkSync(signed);
    const preview = await review(reader.id);
    assert.match(preview.blocks.join('\n'), /Browse the web/);
    assert.match(preview.blocks.join('\n'), /Sign in/);
    const blocked = await result(reader, await due(reader.id));
    assert.equal(blocked.status, 'failed');
    assert.match(blocked.summary, /Paige.*Browse the web/);
    assert.match(blocked.summary, /Paige.*Sign in/);
    assert.match(blocked.summary, /Lena.*Sign in/);
    assert.match(blocked.summary, /permission to include material from web/);
    assert.doesNotMatch(blocked.summary, /Sam needs/);
    await result(reader, await due(reader.id));
    assert.equal((await L.desk()).reports.filter((p) => p.body === blocked.summary).length, 1);
    const counts = await L.pg`select count(*)::int as n from runs where job_id = ${reader.id}`;
    assert.equal(counts[0].n, 6);
    assert.equal((await L.desk()).asks.length, 0);
    writeFileSync(signed, 'fixture@example.test');
    await L.pg`update staff set agent = 'gemini' where id = 'paige'`;
    const native = await result(reader, await due(reader.id));
    assert.match(native.summary, /Paige needs the office file tools/);
    assert.equal(native.checked_files.sha256, undefined);
    await L.pg`update staff set agent = 'claude' where id = 'paige'`;
    const g = (await L.pg`insert into goals (title) values ('Another edition') returning id`)[0].id;
    await L.pg`update threads set goal_id = ${g} where id = ${thread}`;
    await L.serveGoal('paige', g, 'Read the wire.');
    await L.pg`delete from staff_goals where staff_id = 'paige' and goal_id = ${g}`;
    assert.match((await review(reader.id)).blocks.join('\n'), /Paige has no current assignment/);
    await L.pg`update threads set status = 'stopped', ended_at = now() where id = ${thread}`;
    const ended = await result(reader, await due(reader.id));
    assert.match(ended.summary, /still open/);
    assert.equal(ended.checked_files.sha256, undefined);
  } finally {
    stop();
  }
});
