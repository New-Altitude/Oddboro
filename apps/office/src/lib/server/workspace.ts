import {
  advancedMode,
  desk,
  guessesWaiting,
  MANAGERS,
  projectOverview,
  proposedProjectWork,
  roster,
  unreadPokes,
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
        nativeId: s.nativeId,
        questions: projectController()
          .view(s.id)
          .questions.map((q) => ({
            key: q.key,
            label:
              (Array.isArray(q.params.questions) &&
                q.params.questions.find((entry) => typeof entry?.question === 'string')
                  ?.question) ||
              (q.method.endsWith('requestUserInput')
                ? 'Answer a question in '
                : 'Review approval in ') + s.title
          })),
        terminalPid: projectController().terminalPid(s.id),
        title: s.title,
        folder: s.folder,
        agent: s.agent,
        staffId: s.staffId,
        status: projectController().status(s.id, s.status)
      }))
    : [];
  return {
    sessions,
    uncertain: advanced ? await proposedProjectWork('uncertain') : [],
    staff: rows.map((r) => toProfile(r, guesses[r.id])),
    desk: await desk(),
    unread: await unreadPokes(),
    working: working(),
    inProgress: inProgress(),
    advanced,
    welcomed: await welcomed(),
    managers: MANAGERS.map(({ id, name, trait }) => ({ id, name, trait }))
  };
}
