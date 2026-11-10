import assert from 'node:assert/strict';
import { test } from 'node:test';
import { piWorkerPath } from './pi-worker-path.ts';

test('Pi worker resolves inside the staged office on all desktop platforms', () => {
  assert.equal(piWorkerPath('/stage', true, 'darwin'), '/stage/apps/office/build/pi-worker.cjs');
  assert.equal(piWorkerPath('/stage', true, 'linux'), '/stage/apps/office/build/pi-worker.cjs');
  assert.equal(
    piWorkerPath('C:\\stage', true, 'win32'),
    'C:\\stage\\apps\\office\\build\\pi-worker.cjs'
  );
  assert.equal(
    piWorkerPath('/repo', false, 'linux'),
    '/repo/apps/office/src/lib/server/pi-worker.ts'
  );
  assert.equal(
    piWorkerPath('C:\\repo', false, 'win32'),
    'C:\\repo\\apps\\office\\src\\lib\\server\\pi-worker.ts'
  );
});
