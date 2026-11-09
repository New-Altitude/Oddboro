// One ask. GET adds the owner's closest past decisions, and the ask it reworks. POST
// is their decision: approve, deny, or iterate (send it back with what to
// change), with a reason, and whether a success should reach their desk too.
// Approving a goal ask sets the goal. Approving a plan takes the parts the owner ticked
// (`picks`) and answers with the hire asks it made, for the page to open.
// Approving an access ask answers with the connect task it made, if any, so the
// desk goes straight on to it. A reply is approved only by sending it or saving
// it (`reply/+server.ts`), a filter only by creating it (`filter/+server.ts`),
// and a folder ask only by giving the folder (`folder/+server.ts`).
import { error, json } from '@sveltejs/kit';
import {
  approveGoal,
  approvePlan,
  ask,
  decideAsk,
  precedent,
  tasksFrom,
  type Decision
} from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const a = await ask(Number(params.id));
  if (!a) error(404, 'No such ask');
  return json({
    ask: a,
    precedent: await precedent(`${a.title}\n${a.why}`),
    revises: a.revises ? ((await ask(a.revises)) ?? null) : null
  });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as {
    decision?: unknown;
    reason?: unknown;
    report?: unknown;
    picks?: unknown;
  };
  const decision = (['approve', 'deny', 'iterate'] as Decision[]).find((d) => d === body.decision);
  if (!decision) error(400, 'Say approve, deny or iterate');
  const a = await ask(Number(params.id));
  if (!a) error(404, 'No such ask');
  if (a.status !== 'open') error(409, 'This ask was already answered');
  if (a.kind === 'hire' && decision === 'approve') error(400, 'Approve a hire by hiring');
  if (a.kind === 'reply' && decision === 'approve')
    error(400, 'Send the reply, or save it to Gmail drafts');
  if (a.kind === 'filter' && decision === 'approve')
    error(400, 'Create the filter from its card on the desk');
  if (a.kind === 'folder' && decision === 'approve')
    error(400, 'Give the folder from its card on the desk');
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : '';
  if (decision === 'approve' && a.kind === 'goal') {
    await approveGoal(a.id, reason || null).catch((e: Error) => error(400, e.message));
    return json({ ok: true });
  }
  if (decision === 'approve' && a.kind === 'plan') {
    const picks = Array.isArray(body.picks)
      ? body.picks.filter((p): p is number => Number.isInteger(p))
      : [];
    const done = await approvePlan(a.id, picks, reason || null).catch((e: Error) =>
      error(400, e.message)
    );
    return json({ ok: true, hires: done.hires });
  }
  let decided;
  try {
    decided = await decideAsk(a.id, decision, reason || null, body.report === true);
  } catch (e) {
    error(400, e instanceof Error ? e.message : String(e));
  }
  if (!decided) error(409, 'This ask was already answered');
  if (decision === 'approve' && a.access) {
    const task = (await tasksFrom(a.staffId)).find((t) => t.askId === a.id && t.status === 'open');
    return json({ ok: true, task: task ?? null });
  }
  return json({ ok: true });
};
