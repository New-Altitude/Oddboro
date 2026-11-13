// The one door from an event to its change: each kind of event has exactly
// one decider, and `decide` picks it.
//
// Pure: every import that reaches the database is a type.
import type { Decided } from '../transition.ts';
import type { WorkEvent, WorkResults } from './events.ts';
import { runClaimed, runFinished, runQueued, staleRunsClosed } from './runs.ts';
import type { Change, WorkRows } from './snapshot.ts';

type Kind = WorkEvent['kind'];
type Decider<K extends Kind> = (
  rows: WorkRows,
  event: Extract<WorkEvent, { kind: K }>,
  now: Date
) => Decided<Change<WorkResults[K]>>;

/** A kind of event added to `WorkEvent` fails the type check here until it has its decider. */
const DECIDERS: { [K in Kind]: Decider<K> } = {
  runQueued,
  runClaimed,
  runFinished,
  staleRunsClosed
};

/** What the rows and the time make of one event: a refusal, or the change and what follows its commit. */
export function decide<K extends Kind>(
  rows: WorkRows,
  event: Extract<WorkEvent, { kind: K }>,
  now: Date
): Decided<Change<WorkResults[K]>> {
  // TypeScript cannot tie the decider it looks up to this event's own kind,
  // but `DECIDERS` pairs each kind with its own decider, so the one found by
  // `event.kind` takes this event.
  const decider = DECIDERS[event.kind as K] as Decider<K>;
  return decider(rows, event, now);
}
