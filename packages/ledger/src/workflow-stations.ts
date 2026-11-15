// A saved route for work. The normal hand-off carries each station, its answer
// returns to the lead, and the office's normal work thread owns the status.
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from './db.ts';
import { manager } from './goals.ts';
import type { FollowUpRow } from './office-follow-ups.ts';
import { goalThreads, type Tx, type Db } from './threads.ts';
import { ownTransaction, runAfters, type After } from './transition.ts';
import { transitionWork } from './work/apply.ts';
import {
  asks,
  threads,
  followUps,
  stationWorkflows,
  stationJobs,
  staff,
  type Station,
  type Outcome
} from './schema.ts';

export class StationProblem extends Error {}

function words(value: unknown, limit: number, message: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit)
    throw new StationProblem(message);
  return value.trim();
}
async function workflowLead(q: Db, stages: Station[]) {
  const lead = await manager(q);
  if (!lead) throw new StationProblem('Hire an Office Manager to lead the hand-offs.');
  const roster = await q.select({ id: staff.id }).from(staff).where(isNull(staff.leftAt));
  for (const stage of stages) {
    if (!roster.some((s) => s.id === stage.odd))
      throw new StationProblem(`Choose a current Odd for ${stage.name}.`);
    if (stage.odd === lead.id)
      throw new StationProblem(
        'The Office Manager leads the hand-offs. Choose a colleague for each station.'
      );
  }
  return lead;
}
export async function saveWorkflow(name: unknown, input: unknown, id?: number) {
  const title = words(name, 80, 'Name the workflow in 80 characters or fewer.');
  if (!Array.isArray(input) || input.length < 2 || input.length > 12)
    throw new StationProblem('Set up between 2 and 12 stations.');
  const stations: Station[] = input.map((row, index) => {
    if (
      row?.reviseTo != null &&
      (!Number.isInteger(row.reviseTo) || row.reviseTo < 0 || row.reviseTo >= index)
    )
      throw new StationProblem('Choose an earlier station for revisions.');
    return {
      name: words(row?.name, 60, 'Give each station a name of up to 60 characters.'),
      odd: words(row?.odd, 120, 'Choose an Odd for each station.'),
      doneWhen: words(row?.doneWhen, 500, 'Say when each station is done in up to 500 characters.'),
      ...(row.reviseTo != null ? { reviseTo: row.reviseTo } : {})
    };
  });
  await workflowLead(db, stations);
  const data = { name: title, stations };
  const [saved] =
    id === undefined
      ? await db.insert(stationWorkflows).values(data).returning()
      : await db.update(stationWorkflows).set(data).where(eq(stationWorkflows.id, id)).returning();
  if (!saved) throw new StationProblem('That workflow is no longer here.');
  return saved;
}

type Job = typeof stationJobs.$inferSelect;
async function dispatch(
  tx: Tx,
  job: Job,
  lead: string,
  index: number,
  from: number | null,
  lastResult: number | null
): Promise<After[]> {
  const station = job.stations[index];
  const previous = from === null ? undefined : job.stations[from];
  // An owner's answer can return directly to the lead before the colleague
  // has checked its work. Give that same colleague the answer and condition.
  const [answer] =
    from === index && lastResult !== null
      ? await tx
          .select({ note: followUps.note })
          .from(followUps)
          .where(eq(followUps.id, lastResult))
      : [];
  const brief = [
    job.job,
    `Station: ${station.name}. Done when: ${station.doneWhen}`,
    answer?.note && `The owner answered: ${answer.note}`,
    previous &&
      from !== index &&
      `Read the shareable work or review notes in ${previous.odd}'s part of this thread from ${previous.name}.`,
    'Leave your shareable output in your part of this thread. Report done only when the condition is met. Say what you verified.',
    station.reviseTo !== undefined &&
      'If the work needs revision, leave specific shareable review notes in your part of this thread, reply with a line saying "Revision needed", and end with "Outcome: failed". For other failures, explain what blocked you.'
  ]
    .filter(Boolean)
    .join('\n');
  const event = await transitionWork(
    {
      kind: 'handedOff',
      from: lead,
      to: station.odd,
      thread:
        job.threadId === null ? { open: { title: job.job, hubId: lead } } : { id: job.threadId },
      work: { title: station.name, brief, station: index, readers: job.stations.map((s) => s.odd) },
      carry: []
    },
    { tx }
  );
  if ('refused' in event) throw new StationProblem(event.refused);
  const result = event.change.result;
  const thread =
    'thread' in result ? result.thread : 'window' in result.held ? result.held.window : undefined;
  if (thread === undefined) throw new StationProblem('This workflow lost its thread.');
  await tx
    .update(stationJobs)
    .set({
      threadId: event.real(thread),
      station: index,
      fromStation: from,
      lastResult,
      pending: !('id' in result)
    })
    .where(eq(stationJobs.requestId, job.requestId));
  return event.after;
}

export async function startWorkflow(id: number, input: unknown, key: unknown) {
  const job = words(input, 140, 'Describe this job in 140 characters or fewer.');
  if (typeof key !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(key))
    throw new StationProblem('Open the workflow again to start a job.');
  const after = await ownTransaction(async (tx) => {
    const [flow] = await tx.select().from(stationWorkflows).where(eq(stationWorkflows.id, id));
    if (!flow) throw new StationProblem('That workflow is no longer here.');
    const [row] = await tx
      .insert(stationJobs)
      .values({ requestId: key, workflowId: id, job, stations: flow.stations })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const [old] = await tx.select().from(stationJobs).where(eq(stationJobs.requestId, key));
      if (old?.workflowId !== id || old.job !== job)
        throw new StationProblem('Start this job again.');
      return [];
    }
    const lead = await workflowLead(tx, row.stations);
    return dispatch(tx, row, lead.id, 0, null, null);
  });
  await runAfters('handedOff', after);
}

type Return = { outcome: Outcome; text: string };
/** The normal pickup is already claimed by the office. A held hand-off resumes on its normal wake. */
export async function continueStations(f: FollowUpRow): Promise<Return | undefined> {
  const stage = f.handOff?.station;
  if (
    f.threadId === null ||
    (f.kind !== 'resume' && (f.kind !== 'handed_back' || stage === undefined))
  )
    return;
  const threadId = f.threadId;
  try {
    const next = await ownTransaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(stationJobs)
        .where(eq(stationJobs.threadId, threadId))
        .for('update');
      if (!job) return;
      let target = job.station;
      let from = job.fromStation;
      let lastResult = job.lastResult;
      if (f.kind === 'resume') {
        if (!job.pending) return;
        const [thread] = await tx
          .select()
          .from(threads)
          .where(eq(threads.id, threadId))
          .for('update');
        if (thread.status !== 'open') return;
        // A yes at the hand-off limit normally starts the held station itself.
        // If the usage window also held it, only its later wake sends it.
        const [taken] = await tx
          .select({ id: followUps.id })
          .from(followUps)
          .where(
            and(
              eq(followUps.threadId, threadId),
              eq(followUps.kind, 'hand_off'),
              gt(followUps.id, job.lastResult ?? 0),
              sql`${followUps.handOff}->>'station' = ${String(job.station)}`
            )
          )
          .limit(1);
        if (taken) return;
        const [approval] = await tx
          .select({ id: asks.id })
          .from(asks)
          .where(
            and(eq(asks.threadId, threadId), eq(asks.kind, 'hand_offs'), eq(asks.status, 'open'))
          )
          .limit(1);
        if (thread.heldBy || approval)
          return {
            outcome: 'waiting',
            text: f.note || 'The office is holding this hand-off.'
          } as const;
      } else {
        const returned = f.handOff;
        if (
          stage !== job.station ||
          !returned?.id ||
          (lastResult !== null && returned.id <= lastResult)
        )
          return { outcome: 'done', text: 'This station has already handed its work on.' } as const;
        const station = job.stations[job.station];
        if (returned.answered && returned.outcome === 'done') target = job.station;
        else if (
          !returned.answered &&
          returned.outcome === 'failed' &&
          station.reviseTo !== undefined &&
          /^Revision needed\s*$/im.test(f.note ?? '')
        )
          target = station.reviseTo;
        else if (returned.outcome !== 'done')
          return {
            outcome: returned.outcome ?? 'failed',
            text: f.note || 'The station did not meet its completion condition.'
          };
        else if (job.station + 1 === job.stations.length)
          return { outcome: 'done', text: f.note || 'The last station finished.' } as const;
        else target = job.station + 1;
        from = job.station;
        lastResult = f.id;
      }
      const effects = await dispatch(tx, job, f.staffId, target, from, lastResult);
      return {
        outcome: 'done',
        text: `Passed to ${job.stations[target].name}, through the office's hand-offs.`,
        effects
      } as const;
    });
    if (!next) return;
    if ('effects' in next && next.effects) await runAfters('handedOff', next.effects);
    return { outcome: next.outcome, text: next.text };
  } catch (e) {
    if (e instanceof StationProblem) return { outcome: 'failed', text: e.message };
    throw e;
  }
}

export async function workflowBoard() {
  const workflows = await db.select().from(stationWorkflows).orderBy(asc(stationWorkflows.id));
  const rows = await db.select().from(stationJobs).orderBy(desc(stationJobs.threadId));
  const threads = await goalThreads(rows.flatMap((r) => (r.threadId === null ? [] : [r.threadId])));
  const byId = new Map(threads.map((t) => [t.id, t]));
  const failed = threads.filter((t) => t.stage === 'failed').map((t) => t.id);
  const lastFailures = failed.length
    ? await db
        .selectDistinctOn([followUps.threadId], {
          thread: followUps.threadId,
          result: followUps.result
        })
        .from(followUps)
        .where(and(inArray(followUps.threadId, failed), eq(followUps.outcome, 'failed')))
        .orderBy(followUps.threadId, desc(followUps.doneAt), desc(followUps.id))
    : [];
  const reasons = new Map(lastFailures.map((f) => [f.thread, f.result]));
  return {
    workflows,
    jobs: rows.flatMap((row) => {
      const thread = row.threadId === null ? undefined : byId.get(row.threadId);
      return thread
        ? [
            {
              workflowId: row.workflowId,
              stations: row.stations,
              at: row.station,
              thread,
              reason: reasons.get(thread.id)
            }
          ]
        : [];
    })
  };
}
export type WorkflowBoard = Awaited<ReturnType<typeof workflowBoard>>;
