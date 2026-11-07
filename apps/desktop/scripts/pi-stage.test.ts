import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertPiBundle } from './pi-stage.ts';

test('stage refuses a missing or changed worker and missing license inventory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-pi-stage-'));
  try {
    assert.throws(() => assertPiBundle(dir));
    const worker = 'fixture worker';
    const licenses = JSON.stringify([
      { name: '@earendil-works/pi-agent-core', version: '1.5.0', notices: ['MIT'] },
      { name: '@earendil-works/pi-ai', version: '1.5.0', notices: ['MIT'] },
      { name: '@modelcontextprotocol/sdk', version: '1.32.2', notices: ['MIT'] }
    ]);
    const hash = (s: string) => createHash('sha256').update(s).digest('hex');
    writeFileSync(join(dir, 'pi-worker.cjs'), worker);
    writeFileSync(join(dir, 'pi-worker-licenses.json'), licenses);
    writeFileSync(
      join(dir, 'pi-worker-integrity.json'),
      JSON.stringify({ version: 1, workerSha256: hash(worker), licensesSha256: hash(licenses) })
    );
    assert.doesNotThrow(() => assertPiBundle(dir));
    writeFileSync(join(dir, 'pi-worker.cjs'), 'different');
    assert.throws(() => assertPiBundle(dir), /do not match/);
    writeFileSync(join(dir, 'pi-worker.cjs'), worker);
    writeFileSync(join(dir, 'pi-worker-licenses.json'), '[]');
    assert.throws(() => assertPiBundle(dir), /do not match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
