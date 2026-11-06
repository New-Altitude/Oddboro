// How a staffer's run starts on Grok instead of Claude Code: the arguments and
// the environment, which run() in staff.ts spawns the grok `grokCommand`
// finds with. Server only.
//
// Grok keeps its sign-in, sessions and sandbox profiles in the office's own
// Grok home (GROK_HOME), never the owner's ~/.grok. The office never edits that
// home's config.toml, which belongs to the sign-in: it switches Grok's reading
// of other tools' setups (Claude's, Cursor's) off through the environment,
// which beats config.toml. Files are held by a sandbox profile the kernel
// enforces, built on `strict`: it reads the Odd's folder (the run's cwd),
// node and the tool server's code, Grok's home and the system folders Grok
// needs to start. It writes the Odd's folder, Grok's own temp folder and
// Grok's sessions folder, which holds every Grok Odd's sessions. It adds the
// folders the run reads besides its own (the owner's data folder, and its
// thread's or a lead's goals') to read, and on a thread the Odd's part of it
// to write.
// Deny rules hold the rest: no Odd reads anything of the kernel's allowance
// but its own folders (`UNREADABLE`), and none writes in Grok's home. A custom
// profile that cannot apply stops Grok from starting, so a run is never left
// unconfined. The profile holds the whole grok process, its own sign-in
// renewal included, so the office renews the sign-in before a run that could
// outlast it (`grokSignedOut`).
import { spawn } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CODE, home, runsGoing } from '@oddboro/ledger';
import { andBelow, denyRules, instructionPaths } from './files.ts';
import { mcpGrant, NOT_SIGNED_IN, replace, sweep, vendorEnv } from './launch.ts';
import { onPath } from './on-path.ts';
import { GROK_FILE_TOOLS } from '../staff/work.ts';

export const GROK_HOME = home('grok');
const SANDBOX = join(GROK_HOME, 'sandbox.toml');
const CONFIG = join(GROK_HOME, 'config.toml');
/** Each run's MCP servers, in an agent file of its own (Grok has no --mcp-config). */
const RUNS = join(GROK_HOME, 'runs');
/** Grok's own temp folder, so it needs none of the temp folders every app shares (`SHUT`). */
const TEMP = join(GROK_HOME, 'tmp');
/**
 * The sign-in: per account, its tokens, its `email` and when they run out
 * (`expires_at`). Sign out from the page removes it (agent-sign-in.ts).
 */
export const GROK_AUTH = join(GROK_HOME, 'auth.json');
/**
 * The leader socket every grok outside a run talks to. Grok's default is
 * ~/.grok/leader.sock, the owner's own Grok, whatever GROK_HOME says.
 */
const LEADER = join(GROK_HOME, 'leader.sock');
/** How long before a run could end its sign-in must still hold, past the run's own time limit. */
const SIGN_IN_MARGIN_MS = 10 * 60_000;
/**
 * The longest a renewal may take before the office stops it. `grok models`
 * took 0.81 s, Node's start-up included (`/usr/bin/time -p grok models` from
 * the office's Grok home, 2026-11-04), and Grok itself waits up to 25 s for
 * its lock on auth.json (`timeout=25000ms` in its log), so a renewal that
 * waited out another's lock still ends inside this.
 */
const RENEW_MS = 30_000;

/**
 * What the owner reads when a Grok run cannot start for its sign-in. Grok's
 * own advice, `grok login`, would sign in the owner's ~/.grok instead, so
 * this points to the office's own sign-in, on the page.
 */
export const GROK_SIGN_IN = `Grok ${NOT_SIGNED_IN}`;

/**
 * What the owner reads when Grok's plan has no usage left. Grok's own words
 * carry an upsell link, which the office never passes on.
 */
export const GROK_PLAN_LIMIT =
  "Grok's plan limit is reached; this Odd can't work until it resets or the plan changes.";

/**
 * Node and the code the office's tool server runs from. The sandbox holds
 * that server too, and `strict` reads neither, so the profile lets the kernel
 * read them. Only the packages and their dependencies, never the whole repo,
 * which in development holds the office's secrets file and the owner's data
 * folder. The server gets its database from its environment, so it needs
 * neither, as in the app, whose secrets file sits in the office home.
 */
const SERVER_CODE = [
  dirname(process.execPath),
  ...['packages', 'node_modules'].map((d) => resolve(CODE, d)).filter((d) => existsSync(d))
];

/**
 * What `strict` lets every run read that no Odd needs, shut by the kernel:
 * the owner's ~/Library (mail, messages, browsers), the Mac's /Library (every
 * app's shared files), and /tmp and /var, which hold the temp folders and
 * caches every app shares. A profile can only add to `strict`; its deny list
 * is the one way to take a path away. Each is its real path, since macOS
 * links /tmp and /var into /private, and only if it exists, since on Linux a
 * deny path that cannot be bound stops Grok from starting. /etc stays: Grok
 * refuses to start without it.
 */
const SHUT = [
  ...new Set(
    [join(homedir(), 'Library'), '/Library', '/tmp', '/var']
      .filter((p) => existsSync(p))
      .map((p) => realpathSync(p))
  )
];

/**
 * What `strict` reads besides the run's cwd and Grok's home, as Grok 1.0.46
 * on macOS logged it (ProfileApplied in its sessions' sandbox-events.jsonl).
 * Grok and node need what `SHUT` leaves of it to start.
 */
const STRICT_READS = [
  ...['/usr', '/bin', '/sbin', '/etc', '/dev', '/System', '/Library', '/private', '/tmp', '/var'],
  join(homedir(), 'Library')
];

/**
 * Everything the kernel may let a Grok run read besides the Odd's own
 * folders, which the Odd itself may not: Grok's home (the sign-in, every
 * Odd's sessions, each run's agent file), the tool server's code, and what
 * `strict` reads. Grok's read_file, list_dir and grep need no approval under
 * dontAsk, so these deny rules, on each folder and everything in it, keep the
 * Odd's own reads to its folders.
 */
const UNREADABLE = [GROK_HOME, ...SERVER_CODE, ...STRICT_READS];

/**
 * The folders ripgrep runs from when it is on PATH: the folder PATH names and,
 * for a link, the folder it points into. Grok's grep runs ripgrep inside the
 * sandbox, so the kernel must read them, and Read deny rules keep the Odd's
 * own tools out of them. With none, grep cannot run, so a run does not get it.
 */
function ripgrep(): string[] {
  const rg = onPath('rg');
  return rg ? [...new Set([dirname(rg), dirname(realpathSync(rg))])] : [];
}

/**
 * Every compatibility cell Grok has an environment variable for, switched
 * off, so an Odd never loads the owner's or a folder's Claude or Cursor
 * skills, rules, instruction files, MCP servers or hooks.
 */
const COMPAT_OFF: Record<string, 'false'> = Object.fromEntries(
  ['CLAUDE', 'CURSOR'].flatMap((tool) =>
    ['AGENTS', 'HOOKS', 'MCPS', 'RULES', 'SKILLS'].map((cell) => [
      `GROK_${tool}_${cell}_ENABLED`,
      'false'
    ])
  )
);

/**
 * The cells Grok gives no environment variable for (each tool's sessions, and
 * Codex's hooks and skills), written only into a home that has no config.toml
 * yet. Once the owner signs in, that file is the sign-in's to keep.
 */
const FIRST_CONFIG = `# Oddboro's Grok home. Odds never read the owner's ~/.claude, ~/.cursor or ~/.grok.
[compat.claude]
sessions = false

[compat.cursor]
sessions = false

[compat.codex]
sessions = false
hooks = false
skills = false
`;

/** What one Grok run needs from run(). */
type GrokRun = {
  /** The run's key (`runsGoing`), which names its agent file and, on a thread, its profile. */
  key: string;
  staffId: string;
  /** The Odd's folder, the run's cwd. */
  dir: string;
  /** The folders the run reads besides its own: the owner's data folder, and its thread's or those of the goals a lead's chat leads. */
  reads: string[];
  /** On a thread: the Odd's own part of it, which it writes. */
  part?: string;
  /** The folders the run writes. */
  writes: string[];
  /** The paths the run may not write (`deniedEdits`). */
  deniedEdits: string[];
  system: string;
  message: string;
  /** The session to resume, else a new one with `newSession` as its id. */
  resume?: string;
  newSession: string;
  servers: Record<string, unknown>;
  /** The MCP tools the run may call, as access() names them for Claude Code (`mcp__server` or `mcp__server__tool`). */
  allowed: string[];
};

type GrokLaunch = { args: string[]; env: NodeJS.ProcessEnv; done: () => void };

/** A sandbox profile, kept in the Grok home's sandbox.toml. */
type Profile = { readOnly: string[]; readWrite: string[]; deny: string[] };

/** A profile's block in sandbox.toml. JSON strings are TOML basic strings. */
function profileToml(name: string, p: Profile): string {
  return [
    `[profiles.${name}]`,
    'extends = "strict"',
    `read_only = ${JSON.stringify(p.readOnly)}`,
    `read_write = ${JSON.stringify(p.readWrite)}`,
    `deny = ${JSON.stringify(p.deny)}`
  ].join('\n');
}

/**
 * Put one profile in sandbox.toml, which only the office writes, one block per
 * profile. A run on no thread uses its Odd's profile, under the same name every
 * time, since Grok refuses a resumed chat under another name; it takes a
 * changed profile under the same one (measured). Each run writes that profile
 * as it starts: a lead's chat with its goals' folders, the Odd's jobs and
 * follow-ups without them. Grok reads the profile once, as it starts, so a job
 * starting in the moment a chat does can leave that chat without its goals'
 * folders. A thread's profile is the run's own: it goes once no run with its
 * key is going. All of it happens in one tick, so runs starting side by side
 * cannot drop each other's profile.
 */
function setProfile(name: string, p: Profile): void {
  const blocks = new Map<string, string>();
  const text = existsSync(SANDBOX) ? readFileSync(SANDBOX, 'utf8') : '';
  for (const block of text.split(/^(?=\[profiles\.)/m)) {
    const found = /^\[profiles\.([^\]]+)\]/.exec(block)?.[1];
    if (!found) continue;
    if (found.startsWith('run-') && !runsGoing.has(found.slice(4))) continue;
    blocks.set(found, block.trim());
  }
  blocks.set(name, profileToml(name, p));
  const next = [...blocks.values()].join('\n\n') + '\n';
  if (next !== text) replace(SANDBOX, next, 0o644);
}

/** `mcp__office` and `mcp__c__t`, as Grok's `MCPTool(office__*)` and `MCPTool(c__t)`. */
function mcpRule(allowed: string): string {
  const { server, tool } = mcpGrant(allowed);
  return `MCPTool(${server}__${tool ?? '*'})`;
}

/** Every tool that changes a file's contents, since Edit may not cover Write. */
const EDITS = ['Edit', 'Write'];

/**
 * The agent file that gives the run its MCP servers. Its frontmatter is YAML,
 * and a JSON object is YAML. It holds the connectors' secrets, so only the
 * owner may read it, and it goes when the run ends. A file a run that died
 * with the office left behind goes at the next Grok run.
 */
function agentFile(key: string, servers: Record<string, unknown>): string {
  mkdirSync(RUNS, { recursive: true, mode: 0o700 });
  sweep(RUNS, '.md', key);
  const file = join(RUNS, `${key}.md`);
  // Grok takes a list here, one `{name: server}` per entry, and refuses to start on a map.
  const list = Object.entries(servers).map(([name, server]) => ({ [name]: server }));
  replace(
    file,
    `---\nname: odd\ndescription: An Oddboro staffer's run\nmcpServers: ${JSON.stringify(list)}\n---\n`
  );
  return file;
}

/**
 * Get a Grok run ready: its home, its sandbox profile and agent file, and the
 * arguments and environment to start `grok` with. `done` removes what only
 * this run used.
 */
export function grokLaunch(r: GrokRun): GrokLaunch {
  grokHomeReady();
  const sandbox = r.part ? `run-${r.key}` : `odd-${r.staffId}`;
  const rg = ripgrep();
  setProfile(sandbox, {
    readOnly: [...SERVER_CODE, ...rg, ...r.reads],
    readWrite: [TEMP, ...(r.part ? [r.part] : [])],
    deny: [...instructionPaths(r.writes), ...SHUT].flatMap(andBelow)
  });
  const agent = agentFile(r.key, r.servers);
  const model = process.env.OFFICE_GROK_MODEL;
  const args = [
    // Joined to its flag, so a message or job description that starts with
    // "-" is never read as a flag: grok takes no "--" before a value and reads
    // no input (both measured on Grok 1.0.46).
    `--single=${r.message}`,
    '--output-format',
    'streaming-messages-json',
    '--include-partial-messages',
    '--sandbox',
    sandbox,
    '--agent',
    agent,
    '--permission-mode',
    'dontAsk',
    '--no-subagents',
    '--no-auto-update',
    // The five file tools a Claude Code run gets, grep only where ripgrep is.
    // Grok keeps its MCP tools (search_tool, use_tool) beside them; no shell,
    // web or image tool.
    '--tools',
    Object.keys(GROK_FILE_TOOLS)
      .filter((tool) => tool !== 'grep' || rg.length)
      .join(','),
    ...[...UNREADABLE, ...rg]
      .flatMap((p) => denyRules(['Read'], p))
      .flatMap((rule) => ['--deny', rule]),
    // The kernel lets a run write Grok's sessions folder, every Grok Odd's
    // sessions, and dontAsk alone would refuse it: these rules hold it too.
    ...[GROK_HOME, ...r.deniedEdits]
      .flatMap((p) => denyRules(EDITS, p))
      .flatMap((rule) => ['--deny', rule]),
    ...r.writes
      .flatMap((w) => EDITS.map((tool) => `${tool}(${w}/**)`))
      .flatMap((rule) => ['--allow', rule]),
    ...r.allowed.map(mcpRule).flatMap((rule) => ['--allow', rule]),
    ...(model ? ['-m', model] : []),
    `--rules=${r.system}`,
    ...(r.resume ? ['-r', r.resume] : ['-s', r.newSession])
  ];
  return { args, env: grokEnv(), done: () => rmSync(agent, { force: true }) };
}

/**
 * The grok the office starts: the one on PATH, else the one in xAI's install
 * folder, ~/.grok/bin, where its installer puts it (`GROK_BIN_DIR`'s default).
 * When no folder on PATH could take its link, the installer only adds that
 * folder to the shell's PATH, which the office, started before, never reads;
 * so a Grok installed from the page runs without a restart. HOME is read on
 * each call, as PATH is, so a test can point it away from the Mac's own.
 */
export function grokCommand(): string | undefined {
  const found = onPath('grok');
  if (found) return found;
  const installed = join(homedir(), '.grok', 'bin', 'grok');
  try {
    accessSync(installed, constants.X_OK);
    return installed;
  } catch {
    // No grok there either, or one that cannot run: Grok is not installed.
    return undefined;
  }
}

/**
 * The office's Grok home, shut to everyone but the owner, with its temp
 * folder and a config.toml if it had none. Runs and the sign-in use it.
 */
function grokHomeReady(): void {
  mkdirSync(GROK_HOME, { recursive: true, mode: 0o700 });
  chmodSync(GROK_HOME, 0o700);
  mkdirSync(TEMP, { recursive: true, mode: 0o700 });
  if (!existsSync(CONFIG)) replace(CONFIG, FIRST_CONFIG);
}

/**
 * The browser sign-in to the office's Grok home, which the page starts
 * (agent-sign-in.ts). Outside any sandbox, so it names the home's own leader
 * socket, never the owner's.
 */
export function grokSignIn(): { args: string[]; env: NodeJS.ProcessEnv } {
  grokHomeReady();
  return { args: ['login', '--oauth', '--leader-socket', LEADER], env: grokEnv() };
}

/** The environment every `grok` the office starts gets: the office's Grok home, and no key or setup of the office's own. */
function grokEnv(): NodeJS.ProcessEnv {
  const env = vendorEnv(['GROK_', 'XAI_']);
  return Object.assign(env, COMPAT_OFF, {
    GROK_HOME,
    TMPDIR: TEMP,
    GROK_MEMORY: '0',
    GROK_SUBAGENTS: '0',
    GROK_WORKFLOWS: '0',
    GROK_WEB_FETCH: '0',
    // Less of an Odd's work leaves the Mac than Grok sends by default.
    GROK_TELEMETRY_ENABLED: 'false',
    GROK_TELEMETRY_TRACE_UPLOAD: 'false'
  });
}

/** The accounts in the office's Grok sign-in, none when the home has no sign-in file Grok can read. */
function accounts(): unknown[] {
  try {
    const auth: unknown = JSON.parse(readFileSync(GROK_AUTH, 'utf8'));
    return Object.values(auth && typeof auth === 'object' ? auth : {});
  } catch {
    // No file, or one half written: no account to show, and nothing to renew.
    return [];
  }
}

/**
 * Who the office's Grok home is signed in as, for the page: undefined with
 * no account in its sign-in, else the first account's email when it has one.
 */
export function grokAccount(): { email?: string } | undefined {
  const all = accounts();
  if (!all.length) return undefined;
  const email = all
    .map((a) => (a as { email?: unknown } | null)?.email)
    .find((e): e is string => typeof e === 'string');
  return email ? { email } : {};
}

/**
 * When the office's Grok sign-in runs out, as epoch ms: the latest
 * `expires_at` among its accounts. None when the home has no sign-in file
 * Grok can read, or no `expires_at` in it: the run then starts, and Grok's
 * own stream says "Not signed in" (`endedEarly` in cli.ts).
 */
function signInEnds(): number | undefined {
  const ends = accounts()
    .map((account: unknown) =>
      Date.parse(String((account as { expires_at?: unknown })?.expires_at))
    )
    .filter((t) => !Number.isNaN(t));
  return ends.length ? Math.max(...ends) : undefined;
}

/** The renewal going now, which every run starting meanwhile waits on. */
let renewing: Promise<void> | undefined;

/**
 * Renew the sign-in outside any sandbox. Grok has no command made for it, and
 * `grok models` renews an expired sign-in on disk as it starts (measured on
 * Grok 1.0.46: auth.refresh.success, then auth update disk written). It
 * exits 0 and prints "You are not authenticated." whether it renewed or not,
 * so its caller reads `expires_at` again rather than trust its output. A
 * grok that cannot start here cannot start the run either, which says so.
 * Runs starting together share one renewal, so grok renews once for them. One
 * past RENEW_MS is killed, since a grok that ignores SIGTERM would hold every
 * run back with no word to the owner.
 */
function renew(): Promise<void> {
  renewing ??= new Promise<void>((done) => {
    // Outside the sandbox, so on the home's own leader socket, never the owner's.
    const child = spawn(grokCommand() ?? 'grok', ['models', '--leader-socket', LEADER], {
      cwd: GROK_HOME,
      env: grokEnv(),
      stdio: 'ignore',
      timeout: RENEW_MS,
      killSignal: 'SIGKILL'
    });
    child.on('error', () => done());
    child.on('close', () => done());
  }).finally(() => {
    renewing = undefined;
  });
  return renewing;
}

/**
 * Why a Grok run that may last `lastsMs` cannot start for its sign-in, else
 * nothing. Grok renews its own sign-in, but the profile holds the whole grok
 * process and keeps it from writing auth.json (measured), so a renewal inside
 * a run lives only in that run's memory. Once the stored sign-in ran out,
 * every run then waited on 401s, which its stream never shows, until the
 * office cut it 20 minutes later. So a sign-in that could run out before the
 * run ends is renewed first, and a run whose sign-in has still run out is
 * refused at once.
 */
export async function grokSignedOut(lastsMs: number): Promise<string | undefined> {
  const ends = signInEnds();
  if (ends === undefined || ends > Date.now() + lastsMs + SIGN_IN_MARGIN_MS) return undefined;
  await renew();
  const renewed = signInEnds();
  return renewed !== undefined && renewed > Date.now() ? undefined : GROK_SIGN_IN;
}
