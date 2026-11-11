// LIVE_TABLES held to the database: each table's change trigger is the one its
// row names, on every migration, in an in-memory PGlite (pglite.ts). Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/schema.ts';
import { LIVE_TABLES, type LiveTable } from '../src/live-tables.ts';
import { sql } from './pglite.ts';

// pg_trigger.tgtype's bits for the events a trigger fires on.
const INSERT = 4;
const DELETE = 8;
const UPDATE = 16;

/** The `trigger` a row would name for the office_notify trigger the database holds on each table. */
async function triggers(): Promise<Map<string, LiveTable['trigger']>> {
  const rows = await sql<{ table: string; type: number }>`
    SELECT c.relname AS "table", t.tgtype AS "type"
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE p.proname = 'office_notify' AND NOT t.tgisinternal`;
  return new Map(
    rows.map(({ table, type }) => {
      const on = (bit: number) => (type & bit) !== 0;
      const fires =
        on(INSERT) && on(DELETE) && on(UPDATE) ? 'all' : on(UPDATE) ? 'update' : 'other';
      assert.ok(fires !== 'other', `${table}'s trigger fires on neither every change nor updates`);
      return [table, fires] as const;
    })
  );
}

test('every table has the change trigger its row says, and a table with none says why', async () => {
  const found = await triggers();
  for (const [table, { trigger }] of Object.entries(LIVE_TABLES)) {
    if (typeof trigger === 'object') {
      assert.equal(found.get(table), undefined, `${table} has a trigger its row says it has not`);
      assert.ok(trigger.none.trim().length > 0, `${table} has no trigger and does not say why`);
    } else assert.equal(found.get(table), trigger, table);
  }
  const unlisted = [...found.keys()].filter((t) => !(t in LIVE_TABLES));
  assert.deepEqual(unlisted, [], 'a trigger on a table the map does not name');
});

test('the map names every table in the schema and no other', async () => {
  const exported: unknown[] = Object.values(schema);
  const declared = exported.filter((x): x is PgTable => is(x, PgTable)).map((t) => getTableName(t));
  const inDatabase = await sql<{ name: string }>`
    SELECT table_name AS "name" FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const named = Object.keys(LIVE_TABLES).sort();
  assert.deepEqual(declared.sort(), named, 'the schema');
  assert.deepEqual(inDatabase.map((r) => r.name).sort(), named, 'the database');
});
