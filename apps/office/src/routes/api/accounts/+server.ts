// The accounts the owner adds beyond each tool's Office account
// (accounts.ts): POST `{ agent, label }` adds one, with its own folder and
// nothing signed in; the page then signs it in at /api/agents/[tool]. DELETE
// `{ id }` signs it out, moves its Odds back to the Office account and takes
// its folder away. PATCH `{ id, label }` renames one. Only a tool this system offers. Only the owner's page
// reaches it (see "Who the office answers").
import { error, json } from '@sveltejs/kit';
import {
  currentPlatform,
  account,
  addAccount,
  agentsOn,
  offeredAgent,
  removeAccount,
  renameAccount
} from '@oddboro/ledger';
import { signOut } from '#lib/server/agent-sign-in.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { agent?: unknown; label?: unknown };
  const agent = offeredAgent(b.agent, currentPlatform());
  if (!agent) error(400, `Pick ${agentsOn(currentPlatform()).join(' or ')}`);
  if (agent === 'gemini') error(400, 'Gemini takes one API key for the office.');
  try {
    const row = await addAccount(agent, typeof b.label === 'string' ? b.label : '');
    return json({ id: row.id, agent: row.agent, label: row.label });
  } catch (e) {
    error(400, e instanceof Error ? e.message : String(e));
  }
};

export const PATCH: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { id?: unknown; label?: unknown };
  if (typeof b.id !== 'string' || !(await account(b.id))) error(404, 'No such account.');
  try {
    const row = await renameAccount(b.id, typeof b.label === 'string' ? b.label : '');
    return json({ id: row.id, agent: row.agent, label: row.label });
  } catch (e) {
    error(400, e instanceof Error ? e.message : String(e));
  }
};

export const DELETE: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { id?: unknown };
  const row = typeof b.id === 'string' ? await account(b.id) : undefined;
  if (!row) error(404, 'No such account.');
  // Signed out first: Claude Code may keep the login outside the folder (the Mac's keychain).
  await signOut(row.agent, row.id);
  await removeAccount(row.id);
  return json({ ok: true });
};
