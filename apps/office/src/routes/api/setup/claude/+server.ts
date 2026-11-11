// How the office reaches Claude. GET says which login and model staff use, and
// on the Claude plan, which account the office's own Claude Code folder (its
// Office account, accounts.ts) is signed in to; until it is, `ownLogin` is the
// owner's own login, which its Odds keep running on. PUT
// changes them: a model, an API key (tried, then kept in the keychain), or back
// to the Claude plan. POST fixes a missing piece from the browser: `install`
// installs Claude Code, `update` runs its own updater, and `sign-in` signs the
// Office account in (or switches it to another login), never the owner's own,
// each streaming the command's output a line at a time.
//
// Both run through one slot (`command-stream.ts`), the runner the other
// tools' sign-ins use too. A sign-in waits for the owner on the page it opens.
// Closing that page leaves it waiting, so a second `sign-in` stops the first
// and starts over, and DELETE stops it outright. GET says when one is
// waiting, so a refreshed page still shows it. An install runs to the end:
// stopping one halfway can leave Claude Code half installed.
import { error, json } from '@sveltejs/kit';
import { OFFICE_ACCOUNT, WINDOWS, claudeCommand } from '@oddboro/ledger';
import { claudeSignIn, npmMissing, signingIn, SLOTS } from '#lib/server/agent-sign-in.ts';
import {
  claudeAccount,
  claudeAccountOf,
  claudeSettings,
  cleanEnv,
  MODELS,
  setClaude,
  type Model
} from '#lib/server/claude.ts';
import type { Action } from '#lib/server/command-stream.ts';
import type { RequestHandler } from './$types';

const withAccount = async () => {
  const settings = claudeSettings();
  if (settings.auth !== 'plan') return { ...settings, account: undefined };
  const account = await claudeAccountOf(OFFICE_ACCOUNT, true);
  return { ...settings, account, ...(account ? {} : { ownLogin: await claudeAccount() }) };
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
  // Opens the sign-in page in the browser; the command ends when the owner
  // finishes there. It signs the office's own folder in, never the owner's login.
  'sign-in': () => {
    const [cmd, before] = claudeCommand();
    return [cmd, [...before, ...claudeSignIn(OFFICE_ACCOUNT).args]];
  },
  // Claude Code's own updater, which updates it however it was installed.
  update: () => {
    const [cmd, before] = claudeCommand();
    return [cmd, [...before, 'update']];
  }
};

/** Claude Code's install or sign-in, one at a time, shared with its accounts' sign-ins. */
const slot = SLOTS.claude;

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = b.action as Action;
  if (!Object.hasOwn(COMMANDS, action)) error(400, 'Say install, update or sign-in');
  const running = slot.running?.action;
  if (running === 'install' || running === 'update')
    error(409, `Claude Code is still ${running === 'install' ? 'installing' : 'updating'}`);
  const [cmd, args] = COMMANDS[action]();
  const missing = action === 'install' && cmd === 'npm' ? npmMissing('Claude Code') : undefined;
  if (missing) error(400, missing);
  if (action === 'sign-in') {
    signingIn.claude = OFFICE_ACCOUNT;
    return slot.start(action, cmd, args, claudeSignIn(OFFICE_ACCOUNT).env);
  }
  return slot.start(action, cmd, args, cleanEnv());
};

/** Stop a sign-in that is waiting. An install is left to finish. */
export const DELETE: RequestHandler = async () =>
  json({ stopped: slot.running?.action === 'sign-in' && slot.stop('Cancelled.') });
