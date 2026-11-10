// Brings the database up to date: pgvector, then every migration.
// `npm run db:migrate` runs it, and so does the office server on start.
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { moveToolHomes } from './accounts.ts';
import { db, sql } from './db.ts';
import { fixedError } from './errors.ts';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

export async function bringUpToDate(): Promise<void> {
  await sql`create extension if not exists vector`;
  await migrate(db, { migrationsFolder: MIGRATIONS });
  // The tools' one home each becomes their Office account (accounts.ts).
  await moveToolHomes();
}

// The last migration before the baseline, 0034_main-street, as drizzle
// recorded it: its journal time and the sha256 of its file.
const LAST_BEFORE_BASELINE = {
  when: 1793664941813,
  hash: '48f87b4ffc73aa68423f3d3a683480d3c9f03c6b551f313a2f9857c3f2f4bb3d'
};

/** Why the moved install's Google tasks and asks closed. */
const NO_GOOGLE = 'The office no longer connects Google.';

/**
 * For an install made before the baseline migration, and nothing else. The
 * old chain (0000 to 0034) leaves the schema `0000_baseline` builds plus the
 * Google connector's pieces, which the baseline left out. This takes those
 * out: the Google connector and its grants go, open tasks with a Google
 * sign-in step and open asks for Google close, access asks lose their account
 * list, and `grants.accounts` is dropped. Then it records the baseline as
 * applied without running it, the way drizzle records a migration it ran, all
 * in one transaction. The next bringUpToDate() skips the baseline and applies
 * only what comes after it. Bring the database to 0034 with the old chain
 * first. Returns false when the baseline is already recorded, and throws for
 * a database at any other point.
 */
export async function markBaseline(): Promise<boolean> {
  const [baseline] = readMigrationFiles({ migrationsFolder: MIGRATIONS });
  return sql.begin(async (tx) => {
    const [table] = await tx`select to_regclass('drizzle.__drizzle_migrations') as name`;
    if (!table.name) throw fixedError('markBaseline: this database has no migrations recorded');
    const marked =
      await tx`select 1 from drizzle.__drizzle_migrations where hash = ${baseline.hash}`;
    if (marked.length) return false;
    const [last] = await tx<{ hash: string; created_at: string }[]>`
      select hash, created_at from drizzle.__drizzle_migrations
      order by created_at desc limit 1`;
    if (
      last?.hash !== LAST_BEFORE_BASELINE.hash ||
      Number(last.created_at) !== LAST_BEFORE_BASELINE.when
    ) {
      throw fixedError('markBaseline: this database is not at 0034, the last migration before it');
    }
    await tx`delete from grants
      where connector_id in (select id from connectors where kind = 'google')`;
    await tx`delete from connectors where kind = 'google'`;
    await tx`update tasks set status = 'dropped', note = ${NO_GOOGLE}, done_at = now()
      where status = 'open' and exists (
        select 1 from jsonb_array_elements(steps) as s
        where s -> 'action' ->> 'kind' = 'google-signin')`;
    await tx`update asks set status = 'denied', reason = ${NO_GOOGLE}, decided_at = now()
      where status = 'open' and access ->> 'connector' = 'google'`;
    await tx`update asks set access = access - 'accounts' where access ? 'accounts'`;
    await tx`alter table grants drop column accounts`;
    await tx`insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${baseline.hash}, ${baseline.folderMillis})`;
    return true;
  });
}
