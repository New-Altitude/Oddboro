// The owner changes an Odd's level and office tools in the Settings tab, and
// each change writes its own access line in the Ledger, in the tab's words.
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { ledger, staff } from '../src/schema.ts';
import { db } from './pglite.ts';

// The ledger rows embed nothing: no Ollama answers here.
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { setPermission, setTool } = await import('../src/office.ts');

await db.insert(staff).values({
  id: 'ada',
  name: 'Ada',
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  tools: [],
  desk: 'You are Ada.'
});

beforeEach(async () => {
  await db.delete(ledger);
  await db.update(staff).set({ permission: 'draft', tools: [] }).where(eq(staff.id, 'ada'));
});

const lines = () =>
  db
    .select({ kind: ledger.kind, actor: ledger.actor, title: ledger.title, body: ledger.body })
    .from(ledger)
    .orderBy(ledger.id);
const ada = async () => (await db.select().from(staff).where(eq(staff.id, 'ada')))[0];

test("the Settings tab's level and tool changes still write their own access line", async () => {
  await setPermission('ada', 'act');
  assert.equal((await ada()).permission, 'act');
  await setPermission('ada', 'read');
  assert.equal((await ada()).permission, 'read');
  await setTool('ada', 'office_report', true);
  assert.deepEqual((await ada()).tools, ['office_report']);
  await setTool('ada', 'office_report', false);
  assert.deepEqual((await ada()).tools, []);
  assert.deepEqual(await lines(), [
    { kind: 'access', actor: 'owner', title: 'Raised Ada from draft to act', body: '' },
    { kind: 'access', actor: 'owner', title: 'Lowered Ada from act to read', body: '' },
    {
      kind: 'access',
      actor: 'owner',
      title: 'Gave Ada Office report',
      body: 'Sees what every Odd did: jobs, runs, asks and tasks.'
    },
    {
      kind: 'access',
      actor: 'owner',
      title: 'Took Office report from Ada',
      body: 'Sees what every Odd did: jobs, runs, asks and tasks.'
    }
  ]);
});

test('a level or tool the Odd already has writes no line', async () => {
  await setPermission('ada', 'draft');
  await setTool('ada', 'office_report', false);
  assert.deepEqual(await lines(), []);
});

test('a tool the owner does not grant is refused, and nothing changes', async () => {
  await assert.rejects(setTool('ada', 'my_access', true));
  assert.deepEqual((await ada()).tools, []);
  assert.deepEqual(await lines(), []);
});
