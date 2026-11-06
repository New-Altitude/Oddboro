// The words the owner never reads: threads, their numbers and hand-off counts
// are the office's plumbing, and owner surfaces name work by its title. Ledger
// tests assert it over the asks the office writes itself, and the office's
// format test over the line its cards show.
import assert from 'node:assert/strict';

const PLUMBING = /\bthreads?\b|\bhand-offs?\b|#\d+/i;

/** Fails when any of `texts` says thread, hand-off or an id like #3. */
export function ownerWords(...texts: (string | null | undefined)[]): void {
  for (const s of texts) if (s) assert.doesNotMatch(s, PLUMBING);
}
