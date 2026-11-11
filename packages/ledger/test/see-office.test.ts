// Every Odd sees who is in the office (`see_office`) unless the owner takes it
// off: a new hire starts with it whatever tools its hire names, and migration
// 0017 gave it once to every Odd already hired. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db } from './pglite.ts';

const { staff } = await import('../src/schema.ts');
const O = await import('../src/office.ts');
const { STARTER_TOOLS, isGrantable } = await import('../src/tools.ts');

const odd = (name: string) => ({
  name,
  role: 'Writer',
  remit: 'Writing.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft' as const,
  desk: `You are ${name}.`,
  room: 'workspace'
});

test('see_office is a tool the owner can take off, and every new hire starts with it', async () => {
  assert.ok(isGrantable('see_office'));
  assert.ok(STARTER_TOOLS.includes('see_office'));
  const plain = await O.hire(odd('Iris'));
  assert.ok(plain.tools.includes('see_office'));
  // A hire that names its own tools, as the hire window does, still starts with it.
  const named = await O.hire({ ...odd('Wren'), tools: ['search_ledger', 'poke_owner'] });
  assert.deepEqual(named.tools, ['see_office', 'search_ledger', 'poke_owner']);
});

test('migration 0017 gives see_office to every Odd already hired, once', async () => {
  const sqlText = readFileSync(
    new URL('../migrations/0017_see-office.sql', import.meta.url),
    'utf8'
  );
  const update = sqlText.split('--> statement-breakpoint')[1];
  await O.hire(odd('Old'));
  await db
    .update(staff)
    .set({ tools: ['search_ledger'] })
    .where(eq(staff.id, 'old'));
  await db.execute(sql.raw(update));
  await db.execute(sql.raw(update));
  const [row] = await db.select().from(staff).where(eq(staff.id, 'old'));
  assert.deepEqual(row.tools, ['see_office', 'search_ledger']);
});
