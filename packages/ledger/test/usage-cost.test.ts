// Explicit unknown cost keeps measured tokens and never becomes a free or complete total.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { staff, usage } from '../src/schema.ts';
import { db, sql } from './pglite.ts';

process.env.OFFICE_TIME_ZONE = 'UTC';
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { recordUsage, usageFor } = await import('../src/office.ts');
const ids = ['usage-records', 'usage-known', 'usage-unknown', 'usage-mixed', 'usage-empty'];
await db.insert(staff).values(
  ids.map((id) => ({
    id,
    name: id,
    role: 'Tester',
    remit: 'Test usage.',
    variant: 'a',
    portrait: 'a',
    desk: 'Test usage.'
  }))
);

test('0013 to 0014 preserves upstream schema and data, historical costs and the missing-value default', async () => {
  const migrations = fileURLToPath(new URL('../migrations', import.meta.url));
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
  const previous = journal.entries.filter((entry: { idx: number }) => entry.idx <= 13);
  assert.equal(previous.at(-1)?.tag, '0013_calls');
  const folder = mkdtempSync(join(tmpdir(), 'oddboro-usage-migration-'));
  const old = await PGlite.create({ extensions: { vector } });
  try {
    // Run the real upstream chain first, then let the normal migrator find only 0014.
    mkdirSync(join(folder, 'meta'));
    writeFileSync(
      join(folder, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: previous })
    );
    for (const entry of previous)
      copyFileSync(join(migrations, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    await old.exec('create extension if not exists vector');
    const oldDb = drizzle(old, { casing: 'snake_case' });
    await migrate(oldDb, { migrationsFolder: folder });
    await oldDb.insert(staff).values({
      id: 'migration-fixture',
      name: 'Tester',
      role: 'Tester',
      remit: 'Test migrations.',
      variant: 'a',
      portrait: 'a',
      desk: 'Test migrations.'
    });
    await old.exec(
      `insert into usage (kind, model, input_tokens, cost_usd) values
         ('chat', 'historical-zero', 3, 0), ('chat', 'historical-positive', 5, 2.75);
       insert into asks (staff_id, title, why, if_approved, reply, filter, folder, call, via)
       values ('migration-fixture', 'Migration fixture', 'Keep upstream fields.', 'No external action.',
         '{"fixture":"reply"}', '{"fixture":"filter"}', '{"fixture":"folder"}',
         '{"fixture":"call"}', 'fixture-colleague')`
    );
    await assert.rejects(
      old.exec("insert into usage (kind, model, cost_usd) values ('chat', 'rejected', null)"),
      /not-null constraint/
    );
    const columns = () =>
      old.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: 'YES' | 'NO';
        column_default: string | null;
        is_generated: 'ALWAYS' | 'NEVER';
        generation_expression: string | null;
      }>(`select table_name, column_name, data_type, is_nullable, column_default,
                        is_generated, generation_expression
                   from information_schema.columns where table_schema = 'public'
                   order by table_name, ordinal_position`);
    const beforeColumns = (await columns()).rows;
    const tables = await old.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
    );
    const contents = async () =>
      Promise.all(
        tables.rows.map(async ({ table_name }) => {
          assert.match(table_name, /^[a-z_]+$/);
          return [
            table_name,
            (
              await old.query(
                `select to_jsonb(t) as row from "${table_name}" t order by to_jsonb(t)::text`
              )
            ).rows
          ];
        })
      );
    const before = await contents();
    await migrate(oldDb, { migrationsFolder: migrations });
    assert.deepEqual(await contents(), before);
    assert.deepEqual(
      (await columns()).rows,
      beforeColumns.map((column) =>
        column.table_name === 'usage' && column.column_name === 'cost_usd'
          ? { ...column, is_nullable: 'YES' }
          : column
      )
    );
    await old.exec(
      "insert into usage (kind, model, cost_usd) values ('chat', 'unknown', null); insert into usage (kind, model) values ('chat', 'legacy-default')"
    );
    assert.deepEqual((await old.query('select cost_usd from usage order by id')).rows, [
      { cost_usd: 0 },
      { cost_usd: 2.75 },
      { cost_usd: null },
      { cost_usd: 0 }
    ]);
  } finally {
    await old.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('recordUsage distinguishes explicit unknown, real zero, positive and omitted cost without dropping token records', async () => {
  await recordUsage('usage-records', 'chat', {
    unknown: {
      inputTokens: 2,
      outputTokens: 3,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 7,
      costUSD: null
    },
    zero: { inputTokens: 11, outputTokens: 13, costUSD: 0 },
    positive: { inputTokens: 17, outputTokens: 19, costUSD: 2.75 },
    omitted: { inputTokens: 23, outputTokens: 29 }
  });
  const rows = await db.select().from(usage).where(eq(usage.staffId, 'usage-records'));
  assert.equal(rows.length, 4);
  const byModel = new Map(rows.map((row) => [row.model, row]));
  assert.equal(byModel.get('unknown')?.costUsd, null);
  assert.equal(byModel.get('unknown')?.tokens, 17);
  assert.equal(byModel.get('zero')?.costUsd, 0);
  assert.equal(byModel.get('positive')?.costUsd, 2.75);
  assert.equal(byModel.get('omitted')?.costUsd, 0);
  assert.equal(
    rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
    129
  );
});

test('fully reported totals retain known zero and positive costs', async () => {
  await recordUsage('usage-known', 'chat', { zero: { inputTokens: 1, costUSD: 0 } });
  const zero = await usageFor('usage-known');
  assert.equal(zero.totals.d1.costUsd, 0);
  assert.equal(zero.totals.d1.knownCostUsd, 0);
  assert.equal(zero.totals.d1.knownCostRows, 1);
  assert.equal(zero.totals.d1.unknownCostRows, 0);
  await recordUsage('usage-known', 'chat', { positive: { outputTokens: 2, costUSD: 2.75 } });
  const known = await usageFor('usage-known');
  for (const total of Object.values(known.totals)) {
    assert.equal(total.costUsd, 2.75);
    assert.equal(total.knownCostUsd, 2.75);
    assert.equal(total.knownCostRows, 2);
    assert.equal(total.unknownCostRows, 0);
    assert.equal(total.tokens, 3);
  }
});

test('all-unknown totals remain unknown while token totals and bars stay measured', async () => {
  await recordUsage('usage-unknown', 'chat', {
    unpriced: {
      inputTokens: 2,
      outputTokens: 3,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 7,
      costUSD: null
    }
  });
  const result = await usageFor('usage-unknown');
  for (const total of Object.values(result.totals)) {
    assert.equal(total.costUsd, null);
    assert.equal(total.knownCostUsd, 0);
    assert.equal(total.knownCostRows, 0);
    assert.equal(total.unknownCostRows, 1);
    assert.equal(total.tokens, 17);
    assert.equal(total.output, 3);
  }
  assert.equal(
    result.series.d1.reduce((sum, bucket) => sum + bucket.tokens, 0),
    17
  );
  assert.equal(
    result.series.d1.reduce((sum, bucket) => sum + bucket.output, 0),
    3
  );
  assert.equal(JSON.parse(JSON.stringify(result)).totals.d1.costUsd, null);
});

test('mixed periods return unknown complete totals and an explicitly partial known subtotal', async () => {
  await recordUsage('usage-mixed', 'chat', {
    known: { inputTokens: 10, outputTokens: 2, costUSD: 1.25 },
    zero: { inputTokens: 3, outputTokens: 1, costUSD: 0 },
    unknown: { inputTokens: 5, outputTokens: 7, costUSD: null },
    old: { inputTokens: 100, costUSD: null }
  });
  await sql`update usage set created_at = now() - interval '2 days' where staff_id = 'usage-mixed' and model = 'unknown'`;
  await sql`update usage set created_at = now() - interval '40 days' where staff_id = 'usage-mixed' and model = 'old'`;
  const result = await usageFor('usage-mixed');
  assert.equal(result.totals.d1.costUsd, 1.25);
  assert.equal(result.totals.d1.tokens, 16);
  assert.equal(result.totals.d1.unknownCostRows, 0);
  for (const total of [result.totals.d7, result.totals.d30]) {
    assert.equal(total.costUsd, null);
    assert.equal(total.knownCostUsd, 1.25);
    assert.equal(total.knownCostRows, 2);
    assert.equal(total.unknownCostRows, 1);
    assert.equal(total.tokens, 28);
    assert.equal(total.output, 10);
  }
});

test('an empty period remains empty rather than inventing unknown usage', async () => {
  const result = await usageFor('usage-empty');
  assert.deepEqual(result.totals.d1, {
    tokens: 0,
    output: 0,
    costUsd: 0,
    knownCostUsd: 0,
    knownCostRows: 0,
    unknownCostRows: 0,
    runs: 0
  });
});
