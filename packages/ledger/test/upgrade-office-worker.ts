// A separate process per restart, using only the database startup and migration path.
if (!process.env.ODDBORO_HOME || !process.env.ODDBORO_UPGRADE_CHECK)
  throw new Error('This worker needs an explicit disposable office.');
const { startLocalDatabase } = await import('../src/local-db.ts');
const { bringUpToDate } = await import('../src/upgrade.ts');
const { sql } = await import('../src/db.ts');
const stop = await startLocalDatabase();
try {
  await bringUpToDate();
  const [{ count }] = await sql`select count(*)::int from drizzle.__drizzle_migrations`;
  console.log(JSON.stringify({ migrations: count }));
} finally {
  await sql.end();
  await stop();
}
