// A reconnect puts the Odd's steps for a new key on the desk only when the
// tool takes a key. A tool that signs in has no key box, so key steps there
// would send the owner looking for one that is not there. The office's own
// code on every migration, in an in-memory PGlite that stands in for db.ts
// (pglite.ts). Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectors, staff } from '../src/schema.ts';
import { db } from './pglite.ts';

// The ledger rows a grant writes embed nothing: no Ollama answers here.
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
const { grantAccess, reconnectTask } = await import('../src/office.ts');

await db.insert(staff).values({
  id: 'cole',
  name: 'Cole',
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Cole.'
});
const ready = { tools: ['search'], readTools: ['search'], readyAt: new Date() };
await db.insert(connectors).values([
  {
    id: 'brain',
    name: 'Brain',
    description: 'A hosted memory that takes a key.',
    kind: 'http',
    config: { url: 'https://brain.example/mcp', headers: ['x-brain-key'] },
    ...ready
  },
  {
    id: 'notes',
    name: 'Notes',
    description: 'A hosted notes app that signs in.',
    kind: 'http',
    config: { url: 'https://notes.example/mcp', oauth: true },
    ...ready
  }
]);
for (const connector of ['brain', 'notes']) await grantAccess('cole', { connector, level: 'read' });

const GET_KEY = ['Open your credential tracker.', 'Copy the MCP Access Key.'];

test('a tool that takes a key gets the key steps, then its key box', async () => {
  const r = await reconnectTask('cole', 'brain', 'It turns down the key.', GET_KEY);
  assert.ok('task' in r);
  assert.equal(r.keptOut, false);
  const texts = r.task.steps.map((s) => s.text);
  assert.deepEqual(texts.slice(0, 2), GET_KEY);
  assert.ok(r.task.steps.some((s) => s.action?.kind === 'secret'));
});

test('a tool that signs in leaves the key steps out, and says so', async () => {
  const r = await reconnectTask('cole', 'notes', 'The sign-in ran out.', GET_KEY);
  assert.ok('task' in r);
  assert.equal(r.keptOut, true);
  const texts = r.task.steps.map((s) => s.text);
  for (const step of GET_KEY) assert.ok(!texts.includes(step));
  assert.ok(!r.task.steps.some((s) => s.action?.kind === 'secret'));
  assert.ok(r.task.steps.some((s) => s.action?.kind === 'oauth'));
});
