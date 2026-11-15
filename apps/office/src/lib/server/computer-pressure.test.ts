import assert from 'node:assert/strict';
import test from 'node:test';
import type { ComputerActivity } from './computer-activity.ts';
import {
  PRESSURE_INTERVAL,
  linuxMemory,
  macMemory,
  windowsLowMemory,
  pressureAdvice,
  pressureDetector
} from './computer-pressure.ts';
import { pressureEpisode } from './pressure-watch.ts';

test('native memory readings distinguish pressure from cache use and missing evidence', () => {
  assert.deepEqual(['1', '2\n', '4', '', '0'].map(macMemory), [false, true, true, null, null]);
  assert.equal(linuxMemory('some avg10=0.43 avg60=11.0\nfull avg10=0.02'), false);
  assert.equal(linuxMemory('some avg10=12.5 avg60=0.2'), true);
  assert.equal(linuxMemory('missing'), null);
  assert.equal(windowsLowMemory(2 * 1024 ** 3, 128 * 1024 ** 3), false);
  assert.equal(windowsLowMemory(128 * 1024 ** 2, 8 * 1024 ** 3), true);
});
test('a burst, a sleep gap or unknown memory cannot confirm sustained pressure', () => {
  const detect = pressureDetector();
  const read = (n: number, idle: number, memory: boolean | null = false) =>
    detect({ at: n * PRESSURE_INTERVAL, ticks: { total: n * 100, idle }, memory });
  assert.equal(read(0, 0), null);
  assert.equal(read(1, 5), null);
  assert.equal(read(2, 75), null);
  assert.equal(read(3, 80), null);
  assert.equal(read(4, 90), 'cpu');
  assert.equal(read(20, 95, true), null);
  assert.equal(read(21, 150, null), null);
  assert.equal(read(22, 210, true), null);
  assert.equal(read(23, 280, true), 'memory');
});
test('refresh the advice silently during pressure and rearm only after recovery', () => {
  const check = pressureEpisode();
  assert.equal(check(null, 0), undefined);
  assert.equal(check('memory', 30_000), 'notify');
  assert.equal(check('memory', 45_000), undefined);
  assert.equal(check('memory', 90_000), 'update');
  assert.equal(check('cpu', 105_000), 'update');
  assert.equal(check(null, 120_000), undefined);
  assert.equal(check('cpu', 135_000), undefined);
  assert.equal(check(null, 150_000), undefined);
  assert.equal(check(null, 165_000), 'clear');
  assert.equal(check('cpu', 210_000), 'notify');
});
const sample: ComputerActivity = {
  measured: '',
  cpu: 95,
  used: 14 * 1024 ** 3,
  total: 16 * 1024 ** 3,
  titles: { a: 'First draft' },
  openTurns: [],
  runs: [
    { agent: 'claude', pid: 11, cpu: 260, bytes: 1024 ** 3, task: 'Draft report', sessions: [] },
    { agent: 'codex', pid: 22, cpu: 10, bytes: 5 * 1024 ** 3, shared: true, sessions: ['a', 'b'] }
  ]
};
test('name the leader for the constrained resource and keep a shared server whole', () => {
  const ram = pressureAdvice('memory', sample, 4);
  assert.match(ram.detail, /Codex shared server \(PID 22\).*5.0 GiB/);
  assert.doesNotMatch(ram.detail, /First draft/);
  assert.match(ram.action, /2 open chats/);
  const cpu = pressureAdvice('cpu', sample, 4);
  assert.match(cpu.detail, /Draft report \(PID 11\).*260%/);
  assert.match(cpu.action, /decide whether to pause/);
});
test('missing or insignificant agent readings direct the owner to other apps', () => {
  assert.match(pressureAdvice('memory', null).detail, /could not read/);
  const quiet = { ...sample, runs: [{ ...sample.runs[0], cpu: null, bytes: 1024 }] };
  assert.match(pressureAdvice('cpu', quiet).detail, /no agent run/);
  assert.match(pressureAdvice('memory', quiet).action, /sort all apps by memory/);
});
