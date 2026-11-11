import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { db, toolServer } from './tool-server.ts';
const { staff } = await import('../src/schema.ts');
const { home } = await import('../src/home.ts');
const { startClockEvidence, checkedClock } = await import('../src/runtime.ts');
await db.insert(staff).values({
  id: 'manager',
  name: 'Manager',
  role: 'Office Manager',
  remit: 'Keep work moving.',
  variant: 'a',
  portrait: 'a',
  desk: 'Read the runtime evidence.',
  permission: 'read'
});

test('a Read run can inspect runtime without changing its checkpoint', async () => {
  startClockEvidence();
  checkedClock(Date.now(), Date.now() + 600_000);
  const file = home('runtime', 'clock.json'),
    before = readFileSync(file, 'utf8');
  const client = await toolServer('manager', { CEILING: 'read' });
  assert.ok((await client.listTools()).tools.some((t) => t.name === 'office_runtime'));
  const r = await client.callTool({ name: 'office_runtime', arguments: {} });
  assert.ok(!r.isError);
  assert.match(JSON.stringify(r.content), /checked/);
  assert.match(JSON.stringify(r.content), /unknown cause/);
  assert.equal(readFileSync(file, 'utf8'), before);
});
