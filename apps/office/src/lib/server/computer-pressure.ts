import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';
import { promisify } from 'node:util';
import { AGENT_NAMES } from '@oddboro/ledger/agents';
import { SYSTEM, currentPlatform } from '@oddboro/ledger/platform';
import { formatMemory } from '../format-memory.ts';
import {
  hostCpu,
  hostTicks,
  type ActivityRun,
  type ComputerActivity
} from './computer-activity.ts';

const execute = promisify(execFile);
export const PRESSURE_INTERVAL = 15_000;
export type Resource = 'memory' | 'cpu';
export type PressureAdvice = {
  resource: Resource;
  heading: string;
  detail: string;
  action: string;
};
type Reading = { at: number; ticks: ReturnType<typeof hostTicks>; memory: boolean | null };

export function macMemory(value: string) {
  // The sysctl returns dispatch flags (normal, warning, critical), not the kernel's internal enum.
  switch (value.trim()) {
    case '1':
      return false;
    case '2':
    case '4':
      return true;
    default:
      return null;
  }
}
export function linuxMemory(value: string) {
  const some = /^some avg10=(\d+(?:\.\d+)?)\b/m.exec(value);
  return some ? Number(some[1]) >= 10 : null;
}
export function windowsLowMemory(available: number, total: number) {
  return available < Math.min(total * 0.05, 512 * 1024 ** 2);
}
async function memoryPressure(): Promise<boolean | null> {
  switch (currentPlatform()) {
    case 'darwin':
      return macMemory(
        (
          await execute('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], {
            timeout: 2000
          })
        ).stdout
      );
    case 'linux':
      return linuxMemory(await readFile('/proc/pressure/memory', 'utf8'));
    case 'win32':
      // Windows reports available physical memory, including reclaimable standby pages.
      return windowsLowMemory(freemem(), totalmem());
    default:
      return null;
  }
}
export async function readPressure(): Promise<Reading> {
  return { at: Date.now(), ticks: hostTicks(), memory: await memoryPressure().catch(() => null) };
}

/** A gap across sleep loses the CPU baseline. Two high intervals rule out a single burst. */
export function pressureDetector() {
  let previous: Reading | undefined,
    previousCpuHigh = false;
  return (reading: Reading): Resource | null => {
    const gap = previous ? reading.at - previous.at : 0;
    const adjacent = gap >= PRESSURE_INTERVAL / 2 && gap <= PRESSURE_INTERVAL * 3;
    const cpu = previous && adjacent ? hostCpu(previous.ticks, reading.ticks) : null;
    const high = cpu !== null && cpu >= 90;
    const memory = adjacent && previous?.memory && reading.memory;
    const resource = memory ? 'memory' : high && previousCpuHigh ? 'cpu' : null;
    previous = reading;
    previousCpuHigh = high;
    return resource;
  };
}

export function pressureAdvice(
  resource: Resource,
  sample: ComputerActivity | null,
  cores = cpus().length
): PressureAdvice {
  const memory = resource === 'memory';
  const heading = memory
    ? 'Your computer is short on memory.'
    : 'Your computer’s CPU has stayed at or above 90%.';
  const metric = (run: ActivityRun) => (memory ? run.bytes : (run.cpu ?? 0));
  let run: ActivityRun | undefined;
  for (const candidate of sample?.runs ?? []) {
    if (metric(candidate) > (run ? metric(run) : 0)) run = candidate;
  }
  const system =
    SYSTEM === 'mac'
      ? 'Activity Monitor'
      : SYSTEM === 'windows'
        ? 'Task Manager'
        : 'your system monitor';
  const checkApps = 'Open ' + system + ' and sort all apps by ' + (memory ? 'memory.' : 'CPU.');
  if (!sample || !run)
    return {
      resource,
      heading,
      detail: sample
        ? 'I found no agent run with measurable usage of this resource.'
        : 'I could not read the agent processes.',
      action: checkApps
    };
  const shared = run.shared || run.sessions.length > 1;
  const name = AGENT_NAMES[run.agent];
  const label = run.task || sample.titles[run.sessions[0]] || run.project;
  const who = shared ? name + ' shared server' : label ? name + ' · ' + label : name;
  const used = memory
    ? formatMemory(run.bytes)
    : Math.max(1, Math.round(metric(run))) + '% CPU (100% is one core)';
  const detail = `${who} (PID ${run.pid}) is using ${used}, the most ${memory ? 'memory' : 'CPU'} of any agent I can see.`;
  const share = metric(run) / (memory ? sample.total : cores * 100);
  let action = memory
    ? 'Save your work and close a finished session if you need the memory.'
    : 'If this work can wait, review it in its own app and decide whether to pause it.';
  if (shared) {
    const chats =
      run.sessions.length > 1 ? 'its ' + run.sessions.length + ' open chats' : 'its open chats';
    action =
      'The reading covers the whole server. Review ' +
      chats +
      (memory
        ? ' and let one finish before starting more work.'
        : ' and decide whether a lower-priority run can pause.');
  }
  if (share < 0.05) action = 'That is a small share of the computer. ' + checkApps;
  return { resource, heading, detail, action };
}
