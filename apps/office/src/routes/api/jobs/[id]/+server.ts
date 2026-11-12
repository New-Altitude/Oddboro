// One job: run it now, change it, pause it, or remove it.
import { error, json } from '@sveltejs/kit';
import {
  deleteJob,
  job,
  latestScheduledRuns,
  MISSED_RUNS,
  staffer,
  updateJob
} from '@oddboro/ledger';
import { runNow } from '#lib/server/jobs.ts';
import { scheduledFiles } from '#lib/server/scheduled-files.ts';
import { parseSchedule } from '#lib/server/schedule.ts';
import type { RequestHandler } from './$types';

/** Review the saved setup without moving its timer or starting a run. */
export const GET: RequestHandler = async ({ params }) => {
  const j = await job(Number(params.id));
  if (!j?.files) error(404, 'This job has no scheduled files.');
  const who = await staffer(j.staffId);
  if (!who) error(404, 'No such Odd');
  const { blocks, waiting, signIns, browse } = await scheduledFiles(who, j, j.files, 'review');
  const [last] = await latestScheduledRuns([j.id], true);
  return json({
    blocks,
    waiting,
    signIns,
    browse,
    checkedAt: last && last.startedAt >= j.changedAt ? last.finishedAt : null
  });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const id = Number(params.id);
  const j = await job(id);
  if (!j) error(404, 'No such job');
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.op === 'run') await runNow(id);
  else if (b.op === 'delete') await deleteJob(id).catch((e: Error) => error(400, e.message));
  else if (b.op === 'update') {
    const schedule = b.schedule === undefined ? undefined : parseSchedule(b.schedule);
    if (schedule === null) error(400, 'Say how often it runs');
    const missed = MISSED_RUNS.find((m) => m === b.missed);
    if (b.missed !== undefined && !missed) error(400, 'Say latest or record for missed runs');
    const sharing = typeof b.share === 'boolean';
    if (
      sharing &&
      (!j.files?.sources?.length || JSON.stringify(b.expectedFiles) !== JSON.stringify(j.files))
    )
      error(409, 'This job changed. Reopen it to see its files.');
    await updateJob(
      id,
      {
        ...(sharing && j.files ? { files: { ...j.files, share: b.share === true } } : {}),
        ...(typeof b.name === 'string' && b.name.trim()
          ? { name: b.name.trim().slice(0, 80) }
          : {}),
        ...(typeof b.instructions === 'string' && b.instructions.trim()
          ? { instructions: b.instructions.trim().slice(0, 8000) }
          : {}),
        ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}),
        ...(typeof b.report === 'boolean' ? { report: b.report } : {}),
        ...(missed ? { missed } : {}),
        ...(schedule ? { schedule } : {})
      },
      sharing ? (j.files ?? undefined) : undefined
    ).catch((e: Error) => error(409, e.message));
  } else error(400, 'Say run, update or delete');
  return json({ ok: true });
};
