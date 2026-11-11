// Helpers for a populated release upgrade. They start no app hooks or runners.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
const migrations = fileURLToPath(new URL('../migrations/', import.meta.url));
const release = JSON.parse(
  readFileSync(new URL('./fixtures/v0.0.10-migrations.json', import.meta.url), 'utf8')
) as {
  tag: string;
  hash: string;
  idx: number;
  when: number;
  version: string;
  breakpoints: boolean;
}[];
export const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export async function releaseDatabase(home: string) {
  const folder = join(home, 'release-migrations');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries: release })
  );
  for (const entry of release) {
    const source = join(migrations, entry.tag + '.sql');
    assert.equal(
      createHash('sha256').update(readFileSync(source)).digest('hex'),
      entry.hash,
      `${entry.tag}: an applied release migration changed`
    );
    cpSync(source, join(folder, entry.tag + '.sql'));
  }
  const client = await PGlite.create(join(home, 'db'), { extensions: { vector } });
  await client.exec('create extension if not exists vector');
  await migrate(drizzle(client), { migrationsFolder: folder });
  return client;
}
export type Rows = Record<string, Record<string, unknown>[]>;
export async function snapshot(client: PGlite): Promise<Rows> {
  const { rows } = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname='public' order by tablename"
  );
  return Object.fromEntries(
    await Promise.all(
      rows.map(async ({ tablename }) => [
        tablename,
        (
          await client.query<{ row: Record<string, unknown> }>(
            `select row_to_json(t) as row from ${quote(tablename)} t`
          )
        ).rows.map((r) => r.row)
      ])
    )
  );
}
/** Restore only into a new disposable release database, never a running office. */
export async function restore(client: PGlite, tables: Rows) {
  await client.transaction(async (tx) => {
    await tx.exec('set session_replication_role=replica');
    await tx.exec(
      'truncate ' + Object.keys(tables).map(quote).join(',') + ' restart identity cascade'
    );
    for (const [table, rows] of Object.entries(tables)) {
      if (!rows.length) continue;
      const { rows: columns } = await tx.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='public' and table_name=$1 and is_generated='NEVER' order by ordinal_position",
        [table]
      );
      const names = columns.map((c) => quote(c.column_name)).join(',');
      await tx.query(
        `insert into ${quote(table)} (${names}) overriding system value select ${names} from json_populate_recordset(null::${quote(table)}, $1::json)`,
        [JSON.stringify(rows)]
      );
    }
    await tx.exec('set session_replication_role=origin');
    const { rows: identities } = await tx.query<{ table_name: string; column_name: string }>(
      "select table_name,column_name from information_schema.columns where table_schema='public' and is_identity='YES'"
    );
    for (const c of identities)
      await tx.query(
        `select setval(pg_get_serial_sequence($1,$2),coalesce(max(${quote(c.column_name)}),1),count(*)>0) from ${quote(c.table_name)}`,
        [c.table_name, c.column_name]
      );
  });
}
const stable = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
export function sameReleasedRows(before: Rows, after: Rows) {
  for (const [table, rows] of Object.entries(before)) {
    assert.ok(after[table], `${table} was removed`);
    const columns = Object.keys(rows[0] ?? {});
    const project = (items: Record<string, unknown>[]) =>
      items.map((r) => stable(Object.fromEntries(columns.map((c) => [c, r[c]])))).sort();
    assert.deepEqual(project(after[table]), project(rows), `${table}: released rows changed`);
  }
}
export function fileHashes(folder: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const path = join(e.parentPath, e.name);
        return [
          path.slice(folder.length + 1),
          createHash('sha256').update(readFileSync(path)).digest('hex')
        ];
      })
  );
}
