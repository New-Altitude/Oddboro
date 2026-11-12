// Test-only: the idle test preloads it (`node --import`) into each office it
// starts, before anything else loads, so every timer the office makes is
// counted. The office's timers run on a mock clock that the test moves on
// (`pass`), so its idle window costs no real seconds. Its name does not end
// in .test.ts, so `npm test` never runs it.
import { mock } from 'node:test';
// Imported before the clock is mocked, so it keeps real time: what a timer
// sends goes over a real socket, which takes real time to finish.
import { setTimeout as realWait } from 'node:timers/promises';

mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

const live = new Set<unknown>();
let made = 0;
const { setTimeout: timeout, setInterval: interval, clearInterval: clear } = globalThis;

// Each wrapper takes and returns what the one it wraps does. The casts claim
// Node's `__promisify__` too, which the wrappers do not carry.
globalThis.setTimeout = ((...args: Parameters<typeof timeout>) => {
  made++;
  return timeout(...args);
}) as typeof setTimeout;
globalThis.setInterval = ((...args: Parameters<typeof interval>) => {
  const t = interval(...args);
  live.add(t);
  return t;
}) as typeof setInterval;
globalThis.clearInterval = ((t?: Parameters<typeof clear>[0]) => {
  live.delete(t);
  clear(t);
}) as typeof clearInterval;

/** Intervals still running, and timeouts made so far. */
export const timers = () => ({ intervals: live.size, timeouts: made });

/**
 * Move the office's clock on by `ms`. A second at a time, with a real turn
 * between, so a timer that sets the next one from its callback, or after an
 * await, fires again within the window as it would in real time. Then a real
 * pause, so a send a timer started ends, and any timer it sets is counted.
 */
export async function pass(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 1000) {
    mock.timers.tick(1000);
    await realWait(0);
  }
  await realWait(300);
}
