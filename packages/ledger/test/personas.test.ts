// A persona Odd in the ledger: an Odd installed from a New Altitude persona,
// whose look is the package's and whose replies leave the computer. Over the
// office's own database in a throwaway folder, with the office tool server in a
// process of its own (tool-server.ts). Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db, toolServer } from './tool-server.ts';

const { staff } = await import('../src/schema.ts');
const { STARTER_TOOLS } = await import('../src/tools.ts');
const { MANAGERS } = await import('../src/managers.ts');
const { setLook, staffer } = await import('../src/office.ts');

const odd = (id: string, name: string) => ({
  id,
  name,
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft' as const,
  tools: [...STARTER_TOOLS],
  desk: `You are ${name}.`
});
await db.insert(staff).values([
  odd('lead', 'Lena'),
  odd('paige', 'Paige'),
  {
    ...odd('pat', 'Pat'),
    package: { slug: 'pat', version: 1, disclosure: 'Pat is an AI persona.' }
  }
]);

test("a persona Odd's look cannot be redrawn", async () => {
  const look = MANAGERS.find((m) => m.look)?.look;
  assert.ok(look);
  await assert.rejects(setLook('pat', look, 'portrait'), {
    message: "Pat's look comes from New Altitude and cannot be redrawn."
  });
  assert.equal((await staffer('pat'))?.look, null);
});

test("a persona colleague's line says its replies come from New Altitude", async () => {
  const c = await toolServer('lead', { RUN_KEY: 'k-persona' });
  const t = (await c.listTools()).tools.find((t) => t.name === 'hand_off');
  const line = (id: string) => t?.description?.split('\n').find((l) => l.startsWith(`- ${id}:`));
  assert.match(
    line('pat') ?? '',
    /Their replies come from New Altitude, so what you hand them leaves this computer\.$/
  );
  assert.doesNotMatch(line('paige') ?? '', /New Altitude/);
});
