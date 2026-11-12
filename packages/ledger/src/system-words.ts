// The word for the owner's computer in what the office says. Imports only a
// type, so the page can read it too.
import type { System } from './platform.ts';

/** "Mac" on a Mac; anywhere else, or when the system is not known yet, "computer". */
export function computerWord(system: System | undefined): 'Mac' | 'computer' {
  return system === 'mac' ? 'Mac' : 'computer';
}
