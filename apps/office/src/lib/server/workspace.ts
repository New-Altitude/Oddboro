import { advancedMode, desk, guessesWaiting, MANAGERS, roster, welcomed } from '@oddboro/ledger';
import { toProfile } from './profile.ts';
import { inProgress, working } from './staff.ts';

export async function workspace() {
  const rows = await roster();
  const guesses = await guessesWaiting(rows.map((r) => r.id));
  return {
    staff: rows.map((r) => toProfile(r, guesses[r.id])),
    desk: await desk(),
    working: working(),
    inProgress: inProgress(),
    advanced: await advancedMode(),
    welcomed: await welcomed(),
    managers: MANAGERS.map(({ id, name, trait }) => ({ id, name, trait }))
  };
}
