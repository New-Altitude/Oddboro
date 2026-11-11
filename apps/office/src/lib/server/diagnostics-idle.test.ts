// Hard rule 13 for reports: once a request and an error have been sent, an
// office with reports on keeps no more timers running than one without. Each
// office is a child process that counts its timers from the start
// (`diagnostics-idle-timers.ts`). Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { recorder, tempOffice } from './diagnostics-harness.ts';

const door = await recorder();
const { folder } = tempOffice('diagnostics-idle');

after(() => {
  door.close();
  rmSync(folder, { recursive: true, force: true });
});

const file = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const TIMERS = file('./diagnostics-idle-timers.ts');

// One traced request and one error, 7 s for the SDK's 5 s span flush, then a
// 15 s idle window: the intervals still running, and the timeouts made in it.
const office = `
const { timers } = await import(${JSON.stringify(TIMERS)});
await import(${JSON.stringify(file('../../instrumentation.server.ts'))});
const { sender, throwing, traceHeader } = await import(${JSON.stringify(file('./diagnostics-harness.ts'))});
const hooks = await import(${JSON.stringify(file('../../hooks.server.ts'))});
const send = sender(hooks.handle);
await send({ route: '/api/ledger', headers: { 'sentry-trace': traceHeader() } });
await send({ route: '/api/goals', resolve: throwing(() => new Error('T13 idle')) });
await new Promise((r) => setTimeout(r, 7000));
const before = timers().timeouts;
await new Promise((r) => setTimeout(r, 15000));
const now = timers();
console.log('TIMERS ' + JSON.stringify({ intervals: now.intervals, timeouts: now.timeouts - before }));
process.exit(0);
`;

type Count = { intervals: number; timeouts: number };

/** Start an office with these settings, and read its count once it has been idle. */
function idle(env: Record<string, string>): Promise<Count> {
  return new Promise((done, fail) => {
    // Not execFileSync: the door runs in this process and must answer the child.
    execFile(
      process.execPath,
      ['--import', TIMERS, '--input-type=module', '-e', office],
      { env: { ...process.env, ...env }, timeout: 60_000 },
      (error, stdout) => {
        const line = stdout.split('\n').find((l) => l.startsWith('TIMERS '));
        if (error || !line) fail(error ?? new Error(`no count in: ${stdout}`));
        else done(JSON.parse(line.slice('TIMERS '.length)));
      }
    );
  });
}

test('an idle office keeps no recurring timer, with or without reports', async () => {
  const [without, withReports] = await Promise.all([
    idle({}),
    idle({
      ODDBORO_DIAGNOSTICS_DSN: `http://oddboro@127.0.0.1:${door.port}/oddboro/0`,
      OFFICE_DIAGNOSTICS: 'yes'
    })
  ]);
  // The office with reports did report, so its SDK was running.
  assert.ok(door.got.length > 0);
  assert.equal(withReports.intervals, without.intervals);
  assert.ok(
    withReports.timeouts <= without.timeouts,
    `${withReports.timeouts} timeouts against ${without.timeouts}`
  );
});
