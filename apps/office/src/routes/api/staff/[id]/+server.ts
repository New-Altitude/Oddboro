// Change a staffer's permission level, coding tool, account, model or thinking level, grant or remove one
// office tool, switch Run commands or Browse the web, or give or take back a
// folder outside the office. Only the owner does this, from the card. A move
// to another tool can turn Run commands on with it: the one click the Access
// tab offers under a switch the Odd's own tool cannot follow.
import { error, json } from '@sveltejs/kit';
import {
  agentsOn,
  checkFolder,
  commandsHow,
  offeredAgent,
  parseLevel,
  setAgent,
  setEffort,
  setModel,
  setAccount,
  setFolder,
  setOwnTool,
  setPermission,
  setTool,
  staffer,
  EFFORT_ORDER,
  type Agent,
  type Effort
} from '@oddboro/ledger';
import { isBusy } from '#lib/server/staff.ts';
import type { RequestHandler } from './$types';

/**
 * Refuses a Run commands change on a tool that does not follow the switch,
 * with its reason. A stored yes must be the owner's own choice, or it would
 * turn commands on unasked after a later move to a tool that follows it.
 */
function followsCommands(agent: Agent): void {
  const how = commandsHow(agent, process.platform);
  if (how.state !== 'switch') error(400, how.why);
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  const who = await staffer(params.id);
  if (!who) error(404, 'No such Odd');
  const b = (await request.json().catch(() => ({}))) as {
    permission?: unknown;
    agent?: unknown;
    tool?: unknown;
    on?: unknown;
    commands?: unknown;
    web?: unknown;
    folder?: unknown;
    access?: unknown;
    /** The owner's Accept on a folder the office warned about. */
    accept?: unknown;
    effort?: unknown;
    model?: unknown;
    account?: unknown;
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
  // Before the commands branch: a move that turns commands on is checked
  // against the tool it moves to, not the one it leaves.
  if (b.agent !== undefined) {
    // Only a tool whose sandbox held on this system (`AGENT_PLATFORMS`).
    const agent = offeredAgent(b.agent, process.platform);
    if (!agent) error(400, `Pick ${agentsOn(process.platform).join(' or ')}`);
    // A chat still replying would save its session after the move, for a tool that cannot resume it.
    if (isBusy(params.id)) error(409, 'Wait for the reply to finish, then switch.');
    // Refused before anything changes, so the Odd never moves without the commands it was moved for.
    if (typeof b.commands === 'boolean') followsCommands(agent);
    await setAgent(params.id, agent);
    if (typeof b.commands === 'boolean') await setOwnTool(params.id, 'commands', b.commands);
    return json({ ok: true });
  }
  // Like a tool, each of these takes effect on the Odd's next run, so none waits for a reply.
  if (b.account !== undefined) {
    if (b.account !== null && typeof b.account !== 'string') error(400, 'Pick an account');
    // A chat still replying would save its session after the move, in the folder it left.
    if (isBusy(params.id)) error(409, 'Wait for the reply to finish, then switch.');
    const set = await setAccount(params.id, b.account);
    if (set) error(400, set.refused);
    return json({ ok: true });
  }
  if (b.model !== undefined) {
    if (b.model !== null && typeof b.model !== 'string') error(400, 'Pick a model');
    const set = await setModel(params.id, b.model);
    if (set) error(400, set.refused);
    return json({ ok: true });
  }
  if (b.effort !== undefined) {
    const effort = EFFORT_ORDER.find((e) => e === b.effort);
    if (!effort) error(400, `Pick ${EFFORT_ORDER.join(', ')}`);
    const set = await setEffort(params.id, effort as Effort);
    if (set) error(400, set.refused);
    return json({ ok: true });
  }
  if (typeof b.commands === 'boolean') {
    followsCommands(who.agent);
    await setOwnTool(params.id, 'commands', b.commands);
    return json({ ok: true });
  }
  if (typeof b.web === 'boolean') {
    await setOwnTool(params.id, 'web', b.web);
    return json({ ok: true });
  }
  if (typeof b.folder === 'string') {
    // Taken back by the path as stored, so a folder deleted from the disk can still go.
    if (b.access === null) {
      await setFolder(params.id, b.folder, null);
      return json({ ok: true });
    }
    if (b.access !== 'read' && b.access !== 'write') error(400, 'Pick read or write');
    // A whole drive or system files comes back as a warning, given nothing,
    // until the owner presses Accept, which sends `accept`.
    const checked = checkFolder(b.folder, b.accept === true);
    if ('refused' in checked) error(400, checked.refused);
    if ('warning' in checked) return json({ warning: checked.warning });
    const set = await setFolder(params.id, checked.real, b.access);
    if (set) error(400, set.refused);
    return json({ ok: true });
  }
  const permission = parseLevel(b.permission);
  if (!permission) error(400, 'Pick read, draft or act');
  await setPermission(params.id, permission);
  return json({ ok: true });
};
