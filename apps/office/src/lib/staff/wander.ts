// How a free Odd spends its time on the floor: what it does next, and how
// long it stays there. Plain numbers, with no PixiJS.
import type { Activity } from './roster.ts';

// Idle staff wander between these, mostly working, with real breaks.
const IDLE_WEIGHTS: Partial<Record<Activity, number>> = {
  work: 6,
  read: 2,
  intake: 1,
  play: 2,
  rest: 1,
  eat: 1,
  exercise: 1
};

/** How long a free staffer stays at each thing once it gets there, in seconds: [least, most]. */
const STAY: Partial<Record<Activity, [number, number]>> = {
  work: [60, 180],
  read: [40, 120],
  intake: [40, 90],
  play: [30, 90],
  rest: [40, 120],
  eat: [30, 75],
  exercise: [45, 120]
};
export const stayFor = (a: Activity) => {
  const [least, most] = STAY[a] ?? [30, 90];
  return (least + Math.random() * (most - least)) * 1000;
};

export function pickActivity(available: Set<string>, current: Activity): Activity {
  const options = (Object.entries(IDLE_WEIGHTS) as [Activity, number][]).filter(
    ([a]) => available.has(a) && a !== current
  );
  if (!options.length) return current;
  let r = Math.random() * options.reduce((n, [, w]) => n + w, 0);
  for (const [a, w] of options) if ((r -= w) <= 0) return a;
  return options[0][0];
}
