// What a job's run is told about itself: that it runs the job, who started it,
// and the time it is for. A run on time, a late one and Run now each say the
// time they are for and the time it is now, so a run counts and labels by its
// own time, never by when it happened to start. A catch-up lists every
// period it owes, oldest first.
import type { JobRow, RunTrigger } from '@oddboro/ledger';
import { runTime } from '@oddboro/ledger/time';

/** What the In progress list and the floor call a job's run. */
export function jobWork(
  job: Pick<JobRow, 'name'>,
  times: Date[]
): { label: string; detail: string } {
  return times.length > 1
    ? { label: `Catching up ${times.length} periods of ${job.name}`, detail: 'Catching up' }
    : { label: job.name, detail: 'Running a job' };
}

/** The lines on the time a run is for. `times` is never empty. */
function forWhen(times: Date[], now: Date): string {
  const at = `It is now ${runTime(now)}.`;
  if (times.length === 1)
    return `This run is for ${runTime(times[0])}. ${at} Count and label what this run makes by the time it is for, never by now.`;
  return [
    `This run catches up ${times.length} periods this job missed while the office was off. ${at} The periods, oldest first:`,
    '',
    ...times.map((t) => `- ${runTime(t)}`),
    '',
    'Write one entry for each period, labelled with its own time, never with now. When a period\'s data cannot be fetched after the fact, record "no data for <period>" for it. Never fill a past period with current numbers.'
  ].join('\n');
}

/** The "This run" section of a job's brief. `{owner}` is the owner's name, filled in later. */
export function jobBrief(
  job: Pick<JobRow, 'name' | 'report'>,
  trigger: RunTrigger,
  times: Date[],
  now = new Date()
): string {
  const byHand =
    trigger === 'manual'
      ? ' They started this run by hand just now, so they are at their screen: send anything the job has for them now (poke_owner with in_minutes 0), whatever quiet hours you keep for them.'
      : '';
  return `\n## This run\n\nYou are running your job "${job.name}". {owner} is not in a chat with you.${byHand}\n\n${forWhen(times, now)}\n\nDo the job, then reply with what you did in a few plain lines. Your reply goes in the ledger${job.report ? ' and on their desk as a report' : ''}.\n`;
}
