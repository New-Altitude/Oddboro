// The office report fits one tool result however big the office grows
// (#201): a small office gets it whole, a big one gets each Odd in brief,
// then one Odd in full, its runs in pages. office_report runs in the office
// tool server (src/mcp.ts) in a process of its own, over the office's own
// database in a throwaway folder (tool-server.ts). Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db, toolServer } from './tool-server.ts';

const { jobs, runs, staff } = await import('../src/schema.ts');
const { REPORT_CHARS } = await import('../src/office-report.ts');

// Every await comes before the first test: the database closes once the tests end.
const person = (id: string, tools: string[] = []) => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  desk: `You are ${id}.`,
  tools
});
const odds = ['ada', 'bo', 'cy', 'di', 'ed', 'flo', 'gus', 'hal'];
await db.insert(staff).values([person('mona', ['office_report']), ...odds.map((id) => person(id))]);
// Each Odd runs one job every hour for three days, each run with a full summary.
const made = await db
  .insert(jobs)
  .values(
    odds.map((id) => ({
      staffId: id,
      name: `Hourly check for ${id}`,
      instructions: 'Check.',
      schedule: { every: 'minutes' as const, n: 60 },
      nextRunAt: new Date(Date.now() + 3_600_000)
    }))
  )
  .returning({ id: jobs.id, staffId: jobs.staffId });
const now = Date.now();
await db.insert(runs).values(
  made.flatMap((j) =>
    Array.from({ length: 72 }, (_, h) => ({
      jobId: j.id,
      staffId: j.staffId,
      status: h === 5 ? ('failed' as const) : ('done' as const),
      summary: `Run ${h}: `.padEnd(600, 'checked everything and found it in order. '),
      startedAt: new Date(now - (72 - h) * 3_600_000 + 60_000)
    }))
  )
);
const mona = await toolServer('mona', { RUN_KEY: 'k-office-report' });

/** The report part one call returns, with its size in characters. */
async function report(args: Record<string, unknown>) {
  const r = await mona.callTool({ name: 'office_report', arguments: args });
  const text = (r.content as { type: string; text: string }[])[0]?.text ?? '';
  assert.ok(text.length <= REPORT_CHARS, `${text.length} characters is past the limit`);
  return JSON.parse(text) as Record<string, unknown> & {
    staff: { id: string; runs: unknown; failedJobs?: Record<string, number> }[];
    parts?: string;
    page?: { n: number; of: number; note: string };
  };
}

test('a big office over 72 hours comes as each Odd in brief, every Odd in one call', async () => {
  const brief = await report({ hours: 72 });
  assert.match(brief.parts ?? '', /call office_report again with the same hours and odd/);
  assert.deepEqual(brief.staff.map((s) => s.id).sort(), ['mona', ...odds].sort());
  const ada = brief.staff.find((s) => s.id === 'ada')!;
  assert.deepEqual(ada.runs, { done: 71, failed: 1, running: 0 });
  assert.deepEqual(ada.failedJobs, { 'Hourly check for ada': 1 });
});

test("one Odd's part comes in full, its 72 runs in pages, oldest first, with none lost", async () => {
  const first = await report({ hours: 72, odd: 'ada' });
  assert.equal(first.staff.length, 1);
  assert.ok(first.page && first.page.of > 1, 'its runs fill more than one page');
  assert.match(first.page.note, /page 2/);
  const seen: string[] = [];
  for (let n = 1; n <= first.page.of; n++) {
    const part = n === 1 ? first : await report({ hours: 72, odd: 'ada', page: n });
    seen.push(...(part.staff[0].runs as { summary: string }[]).map((r) => r.summary.split(':')[0]));
  }
  assert.deepEqual(
    seen,
    Array.from({ length: 72 }, (_, h) => `Run ${h}`)
  );
  assert.match(
    (await report({ hours: 72, odd: 'ada', page: first.page.of })).page!.note,
    /last page/
  );
});

test('a small window still comes whole, as before', async () => {
  const whole = await report({ hours: 1 });
  assert.equal(whole.parts, undefined);
  assert.ok(Array.isArray(whole.staff.find((s) => s.id === 'ada')!.runs));
});

test('an id that is no Odd here names the ids there are', async () => {
  const r = await mona.callTool({ name: 'office_report', arguments: { odd: 'zed' } });
  assert.match((r.content as { text: string }[])[0].text, /No Odd "zed".*ada/);
});
