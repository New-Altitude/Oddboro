import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { serveOwner, ownerRequest } from './service-channel.mjs';

test(
  'only a paired owner reaches the handler, and stop belongs to the service',
  { timeout: 5000 },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'office-channel-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const key = 'ab'.repeat(32);
    let received = 0;
    const stopped = Promise.withResolvers();
    const server = await serveOwner(
      home,
      key,
      4500,
      (req, res) => {
        assert.equal(req[Symbol.for('oddboro.owner.connection')], true);
        received++;
        res.end('yes');
      },
      () => {
        stopped.resolve();
      }
    );
    t.after(() => new Promise((done) => server.close(done)));
    await assert.rejects(ownerRequest(home, 'different', 'POST', '/api/workspace', {}));
    assert.equal(received, 0);
    const ok = await ownerRequest(home, key, 'POST', '/api/workspace', {});
    assert.equal(ok.statusCode, 200);
    ok.resume();
    assert.equal(received, 1);
    const other = await ownerRequest(home, key, 'GET', '/');
    assert.equal(other.statusCode, 404);
    other.resume();
    const stop = await ownerRequest(home, key, 'POST', '/service/stop');
    stop.resume();
    await stopped.promise;
  }
);
