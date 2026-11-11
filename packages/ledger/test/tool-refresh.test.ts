// A service's stored tools follow what it lists now (`refreshTools`): new and
// dropped tools, Read only's reach both ways, and each tool's description. A
// dropped tool leaves each Odd's standing yes. Nothing changed writes nothing.
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { connectors, grants, ledger, staff } from '../src/schema.ts';
import { db } from './pglite.ts';

// The ledger rows embed nothing: no Ollama answers here.
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { changesSaid, connector, connectorsInUse, refreshTools } = await import('../src/office.ts');

await db.insert(staff).values({
  id: 'cleo',
  name: 'Cleo',
  role: 'Assistant',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Cleo.'
});
await db.insert(connectors).values({
  id: 'cal',
  name: 'Calendar',
  description: 'A calendar.',
  kind: 'http',
  tools: ['list_events', 'add_event', 'apply_changes'],
  readTools: ['list_events'],
  toolNotes: { list_events: 'List events.', add_event: 'Stage an event.', apply_changes: '' },
  readyAt: new Date()
});
await db
  .insert(grants)
  .values({ staffId: 'cleo', connectorId: 'cal', level: 'act', standing: ['add_event'] });

const titles = async () => (await db.select().from(ledger)).map((l) => l.title);

test('nothing changed writes nothing', async () => {
  const ch = await refreshTools('cal', [
    { name: 'list_events', description: 'List events.', readOnly: true },
    { name: 'add_event', description: 'Stage an event.', readOnly: false },
    { name: 'apply_changes', readOnly: false }
  ]);
  assert.equal(changesSaid(ch), 'Up to date.');
  assert.deepEqual(await titles(), []);
});

test('a new tool, a dropped one, a new read tool and a lost standing yes are kept and recorded', async () => {
  const ch = await refreshTools('cal', [
    { name: 'list_events', description: 'List events.', readOnly: true },
    { name: 'find_time', description: 'Find a free slot.', readOnly: true },
    { name: 'apply_changes', description: 'Apply what was staged.', readOnly: false }
  ]);
  assert.equal(changesSaid(ch), 'Tools updated: 1 new, 1 gone, Read only changed.');
  const c = (await connector('cal'))!;
  assert.deepEqual(c.tools, ['list_events', 'find_time', 'apply_changes']);
  assert.deepEqual(c.readTools, ['list_events', 'find_time']);
  assert.equal(c.toolNotes.apply_changes, 'Apply what was staged.');
  // add_event went, so a tool that comes back by that name asks first.
  const [g] = await db.select().from(grants).where(eq(grants.connectorId, 'cal'));
  assert.deepEqual(g.standing, []);
  assert.deepEqual((await titles()).sort(), [
    'Calendar added find_time, and dropped add_event',
    'Cleo asks again before using add_event in Calendar',
    'Read only for Calendar now reaches find_time'
  ]);
});

test('a tool the service stops marking as reading leaves Read only, and says so', async () => {
  await db.delete(ledger);
  await refreshTools('cal', [
    { name: 'list_events', description: 'List events.', readOnly: true },
    { name: 'find_time', description: 'Find a free slot.', readOnly: false },
    { name: 'apply_changes', description: 'Apply what was staged.', readOnly: false }
  ]);
  assert.deepEqual((await connector('cal'))!.readTools, ['list_events']);
  assert.deepEqual(await titles(), ['Read only for Calendar no longer reaches find_time']);
});

test('the office keeps current only connected services an Odd holds', async () => {
  const ids = (await connectorsInUse()).map((c) => c.id);
  assert.ok(ids.includes('cal'));
  assert.ok(!ids.includes('gmail'), 'gmail is not connected here, and no Odd holds it');
});
