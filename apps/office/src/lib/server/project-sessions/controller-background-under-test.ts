// A project's Claude Code conversations run in Claude Code's background
// service, through the controller the project route drives. This sets up what
// the controller's background tests share: a stand-in claude that logs each
// whole command and answers from files in the Claude folder it was given, and
// a stand-in terminal library that keeps what each terminal was opened with.
// A test file imports this before anything of the office's, so the terminal
// stand-in is in place before the controller loads.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, afterEach, beforeEach, mock } from 'node:test';
import { currentPlatform } from '@oddboro/ledger/platform';
import { app } from './controller-under-test.ts';

/** Each terminal opened: its arguments, folder and environment. */
export const spawned: { args: string[]; cwd: string; env: Record<string, string> }[] = [];
/** Each size any terminal was set to, in order, as [cols, rows]. */
export const resized: number[][] = [];
mock.module('@oddboro/ledger/project-terminal', {
  namedExports: {
    openProjectTerminal: async (
      _file: string,
      args: string[],
      options: { cwd: string; env: Record<string, string> }
    ) => {
      spawned.push({ args, cwd: options.cwd, env: options.env });
      let exited: ((e: { exitCode: number }) => void) | undefined;
      return {
        onData: () => {},
        onExit: (done: typeof exited) => void (exited = done),
        write: () => {},
        resize: (cols: number, rows: number) => void resized.push([cols, rows]),
        kill: () => {
          // Logged beside claude's commands, so a test can tell which came first.
          appendFileSync(calls, `terminal closed ${JSON.stringify(args)}\n`);
          exited?.({ exitCode: 0 });
        }
      };
    }
  }
});
export const { L, folder, onPlatform, request, withEnv } = await import('../office-under-test.ts');
const { projectController } = await import('./controller.ts');
export const { ClaudeNeedsTrust, endTerminalSession } = await import('./claude-background.ts');
export const { PROJECT_WORDS } = await import('../../project-words.ts');

// The stand-in claude. Every call logs its whole command, then a Node helper
// answers it from the Claude folder it runs under: `--version` from one file
// for the computer, `agents --json` from the folder's `agents.json` (without
// `--all`, leaving out background sessions that ended, as Claude Code does, or
// from `agents-now.json` when a test wrote one: what Move here's second read
// finds just before its signal, since connect's reads all pass `--all`),
// and `--bg` with the folder's `bg.out`, else the line Claude Code prints. A
// background start adds its session to `agents.json`, under the folder's
// `start-id` when the test names one. `stop` and `rm` log again with the
// project folder and the Claude folder they ran in. A test makes `agents`
// fail with an `agents.fail` file in the Claude folder, and `stop` with a
// `stop.fail` file: each then exits 1, `stop` after its log line.
const calls = join(folder, 'background-calls.log');
const bin = join(folder, 'background-bin');
mkdirSync(bin);
const standIn = join(bin, 'claude');
const versionFile = join(bin, 'version');
const helper = join(bin, 'answer.mjs');
writeFileSync(
  helper,
  `import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [dir, ...args] = process.argv.slice(2);
const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined);
const rows = JSON.parse(read('agents.json') ?? '[]');
if (args[0] === '--version') process.stdout.write(readFileSync(${JSON.stringify(versionFile)}, 'utf8'));
else if (args[0] === 'auth') console.log('{"loggedIn":false}');
else if (args[0] === 'agents') {
  if (read('agents.fail') !== undefined) process.exit(1);
  const ended = (r) => r.pid === undefined && ['done', 'stopped', 'failed'].includes(r.state);
  const now = read('agents-now.json');
  if (!args.includes('--all') && now !== undefined) process.stdout.write(now);
  else console.log(JSON.stringify(args.includes('--all') ? rows : rows.filter((r) => !ended(r))));
} else if (args[0] === '--bg') {
  const said = read('bg.out');
  const resume = args.indexOf('--resume');
  if (said !== undefined) process.stdout.write(said);
  else if (resume >= 0) console.log('backgrounded · ' + args[resume + 1].slice(0, 8) + ' · Work');
  else {
    const sessionId = read('start-id')?.trim() ?? randomUUID();
    rows.push({ sessionId, id: sessionId.slice(0, 8), kind: 'background', status: 'idle', cwd: process.cwd() });
    writeFileSync(join(dir, 'agents.json'), JSON.stringify(rows));
    console.log('backgrounded · ' + sessionId.slice(0, 8) + ' · ' + args[args.indexOf('-n') + 1]);
  }
} else if (args[0] === 'stop' || args[0] === 'rm') {
  appendFileSync(${JSON.stringify(calls)}, args.join(' ') + ' in ' + process.cwd() + ' under ' + dir + '\\n');
  if (args[0] === 'stop' && read('stop.fail') !== undefined) process.exit(1);
}
`
);
writeFileSync(
  standIn,
  `#!/bin/sh
echo "$*" >> "${calls}"
exec "${process.execPath}" "${helper}" "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "$@"
`
);
chmodSync(standIn, 0o755);
process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
/** The stand-in by the name a Windows office starts, claude.exe, in a folder of its own. */
const windowsBin = join(folder, 'background-windows-bin');
mkdirSync(windowsBin);
symlinkSync(standIn, join(windowsBin, 'claude.exe'));
export const onWindows = <T>(fn: () => Promise<T>) =>
  withEnv({ PATH: `${windowsBin}${delimiter}${process.env.PATH}` }, () => onPlatform('win32', fn));

export const NEWEST = '2.1.325 (Claude Code)';
let stamp = 1_700_000_000;
/**
 * The stand-in now says it is `version`. The office reads a version once per
 * change to the binary's file, so the file's change time moves on too.
 */
export function version(v: string) {
  writeFileSync(versionFile, v + '\n');
  stamp += 60;
  utimesSync(standIn, stamp, stamp);
}
version(NEWEST);

/** Each command claude ran since the test began, one per line, and each terminal closed. */
export const logged = () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n') : []);

/** A Claude folder named in Setup, the only one, so every test reads its own. */
export function claudeFolder(name: string) {
  const dir = join(homedir(), name);
  mkdirSync(dir, { recursive: true });
  L.setClaudeFolders([dir]);
  return dir;
}
/** What `claude agents --json` lists in the Claude folder `dir`. */
export const agents = (dir: string, rows: object[]) =>
  writeFileSync(join(dir, 'agents.json'), JSON.stringify(rows));
/** What a read without `--all` lists in `dir` from now on: Move here's second read. */
export const agentsNow = (dir: string, rows: object[]) =>
  writeFileSync(join(dir, 'agents-now.json'), JSON.stringify(rows));
/** Claude Code's row for `id` open in a terminal, run by the process `pid`. */
export const inTerminal = (id: string, pid: number, status: string) => ({
  sessionId: id,
  kind: 'interactive',
  pid,
  status,
  cwd: app
});
/**
 * A process standing in for a terminal session's. A `sleep` child is the only
 * process a test lets the office signal. The test ends it.
 */
export const terminalSession = () => spawn('sleep', ['30'], { stdio: 'ignore' });
export const alive = (p: ReturnType<typeof terminalSession>) =>
  p.exitCode === null && p.signalCode === null;
/** The process id of a terminal session that has already exited. */
export async function endedSession() {
  const p = terminalSession();
  p.kill();
  await once(p, 'exit');
  return p.pid!;
}
/**
 * A terminal session that answers Ctrl+C as `onInterrupt` says, once its
 * handler is in place. It touches `exiting` just before it exits.
 */
export async function slowSession(onInterrupt: 'exit after a second' | 'ignore', exiting: string) {
  const handler =
    onInterrupt === 'ignore'
      ? '() => {}'
      : "() => setTimeout(() => { require('node:fs').writeFileSync(process.argv[1], ''); process.exit(0); }, 1000)";
  // The path goes as an argument, never into the code.
  const p = spawn(
    process.execPath,
    [
      '-e',
      `process.on('SIGINT', ${handler}); console.log('ready'); setInterval(() => {}, 1000);`,
      exiting
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  );
  await once(p.stdout!, 'data');
  return p;
}
/** Every signal the office sends, still sent. */
const signals = mock.method(process, 'kill');
export const interrupted = (pid: number | undefined) =>
  signals.mock.calls.some((k) => k.arguments[0] === pid && k.arguments[1] === 'SIGINT');
/** Where the plugin of the session `id` lives, which `--plugin-dir` names. */
export const pluginOf = (id: string) => L.home('project-sessions', id, 'market', 'plugin');
export const lastTerminal = () => spawned.at(-1)!;
export const SHELL_STAND_IN = {
  skip: currentPlatform() === 'win32' && 'the stand-in is a shell script'
};
/** What `claude --bg` prints in a project folder Claude Code was never told to trust. */
export const NOT_TRUSTED = `Workspace not trusted. Run \`claude\` in ${app} once to accept the workspace trust dialog.\n`;

export const c = projectController();
/** The controller's runtimes and its release: no public method releases every one. */
const inside = c as unknown as {
  sessions: Map<string, unknown>;
  release(runtime: unknown): Promise<void>;
};
// The route answers only with Advanced mode on, which needs an owner.
await L.setOwnerName('Tester');
await L.setAdvancedMode(true);

beforeEach(() => writeFileSync(calls, ''));
afterEach(async () => {
  for (const runtime of [...inside.sessions.values()]) await inside.release(runtime);
  L.setClaudeFolders([]);
});
after(() => signals.mock.restore());
