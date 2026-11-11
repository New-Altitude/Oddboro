// The existing jobs do the work. These rows keep the owner's required result
// and each day's evidence, including a delivery whose outcome is still unknown.
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { db } from './db.ts';
import {
  connectors,
  grants,
  jobs,
  reports,
  resultEditions,
  runs,
  scheduledResults
} from './schema.ts';
import { record, staffer, startRun } from './office.ts';
import { thread, type Db } from './threads.ts';
import { fixedError } from './errors.ts';
import { fileReaders } from './sharing.ts';
import { instant, isZone } from './time.ts';
import type { ResultDestination } from './scheduled-result-types.ts';
export type ScheduledResult = typeof scheduledResults.$inferSelect;
export type ResultEdition = typeof resultEditions.$inferSelect;
export type ResultInput = Pick<
  ScheduledResult,
  | 'producerId'
  | 'reviewerId'
  | 'responsibleId'
  | 'title'
  | 'deadline'
  | 'zone'
  | 'destination'
  | 'repairs'
>;
export const resultDay = (now: Date, zone: string) =>
  now.toLocaleDateString('en-CA', { timeZone: zone });
export function resultInstant(day: string, time: string, zone: string) {
  const [y, m, d] = day.split('-').map(Number),
    [h, min] = time.split(':').map(Number);
  return instant(y, m, d, h, min, zone);
}
export const nextDay = (day: string) =>
  new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
export const payloadHash = (subject: string, body: string) =>
  createHash('sha256')
    .update(JSON.stringify([subject, body]))
    .digest('hex');
export const scheduledResult = async (id: number) =>
  (await db.select().from(scheduledResults).where(eq(scheduledResults.id, id)))[0];
export const scheduledResultPlans = () => db.select().from(scheduledResults);
export const editionsFor = (id: number) =>
  db
    .select()
    .from(resultEditions)
    .where(eq(resultEditions.resultId, id))
    .orderBy(desc(resultEditions.day))
    .limit(31);
export const resultEdition = async (id: string) =>
  (await db.select().from(resultEditions).where(eq(resultEditions.id, id)))[0];
export const patchEdition = (id: string, patch: Partial<ResultEdition>) =>
  db.update(resultEditions).set(patch).where(eq(resultEditions.id, id));

export async function saveScheduledResult(input: ResultInput) {
  if (
    !input.title.trim() ||
    input.title.length > 100 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.deadline) ||
    !isZone(input.zone) ||
    !Number.isInteger(input.repairs) ||
    input.repairs < 0 ||
    input.repairs > 2
  )
    throw fixedError('Choose a title, deadline, time zone and zero to two recovery runs.');
  const pair = await db
    .select()
    .from(jobs)
    .where(inArray(jobs.id, [input.producerId, input.reviewerId]));
  const producer = pair.find((j) => j.id === input.producerId),
    reviewer = pair.find((j) => j.id === input.reviewerId);
  if (
    !producer?.files ||
    !reviewer?.files ||
    producer.id === reviewer.id ||
    !producer.enabled ||
    !reviewer.enabled ||
    producer.files.thread !== reviewer.files.thread ||
    reviewer.files.input !== `${producer.staffId}/${producer.files.output}`
  )
    throw fixedError(
      'Choose two enabled jobs on the same work. The reviewer must read the producer’s output.'
    );
  const work = await thread(producer.files.thread);
  if (
    !work ||
    work.status !== 'open' ||
    !(await fileReaders(work)).readers.has(input.responsibleId) ||
    !(await staffer(input.responsibleId))
  )
    throw fixedError('Choose a responsible Odd assigned to this open work.');
  await checkDestination(input.destination, input.responsibleId);
  return db.transaction(async (tx) => {
    const values = {
      ...input,
      title: input.title.trim(),
      threadId: work.id,
      producerChangedAt: producer.changedAt,
      reviewerChangedAt: reviewer.changedAt
    };
    const [row] = await tx
      .insert(scheduledResults)
      .values(values)
      .onConflictDoUpdate({
        target: scheduledResults.producerId,
        set: { ...values, enabled: true, revision: sql`${scheduledResults.revision} + 1` }
      })
      .returning();
    await record(
      {
        kind: 'work',
        actor: 'owner',
        title: `Set required result: ${row.title}`,
        body: JSON.stringify(input)
      },
      tx
    );
    return row;
  });
}
export async function checkDestination(d: ResultDestination, who: string) {
  if (d.kind === 'desk') return;
  const person = await staffer(who);
  if (!person) throw fixedError('The responsible Odd is no longer here.');
  if (
    d.kind !== 'gmail' ||
    !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(d.to) ||
    d.to.length > 254
  )
    throw fixedError('Choose one email address.');
  const [c] = await db.select().from(connectors).where(eq(connectors.id, d.connector));
  const [g] = await db
    .select()
    .from(grants)
    .where(and(eq(grants.staffId, who), eq(grants.connectorId, d.connector)));
  if (c?.config.google !== 'gmail' || c.config.oauth !== 'google' || g?.level !== 'act')
    throw fixedError('Choose an existing Gmail account with write access for the responsible Odd.');
}
export async function pauseScheduledResult(id: number, enabled: boolean) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(scheduledResults)
      .set({ enabled })
      .where(eq(scheduledResults.id, id))
      .returning();
    if (!row) throw fixedError('No such required result.');
    await record(
      {
        kind: 'work',
        actor: 'owner',
        title: `${enabled ? 'Resumed' : 'Paused'} required result: ${row.title}`,
        body: 'Existing job schedules are unchanged.'
      },
      tx
    );
  });
}
/** A repeated clock check or restart never creates a second edition. */
export async function ensureEditions(p: ScheduledResult, now: Date) {
  const today = resultDay(now, p.zone);
  let day = p.lastDay ? nextDay(p.lastDay) : resultDay(p.createdAt, p.zone);
  // Work in bounded batches after a very long absence. The next clock check continues.
  for (let count = 0; day <= today && count < 31; count++, day = nextDay(day)) {
    await db.transaction(async (tx) => {
      const id = randomUUID();
      await tx
        .insert(resultEditions)
        .values({
          id,
          resultId: p.id,
          day,
          deadline: resultInstant(day, p.deadline, p.zone),
          revision: p.revision,
          destination: p.destination,
          messageId: `<${id}@oddboro.local>`
        })
        .onConflictDoNothing();
      await tx
        .update(scheduledResults)
        .set({ lastDay: day })
        .where(
          and(
            eq(scheduledResults.id, p.id),
            sql`(${scheduledResults.lastDay} IS NULL OR ${scheduledResults.lastDay} < ${day})`
          )
        );
    });
  }
}
/** One current incident per requirement; successful repair closes that same report. */
export async function resultIncident(p: ScheduledResult, reason: string, e: ResultEdition) {
  const body = `${reason}\n\nResponsible: ${p.responsibleId}\nRecovery runs used: ${e.attempts}/${p.repairs}.\nLast verified output: ${e.evidence.output ?? 'None for this edition'}.\nEdition: ${e.day}. Deadline: ${e.deadline.toISOString()}.`;
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(scheduledResults)
      .where(eq(scheduledResults.id, p.id))
      .for('update');
    if (current.incidentId) {
      const [old] = await tx.select().from(reports).where(eq(reports.id, current.incidentId));
      if (old?.body !== body)
        await tx
          .update(reports)
          .set({
            title: `${reason ? 'Needs attention' : 'Recovered'}: ${p.title}`,
            body,
            readAt: reason ? null : new Date()
          })
          .where(eq(reports.id, current.incidentId));
    } else if (reason) {
      const [r] = await tx
        .insert(reports)
        .values({ staffId: p.responsibleId, title: `Needs attention: ${p.title}`, body })
        .returning();
      await tx
        .update(scheduledResults)
        .set({ incidentId: r.id })
        .where(eq(scheduledResults.id, p.id));
    }
  });
}
export async function putResultOnDesk(p: ScheduledResult, edition: ResultEdition) {
  return db.transaction(async (tx) => {
    const [e] = await tx
      .select()
      .from(resultEditions)
      .where(eq(resultEditions.id, edition.id))
      .for('update');
    if (e.reportId || !e.evidence.payload) return e;
    const [r] = await tx
      .insert(reports)
      .values({
        staffId: p.responsibleId,
        title: e.evidence.payload.subject,
        body: e.evidence.payload.body
      })
      .returning();
    return (
      await tx
        .update(resultEditions)
        .set({ reportId: r.id, deskAt: new Date() })
        .where(eq(resultEditions.id, e.id))
        .returning()
    )[0];
  });
}
/** Claim the allowance and run in one transaction. A restart counts that attempt. */
export async function claimResultRepair(
  p: ScheduledResult,
  e: ResultEdition,
  jobId: number,
  sha?: string
) {
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(scheduledResults)
      .where(eq(scheduledResults.id, p.id))
      .for('update');
    const [edition] = await tx
      .select()
      .from(resultEditions)
      .where(eq(resultEditions.id, e.id))
      .for('update');
    const [j] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
    if (
      !plan.enabled ||
      plan.revision !== e.revision ||
      edition.attempts >= p.repairs ||
      !j?.enabled
    )
      return;
    if (edition.repairRun) {
      const [r] = await tx.select().from(runs).where(eq(runs.id, edition.repairRun));
      if (r?.status === 'running' || (sha && edition.repairSha === sha)) return;
    }
    const r = await startRun(j, 'recovery', tx);
    await tx
      .update(resultEditions)
      .set({ attempts: edition.attempts + 1, repairRun: r.id, repairSha: sha ?? null })
      .where(eq(resultEditions.id, e.id));
    return { job: j, run: r };
  });
}
export async function approveResultEdition(id: string, expectedHash: string) {
  await db.transaction(async (tx) => {
    const [e] = await tx
      .select()
      .from(resultEditions)
      .where(eq(resultEditions.id, id))
      .for('update');
    if (
      !e ||
      e.delivery !== 'ready' ||
      !e.evidence.payload ||
      e.evidence.payload.hash !== expectedHash
    )
      throw fixedError('This edition changed. Open its exact message again.');
    await tx
      .update(resultEditions)
      .set({ approvedHash: expectedHash })
      .where(eq(resultEditions.id, id));
    await record(
      {
        kind: 'work',
        actor: 'owner',
        title: `Approved delivery of ${e.day}`,
        body: JSON.stringify({
          destination: e.destination,
          sha256: e.evidence.sha256,
          payloadHash: expectedHash
        })
      },
      tx
    );
  });
}
/** Claim before calling Gmail. An interrupted claim is uncertain, never ready to resend. */
export async function claimResultSend(p: ScheduledResult, e: ResultEdition) {
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(scheduledResults)
      .where(eq(scheduledResults.id, p.id))
      .for('update');
    const pair = await tx
      .select()
      .from(jobs)
      .where(inArray(jobs.id, [p.producerId, p.reviewerId]));
    if (
      pair.some(
        (j) =>
          !j.enabled ||
          j.changedAt.getTime() !==
            (j.id === p.producerId ? p.producerChangedAt : p.reviewerChangedAt).getTime()
      )
    )
      return;
    const who = await staffer(p.responsibleId, tx);
    if (!plan.enabled || plan.revision !== e.revision || !who || who.permission === 'read') return;
    if (e.destination.kind !== 'gmail') return;
    const [g] = await tx
      .select()
      .from(grants)
      .where(and(eq(grants.staffId, who.id), eq(grants.connectorId, e.destination.connector)));
    if (g?.level !== 'act') return;
    return (
      await tx
        .update(resultEditions)
        .set({
          delivery: 'sending',
          sendAttempts: sql`${resultEditions.sendAttempts}+1`,
          nextCheck: new Date(Date.now() + 30000)
        })
        .where(
          and(
            eq(resultEditions.id, e.id),
            eq(resultEditions.delivery, 'ready'),
            sql`${resultEditions.sendAttempts}<2`,
            who.permission === 'draft'
              ? eq(resultEditions.approvedHash, e.evidence.payload?.hash ?? '')
              : undefined
          )
        )
        .returning()
    )[0];
  });
}
export function editionBounds(e: ResultEdition, p: ScheduledResult) {
  return {
    start: resultInstant(e.day, '00:00', p.zone),
    end: resultInstant(nextDay(e.day), '00:00', p.zone)
  };
}
export async function editionRuns(e: ResultEdition, p: ScheduledResult) {
  const { start, end } = editionBounds(e, p);
  return db
    .select()
    .from(runs)
    .where(
      and(
        inArray(runs.jobId, [p.producerId, p.reviewerId]),
        inArray(runs.trigger, ['schedule', 'recovery']),
        sql`${runs.startedAt}>=${start.toISOString()} AND ${runs.startedAt}<${end.toISOString()}`
      )
    )
    .orderBy(desc(runs.id));
}
export async function resultChoices() {
  return {
    jobs: await db.select().from(jobs),
    connectors: (await db.select().from(connectors))
      .filter((c) => c.config.google === 'gmail')
      .map((c) => ({ id: c.id, name: c.name })),
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

/** Keep the explanation on this edition and the requirement's one current report. */
export async function explainResult(p: ScheduledResult, e: ResultEdition, reason: string) {
  if (e.reason !== reason) await patchEdition(e.id, { reason });
  await resultIncident(p, reason, e);
}
export async function hasResultRequirement(jobId: number, q: Db) {
  return !!(
    await q
      .select({ id: scheduledResults.id })
      .from(scheduledResults)
      .where(
        and(
          eq(scheduledResults.enabled, true),
          or(eq(scheduledResults.producerId, jobId), eq(scheduledResults.reviewerId, jobId))
        )
      )
      .limit(1)
  )[0];
}
export async function scheduledResultActivity(since: Date) {
  return db
    .select({
      title: scheduledResults.title,
      responsible: scheduledResults.responsibleId,
      day: resultEditions.day,
      deadline: resultEditions.deadline,
      savedAt: sql<string>`${resultEditions.evidence}->>'savedAt'`,
      reviewedAt: sql<string>`${resultEditions.evidence}->>'reviewedAt'`,
      output: sql<string>`${resultEditions.evidence}->>'output'`,
      deskAt: resultEditions.deskAt,
      delivery: resultEditions.delivery,
      acceptedAt: resultEditions.acceptedAt,
      receipt: resultEditions.receipt,
      reason: resultEditions.reason,
      repairs: resultEditions.attempts,
      allowance: scheduledResults.repairs
    })
    .from(resultEditions)
    .innerJoin(scheduledResults, eq(resultEditions.resultId, scheduledResults.id))
    .where(gte(resultEditions.deadline, since))
    .orderBy(desc(resultEditions.deadline))
    .limit(31);
}
