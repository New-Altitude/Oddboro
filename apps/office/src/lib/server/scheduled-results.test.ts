import type { RunRow } from '@oddboro/ledger';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { L, secrets } from './office-under-test.ts';
import { resultFixture } from './scheduled-result-under-test.ts';
const { checkScheduledResults } = await import('./scheduled-results.ts');
const { POST } = await import('../../routes/api/scheduled-results/+server.ts');
process.env.ODDBORO_GOOGLE_CLIENT_SECRET = 'synthetic-client-secret';
secrets.set(
  'gmail:oauth',
  JSON.stringify({
    tokens: { access_token: 'synthetic-access', expires_in: 3600 },
    savedAt: Date.now()
  })
);
mkdirSync(L.accountHome('claude', 'office'), { recursive: true });
writeFileSync(join(L.accountHome('claude', 'office'), 'signed-in'), 'test@example.test');
await L.pg`insert into grants (staff_id,connector_id,level) values ('paige','gmail','act') on conflict (staff_id,connector_id) do update set level='act'`;
await L.pg`update staff set permission='act' where id='paige'`;
const original = globalThis.fetch;
let sends = 0,
  lookups = 0,
  mode: 'accept' | 'timeout' | 'unknown' | 'rate' = 'accept',
  mime = '';
globalThis.fetch = (async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith('https://gmail.googleapis.com/'))
    throw new Error('Unexpected outbound request: ' + url);
  if (url.endsWith('/messages/send')) {
    sends++;
    mime = Buffer.from(JSON.parse(String(init?.body)).raw, 'base64url').toString();
    if (mode === 'timeout' || mode === 'unknown')
      throw new TypeError('Connection lost after submission');
    if (mode === 'rate') return Response.json({ error: { message: 'busy' } }, { status: 429 });
    return Response.json({ id: 'receipt-' + sends });
  }
  assert.match(url, /labelIds=SENT/);
  assert.match(decodeURIComponent(url), /rfc822msgid:<[a-f0-9-]+@oddboro.local>/);
  lookups++;
  return Response.json({ messages: mode === 'unknown' ? [] : [{ id: 'confirmed-after-timeout' }] });
}) as typeof fetch;
after(() => {
  globalThis.fetch = original;
});
const check = (now = new Date()) =>
  checkScheduledResults(() => assert.fail('No recovery expected'), now);
const quiet = async () => {
  await L.pg`update scheduled_results set enabled=false`;
};

test('saved and reviewed bytes reach the Desk and Gmail once across duplicate clock checks', async () => {
  const f = await resultFixture({ kind: 'gmail', connector: 'gmail', to: 'reader@example.test' });
  await Promise.all([check(), check()]);
  const e = await f.edition();
  assert.equal(e.delivery, 'accepted');
  assert.ok(e.evidence.savedAt);
  assert.ok(e.evidence.reviewedAt);
  assert.ok(e.deskAt);
  assert.ok(e.receipt);
  assert.equal(e.evidence.sha256, f.sha);
  assert.match(mime, /Message-ID: <[a-f0-9-]+@oddboro.local>/);
  assert.match(mime, /To: reader@example.test/);
  const count = sends;
  await check();
  assert.equal(sends, count);
  assert.equal((await L.editionsFor(f.plan.id)).length, 1);
  assert.equal((await L.job(f.producer.id))!.id, f.producer.id);
  await quiet();
});
test('timeout after acceptance is reconciled from Sent mail without a second send', async () => {
  mode = 'timeout';
  const f = await resultFixture({ kind: 'gmail', connector: 'gmail', to: 'reader@example.test' });
  const before = sends;
  await check();
  assert.equal((await f.edition()).delivery, 'uncertain');
  await check(new Date(Date.now() + 31000));
  assert.equal((await f.edition()).delivery, 'accepted');
  assert.equal(sends, before + 1);
  assert.ok(lookups);
  await quiet();
});
test('unknown delivery survives restart, uses two lookups and never resends', async () => {
  mode = 'unknown';
  const f = await resultFixture({ kind: 'gmail', connector: 'gmail', to: 'reader@example.test' });
  const before = sends,
    reads = lookups;
  await check();
  await L.pg`update result_editions set delivery='sending' where result_id=${f.plan.id}`;
  await check(new Date(Date.now() + 31000));
  await check(new Date(Date.now() + 92000));
  await check(new Date(Date.now() + 153000));
  assert.equal((await f.edition()).delivery, 'uncertain');
  assert.equal(sends, before + 1);
  assert.equal(lookups, reads + 2);
  const [{ n }] =
    await L.pg`select count(*)::int as n from reports where id=(select incident_id from scheduled_results where id=${f.plan.id})`;
  assert.equal(n, 1);
  await quiet();
});
test('Draft approves exact frozen bytes and revoked grants prevent delivery', async () => {
  mode = 'accept';
  await L.pg`update staff set permission='draft' where id='paige'`;
  const f = await resultFixture({ kind: 'gmail', connector: 'gmail', to: 'reader@example.test' });
  const before = sends;
  await check();
  const e = await f.edition();
  assert.equal(e.delivery, 'ready');
  assert.equal(sends, before);
  await assert.rejects(() => L.approveResultEdition(e.id, 'wrong'), /changed/);
  await L.approveResultEdition(e.id, e.evidence.payload!.hash);
  await L.pg`update grants set level='read' where staff_id='paige' and connector_id='gmail'`;
  await check();
  assert.equal(sends, before);
  await L.pg`update grants set level='act' where staff_id='paige' and connector_id='gmail'`;
  await check();
  assert.equal(sends, before + 1);
  await L.pg`update staff set permission='act' where id='paige'`;
  await quiet();
});
test('stale output cannot become a reviewed message; slow work is not duplicated', async () => {
  const f = await resultFixture();
  writeFileSync(f.path, 'Changed after review');
  await check();
  assert.equal((await f.edition()).deskAt, null);
  assert.match((await f.edition()).reason!, /changed after review/);
  await quiet();
  const slow = await resultFixture({ kind: 'desk' }, false);
  const r = await L.startRun(slow.producer, 'schedule');
  await L.pg`update result_editions set deadline=now()-interval '1 minute' where result_id=${slow.plan.id}`;
  await check();
  assert.match((await slow.edition()).reason!, /still running/);
  assert.equal((await slow.edition()).attempts, 0);
  await L.finishRun(r, slow.producer, false, 'Stopped for test');
  await quiet();
});
test('recovery shares the original jobs, is bounded, and an unchanged review stops', async () => {
  const f = await resultFixture({ kind: 'desk' }, false);
  await f.produce(false);
  const repairs: RunRow[] = [];
  const recover = () =>
    checkScheduledResults((j, r) => {
      assert.equal(j.id, f.producer.id);
      repairs.push(r);
    });
  await Promise.all([recover(), recover()]);
  assert.equal(repairs.length, 1);
  await L.finishRun(repairs[0], f.producer, false, 'Still failed');
  await recover();
  assert.equal(repairs.length, 2);
  await L.finishRun(repairs[1], f.producer, false, 'Still failed');
  await recover();
  assert.equal(repairs.length, 2);
  assert.match((await f.edition()).reason!, /allowance/);
  await quiet();
  const r = await resultFixture({ kind: 'desk' }, false);
  const p = await r.produce();
  await r.review(p.id, false);
  let attempt: RunRow | undefined;
  await checkScheduledResults((j, run) => {
    assert.equal(j.id, r.reviewer.id);
    attempt = run;
  });
  assert.ok(attempt);
  await L.finishRun(attempt, r.reviewer, false, 'No changed review');
  await check();
  assert.match((await r.edition()).reason!, /unchanged/);
  await quiet();
});
test('missing sign-in produces one incident and consumes no recovery allowance', async () => {
  const f = await resultFixture({ kind: 'desk' }, false);
  await f.produce(false);
  const { unlinkSync } = await import('node:fs');
  unlinkSync(join(L.accountHome('claude', 'office'), 'signed-in'));
  await check();
  await check();
  assert.equal((await f.edition()).attempts, 0);
  assert.match((await f.edition()).reason!, /Sign in/);
  writeFileSync(join(L.accountHome('claude', 'office'), 'signed-in'), 'test@example.test');
  await quiet();
});
test('missed editions and runtime gaps remain visible after catch-up', async () => {
  const f = await resultFixture();
  const yesterday = new Date(Date.now() - 86400000);
  await L.pg`update scheduled_results set last_day=null,created_at=${yesterday.toISOString()} where id=${f.plan.id}`;
  L.startClockEvidence(Date.now() - 120000);
  L.checkedClock(Date.now() - 120000, Date.now() - 100000);
  L.checkedClock(Date.now(), Date.now() + 600000);
  await check();
  const editions = await L.editionsFor(f.plan.id);
  assert.equal(editions.length, 2);
  assert.match(editions[1].reason!, /Missed edition/);
  assert.ok(editions[0].evidence.gaps.length);
  assert.match(editions[0].evidence.payload!.body, /does not establish research coverage/);
  await quiet();
});
test('the owner route rejects extra keys, and job edits hold a frozen edition', async () => {
  const f = await resultFixture({ kind: 'gmail', connector: 'gmail', to: 'reader@example.test' });
  await L.pg`update staff set permission='draft' where id='paige'`;
  await check();
  const before = sends,
    e = await f.edition();
  await L.approveResultEdition(e.id, e.evidence.payload!.hash);
  await L.updateJob(f.reviewer.id, { instructions: 'Changed instructions' });
  await check();
  assert.equal(sends, before);
  assert.match((await f.edition()).reason!, /jobs changed/);
  await assert.rejects(async () =>
    POST({
      request: new Request('http://office/api/scheduled-results', {
        method: 'POST',
        body: JSON.stringify({ op: 'save', plan: { ...f.input, unexpected: true } })
      })
    } as Parameters<typeof POST>[0])
  );
  await quiet();
});

test('an explicit rate rejection permits one retry, while Read never sends', async () => {
  mode = 'rate';
  await L.pg`update staff set permission='act' where id='paige'`;
  const f = await resultFixture({ kind: 'gmail', connector: 'gmail', to: 'reader@example.test' });
  const before = sends;
  await check();
  assert.equal((await f.edition()).delivery, 'ready');
  mode = 'accept';
  await check(new Date(Date.now() + 61000));
  assert.equal((await f.edition()).delivery, 'accepted');
  assert.equal(sends, before + 2);
  await quiet();
  await L.pg`update staff set permission='read' where id='paige'`;
  const read = await resultFixture({
    kind: 'gmail',
    connector: 'gmail',
    to: 'reader@example.test'
  });
  const count = sends;
  await check();
  const e = await read.edition();
  await L.approveResultEdition(e.id, e.evidence.payload!.hash);
  await check();
  assert.equal(sends, count);
  assert.match((await read.edition()).reason!, /at Read/);
  await L.pg`update staff set permission='act' where id='paige'`;
  await quiet();
});

test('an expired account reuses its existing reconnect task', async () => {
  const f = await resultFixture({ kind: 'gmail', connector: 'gmail', to: 'reader@example.test' });
  const saved = secrets.get('gmail:oauth')!;
  secrets.delete('gmail:oauth');
  await check();
  await check();
  const tasks = (await L.desk()).tasks.filter(
    (t) =>
      t.status === 'open' &&
      t.steps.some((s) => s.action && 'connector' in s.action && s.action.connector === 'gmail')
  );
  assert.equal(tasks.length, 1);
  assert.equal((await f.edition()).sendAttempts, 0);
  secrets.set('gmail:oauth', saved);
  await quiet();
});

test('the same 6:30 deadline follows Pacific daylight saving time', () => {
  assert.equal(
    L.resultInstant('2026-03-07', '06:30', 'America/Los_Angeles').toISOString(),
    '2026-03-07T14:30:00.000Z'
  );
  assert.equal(
    L.resultInstant('2026-03-08', '06:30', 'America/Los_Angeles').toISOString(),
    '2026-03-08T13:30:00.000Z'
  );
  assert.equal(
    L.resultInstant('2026-11-01', '06:30', 'America/Los_Angeles').toISOString(),
    '2026-11-01T14:30:00.000Z'
  );
});
