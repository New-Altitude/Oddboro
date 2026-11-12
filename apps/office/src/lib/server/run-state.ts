// Slot admission, the floor's work and Stop all read the same live runs.
import {
  runsGoing,
  reserveRun,
  releaseRun,
  type LiveRun,
  type Work,
  type WorkAbout
} from '@oddboro/ledger/run-registry';
import type { ChatEvent } from '#lib/staff/chat.ts';
import { bus, emit } from './events.ts';

const AT_ONCE = 3;
let workIds = 0;

export function inProgress(): Record<string, Work[]> {
  const work: Record<string, Work[]> = {};
  for (const run of runsGoing.values())
    if (run.work) (work[run.staffId] ??= []).push({ ...run.work });
  return work;
}

export function working(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [id, work] of Object.entries(inProgress())) {
    const now = work.filter((w) => !w.queued).map((w) => w.label);
    if (now.length) labels[id] = now.length > 1 ? `${now[0]} +${now.length - 1} more` : now[0];
  }
  return labels;
}

function show() {
  emit({ type: 'working', working: working(), inProgress: inProgress() });
}

export function chatRun(id: string): LiveRun | undefined {
  return [...runsGoing.values()].findLast(
    (r) => r.staffId === id && (r.kind === 'hello' || !!r.turnId)
  );
}

export const isBusy = (id: string): boolean => !!chatRun(id);
export const runsActive = (): boolean => runsGoing.size > 0;

export function stopRuns(id: string): void {
  for (const run of runsGoing.values()) if (run.staffId === id) run.stop.abort('left');
}

export function workAbout(leadId: string, key: string): WorkAbout | undefined {
  return [...runsGoing.values()].find(
    (r) => !r.work?.queued && r.work?.about?.leadId === leadId && r.work.about.key === key
  )?.work?.about;
}

/** A chat uses its own session. Only background work waits for these slots. */
export async function slot<T>(
  id: string,
  about: Pick<Work, 'kind' | 'label' | 'detail' | 'askId' | 'about'>,
  fn: (onEvent: (e: ChatEvent) => void, runId: string) => Promise<T>,
  options: { greeting?: true } = {}
): Promise<T> {
  const work: Work = {
    ...about,
    id: ++workIds,
    since: new Date().toISOString(),
    queued: true,
    steps: 0
  };
  const run = reserveRun({ staffId: id, kind: options.greeting ? 'hello' : about.kind, work });
  const active = () =>
    [...runsGoing.values()].filter((r) => r.staffId === id && r.work && !r.work.queued).length;
  if (active() >= AT_ONCE) {
    show();
    await new Promise<void>((enter) => {
      run.enter = () => enter();
      run.stop.signal.addEventListener('abort', run.enter, { once: true });
    });
  }
  if (run.enter) run.stop.signal.removeEventListener('abort', run.enter);
  work.queued = false;
  work.since = new Date().toISOString();
  show();
  try {
    return await fn((e) => {
      if (e.type !== 'tool') return;
      work.doing = e.name;
      work.steps++;
      show();
    }, run.key);
  } finally {
    releaseRun(run);
    bus.emit('run-ended');
    show();
    const next = [...runsGoing.values()].find((r) => r.staffId === id && r.work?.queued && r.enter);
    if (next && active() < AT_ONCE) {
      next.work!.queued = false; // The queued entry above has a work item.
      next.enter!(); // Only entries waiting on a slot have enter.
    }
  }
}
