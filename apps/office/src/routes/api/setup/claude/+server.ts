// How the office reaches Claude. GET says which login and model staff use, and
// on the Claude plan, which account it is signed in to. PUT
// changes them: a model, an API key (tried, then kept in the keychain), or back
// to the Claude plan. POST fixes a missing piece from the browser: `install`
// installs Claude Code and `sign-in` starts its login (or a switch to another
// account), each streaming the command's output a line at a time.
//
// Both run through one slot (`command-stream.ts`), the runner the other
// tools' sign-ins use too. A sign-in waits for the owner on the page it opens.
// Closing that page leaves it waiting, so a second `sign-in` stops the first
// and starts over, and DELETE stops it outright. GET says when one is
// waiting, so a refreshed page still shows it. An install runs to the end:
// stopping one halfway can leave Claude Code half installed.
import { error, json } from '@sveltejs/kit';
import { WINDOWS, claudeCommand } from '@oddboro/ledger';
import {
  claudeAccount,
  claudeSettings,
  cleanEnv,
  MODELS,
  setClaude,
  type Model
} from '#lib/server/claude.ts';
import { commandSlot, type Action } from '#lib/server/command-stream.ts';
import type { RequestHandler } from './$types';

const withAccount = async () => {
  const settings = claudeSettings();
  return { ...settings, account: settings.auth === 'plan' ? await claudeAccount() : undefined };
};

export const GET: RequestHandler = async () =>
  json({ ...(await withAccount()), signingIn: slot.running?.action === 'sign-in' });

export const PUT: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as {
    model?: unknown;
    key?: unknown;
    auth?: unknown;
  };
  const model = MODELS.includes(b.model as Model) ? (b.model as Model) : undefined;
  const r = await setClaude({
    ...(model !== undefined ? { model } : {}),
    ...(typeof b.key === 'string' ? { key: b.key } : {}),
    ...(b.auth === 'plan' ? { auth: 'plan' as const } : {})
  });
  if (!r.ok) error(400, r.problem);
  return json(await withAccount());
};

const COMMANDS: Record<Action, () => [string, string[]]> = {
  // Windows rarely has Node, so it gets Claude Code's own installer, the one
  // its docs give there. It puts claude.exe in ~/.local/bin, which the app's
  // PATH already names (apps/desktop/src-tauri/src/env.rs).
  install: () =>
    WINDOWS
      ? [
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            'irm https://claude.ai/install.ps1 | iex'
          ]
        ]
      : ['npm', ['install', '-g', '@anthropic-ai/claude-code']],
  // Opens the sign-in page in the browser; the command ends when the owner finishes there.
  'sign-in': () => {
    const [cmd, before] = claudeCommand();
    return [cmd, [...before, 'auth', 'login', '--claudeai']];
  }
};

/** Claude Code's install or sign-in, one at a time (`command-stream.ts`). */
const slot = commandSlot();

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = b.action as Action;
  if (!Object.hasOwn(COMMANDS, action)) error(400, 'Say install or sign-in');
  if (slot.running?.action === 'install') error(409, 'Claude Code is still installing');
  const [cmd, args] = COMMANDS[action]();
  return slot.start(action, cmd, args, cleanEnv());
};

/** Stop a sign-in that is waiting. An install is left to finish. */
export const DELETE: RequestHandler = async () =>
  json({ stopped: slot.running?.action === 'sign-in' && slot.stop('Cancelled.') });
