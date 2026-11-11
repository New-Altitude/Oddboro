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
import { scheduledFiles } from './scheduled-files.ts';
import { slot } from './run-state.ts';
import { run, type Run } from './staff.ts';

const JOB_TIMEOUT_MS = 20 * 60_000;

/** Run one job in a fresh session. The staffer walks to its room while it runs. */
export async function runJob(job: JobRow, trigger: RunTrigger = 'schedule'): Promise<Run> {
  const named = await staffer(job.staffId);
  if (!named) return { ok: false, text: `No Odd named ${job.staffId}` };
  return slot(
    named.id,
    {
      kind: 'job',
      label: job.name,
      detail: 'Running a job',
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
        extra: `\n## This run\n\nYou are running your job "${job.name}". {owner} is not in a chat with you.${trigger === 'manual' ? ' They started this run by hand just now, so they are at their screen: send anything the job has for them now (poke_owner with in_minutes 0), whatever quiet hours you keep for them.' : ''} Do the job, then reply with what you did in a few plain lines. Your reply goes in the ledger${job.report ? ' and on their desk as a report' : ''}.\n`
      };
      if (!job.files) return run(who, job.instructions, opts);
      const current = await jobById(job.id);
      if (
        !current ||
        current.changedAt.getTime() !== job.changedAt.getTime() ||
        (trigger !== 'manual' && !current.enabled)
      )
        return {
          ok: false,
          text: `${who.name}'s job changed before it could start. Its next run uses the new settings.`
        };
      const f = await scheduledFiles(who, job, job.files, 'run');
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
        const after = await scheduledFiles(who, job, job.files, 'review');
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
          checkedFiles: {
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
