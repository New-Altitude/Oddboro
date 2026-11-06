// One tool's install and sign-in in the office, from the page
// (agent-sign-in.ts). Only a tool this system offers, and never Claude Code,
// whose install and sign-in are Setup's.
//
// POST `install` runs the tool's own installer, and `sign-in` a browser
// tool's sign-in, each streaming its output a line of JSON at a time, the
// sign-in with its page's address once it prints one. A second sign-in starts
// over. POST `sign-out` stops a sign-in still waiting, then removes the
// tool's sign-in (never through the tool's own logout). PUT `{ key }` tries a
// key tool's key once, then keeps it. DELETE stops a sign-in that is waiting.
// Each but the streams answers with the tool's state. An install runs to its
// end: while it runs, every other request about that tool gets 409.
import { error, json } from '@sveltejs/kit';
import { AGENT_NAMES, offeredAgent } from '@oddboro/ledger';
import {
  computerWord,
  installEnv,
  SIGN_INS,
  signInState,
  signOut,
  SLOTS,
  agentCommand,
  type SignInTool
} from '#lib/server/agent-sign-in.ts';
import type { RequestHandler } from './$types';

/**
 * The tool the address names, when this system offers it and it signs in
 * here, and nothing is installing it.
 */
function toolOf(name: string): SignInTool {
  const tool = offeredAgent(name, process.platform);
  if (!tool || tool === 'claude') error(404, 'No such tool to sign in to here.');
  if (SLOTS[tool].running?.action === 'install')
    error(409, `${AGENT_NAMES[tool]} is still installing.`);
  return tool;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const tool = toolOf(params.tool);
  const b = (await request.json().catch(() => ({}))) as { action?: unknown };
  const s = SIGN_INS[tool];
  const name = AGENT_NAMES[tool];
  if (b.action === 'install') {
    const [cmd, args] = s.install;
    return SLOTS[tool].start('install', cmd, args, installEnv());
  }
  if (b.action === 'sign-in') {
    if (s.how === 'key') error(400, `${name} takes an API key.`);
    const command = agentCommand(tool);
    if (!command) error(400, `${name} is not on this ${computerWord()}. Install it first.`);
    const [cmd, before] = command;
    const { args, env } = s.command();
    return SLOTS[tool].start('sign-in', cmd, [...before, ...args], env);
  }
  if (b.action === 'sign-out') {
    SLOTS[tool].stop('Signed out.');
    signOut(tool);
    return json(signInState(tool));
  }
  error(400, 'Say install, sign-in or sign-out.');
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const tool = toolOf(params.tool);
  const s = SIGN_INS[tool];
  if (s.how !== 'key') error(400, `${AGENT_NAMES[tool]} signs in on its own page, not with a key.`);
  const b = (await request.json().catch(() => ({}))) as { key?: unknown };
  const r = await s.setKey(typeof b.key === 'string' ? b.key : '');
  if (!r.ok) error(400, r.problem);
  return json(signInState(tool));
};

export const DELETE: RequestHandler = async ({ params }) => {
  const tool = toolOf(params.tool);
  return json({ stopped: SLOTS[tool].stop('Cancelled.') });
};
