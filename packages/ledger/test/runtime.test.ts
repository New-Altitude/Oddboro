import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { after, test } from 'node:test';
import { home } from '../src/home.ts';
import {
  checkedClock,
  failedClock,
  runtimeSummary,
  startClockEvidence,
  stoppedClock
} from '../src/runtime.ts';
import { checkService } from '../src/checks.ts';
const path = home('runtime', 'desktop.json');
after(() => rmSync(home('runtime'), { recursive: true, force: true }));
const shell = (platform: 'macos' | 'linux' | 'windows', login: boolean | null) => ({
  schema: 1,
  shellPid: 123,
  platform,
  updatedAt: 500,
  state: 'running',
  nodePid: process.pid,
  openAtLogin: login,
  loginCheckedAt: 400,
  lastCleanShutdownAt: 100,
  restartReason: 'node_exit',
  power: { nodePid: process.pid, state: 'requested', at: 500, platform },
  events: []
});
function keep(data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

test('the existing clock records missed checks through restarts without inventing a cause', () => {
  startClockEvidence(100);
  checkedClock(200, 600_200);
  assert.equal(runtimeSummary(600_200).clock?.gaps.length, 0, 'ten-minute idle timer is expected');
  startClockEvidence(700_300);
  checkedClock(700_400, 1_300_400);
  assert.deepEqual(runtimeSummary(700_400).clock?.gaps, [
    { from: 600_200, to: 700_400, lastCheck: 200, cause: 'unknown' }
  ]);
  failedClock(700_500);
  assert.equal(runtimeSummary(700_500).clockState, 'failed');
  checkedClock(700_600, 1_300_600);
  assert.equal(runtimeSummary(700_600).clockState, 'checked');
  assert.equal(runtimeSummary(1_400_000).clockState, 'overdue');
  stoppedClock(1_400_100);
  assert.equal(runtimeSummary(1_400_100).clockState, 'stopped');
});

for (const platform of ['macos', 'linux', 'windows'] as const)
  test(`${platform}: packaged setup reads the shell login state and never prescribes the development service`, async () => {
    const previous = process.env.ODDBORO_APP;
    process.env.ODDBORO_APP = '1';
    try {
      for (const login of [true, false, null]) {
        keep(shell(platform, login));
        const c = await checkService();
        assert.equal(c.state, login === true ? 'ok' : 'optional');
        assert.doesNotMatch(JSON.stringify(c), /npm run|service:install/);
        assert.equal(runtimeSummary().desktop?.platform, platform);
      }
    } finally {
      if (previous === undefined) delete process.env.ODDBORO_APP;
      else process.env.ODDBORO_APP = previous;
    }
  });

test('a different Node process cannot inherit the previous sleep-prevention request', () => {
  startClockEvidence(10);
  checkedClock(20, 1000);
  keep({ ...shell('macos', true), nodePid: process.pid + 1 });
  assert.equal(runtimeSummary(30).supervisorVerifiedForClock, false);
  assert.equal(runtimeSummary(30).power, null);
  keep(shell('macos', true));
  assert.equal(runtimeSummary(30).power?.state, 'requested');
  assert.match(runtimeSummary(30).limitation, /cannot prove continuous/);
});

test('runtime records are bounded and expose only declared evidence', () => {
  keep({ ...shell('linux', false), credentials: 'not for the tool' });
  assert.ok(!JSON.stringify(runtimeSummary()).includes('not for the tool'));
  writeFileSync(path, 'x'.repeat(65537));
  assert.equal(runtimeSummary().desktop, null);
  writeFileSync(path, '{bad');
  assert.equal(runtimeSummary().desktop, null);
  for (let i = 1; i <= 50; i++) checkedClock(i * 100_000, i * 100_000 + 1);
  assert.equal(runtimeSummary().clock?.gaps.length, 40);
});
