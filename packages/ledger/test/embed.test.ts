import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';

// A free port with nothing on it yet: Ollama is not running.
const probe = createServer();
await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
const port = (probe.address() as AddressInfo).port;
await new Promise<void>((done) => probe.close(() => done()));
process.env.OLLAMA_URL = `http://127.0.0.1:${port}`;
const { embed } = await import('../src/embed.ts');

let asked = 0;
const stuck = createServer(() => {
  asked++;
});

after(() => {
  stuck.closeAllConnections();
  stuck.close();
});

test('an Ollama that is not running is tried again, and one that never answers is left alone a while', async () => {
  assert.equal(await embed('a line before Ollama starts', 'document', 300), null);
  // Ollama starts, but never answers. The refusal paused nothing, so the next line reaches it.
  await new Promise<void>((done) => stuck.listen(port, '127.0.0.1', done));
  const started = Date.now();
  assert.equal(await embed('a line for the ledger', 'document', 300), null);
  assert.ok(Date.now() - started < 3000);
  assert.equal(asked, 1);
  // The timeout paused it: the line after never reaches Ollama.
  assert.equal(await embed('the next line', 'document', 300), null);
  assert.equal(asked, 1);
});
