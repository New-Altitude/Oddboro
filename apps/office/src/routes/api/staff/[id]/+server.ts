// Change a staffer's permission level or coding tool, or grant or remove one
// office tool. Only the owner does this, from the card.
import { error, json } from '@sveltejs/kit';
import {
  agentsOn,
  offeredAgent,
  setAgent,
  setPermission,
  setTool,
  staffer,
  type Level
} from '@oddboro/ledger';
import { isBusy } from '#lib/server/staff.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
  if (!(await staffer(params.id))) error(404, 'No such Odd');
  const b = (await request.json().catch(() => ({}))) as {
    permission?: unknown;
    agent?: unknown;
    tool?: unknown;
    on?: unknown;
  };
  if (typeof b.tool === 'string') {
    if (typeof b.on !== 'boolean') error(400, 'Say whether to grant or remove it');
    try {
      await setTool(params.id, b.tool, b.on);
    } catch (e) {
      error(400, e instanceof Error ? e.message : String(e));
    }
    return json({ ok: true });
  }
  if (b.agent !== undefined) {
    // Only a tool whose sandbox held on this system (`AGENT_PLATFORMS`).
    const agent = offeredAgent(b.agent, process.platform);
    if (!agent) error(400, `Pick ${agentsOn(process.platform).join(' or ')}`);
    // A chat still replying would save its session after the move, for a tool that cannot resume it.
    if (isBusy(params.id)) error(409, 'Wait for the reply to finish, then switch.');
    await setAgent(params.id, agent);
    return json({ ok: true });
  }
  const permission = (['read', 'draft', 'act'] as Level[]).find((l) => l === b.permission);
  if (!permission) error(400, 'Pick read, draft or act');
  await setPermission(params.id, permission);
  return json({ ok: true });
};
