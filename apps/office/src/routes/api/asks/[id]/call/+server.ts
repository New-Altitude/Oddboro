// The owner says yes to a call an Odd at Draft made: the office makes that
// exact call itself (`makeCall` in gateway.ts), then approves the ask with
// what came back (`approveCall`), which starts the Odd's run that carries on
// with it. A service the office cannot reach leaves the ask open to try again.
// A calendar event may come with the owner's `arguments`: their version of the
// fields they may change on the desk (`ownerEdit`), and only a calendar the
// desk offered them, which is what the office makes and keeps. Any other call takes none.
import { error, json } from '@sveltejs/kit';
import { approveCall, ask } from '@oddboro/ledger';
import { makeCall } from '#lib/server/gateway.ts';
import { ownerEdit } from '#lib/server/google/calendar.ts';
import type { RequestHandler } from './$types';

/** Calls being made now, by ask, so a second click never makes one twice. */
const making = new Set<number>();

export const POST: RequestHandler = async ({ params, request }) => {
  const id = Number(params.id);
  const a = await ask(id);
  if (!a || a.kind !== 'call' || !a.call) error(404, 'No such call');
  if (a.status !== 'open') error(409, 'This call was already answered');
  const b = (await request.json().catch(() => ({}))) as { arguments?: unknown };
  const edited = b?.arguments;
  if (edited !== undefined && (!a.call.event || typeof edited !== 'object' || !edited))
    error(400, 'Only a calendar event takes changes on the desk');
  let call = a.call;
  if (edited)
    try {
      call = {
        ...a.call,
        arguments: ownerEdit(
          a.call.tool,
          a.call.arguments,
          edited as Record<string, unknown>,
          a.call.event
        )
      };
    } catch (e) {
      error(400, e instanceof Error ? e.message : String(e));
    }
  if (making.has(id)) error(409, 'The office is making this call now');
  making.add(id);
  try {
    let result;
    try {
      result = await makeCall(call, a.staffId);
    } catch (e) {
      error(502, `The office could not reach the service: ${e instanceof Error ? e.message : e}`);
    }
    await approveCall(id, { ...call, result });
    return json({ ok: true, result });
  } finally {
    making.delete(id);
  }
};
