// One job: run it now, change it, pause it, or remove it.
import { error, json } from '@sveltejs/kit';
import { deleteJob, job, MISSED_RUNS, updateJob } from '@oddboro/ledger';
import { runNow } from '#lib/server/jobs.ts';
import { parseSchedule } from '#lib/server/schedule.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  const id = Number(params.id);
  if (!(await job(id))) error(404, 'No such job');
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.op === 'run') await runNow(id);
  else if (b.op === 'delete') await deleteJob(id).catch((e: Error) => error(400, e.message));
  else if (b.op === 'update') {
    const schedule = b.schedule === undefined ? undefined : parseSchedule(b.schedule);
    if (schedule === null) error(400, 'Say how often it runs');
    const missed = MISSED_RUNS.find((m) => m === b.missed);
    if (b.missed !== undefined && !missed) error(400, 'Say latest or record for missed runs');
    await updateJob(id, {
      ...(typeof b.name === 'string' && b.name.trim() ? { name: b.name.trim().slice(0, 80) } : {}),
      ...(typeof b.instructions === 'string' && b.instructions.trim()
        ? { instructions: b.instructions.trim().slice(0, 8000) }
        : {}),
      ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}),
      ...(typeof b.report === 'boolean' ? { report: b.report } : {}),
      ...(missed ? { missed } : {}),
      ...(schedule ? { schedule } : {})
    });
  } else error(400, 'Say run, update or delete');
  return json({ ok: true });
};
