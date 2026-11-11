import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  approveResultEdition,
  editionsFor,
  pauseScheduledResult,
  resultChoices,
  roster,
  saveScheduledResult,
  scheduledResultPlans,
  thread
} from '@oddboro/ledger';
import { refreshClock } from '#lib/server/jobs.ts';
import type { RequestHandler } from './$types';
const plan = z
  .object({
    producerId: z.number().int().positive(),
    reviewerId: z.number().int().positive(),
    responsibleId: z.string().min(1),
    title: z.string().min(1).max(100),
    deadline: z.string(),
    zone: z.string(),
    repairs: z.number().int().min(0).max(2),
    destination: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('desk') }).strict(),
      z.object({ kind: z.literal('gmail'), connector: z.string(), to: z.string() }).strict()
    ])
  })
  .strict();
const action = z.discriminatedUnion('op', [
  z.object({ op: z.literal('save'), plan }).strict(),
  z
    .object({ op: z.literal('pause'), id: z.number().int().positive(), enabled: z.boolean() })
    .strict(),
  z.object({ op: z.literal('approve'), id: z.string(), hash: z.string() }).strict()
]);
export const GET: RequestHandler = async () =>
  json({
    ...(await resultChoices()),
    staff: (await roster()).map((p) => ({ id: p.id, name: p.name })),
    plans: await Promise.all(
      (await scheduledResultPlans()).map(async (p) => ({
        ...p,
        goalId: (await thread(p.threadId))?.goalId,
        editions: await editionsFor(p.id)
      }))
    )
  });
export const POST: RequestHandler = async ({ request }) => {
  const parsed = action.safeParse(await request.json());
  if (!parsed.success) error(400, 'Choose a result plan, pause action or exact edition approval.');
  const a = parsed.data;
  try {
    if (a.op === 'save') await saveScheduledResult(a.plan);
    else if (a.op === 'pause') await pauseScheduledResult(a.id, a.enabled);
    else await approveResultEdition(a.id, a.hash);
  } catch (e) {
    error(409, e instanceof Error ? e.message : String(e));
  }
  refreshClock();
  return json({ ok: true });
};
