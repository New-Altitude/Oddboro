import {
  advancedMode,
  desk,
  guessesWaiting,
  MANAGERS,
  projectOverview,
  roster,
  welcomed
} from '@oddboro/ledger';
import { projectController } from './project-sessions/controller.ts';
import { toProfile } from './profile.ts';
import { inProgress, working } from './staff.ts';

export async function workspace() {
  const rows = await roster();
  const guesses = await guessesWaiting(rows.map((r) => r.id));
  const advanced = await advancedMode();
  const sessions = advanced
    ? (await projectOverview()).map((s) => ({
        id: s.id,
        title: s.title,
        folder: s.folder,
        agent: s.agent,
        staffId: s.staffId,
        status: projectController().status(s.id, s.status)
      }))
    : [];
  return {
    sessions,
    staff: rows.map((r) => toProfile(r, guesses[r.id])),
    desk: await desk(),
    working: working(),
    inProgress: inProgress(),
    advanced,
    welcomed: await welcomed(),
    managers: MANAGERS.map(({ id, name, trait }) => ({ id, name, trait }))
  };
}
