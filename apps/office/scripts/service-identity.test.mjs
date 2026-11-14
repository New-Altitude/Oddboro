import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findService, identityFile, proof } from './service-identity.mjs';

test('attach verifies a fresh challenge, office key, readiness and version', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'office-identity-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const key = 'ab'.repeat(32);
  let received = '',
    saved = '',
    replay = false;
  const server = createServer((req, res) => {
    received = JSON.stringify({ headers: req.headers, url: req.url });
    const nonce = new URL(req.url, 'http://localhost').searchParams.get('challenge');
    const signature = replay ? saved : proof(key, nonce);
    saved = signature;
    res.end(JSON.stringify({ version: '1', readyMs: 3, proof: signature }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  writeFileSync(identityFile(home), JSON.stringify({ port, key }));
  assert.equal((await findService(home, port, '1')).port, port);
  assert.ok(!received.includes(key));
  assert.equal(await findService(home, port, '2'), undefined);
  replay = true;
  assert.equal(await findService(home, port, '1'), undefined);
});
