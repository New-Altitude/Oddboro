// Reconcile results from the existing clock. No timer or separate job runner lives here.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import {
  claimResultRepair,
  editionRuns,
  editionsFor,
  ensureEditions,
  job,
  patchEdition,
  payloadHash,
  putResultOnDesk,
  resultDay,
  resultIncident,
  explainResult,
  runtimeSummary,
  scheduledResultPlans,
  staffer,
  workFile,
  type JobRow,
  type RunRow,
  type ResultEdition,
  type ScheduledResult
} from '@oddboro/ledger';
import { workName } from '@oddboro/ledger/work-paths';
import { deliverResult } from './scheduled-delivery.ts';
import { scheduledFiles } from './scheduled-files.ts';

type StartRepair = (j: JobRow, r: RunRow) => void;
let checking: Promise<number> | undefined;
export function checkScheduledResults(start: StartRepair, now = new Date()): Promise<number> {
  return (checking ??= checkAll(start, now).finally(() => {
    checking = undefined;
  }));
}
async function checkAll(start: StartRepair, now: Date) {
  let next = now.getTime() + 600000;
  for (const p of await scheduledResultPlans()) {
    if (!p.enabled) continue;
    try {
      await ensureEditions(p, now);
      for (const e of await editionsFor(p.id)) {
        if (e.day < resultDay(now, p.zone)) {
          if (!e.deskAt && !e.reason)
            await patchEdition(e.id, {
              reason: 'Missed edition. Later research cannot establish coverage for this day.'
            });
          // Only read-only reconciliation may continue for an old uncertain delivery.
          if (['sending', 'uncertain'].includes(e.delivery))
            await deliverResult(p, e, { now, maySend: false });
          continue;
        }
        const at = await checkEdition(p, e, start, now);
        if (at) next = Math.min(next, at);
      }
    } catch (e) {
      console.error(`Could not check required result ${p.id}:`, e);
      next = Math.min(next, now.getTime() + 30000);
    }
  }
  return next;
}
async function checkEdition(
  p: ScheduledResult,
  e: ResultEdition,
  start: StartRepair,
  now: Date
): Promise<number | undefined> {
  if (e.delivery === 'accepted') return;
  if (e.destination.kind === 'desk' && e.deskAt) return;
  if (['sending', 'uncertain'].includes(e.delivery))
    return deliverResult(p, e, { now, maySend: false });
  const producer = await job(p.producerId),
    reviewer = await job(p.reviewerId);
  if (
    !producer?.enabled ||
    !reviewer?.enabled ||
    p.revision !== e.revision ||
    producer.changedAt.getTime() !== p.producerChangedAt.getTime() ||
    reviewer.changedAt.getTime() !== p.reviewerChangedAt.getTime()
  ) {
    await explainResult(
      p,
      e,
      'The result plan or jobs changed. Review the requirement before a new edition runs.'
    );
    return;
  }
  const rows = await editionRuns(e, p),
    pr = rows.find((r) => r.jobId === p.producerId),
    rr = rows.find((r) => r.jobId === p.reviewerId);
  const clock = runtimeSummary(now.getTime()).clock;
  const recorded = clock?.gaps ?? [];
  // This clock check is recorded after reconciliation. Preserve a still-open
  // gap too, so catch-up delivery cannot precede its runtime evidence.
  const openGap =
    clock?.expectedAt && now.getTime() > clock.expectedAt + 60000
      ? [{ from: clock.expectedAt, to: now.getTime(), cause: 'unknown' as const }]
      : [];
  const gaps = [
    ...new Map(
      [...e.evidence.gaps, ...recorded, ...openGap]
        .filter(
          (g) =>
            resultDay(new Date(g.to), p.zone) >= e.day &&
            resultDay(new Date(g.from), p.zone) <= e.day
        )
        .map((g) => [`${g.from}:${g.to}`, { from: g.from, to: g.to, cause: g.cause }])
    ).values()
  ].slice(-40);
  const evidence = { ...e.evidence, gaps };
  if (pr?.status === 'done' && pr.checkedFiles) {
    evidence.producerRun = pr.id;
    evidence.savedAt = pr.finishedAt?.toISOString();
  }
  if (JSON.stringify(evidence) !== JSON.stringify(e.evidence)) {
    await patchEdition(e.id, { evidence });
    e = { ...e, evidence };
  }
  const waiting = pr?.status === 'running' || rr?.status === 'running';
  const reviewed =
    pr?.status === 'done' &&
    pr.checkedFiles &&
    rr?.status === 'done' &&
    rr.checkedFiles?.inputRun === pr.id &&
    rr.checkedFiles.input === reviewer.files?.input;
  if (!reviewed) {
    if (waiting) {
      if (now >= e.deadline)
        await explainResult(
          p,
          e,
          'The deadline passed while work was still running. Wait for that run; no duplicate was started.'
        );
      return now < e.deadline ? e.deadline.getTime() : undefined;
    }
    const target = pr?.status === 'done' && pr.checkedFiles ? reviewer : producer;
    const latest = target.id === producer.id ? pr : rr;
    const due = latest?.status === 'failed' || now >= e.deadline;
    if (!due) return e.deadline.getTime();
    const who = await staffer(target.staffId);
    if (!who || !target.files) {
      await explainResult(p, e, 'Restore the assigned Odd and files before recovery.');
      return;
    }
    const access = await scheduledFiles(who, target, target.files, 'run');
    if (access.blocks.length) {
      await explainResult(p, e, access.blocks.join('\n'));
      return;
    }
    const repair = await claimResultRepair(
      p,
      e,
      target.id,
      target.id === reviewer.id ? pr?.checkedFiles?.sha256 : undefined
    );
    if (repair) {
      await explainResult(
        p,
        { ...e, attempts: e.attempts + 1 },
        `Recovery started: ${target.name}. Its existing instructions and access limits still apply.`
      );
      start(repair.job, repair.run);
    } else
      await explainResult(
        p,
        e,
        e.attempts >= p.repairs
          ? 'The recovery allowance is used. Inspect the failed run before authorizing more work.'
          : 'The review failed again with unchanged producer bytes. Change the result or instructions before another review.'
      );
    return;
  }
  if (!rr?.checkedFiles) return;
  const who = await staffer(reviewer.staffId);
  if (!who || !reviewer.files) return;
  const access = await scheduledFiles(who, reviewer, reviewer.files, 'run');
  if (access.blocks.length) {
    await explainResult(p, e, access.blocks.join('\n'));
    return;
  }
  const path = await workFile(
    reviewer.staffId,
    workName(p.threadId, `${reviewer.staffId}/${reviewer.files.output}`)
  );
  if (!path || statSync(path).size > 100000) {
    await explainResult(
      p,
      e,
      'The reviewed output is missing or exceeds 100,000 bytes. Produce a shorter edition; no text was cut.'
    );
    return;
  }
  const bytes = readFileSync(path),
    sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== rr.checkedFiles.sha256) {
    await explainResult(
      p,
      e,
      'The output changed after review. Run the reviewer on the current file before delivery.'
    );
    return;
  }
  if (!e.evidence.payload) {
    const subject = `${p.title} · ${e.day}`;
    const coverage = gaps.length
      ? `\n\nClock gaps observed: ${gaps.map((g) => `${new Date(g.from).toISOString()} to ${new Date(g.to).toISOString()}`).join('; ')}. Their cause is unknown. This edition does not establish research coverage during those gaps.`
      : '';
    const body = bytes.toString('utf8') + coverage;
    const kept = {
      ...e.evidence,
      reviewerRun: rr.id,
      reviewedAt: rr.finishedAt?.toISOString(),
      output: path,
      sha256: sha,
      payload: { subject, body, hash: payloadHash(subject, body) }
    };
    await patchEdition(e.id, { evidence: kept, delivery: 'ready', reason: null });
    e = { ...e, evidence: kept, delivery: 'ready', reason: null };
  } else if (e.evidence.sha256 !== sha) {
    await explainResult(
      p,
      e,
      'This edition already has a frozen reviewed message. Inspect it before changing its delivery.'
    );
    return;
  }
  e = await putResultOnDesk(p, e);
  if (e.destination.kind === 'desk') {
    if (e.deskAt && e.deskAt > e.deadline)
      await explainResult(
        p,
        e,
        'Available on the Desk after its deadline. The missed deadline remains recorded.'
      );
    else await resultIncident(p, '', e);
    return;
  }
  return deliverResult(p, e, { now, maySend: true });
}
