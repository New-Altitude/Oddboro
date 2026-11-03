// How the office reaches Claude. GET says which login and model staff use, and
// on the Claude plan, which account it is signed in to. PUT
// changes them: a model, an API key (tried, then kept in the keychain), or back
// to the Claude plan. POST fixes a missing piece from the browser: `install`
// installs Claude Code and `sign-in` starts its login (or a switch to another
// account), each streaming the command's output a line at a time.
//
// A sign-in waits for the owner on the page it opens. Closing that page leaves
// it waiting, so a second `sign-in` stops the first and starts over, and
// DELETE stops it outright. GET says when one is waiting, so a refreshed page
// still shows it. An install runs to the end: stopping one halfway can leave
// Claude Code half installed.
import { spawn, type ChildProcess } from 'node:child_process';
import { error, json } from '@sveltejs/kit';
import {
  claudeAccount,
  claudeSettings,
  cleanEnv,
  MODELS,
  setClaude,
  type Model
} from '#lib/server/claude.ts';
import type { RequestHandler } from './$types';

const withAccount = async () => {
  const settings = claudeSettings();
  return { ...settings, account: settings.auth === 'plan' ? await claudeAccount() : undefined };
};

export const GET: RequestHandler = async () =>
  json({ ...(await withAccount()), signingIn: current?.action === 'sign-in' });

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

const COMMANDS = {
  install: ['npm', ['install', '-g', '@anthropic-ai/claude-code']],
  // Opens the sign-in page in the browser; the command ends when the owner finishes there.
  'sign-in': ['claude', ['auth', 'login', '--claudeai']]
} as const;

type Action = keyof typeof COMMANDS;

/** The command running now, with the way to end its answer. */
let current:
  { action: Action; child: ChildProcess; finish: (ok: boolean, line?: string) => void } | undefined;

/** Stop a command: politely, then for sure. */
function stop(child: ChildProcess) {
  child.kill();
  setTimeout(() => child.kill('SIGKILL'), 3000).unref();
}

// A command outlives the server unless the server stops it on the way out.
process.once('exit', () => current?.child.kill());

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = b.action as Action;
  const command = COMMANDS[action];
  if (!command) error(400, 'Say install or sign-in');
  if (current?.action === 'install') error(409, 'Claude Code is still installing');
  if (current) {
    // Signing in again: the owner closed the page or wants a fresh one.
    const old = current;
    old.finish(false, 'Started over.');
    stop(old.child);
  }
  const [cmd, args] = command;
  const encoder = new TextEncoder();
  // The page can leave before the command ends; the command still finishes.
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    start(out) {
      const send = (o: unknown) => {
        if (open) out.enqueue(encoder.encode(`${JSON.stringify(o)}\n`));
      };
      const child = spawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
      const lines = (chunk: Buffer) =>
        chunk
          .toString()
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .forEach((line) => send({ line }));
      child.stdout.on('data', lines);
      child.stderr.on('data', lines);
      // Five minutes is long enough for a slow install or for the owner to sign in.
      const timer = setTimeout(() => stop(child), 5 * 60_000);
      let finished = false;
      const finish = (ok: boolean, line?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (current === entry) current = undefined;
        if (line) send({ line });
        send({ done: true, ok });
        if (open) out.close();
        open = false;
      };
      const entry = { action, child, finish };
      current = entry;
      child.on('error', (e) => finish(false, e.message));
      child.on('close', (code) => finish(code === 0));
    },
    cancel() {
      open = false;
    }
  });
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
};

/** Stop a sign-in that is waiting. An install is left to finish. */
export const DELETE: RequestHandler = async () => {
  const old = current;
  if (old?.action !== 'sign-in') return json({ stopped: false });
  old.finish(false, 'Cancelled.');
  stop(old.child);
  return json({ stopped: true });
};
