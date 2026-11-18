// Every Claude Code background command a project runs, and the only place
// that reads what those commands print. Server only.
import { claudeFolderEnv, olderThan } from '@oddboro/ledger';
import { probe } from '@oddboro/ledger/platform';
import { PROJECT_WORDS } from '../../project-words.ts';
import { processGone } from '../drive.ts';
import { versionOf } from '../versions.ts';
import { CLAUDE_LIST_FAILED, claudeAgents, type ClaudeConversation } from './claude-project.ts';
import { canMoveHere, nativeCommand, nativeEnv } from './native.ts';

/**
 * The oldest Claude Code with the background sessions Projects runs on. It is
 * lower than the Odds' own floor, since Projects works without any Odd.
 */
export const CLAUDE_BACKGROUND_FLOOR = '2.1.285';

/** Refuses, in the owner's words, a Claude Code that is missing or too old for background sessions. */
export async function requireBackground(): Promise<void> {
  const version = await versionOf('claude');
  if (version === undefined) throw new Error(CLAUDE_LIST_FAILED.missing());
  if (olderThan(version, CLAUDE_BACKGROUND_FLOOR)) throw new Error(PROJECT_WORDS.update);
}

/** Claude Code will not start in a folder until the owner trusts it, which only a terminal can ask. */
export class ClaudeNeedsTrust extends Error {
  /** The terminal that asks, once the controller opened one. */
  setup?: string;
  constructor() {
    super(PROJECT_WORDS.trustLine);
  }
}

/**
 * Where a `claude` command runs: the project `folder` it works in, and the
 * Claude folder `dir` it runs under. One object, since the two are both paths
 * and a swap would run the command against the wrong Claude folder.
 */
export type ClaudeWhere = { folder: string; dir: string };

/** Runs `claude` with `args` in `where`. */
function claude({ folder, dir }: ClaudeWhere, args: string[], timeout: number) {
  const [exe, prefix] = nativeCommand('claude');
  return probe(exe, [...prefix, ...args], {
    env: claudeFolderEnv(dir, nativeEnv()),
    cwd: folder,
    timeout
  });
}

/**
 * Starts a background session with `claude --bg ...args` and returns its
 * short id. Claude Code writes some of its lines to stderr, so both streams
 * are read.
 */
export async function startInBackground(where: ClaudeWhere, args: string[]): Promise<string> {
  const r = await claude(where, ['--bg', ...args], 30_000);
  switch (r.status) {
    case 'missing':
      throw new Error(CLAUDE_LIST_FAILED.missing());
    case 'timeout':
      throw new Error(PROJECT_WORDS.startFailed);
    case 'ok':
    case 'failed': {
      const said = r.out + r.err;
      if (said.includes('Workspace not trusted')) throw new ClaudeNeedsTrust();
      if (said.includes('disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW'))
        throw new Error(PROJECT_WORDS.backgroundOff);
      const short = /backgrounded · ([0-9a-f]{8})/.exec(said)?.[1];
      if (short) return short;
      console.error(`claude --bg printed no session it started: ${said.slice(0, 400)}`);
      throw new Error(PROJECT_WORDS.startFailed);
    }
    default: {
      const missed: never = r;
      throw new Error(`claude --bg came back as ${JSON.stringify(missed)}`);
    }
  }
}

/**
 * Runs `claude stop` or `claude rm` on the background session `short`, and
 * says whether it came back ok. A failure is logged, not thrown, so each
 * caller decides what the owner reads.
 */
async function endInBackground(
  verb: 'stop' | 'rm',
  where: ClaudeWhere,
  short: string
): Promise<boolean> {
  const r = await claude(where, [verb, short], 10_000);
  if (r.status !== 'ok') console.error(`claude ${verb} ${short} came back ${r.status}`);
  return r.status === 'ok';
}

/**
 * Stops the background session `short` of a session of this office, and says
 * whether it came back ok. Start ignores the answer when it stops a session it
 * just started, since it is already on its way to a refusal of its own.
 */
export const stopInBackground = (where: ClaudeWhere, short: string) =>
  endInBackground('stop', where, short);

/**
 * Resumes the conversation `id` as a background session and returns its
 * short id. The caller has read that no background session holds `id`.
 * One that appeared since makes Claude Code start a copy under a new id,
 * so a copy is stopped and removed, and the owner is asked to try again.
 */
export async function resumeInBackground(
  where: ClaudeWhere,
  id: string,
  plugin: string
): Promise<string> {
  const short = await startInBackground(where, ['--resume', id, '--plugin-dir', plugin]);
  if (short === id.slice(0, 8)) return short;
  await endInBackground('stop', where, short);
  await endInBackground('rm', where, short);
  throw new Error(PROJECT_WORDS.copied);
}

/** Refuses, in the owner's words, a terminal session that is not idle. */
function requireIdle(status: string | undefined) {
  if (status === 'waiting') throw new Error(PROJECT_WORDS.waiting);
  if (status !== 'idle') throw new Error(PROJECT_WORDS.busy);
}

/**
 * Ends the terminal session in `row`, a conversation of the project `folder`,
 * with the interrupt a person's Ctrl+C sends, and waits for it to exit, so the
 * conversation can resume in the background in place. It ends only an idle
 * session, and never sends a harder signal: one still running after the wait
 * is the owner's to end.
 *
 * Connect's read of the status ran beside its other reads, so a reply could
 * have started since. The status is read again just before the signal, from
 * the Claude folder that listed the process (`liveIn`), not the row's
 * `configDir`: that one holds the newest file, and its read would miss a
 * process another folder runs. That narrows the window to one read; it cannot
 * close it, since Claude Code ends on the interrupt whatever it is doing.
 */
export async function endTerminalSession(
  folder: string,
  row: Pick<ClaudeConversation, 'id' | 'pid' | 'status' | 'liveIn'>
): Promise<void> {
  if (!canMoveHere()) throw new Error(PROJECT_WORDS.windows);
  const { pid, liveIn } = row;
  if (pid === undefined || liveIn === undefined) throw new Error(PROJECT_WORDS.startFailed);
  requireIdle(row.status);
  const now = (await claudeAgents(folder, liveIn)).find(
    (a) => a.sessionId === row.id && a.pid === pid
  );
  // Not listed now for this conversation: no signal goes to a process no
  // read vouches for. Gone, it ended on its own, and the wait below returns
  // at once. Still running, it holds another conversation or is exiting, as
  // after /clear, /resume or /exit in that terminal, so nothing is closed here.
  if (!now && !processGone(pid)) throw new Error(PROJECT_WORDS.switched);
  if (now) {
    requireIdle(now.status);
    try {
      process.kill(pid, 'SIGINT');
    } catch (e) {
      // ESRCH: it exited on its own already, which is what the signal was for.
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return;
      console.error(`Could not interrupt the terminal session ${pid}:`, e);
      throw new Error(PROJECT_WORDS.startFailed);
    }
  }
  // An idle session was measured to exit 0.6 to 0.8 s after the interrupt.
  const end = performance.now() + 5000;
  while (!processGone(pid)) {
    if (performance.now() > end) {
      console.error(`The terminal session ${pid} was still running 5 s after the interrupt.`);
      throw new Error(PROJECT_WORDS.closeSlow);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
