// A writer job and a reader job on one goal's thread, through the office
// clock with made-up times, as missed-runs.test.ts drives it. The reader takes
// the writer's file for the period it runs for, by the writer's run for that
// period, even when the bytes did not change. A writer still catching up makes
// the reader wait and run after it; a skipped writer makes it skip quietly; a
// writer that ran and wrote nothing makes the reader's run fail. The stand-in
// Claude Code makes the file calls each job's steps name, over the office's
// own file server. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { JobRow, MissedRuns, Schedule } from '@oddboro/ledger';
import { L, bin, gave } from './office-under-test.ts';

const { lookAtJobs, lineDone } = await import('./jobs.ts');
const { nextRun, setZone } = await import('@oddboro/ledger/time');

setZone('America/New_York');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

mkdirSync(L.accountHome('claude', 'office'), { recursive: true });
writeFileSync(join(L.accountHome('claude', 'office'), 'signed-in'), 'fixture@example.test');
// Job steps, one per run: `WRITE <path> "<text>"`, `COPY <from> TO <to>`
// (read one file, write "Copy of <its first line>" to the other) or `NOTHING`.
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
  const c = new Client({ name: 'periods-test', version: '1' });
  await c.connect(new StdioClientTransport(config.mcpServers.files));
  const call = (name, a) => c.callTool({ name, arguments: a });
  let message = ''; for await (const chunk of process.stdin) message += chunk;
  let said = 'Did nothing.';
  const write = /WRITE (\\S+) "([^"]*)"/.exec(message);
  const copy = /COPY (\\S+) TO (\\S+)/.exec(message);
  if (write) {
    const w = await call('write_file', { path: write[1], content: write[2] });
    said = w.isError ? 'Could not write.' : 'Wrote it.';
  } else if (copy) {
    const r = await call('read_file', { path: copy[1] });
    if (r.isError) said = 'Could not read: ' + r.content[0].text;
    else {
      const line = r.content[0].text.split('\\t')[1];
      const w = await call('write_file', { path: copy[2], content: 'Copy of ' + line });
      said = w.isError ? 'Could not write.' : 'Copied it.';
    }
  }
  await c.close();
  console.log(JSON.stringify({ type: 'result', subtype: 'success', result: said }));
})().catch((e) => { console.error(e); process.exitCode = 1; });
`
);
chmodSync(cli, 0o755);

type Run = {
  id: number;
  status: string;
  summary: string;
  started_at: Date;
  finished_at: Date | null;
  checked_files: {
    periods: string[];
    output: string;
    sha256?: string;
    input?: string;
    inputRun?: number;
  } | null;
};
const runsOf = (id: number) =>
  L.pg<Run[]>`select * from runs where job_id = ${id} and status <> 'running' order by id`;

/** A writer and a reader on a new piece of work, both due at `next`, with the steps given. */
async function pair(
  title: string,
  schedule: Schedule,
  missed: { writer: MissedRuns; reader: MissedRuns },
  next: Date,
  writes = 'Wire one'
) {
  const { thread } = await gave('lead', 'paige', { title });
  const wire = join(L.threadPart(thread, 'lead'), 'wire.md');
  const edition = join(L.threadPart(thread, 'paige'), 'edition.md');
  const add = (staffId: string, name: string, instructions: string, input?: string) =>
    L.addJob({
      staffId,
      name: `${name} (${title})`,
      instructions,
      schedule,
      missed: staffId === 'lead' ? missed.writer : missed.reader,
      files: { thread, output: input ? 'edition.md' : 'wire.md', ...(input ? { input } : {}) }
    });
  const writer = await add('lead', 'Wire', `WRITE ${wire} "${writes}"`);
  const reader = await add('paige', 'Edition', `COPY ${wire} TO ${edition}`, 'lead/wire.md');
  for (const j of [writer, reader]) await L.setNextRun(j.id, next);
  return { thread, wire, edition, writer, reader };
}

/**
 * The clock's look at `now`, then every run it started or put in line, to its
 * end: no run of these jobs going, and none of them owing a run.
 */
async function look(now: Date, ...jobs: JobRow[]): Promise<void> {
  await lookAtJobs(now);
  const ids = jobs.map((j) => j.id);
  for (let i = 0; i < 1000; i++) {
    await lineDone();
    const busy = await L.pg`
      select id from runs where status = 'running' and job_id in ${L.pg(ids)}
      union all select id from jobs where owed is not null and id in ${L.pg(ids)}`;
    if (!busy.length) return lineDone();
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('the runs never ended');
}

test("a reader takes its writer's file for its own period, even when the bytes did not change", async () => {
  const daily: Schedule = { every: 'day', at: '07:00' };
  const first = new Date(Date.now() - 5_000);
  const { writer, reader, edition } = await pair(
    'Same words',
    daily,
    { writer: 'latest', reader: 'latest' },
    first
  );
  await look(new Date(), writer, reader);
  const [w1] = await runsOf(writer.id);
  const [r1] = await runsOf(reader.id);
  assert.equal(w1.status, 'done', w1.summary);
  assert.equal(r1.status, 'done', r1.summary);
  assert.deepEqual(w1.checked_files?.periods, [first.toISOString()]);
  assert.equal(r1.checked_files?.inputRun, w1.id);

  // The next period: the writer writes the very same words.
  const second = new Date(Math.max(Date.now() - 2_000, first.getTime() + 1_000));
  for (const j of [writer, reader]) await L.setNextRun(j.id, second);
  await look(new Date(), writer, reader);
  const [, w2] = await runsOf(writer.id);
  const [, r2] = await runsOf(reader.id);
  assert.equal(w2.status, 'done', w2.summary);
  assert.equal(w2.checked_files?.sha256, w1.checked_files?.sha256);
  assert.deepEqual(w2.checked_files?.periods, [second.toISOString()]);
  assert.equal(r2.status, 'done', r2.summary);
  assert.equal(r2.checked_files?.inputRun, w2.id, "the reader took last period's run");
  assert.ok(r2.started_at >= w2.finished_at!, 'the reader ran before its writer finished');
  assert.equal(readFileSync(edition, 'utf8'), 'Copy of Wire one');
});

test('a writer catching up makes its reader wait, then both run in order', async () => {
  const daily: Schedule = { every: 'day', at: '07:00' };
  const now = new Date();
  // The Mac slept: the writer owes three days, and the reader is due now.
  const first = nextRun(daily, new Date(now.getTime() - 3 * DAY));
  const { writer, reader } = await pair(
    'Away three days',
    daily,
    { writer: 'record', reader: 'latest' },
    first
  );
  const due = new Date(now.getTime() - 5_000);
  await L.setNextRun(reader.id, due);
  await look(now, writer, reader);
  const [w] = await runsOf(writer.id);
  const [r] = await runsOf(reader.id);
  assert.equal(w.status, 'done', w.summary);
  assert.equal(r.status, 'done', r.summary);
  assert.ok(w.checked_files!.periods.length >= 3, JSON.stringify(w.checked_files));
  assert.deepEqual(r.checked_files?.periods, [due.toISOString()]);
  assert.equal(r.checked_files?.inputRun, w.id);
  assert.ok(r.started_at >= w.finished_at!, 'the reader ran before its writer caught up');
  assert.equal((await runsOf(reader.id)).length, 1, 'the reader failed or ran twice');
  assert.equal((await L.job(reader.id))!.owed, null);
  assert.equal(
    (await L.desk()).reports.filter((p) => p.title.startsWith('Blocked')).length,
    0,
    'a false alarm reached the desk'
  );
});

test('a writer that skipped its period makes its reader skip it quietly, on the While you were away card', async () => {
  const hourly: Schedule = { every: 'minutes', n: 60 };
  const now = new Date();
  // Its newest missed time is 45 minutes ago, past half its hour: a `latest` writer skips.
  const first = new Date(now.getTime() - 3 * HOUR - 45 * 60_000);
  const { writer, reader } = await pair(
    'Writer skipped',
    hourly,
    { writer: 'latest', reader: 'record' },
    first
  );
  await look(now, writer, reader);
  assert.equal((await runsOf(writer.id)).length, 0);
  assert.equal((await runsOf(reader.id)).length, 0, 'the reader ran without its file');
  assert.equal((await L.job(reader.id))!.owed, null);
  const away = (await L.desk()).away.map((j) => j.id);
  assert.ok(away.includes(writer.id) && away.includes(reader.id), away.join());
  assert.equal(
    (await L.desk()).reports.filter((p) => p.title.startsWith('Blocked')).length,
    0,
    'a false alarm reached the desk'
  );
});

test("a writer that ran and wrote nothing fails its reader's run", async () => {
  const daily: Schedule = { every: 'day', at: '07:00' };
  const { writer, reader, wire } = await pair(
    'Writer wrote nothing',
    daily,
    { writer: 'latest', reader: 'latest' },
    new Date(Date.now() - 5_000)
  );
  // Last period's file is still on disk: it must not pass as this period's.
  mkdirSync(join(wire, '..'), { recursive: true });
  writeFileSync(wire, 'Old wire');
  await L.updateJob(writer.id, { instructions: 'NOTHING' });
  await look(new Date(), writer, reader);
  const [w] = await runsOf(writer.id);
  const [r] = await runsOf(reader.id);
  assert.equal(w.status, 'failed');
  assert.match(w.summary, /did not leave a checked result/);
  assert.equal(w.checked_files?.sha256, undefined);
  assert.equal(w.checked_files?.periods.length, 1);
  assert.equal(r.status, 'failed');
  assert.match(
    r.summary,
    /"Wire \(Writer wrote nothing\)" ran for .* and left no checked lead\/wire.md/
  );
  assert.equal(r.checked_files?.sha256, undefined);
});
