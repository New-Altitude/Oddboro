import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stopPiChild } from './launch.ts';

test('Windows cancellation targets only the live worker PID and its tree', () => {
  const calls: unknown[][] = [];
  const child = { pid: 12345, exitCode: null, signalCode: null, kill: () => true } as Parameters<
    typeof stopPiChild
  >[0];
  const run = ((...args: unknown[]) => {
    calls.push(args);
    return Buffer.alloc(0);
  }) as typeof import('node:child_process').execFileSync;
  stopPiChild(child, 'win32', run);
  assert.equal(calls.length, 1);
  assert.match(String(calls[0][0]), /System32\\taskkill\.exe$/i);
  assert.deepEqual(calls[0][1], ['/PID', '12345', '/T', '/F']);
  stopPiChild({ ...child, exitCode: 0 }, 'win32', run);
  stopPiChild({ ...child, pid: undefined }, 'win32', run);
  assert.equal(calls.length, 1);
});

test('Windows cancellation reports a failed tree stop and only kills its own worker', () => {
  let killed = 0;
  const child = {
    pid: 321,
    exitCode: null,
    signalCode: null,
    kill: () => {
      killed++;
      return true;
    }
  } as Parameters<typeof stopPiChild>[0];
  const fail = (() => {
    throw new Error('fixture taskkill failure');
  }) as typeof import('node:child_process').execFileSync;
  assert.equal(stopPiChild(child, 'win32', fail), false);
  assert.equal(killed, 1);
});
