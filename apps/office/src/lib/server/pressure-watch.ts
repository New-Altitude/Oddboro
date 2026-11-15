// A single check on the computer running the office, including a headless office.
// Read host counters while a manager is on staff. Walk the process tree only under pressure.
import { manager } from '@oddboro/ledger';
import { bus, emit, type OfficeEvent } from './events.ts';
import { notifyMac } from './notify.ts';
import { readComputerActivity } from './computer-activity.ts';
import {
  PRESSURE_INTERVAL,
  pressureAdvice,
  pressureDetector,
  readPressure,
  type PressureAdvice,
  type Resource
} from './computer-pressure.ts';

export type ManagerAdvice = PressureAdvice & { manager: string };
// The server and every page share one monitor, including across a dev-server reload.
type Watch = { latest: ManagerAdvice | null; stop?: () => void };
const g = globalThis as typeof globalThis & { officePressure?: Watch };
const watch: Watch = (g.officePressure ??= { latest: null });
export const currentPressure = () => watch.latest;

/** Resample the leading process during a long episode. Two clear readings rearm the notification. */
export function pressureEpisode() {
  let active: Resource | null = null,
    clear = 0,
    measured = 0;
  return (resource: Resource | null, now: number) => {
    if (!resource) {
      if (active && ++clear >= 2) {
        active = null;
        return 'clear';
      }
      return;
    }
    clear = 0;
    if (active === resource && now >= measured && now - measured < 60_000) return;
    const action = active ? 'update' : 'notify';
    active = resource;
    measured = now;
    return action;
  };
}

export function startPressureWatch() {
  if (watch.stop) return watch.stop;
  let name: string | undefined,
    revision = 0,
    generation = 0;
  let timer: ReturnType<typeof setTimeout>;
  function publish(advice: ManagerAdvice | null) {
    watch.latest = advice;
    emit({ type: 'pressure', advice });
  }
  async function staffing() {
    const id = ++revision;
    const who = await manager();
    if (id !== revision || name === who?.name) return;
    name = who?.name;
    const current = ++generation;
    clearTimeout(timer);
    if (watch.latest) publish(null);
    if (!who) return;
    const managerName = who.name;
    const detect = pressureDetector(),
      episode = pressureEpisode();
    async function check() {
      try {
        const reading = await readPressure();
        if (current !== generation) return;
        const resource = detect(reading);
        const change = episode(resource, reading.at);
        if (change === 'clear') publish(null);
        else if (change && resource) {
          const sample = await readComputerActivity().catch(() => null);
          if (current !== generation) return;
          const advice = { ...pressureAdvice(resource, sample), manager: managerName };
          publish(advice);
          if (change === 'notify')
            void notifyMac(
              advice.manager,
              [advice.heading, advice.detail, advice.action].join(' ')
            ).catch((error: unknown) => console.error('Computer pressure notification:', error));
        }
      } finally {
        if (current === generation) timer = setTimeout(run, PRESSURE_INTERVAL).unref();
      }
    }
    const run = () =>
      void check().catch((error: unknown) => console.error('Computer pressure check:', error));
    run();
  }
  const refresh = () =>
    void staffing().catch((error: unknown) => console.error('Computer pressure watch:', error));
  const changed = (e: OfficeEvent) => {
    if (e.type === 'change' && e.table === 'staff') refresh();
  };
  bus.on('event', changed);
  refresh();
  watch.stop = () => {
    delete watch.stop;
    bus.off('event', changed);
    revision++;
    generation++;
    clearTimeout(timer);
    if (watch.latest) publish(null);
  };
  return watch.stop;
}
