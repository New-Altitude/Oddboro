// The office reads the owner's key first as it starts, in a release (`init`
// in hooks.server.ts) and in dev (`ownerOnly` in vite.config.ts). It cannot
// answer anyone without the key, so a key file it cannot use stops the start.
// The app's failure dialog shows the end of the office's log, so the start
// prints only the key's own sentence, which says what to do: a stack there
// would bury it under lines of paths.
import { ownerKey } from '@oddboro/ledger/owner-key';

/** The owner's key, made if there is none. A key file it cannot use ends the process with that one sentence. */
export function ownerKeyAtStart(): string {
  try {
    return ownerKey();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
