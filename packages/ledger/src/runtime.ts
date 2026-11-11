// Local runtime evidence only. The existing job clock supplies checkpoints;
// this module starts no timer and reads no office work or credentials.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { home } from './home.ts';

const time = z.number().finite().nonnegative();
const desktopShape = z.object({
  schema: z.literal(1),
  shellPid: z.number().int().positive(),
  platform: z.enum(['macos', 'linux', 'windows']),
  updatedAt: time,
  state: z.enum([
    'starting',
    'running',
    'restarting',
    'stopping',
    'stopped',
    'failed',
    'exhausted'
  ]),
  nodePid: z.number().int().nonnegative(),
  openAtLogin: z.boolean().nullable().optional(),
  loginCheckedAt: time.optional(),
  lastReadyAt: time.optional(),
  lastStopAt: time.optional(),
  lastCleanShutdownAt: time.optional(),
  restartReason: z
    .enum(['could_not_start', 'ready_timeout', 'node_exit', 'restart_limit'])
    .optional(),
  exitCode: z.number().int().nullable().optional(),
  restartDelaySeconds: z.number().optional(),
  power: z
    .object({
      nodePid: z.number().int(),
      state: z.enum(['requested', 'failed', 'ended']),
      at: time,
      platform: z.enum(['macos', 'linux', 'windows'])
    })
    .optional(),
  events: z
    .array(
      z.object({
        at: time,
        kind: z.enum([
          'shell_started',
          'login_checked',
          'node_started',
          'node_ready',
          'node_stopped',
          'power_request',
          'start_failed',
          'ready_timeout',
          'restart_limit',
          'restart_planned',
          'quit_requested'
        ])
      })
    )
    .max(40)
});
const clockShape = z.object({
  schema: z.literal(1),
  pid: z.number().int().positive(),
  packaged: z.boolean(),
  startedAt: time,
  checkedAt: time.optional(),
  expectedAt: time.optional(),
  stoppedAt: time.optional(),
  failedAt: time.optional(),
  gaps: z
    .array(z.object({ from: time, to: time, lastCheck: time, cause: z.literal('unknown') }))
    .max(40)
});
type ClockEvidence = z.infer<typeof clockShape>;
const clockPath = () => home('runtime', 'clock.json');
function read<T>(path: string, shape: z.ZodType<T>): T | undefined {
  try {
    if (statSync(path).size > 65536) return;
    return shape.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return;
  }
}
function keepClock(data: ClockEvidence) {
  const path = clockPath(),
    temp = path + '.' + randomUUID() + '.tmp';
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
  renameSync(temp, path);
}
export function startClockEvidence(now = Date.now()) {
  const old = read(clockPath(), clockShape);
  keepClock({
    ...old,
    schema: 1,
    pid: process.pid,
    packaged: process.env.ODDBORO_APP === '1',
    startedAt: now,
    stoppedAt: undefined,
    gaps: old?.gaps ?? []
  });
}
/** A missed expected check is evidence of a clock gap, not proof of its cause. */
export function checkedClock(now: number, expectedAt: number) {
  const old = read(clockPath(), clockShape);
  const gaps = old?.gaps ?? [];
  if (old?.checkedAt !== undefined && old.expectedAt !== undefined && now > old.expectedAt + 60_000)
    gaps.push({ lastCheck: old.checkedAt, from: old.expectedAt, to: now, cause: 'unknown' });
  keepClock({
    schema: 1,
    pid: process.pid,
    packaged: process.env.ODDBORO_APP === '1',
    startedAt: old?.startedAt ?? now,
    checkedAt: now,
    expectedAt,
    gaps: gaps.slice(-40)
  });
}
export function failedClock(now = Date.now()) {
  const old = read(clockPath(), clockShape);
  if (old) keepClock({ ...old, failedAt: now });
}
export function stoppedClock(now = Date.now()) {
  const old = read(clockPath(), clockShape);
  if (old) keepClock({ ...old, stoppedAt: now });
}
export function runtimeSummary(now = Date.now()) {
  const desktop = read(home('runtime', 'desktop.json'), desktopShape);
  const clock = read(clockPath(), clockShape);
  const overdue = !!clock?.expectedAt && now > clock.expectedAt + 60_000;
  const matching = !!desktop && desktop.nodePid === clock?.pid && !clock?.stoppedAt;
  return {
    observedAt: now,
    mode: process.env.ODDBORO_APP === '1' || clock?.packaged ? 'desktop' : 'source',
    desktop: desktop ?? null,
    clock: clock ?? null,
    clockState: !clock
      ? 'unknown'
      : clock.stoppedAt
        ? 'stopped'
        : overdue
          ? 'overdue'
          : clock.failedAt
            ? 'failed'
            : clock.checkedAt
              ? 'checked'
              : 'starting',
    supervisorVerifiedForClock: matching,
    power: matching && desktop?.power?.nodePid === clock?.pid ? desktop.power : null,
    limitation:
      'A sleep-prevention request cannot prove continuous availability. A clock gap has an unknown cause unless separate native evidence establishes it. No local work runs while this computer is unavailable.'
  };
}
export type RuntimeSummary = ReturnType<typeof runtimeSummary>;
