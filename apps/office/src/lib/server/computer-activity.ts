import { cpus, totalmem, freemem } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { Agent } from '@oddboro/ledger/agents';
import { activityTitles, openCodexTurns } from './activity-titles.ts';
import { processRows, processFiles, type ProcessRow } from './activity-processes.ts';

export type ActivityRun = {
  pid: number;
  agent: Agent;
  cpu: number | null;
  bytes: number;
  project?: string;
  staffId?: string;
  task?: string;
  shared?: boolean;
  sessions: string[];
};
type OfficeProcess = { agent: Agent; staffId: string; task?: string };
export type ComputerActivity = {
  measured: string;
  cpu: number | null;
  used: number;
  total: number;
  titles: Record<string, string>;
  openTurns: string[];
  runs: ActivityRun[];
};

function hostTicks() {
  let total = 0,
    idle = 0;
  for (const core of cpus()) {
    idle += core.times.idle;
    total += Object.values(core.times).reduce((a, b) => a + b, 0);
  }
  return { idle, total };
}

/** Charge each descendant to its nearest run. An npm shim and the native program it launches are one run. */
export function groupProcesses(
  first: ProcessRow[],
  last: ProcessRow[],
  elapsed: number,
  office: Map<number, OfficeProcess>
) {
  const before = new Map(first.map((p) => [p.pid, p]));
  const rows = new Map(last.map((p) => [p.pid, p]));
  const groups = new Map<number, ActivityRun>();
  const agentPids = new Map<number, number>();
  for (const p of last) {
    const owner = office.get(p.pid);
    const agent = owner?.agent ?? p.agent;
    if (!agent) continue;
    const parent = rows.get(p.parent);
    if (!owner && parent?.launcher && parent.agent === agent) continue;
    groups.set(p.pid, {
      pid: p.pid,
      agent,
      cpu: 0,
      bytes: 0,
      shared: p.shared,
      sessions: [],
      staffId: owner?.staffId,
      task: owner?.task
    });
  }
  for (const p of last) {
    let ancestor: ProcessRow | undefined = p;
    const seen = new Set<number>();
    while (ancestor && !groups.has(ancestor.pid) && !seen.has(ancestor.pid)) {
      seen.add(ancestor.pid);
      ancestor = rows.get(ancestor.parent);
    }
    const run = ancestor && groups.get(ancestor.pid);
    if (!run) continue;
    if (p.shared) run.shared = true;
    if (p.agent || p.pid === run.pid) agentPids.set(p.pid, run.pid);
    run.bytes += p.bytes;
    const old = before.get(p.pid);
    if (old?.start === p.start && elapsed > 0 && p.ms >= old.ms) {
      if (run.cpu !== null) run.cpu += ((p.ms - old.ms) * 100) / elapsed;
    } else if (p.pid === run.pid) run.cpu = null;
  }
  return { groups, agentPids };
}

export async function computerActivity(
  officeProcesses: () => Map<number, OfficeProcess>
): Promise<ComputerActivity> {
  const first = await processRows(false);
  const begin = performance.now(),
    host = hostTicks();
  await delay(750);
  const last = await processRows(true);
  const end = hostTicks(),
    elapsed = performance.now() - begin;
  const ticks = end.total - host.total;
  const { groups, agentPids } = groupProcesses(first, last, elapsed, officeProcesses());
  const files = await processFiles([...agentPids.keys()]);
  for (const [pid, root] of agentPids) {
    const run = groups.get(root)!; // agentPids names only roots in groups.
    const info = files.get(pid);
    if (!info) continue;
    run.project ||= info.project;
    if (run.agent === 'codex') {
      for (const id of info.sessions) if (!run.sessions.includes(id)) run.sessions.push(id);
    }
  }
  const total = totalmem();
  const ids = new Set([...groups.values()].flatMap((r) => r.sessions));
  return {
    measured: new Date().toISOString(),
    cpu: ticks > 0 ? Math.max(0, Math.min(100, 100 * (1 - (end.idle - host.idle) / ticks))) : null,
    used: total - freemem(),
    total,
    openTurns: openCodexTurns(ids),
    titles: await activityTitles(ids),
    runs: [...groups.values()].sort((a, b) => (b.cpu ?? -1) - (a.cpu ?? -1) || b.bytes - a.bytes)
  };
}
