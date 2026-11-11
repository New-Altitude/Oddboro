// What reaches the Odd when the owner answers something on the desk: an ask,
// a task or a report, and a goal's change of status. One row per kind and
// answer, so a new kind fails the type check here until it says what its
// answer does. Imports types only, so the page reads it too.
import type { AskKind, GoalStatus } from './schema.ts';

export const DESK_ITEMS = ['ask', 'task', 'report'] as const;
export type DeskItem = (typeof DESK_ITEMS)[number];

/**
 * What reaches the Odd when the owner answers. A `none` names the Linear row
 * that would add it.
 *
 * - `approval_work`: what approving means, done by the function that approves
 *   that kind (`approveGoal`, `approvePlan`) before the answer goes back.
 * - `carry_out`: a `carry_out` follow-up, to do what the ask or task waited on.
 * - `grant_access`: the access the ask names is granted (`grantAccess`). A tool
 *   already connected starts the work that waited on it (`carry_out`) at once;
 *   otherwise the owner gets a task to connect it, and finishing that starts it.
 * - `give_folder`: the folder the owner gave went to the Odd with the yes
 *   (`giveFolder`), and the work that waited on it starts, once for each place
 *   a result goes back to.
 * - `turn_on`: the switches the ask names turned on with the yes
 *   (`turnOnSwitches`), and the work that waited on them starts, once for each
 *   place a result goes back to.
 * - `start_held`: the hand-off the ask held starts, as the ask is claimed.
 * - `answer_window`: the usage window's answer (`answerWindow`).
 * - `answer_hand_offs`: the yes or no to more hand-offs goes to the thread's hub
 *   (`answerHandOffs`).
 * - `answer_back`: the answer itself goes to the hand-off or thread it was
 *   raised on (`answerLater`). Raised on neither, it reaches nobody.
 * - `rework`: a `rework` follow-up, with what to change.
 * - `denied_lesson`: a `denied` follow-up, when the no carries a reason.
 * - `task_done`: a `task_done` follow-up, to pick up what waited on the task.
 * - `odd_leaves`: the Odd the ask names leaves the office (`removeOdd` in
 *   leaving.ts), after the answer went back, so leaving closes any run it started.
 * - `odd_returns`: the Odd the ask names comes back as it was (`bringBack`).
 */
export type Effect =
  | 'approval_work'
  | 'carry_out'
  | 'grant_access'
  | 'give_folder'
  | 'turn_on'
  | 'start_held'
  | 'answer_window'
  | 'answer_hand_offs'
  | 'answer_back'
  | 'rework'
  | 'denied_lesson'
  | 'task_done'
  | 'odd_leaves'
  | 'odd_returns'
  | { none: string };
export type AskEffect = Exclude<Effect, 'task_done'>;
export type TaskEffect = Extract<
  Effect,
  'carry_out' | 'task_done' | 'answer_back' | { none: string }
>;

export type AskAnswer = {
  /**
   * A hire, a reply, a filter, a folder or a call is approved by doing it
   * (`approveHire`, `reply/`, `filter/`, `folder/`, `call/`), never by a bare yes: `by` is what the
   * office answers a bare yes with. Then `then` runs.
   */
  approve: readonly AskEffect[] | { by: string; then: readonly AskEffect[] };
  deny: readonly AskEffect[];
  /**
   * `refused`: the owner says yes or no and nobody reworks it, since the office
   * raised it, or it lets an Odd go or brings one back.
   */
  iterate: readonly AskEffect[] | 'refused';
};
/**
 * An answer with no run to follow it, to an ask raised on no hand-off and no
 * thread, tells the Odd that asked nothing: a yes to a hire or a goal, and a
 * no with no reason.
 */
const OFF_A_THREAD = { none: 'NEW-1715' };
/** A no: the answer goes back, and its reason is a lesson for the Odd that asked. */
const NO: readonly AskEffect[] = ['answer_back', 'denied_lesson', OFF_A_THREAD];
const REWORK: readonly AskEffect[] = ['rework'];

export const OWNER_ANSWERS = {
  ask: {
    approval: { approve: ['carry_out'], deny: NO, iterate: REWORK },
    access: { approve: ['grant_access'], deny: NO, iterate: REWORK },
    hire: {
      approve: { by: 'Approve a hire by hiring', then: ['answer_back', OFF_A_THREAD] },
      deny: NO,
      iterate: REWORK
    },
    // Setting the goal wakes the Office Manager to plan it, on the goal's thread.
    goal: { approve: ['approval_work', 'answer_back', OFF_A_THREAD], deny: NO, iterate: REWORK },
    // A plan is always raised on its goal's thread, so its answer always reaches the lead.
    plan: {
      approve: ['approval_work', 'answer_back'],
      deny: ['answer_back', 'denied_lesson'],
      iterate: REWORK
    },
    hand_offs: {
      approve: ['start_held', 'answer_hand_offs'],
      deny: ['answer_hand_offs', 'denied_lesson'],
      iterate: 'refused'
    },
    // The office raised it, not the Odd named on it, so a no has no lesson.
    window: { approve: ['answer_window'], deny: ['answer_window'], iterate: 'refused' },
    reply: {
      approve: {
        by: 'Send the reply, or save it to Gmail drafts',
        then: ['answer_back', OFF_A_THREAD]
      },
      deny: NO,
      iterate: REWORK
    },
    filter: {
      approve: {
        by: 'Create the filter from its card on the desk',
        then: ['answer_back', OFF_A_THREAD]
      },
      deny: NO,
      iterate: REWORK
    },
    folder: {
      approve: { by: 'Give the folder from its card on the desk', then: ['give_folder'] },
      deny: NO,
      iterate: REWORK
    },
    // Plain Approve is the desk's Turn on.
    switch: { approve: ['turn_on'], deny: NO, iterate: REWORK },
    call: {
      approve: { by: 'Approve the call from its card on the desk', then: ['carry_out'] },
      deny: NO,
      iterate: REWORK
    },
    remove: { approve: ['answer_back', OFF_A_THREAD, 'odd_leaves'], deny: NO, iterate: 'refused' },
    bring_back: {
      approve: ['answer_back', OFF_A_THREAD, 'odd_returns'],
      deny: NO,
      iterate: 'refused'
    }
  } satisfies Record<AskKind, AskAnswer>,
  task: {
    done: {
      /** The owner finished connecting a tool an Odd asked for: the work that waited on it starts. */
      fromAccess: ['carry_out'],
      other: ['task_done'],
      /** A task no Odd gave the owner. */
      noOdd: []
    },
    dropped: ['answer_back', { none: 'NEW-1703' }]
  } satisfies {
    done: Record<'fromAccess' | 'other' | 'noOdd', readonly TaskEffect[]>;
    dropped: readonly TaskEffect[];
  },
  report: { read: [] }
} satisfies Record<DeskItem, unknown>;

/**
 * What a goal's change of status tells the Odds that serve it. `updateGoal`
 * runs nothing, so each is a `none`: a status that should reach them widens
 * this type and adds its effect there.
 */
export const GOAL_ANSWERS: Record<Exclude<GoalStatus, 'active'>, readonly { none: string }[]> = {
  paused: [{ none: 'NEW-1704' }],
  met: [{ none: 'NEW-1704' }],
  dropped: [{ none: 'NEW-1704' }]
};
