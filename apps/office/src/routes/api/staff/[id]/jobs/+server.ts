// A staffer's jobs: list them, or add one.
import { error, json } from '@sveltejs/kit';
import { addJob, jobsFor, MISSED_RUNS, staffer } from '@oddboro/ledger';
import { parseSchedule } from '#lib/server/schedule.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => json(await jobsFor(params.id));

export const POST: RequestHandler = async ({ params, request }) => {
  if (!(await staffer(params.id))) error(404, 'No such Odd');
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
  const instructions =
    typeof b.instructions === 'string' ? b.instructions.trim().slice(0, 8000) : '';
  const schedule = parseSchedule(b.schedule);
  if (!name || !instructions) error(400, 'Give the job a name and say what to do');
  if (!schedule) error(400, 'Say how often it runs');
  const missed = MISSED_RUNS.find((m) => m === b.missed);
  return json(
    await addJob({
      staffId: params.id,
      name,
      instructions,
      schedule,
      report: b.report === true,
      ...(missed ? { missed } : {})
    })
  );
};
