// A resumed session's tokens count once. Claude Code and Codex report a
// running total for the whole session, so each row keeps only its run's share:
// the office's own code on every migration, in an in-memory PGlite that stands
// in for db.ts (pglite.ts). Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { asc, eq } from 'drizzle-orm';
import { usage } from '../src/schema.ts';
import { db } from './pglite.ts';

const { recordUsage } = await import('../src/office-usage.ts');

const OPUS = 'claude-opus-5-5';
const HAIKU = 'claude-haiku-5-5';
/** A running total as Claude Code's result reports it. */
const total = (read: number, write: number, out = 3, cost = 0) => ({
  inputTokens: 2,
  outputTokens: out,
  cacheReadInputTokens: read,
  cacheCreationInputTokens: write,
  costUSD: cost
});

const rows = (session: string | null) =>
  db
    .select({
      model: usage.model,
      input: usage.inputTokens,
      output: usage.outputTokens,
      read: usage.cacheReadTokens,
      write: usage.cacheWriteTokens,
      tokens: usage.tokens
    })
    .from(usage)
    .where(session === null ? undefined : eq(usage.session, session))
    .orderBy(asc(usage.id));

beforeEach(async () => {
  await db.delete(usage);
});

test("each run of a resumed session keeps its own share, so the session's tokens add up to its last total", async () => {
  // Three runs of one chat, as measured from Claude Code 2.1.327.
  await recordUsage(null, 'chat', { [OPUS]: total(649, 3120) }, 's1');
  await recordUsage(null, 'chat', { [OPUS]: total(4011, 3564, 6) }, 's1');
  await recordUsage(null, 'chat', { [OPUS]: total(7792, 3626, 9) }, 's1');
  assert.deepEqual(
    (await rows('s1')).map((r) => [r.read, r.write, r.output]),
    [
      [649, 3120, 3],
      [3362, 444, 3],
      [3781, 62, 3]
    ]
  );
  const sum = (await rows('s1')).reduce((n, r) => n + (r.tokens ?? 0), 0);
  assert.equal(sum, 2 + 9 + 7792 + 3626, 'the session counts its last total once');
});

test('two totals for one session, recorded at once, still count once', async () => {
  await Promise.all([
    recordUsage(null, 'chat', { [OPUS]: total(1000, 500) }, 's2'),
    recordUsage(null, 'chat', { [OPUS]: total(2500, 600, 6) }, 's2')
  ]);
  assert.deepEqual(
    (await rows('s2')).map((r) => [r.read, r.write]),
    [
      [1000, 500],
      [1500, 100]
    ]
  );
});

test('a total below what the session counted is a fresh count, kept whole', async () => {
  await recordUsage(null, 'chat', { [OPUS]: total(5000, 4000) }, 's3');
  await recordUsage(null, 'chat', { [OPUS]: total(800, 300) }, 's3');
  assert.deepEqual(
    (await rows('s3')).map((r) => [r.read, r.write]),
    [
      [5000, 4000],
      [800, 300]
    ]
  );
});

test('a model only an earlier run used adds no row, and a new one counts whole', async () => {
  await recordUsage(null, 'chat', { [OPUS]: total(100, 50), [HAIKU]: total(10, 5) }, 's4');
  await recordUsage(null, 'chat', { [OPUS]: total(300, 60, 6), [HAIKU]: total(10, 5) }, 's4');
  await recordUsage(
    null,
    'chat',
    { [OPUS]: total(500, 70, 9), [HAIKU]: total(10, 5), x: total(7, 1) },
    's4'
  );
  assert.deepEqual(
    (await rows('s4')).map((r) => [r.model, r.read]),
    [
      [OPUS, 100],
      [HAIKU, 10],
      [OPUS, 200],
      [OPUS, 200],
      ['x', 7]
    ]
  );
});

test('usage with no session is kept as it came', async () => {
  await recordUsage(null, 'job', { [OPUS]: total(900, 100) });
  await recordUsage(null, 'job', { [OPUS]: total(900, 100) });
  assert.deepEqual(
    (await rows(null)).map((r) => [r.read, r.write]),
    [
      [900, 100],
      [900, 100]
    ]
  );
});
