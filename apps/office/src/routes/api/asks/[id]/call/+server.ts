// The owner says yes to a call an Odd at Draft made: the office makes that
// exact call itself (`makeCall` in gateway.ts), then approves the ask with
// what came back (`approveCall`), which starts the Odd's run that carries on
// with it. A service the office cannot reach leaves the ask open to try again.
import { error, json } from '@sveltejs/kit';
import { approveCall, ask } from '@oddboro/ledger';
import { makeCall } from '#lib/server/gateway.ts';
import type { RequestHandler } from './$types';

/** Calls being made now, by ask, so a second click never makes one twice. */
const making = new Set<number>();

export const POST: RequestHandler = async ({ params }) => {
  const id = Number(params.id);
  const a = await ask(id);
  if (!a || a.kind !== 'call' || !a.call) error(404, 'No such call');
  if (a.status !== 'open') error(409, 'This call was already answered');
  if (making.has(id)) error(409, 'The office is making this call now');
  making.add(id);
  try {
    let result;
    try {
      result = await makeCall(a.call, a.staffId);
    } catch (e) {
      error(502, `The office could not reach the service: ${e instanceof Error ? e.message : e}`);
    }
    await approveCall(id, { ...a.call, result });
    return json({ ok: true, result });
  } finally {
    making.delete(id);
  }
};
