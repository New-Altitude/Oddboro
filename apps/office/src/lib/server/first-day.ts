// A new hire's first minutes, as a decision with no database, so a test reads
// it as `firstDay` does.

/**
 * What a new hire's hello says about what comes next, and whether its first
 * day starts once it has said it. Only a hire with a job starts one. A hire
 * that serves a goal and has no job starts nothing: the goal's lead hands it
 * its first piece. With a job and a goal, the job's first day runs off the
 * goal's thread.
 */
export function firstDayOf(h: { jobs: number; goal?: { title: string } }): {
  hello: string[];
  starts: boolean;
} {
  if (h.jobs > 0)
    return {
      hello: [
        '- Say what you will do first, and when your jobs run.',
        '- Tell them you are getting started now. Do not do the work in this reply: the office starts your first day the moment you finish.'
      ],
      starts: true
    };
  return {
    hello: [
      h.goal
        ? `- Say what you are here for in the goal "${h.goal.title}". The Odd who leads it hands you your first piece when the plan gets to you, so you start nothing on your own, and {owner} need not tell you to.`
        : '- You have no job yet, so you run only when a colleague hands you work or {owner} writes to you here. Say so, and that they can give you a job on your Jobs tab.',
      '- Do no work in this reply.'
    ],
    starts: false
  };
}
