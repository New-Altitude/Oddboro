// Scheduled work uses the same runner and live slots as every other job.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  accountOf,
  home,
  job as jobById,
  staffer,
  workFile,
  type JobRow,
  type RunTrigger
} from '@oddboro/ledger';
import { workName } from '@oddboro/ledger/work-paths';
import { grokHome } from './grok.ts';
import { jobBrief, jobWork } from './job-brief.ts';
import { scheduledFiles } from './scheduled-files.ts';
import { slot } from './run-state.ts';
import { run, type Run } from './staff.ts';

const JOB_TIMEOUT_MS = 20 * 60_000;

/**
 * Run one job in a fresh session. The staffer walks to its room while it runs.
 * `times` are the scheduled times the run is for: one, or a catch-up's
 * periods oldest first. Run now is for now.
 */
export async function runJob(
  job: JobRow,
  trigger: RunTrigger = 'schedule',
  times: Date[] = [new Date()]
): Promise<Run> {
  const named = await staffer(job.staffId);
  if (!named) return { ok: false, text: `No Odd named ${job.staffId}` };
  return slot(
    named.id,
    {
      kind: 'job',
      ...jobWork(job, times),
      about: {
        key: randomUUID(),
        kind: 'job',
        id: job.id,
        title: job.name,
        leadId: named.id,
        lead: named.name
      }
    },
    async (onEvent, runId) => {
      const who = await staffer(job.staffId);
      if (!who) return { ok: false, text: `No Odd named ${job.staffId}` };
      const opts = {
        kind: 'job' as const,
        runId,
        onEvent,
        timeoutMs: JOB_TIMEOUT_MS,
        extra: jobBrief(job, trigger, times)
      };
      if (!job.files) return run(who, job.instructions, opts);
      const current = await jobById(job.id);
      if (
        !current ||
        current.changedAt.getTime() !== job.changedAt.getTime() ||
        (trigger === 'schedule' && !current.enabled)
      )
        return {
          ok: false,
          text: `${who.name}'s job changed before it could start. Its next run uses the new settings.`
        };
      // The input is the writer's file for the newest period this run is for.
      const at = times.at(-1) ?? new Date();
      const f = await scheduledFiles(who, job, job.files, 'run', at);
      if (f.blocks.length) return { ok: false, text: f.blocks.join('\n') };
      // Grok's file server runs inside its kernel sandbox. Use its existing
      // private temp folder, which its model's file tools cannot open.
      const checks =
        who.agent === 'grok' ? grokHome(await accountOf(who)).temp : home('file-checks');
      mkdirSync(checks, { recursive: true, mode: 0o700 });
      const dir = mkdtempSync(join(checks, 'run-'));
      const record = join(dir, 'written');
      try {
        const r = await run(who, job.instructions, {
          ...opts,
          draftOnly: true,
          extra: opts.extra + f.brief,
          jobFiles: {
            ...job.files,
            input: f.input,
            output: f.output,
            inputHash: f.source?.sha256,
            record
          }
        });
        if (!r.ok) return r;
        // Another clock can finish, or the owner can withdraw the work, while
        // the model is reading. Publish a check only for the same assignment.
        const after = await scheduledFiles(who, job, job.files, 'review', at);
        if (after.blocks.length) return { ok: false, text: after.blocks.join('\n') };
        if (
          after.source?.run !== f.source?.run ||
          (await jobById(job.id))?.changedAt.getTime() !== job.changedAt.getTime()
        )
          return {
            ok: false,
            text: `${who.name}'s scheduled files changed during "${job.name}". The next scheduled run will check the current files.`
          };
        const actual = await workFile(
          who.id,
          workName(job.files.thread, `${who.id}/${job.files.output}`)
        );
        const digest = existsSync(record) ? readFileSync(record, 'utf8') : '';
        if (
          !actual ||
          !digest ||
          digest !== createHash('sha256').update(readFileSync(actual)).digest('hex')
        )
          return {
            ok: false,
            text: `${who.name} did not leave a checked result for "${job.name}". Ask ${who.name} in chat to check the file steps for ${job.files.output} before the next run.`
          };
        return {
          ...r,
          checked: {
            input: job.files.input,
            inputRun: f.source?.run,
            output: `${who.id}/${job.files.output}`,
            sha256: digest
          }
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
}
