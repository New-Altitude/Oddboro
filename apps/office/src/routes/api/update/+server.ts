// The app's updates. The shell (apps/desktop) POSTs `{ version, notes }` when
// it has a new version downloaded and checked, `{ checked: true }` when it
// found none, or `{ failed }` when it could not look, and GETs every 30
// seconds until `install` is true. Only the shell may do those: from this
// computer, with the app's key in its header (`fromShell`). The Setup tab and
// the floor's notice GET the same answer and POST `{ action }`: `check`,
// `install-now`, `install-tonight`, `wait`, or `checks-on` and `checks-off`
// for the owner's switch. PUT sets the owner's window, `{ start, end }` as
// HH:MM in office time.
import { error, json } from '@sveltejs/kit';
import { isClock } from '@oddboro/ledger';
import { fromShell } from '#lib/server/app-key.ts';
import {
  askShellToCheck,
  checked,
  installWhen,
  ready,
  setChecks,
  setWindow,
  status
} from '#lib/server/update.ts';
import type { RequestHandler } from './$types';

const VERSION = /^\d+\.\d+\.\d+$/;

/** What the owner can ask for, by the name the page sends. */
const ACTIONS: Record<string, () => unknown> = {
  check: askShellToCheck,
  'install-now': () => installWhen('now'),
  'install-tonight': () => installWhen('tonight'),
  wait: () => installWhen('wait'),
  'checks-on': () => setChecks(true),
  'checks-off': () => setChecks(false)
};

export const GET: RequestHandler = async ({ request }) => json(await status(fromShell(request)));

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as {
    version?: unknown;
    notes?: unknown;
    checked?: unknown;
    failed?: unknown;
    action?: unknown;
  };
  const shell = fromShell(request);
  if (b.version !== undefined || b.checked !== undefined || b.failed !== undefined) {
    if (!shell) error(403, 'Only the app reports updates');
    if (b.version !== undefined) {
      if (typeof b.version !== 'string' || !VERSION.test(b.version))
        error(400, 'Say the version as x.y.z');
      await ready(b.version, typeof b.notes === 'string' ? b.notes.slice(0, 4000) : '');
    } else checked(typeof b.failed === 'string' ? b.failed || 'The check failed' : undefined);
    return json(await status(true));
  }
  const action = b.action;
  if (typeof action !== 'string' || !Object.hasOwn(ACTIONS, action))
    error(400, 'Say check, install-now, install-tonight, wait, checks-on or checks-off');
  try {
    await ACTIONS[action]();
  } catch (e) {
    error(409, e instanceof Error ? e.message : String(e));
  }
  return json(await status());
};

export const PUT: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { start?: unknown; end?: unknown };
  if (!isClock(b.start) || !isClock(b.end)) error(400, 'Say the window as HH:MM to HH:MM');
  if (b.start === b.end) error(400, 'The window needs a start and a later end');
  await setWindow(b.start, b.end);
  return json(await status());
};
