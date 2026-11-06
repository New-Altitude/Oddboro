// A command the page starts and watches: Claude Code's install and sign-in
// (routes/api/setup/claude) and each other tool's sign-in (agent-sign-in.ts).
// Its output streams to the page a line of JSON at a time. A slot runs one
// command at a time, so a second start stops the first. The page can leave
// before the command ends; the command still finishes. A sign-in stops at five
// minutes, since it waits on the owner. An install runs to its end, however
// long a slow download takes, since one stopped halfway can leave a tool half
// installed. Server only.
import { spawn, type ChildProcess } from 'node:child_process';

/** What a slot's command does: install a tool, or sign it in on its page. */
export type Action = 'install' | 'sign-in';

/** One job's command, whose output streams to the page a line of JSON at a time. */
export type Slot = {
  /** What runs now: its action, and the first https address it printed (its sign-in page). */
  readonly running: { action: Action; url?: string } | undefined;
  /**
   * Start a command. One already running ends first, its stream closing with
   * "Started over.". Streams {line} for each output line, {url} once for the
   * first https:// address, then {done, ok}.
   */
  start(action: Action, cmd: string, args: readonly string[], env: NodeJS.ProcessEnv): Response;
  /** Stop the running command; its stream ends with `why` and ok:false. False when none ran. */
  stop(why: string): boolean;
};

/**
 * A sign-in page's address. Only https: Codex prints its own callback server
 * on http://localhost first, which is not the page the owner signs in on.
 */
const PAGE_URL = /https:\/\/[^\s"'<>\x1b\x07]+/;

/** Five minutes is long enough for the owner to sign in. */
const LONGEST_SIGN_IN_MS = 5 * 60_000;
/** A sign-in's last line when the office stops it for taking too long. */
const SIGN_IN_TOO_LONG = `The sign-in took longer than ${LONGEST_SIGN_IN_MS / 60_000} minutes, so the office stopped it. Try again.`;

/** Every command a slot started that is still going. */
const going = new Set<ChildProcess>();
// A command outlives the server unless the server stops it on the way out.
process.once('exit', () => {
  for (const child of going) child.kill();
});

/** Stop a command: politely, then for sure. */
function end(child: ChildProcess) {
  child.kill();
  setTimeout(() => child.kill('SIGKILL'), 3000).unref();
}

/** A slot. `longestSignInMs` is shorter only in tests. */
export function commandSlot(longestSignInMs = LONGEST_SIGN_IN_MS): Slot {
  let current:
    | {
        action: Action;
        url?: string;
        child: ChildProcess;
        finish: (ok: boolean, line?: string) => void;
      }
    | undefined;
  const stop = (why: string) => {
    const old = current;
    if (!old) return false;
    old.finish(false, why);
    end(old.child);
    return true;
  };
  return {
    get running() {
      return current && { action: current.action, url: current.url };
    },
    stop,
    start(action, cmd, args, env) {
      // Started again: the owner closed the page or wants a fresh one.
      stop('Started over.');
      const encoder = new TextEncoder();
      let open = true;
      const body = new ReadableStream<Uint8Array>({
        start(out) {
          const send = (o: unknown) => {
            if (open) out.enqueue(encoder.encode(`${JSON.stringify(o)}\n`));
          };
          const child = spawn(cmd, [...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
            windowsHide: true
          });
          going.add(child);
          const lines = (chunk: Buffer) => {
            for (const line of chunk.toString().split(/\r?\n/)) {
              const l = line.trim();
              if (!l) continue;
              send({ line: l });
              const url = entry.url ? undefined : PAGE_URL.exec(l)?.[0];
              if (url) {
                entry.url = url;
                send({ url });
              }
            }
          };
          child.stdout.on('data', lines);
          child.stderr.on('data', lines);
          const timer =
            action === 'sign-in'
              ? setTimeout(() => {
                  // Said before the command stops, so the page shows this, not the command's last line.
                  finish(false, SIGN_IN_TOO_LONG);
                  end(child);
                }, longestSignInMs)
              : undefined;
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
          const entry: NonNullable<typeof current> = { action, child, finish };
          current = entry;
          child.on('error', (e) => {
            going.delete(child);
            finish(false, e.message);
          });
          child.on('close', (code) => {
            going.delete(child);
            finish(code === 0);
          });
        },
        cancel() {
          open = false;
        }
      });
      return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
    }
  };
}
