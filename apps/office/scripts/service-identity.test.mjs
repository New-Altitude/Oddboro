import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { newPairing, sealSession, openSession, verifyService, nonce } from './service-identity.mjs';

test('only the owner opens an authentic envelope for the current office', async () => {
  const owner = newPairing(),
    other = newPairing();
  const session = { key: nonce(), port: 4500, version: '1' };
  const record = await sealSession(owner.registration, session);
  assert.deepEqual(await openSession(owner.credential, record), session);
  assert.ok(!JSON.stringify(record).includes(session.key));
  await assert.rejects(openSession(other.credential, record));
  // With the verifier and the office signer, one can still neither decrypt
  // the office's envelope nor recover the owner's private credential.
  const wrongPrivate = other.credential.split('.');
  wrongPrivate[2] = owner.credential.split('.')[2];
  await assert.rejects(openSession(wrongPrivate.join('.'), record));
  await assert.rejects(openSession(owner.credential, { ...record, box: record.box + 'x' }));
});

test('the current office proves its identity without receiving any credential', async (t) => {
  const key = nonce();
  let previous,
    replay = false;
  const server = createServer((request, res) => {
    const url = new URL(request.url, 'http://localhost');
    assert.equal(url.pathname, '/api/proof');
    assert.ok(!JSON.stringify([request.url, request.headers]).includes(key));
    const proof = createHmac('sha256', key)
      .update('oddboro-proof:' + url.searchParams.get('nonce'))
      .digest('hex');
    res.end(replay ? previous : proof);
    previous = proof;
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  await verifyService({ port, key });
  replay = true;
  await assert.rejects(verifyService({ port, key }));
});
