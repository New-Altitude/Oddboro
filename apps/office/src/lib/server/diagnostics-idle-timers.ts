// Test-only: the idle test preloads it (`node --import`) into each office it
// starts, before anything else loads, so every timer the office makes is
// counted. Its name does not end in .test.ts, so `npm test` never runs it.
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
