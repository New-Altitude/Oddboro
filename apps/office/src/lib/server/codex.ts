// How a staffer's run starts on Codex instead of Claude Code: the arguments,
// the environment and the input `codex exec` gets, and how run() in staff.ts
// reads what it prints. Server only.
//
// Codex keeps its sign-in and sessions in the office's own Codex home
// (CODEX_HOME), never the owner's ~/.codex. Every switch the office sets goes
// on each run's arguments (`-c`), which beat that home's config.toml; the
// office writes a config.toml only into a home with none, since once the owner
// signs in, that file is the sign-in's to keep. A Codex Odd reads and changes
// files through the office's file tools (files-server.ts in the ledger), with
// Codex's own shell off, so the office holds its folders on every system. With
// Run commands on (a Mac or Linux, where its sandbox held), it also has a
// shell, held by a permission profile the kernel enforces (Seatbelt on a Mac,
// bubblewrap on Linux, which also reads Codex's own install): it reads
// the system's own folders (`:minimal`), Apple's developer tools (Xcode's
// too, when the Mac uses it), node's OpenSSL config, the owner's developer
// tool folders but their credential files (`devReads`), its folder,
// the owner's data folder, the thread folders it reads and the folders the
// owner gave it, writes only its folder, its part of a thread, the folders the
// owner gave it to change and its own temp folder, never an instruction file
// in them, and never reaches the internet (`networkWithWeb` in `AGENT_PLATFORMS`). Codex's own
// web search runs outside the profile, only with Browse the web on. The codex
// process itself and the MCP servers run outside that profile, so the Codex
// home, the sign-in and every Codex Odd's sessions stay shut to the model.
// Without a shell, the profile still holds apply_patch, Codex's one way to
// write a file itself. On Windows, where Codex's own sandbox opened every
// Odd's folder to reads (2026-11-06), a run has no shell and Codex's
// read-only mode, so apply_patch writes nothing.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import {
  currentPlatform,
  home,
  OFFICE_ACCOUNT,
  OFFICE_MODEL_VAR,
  toolHome,
  type Effort
} from '@oddboro/ledger';
import { andBelow, instructionPaths } from './files.ts';
import { devReads } from './sandbox.ts';
import { sandboxPaths } from './sandbox-paths.ts';
import { onPath } from './on-path.ts';
import {
  mcpGrant,
  NOT_SIGNED_IN,
  replace,
  shellEnv,
  sweep,
  toml,
  vendorEnv,
  type McpServer,
  type RunEvent,
  type RunImage,
  type Toml
} from './launch.ts';
import { runEnv } from './run-env-allow.ts';

/**
 * One account's Codex home (`toolHome`), its config, and where its sign-in is
 * kept, since config.toml says `cli_auth_credentials_store = "file"`. Sign out
 * from the page removes it (agent-sign-in.ts).
 */
export function codexHome(account: string = OFFICE_ACCOUNT) {
  const dir = toolHome('codex', account);
  return { dir, config: join(dir, 'config.toml'), auth: join(dir, 'auth.json') };
}
type CodexHome = ReturnType<typeof codexHome>;
/**
 * Each run's own temp folder, named by its key. A shared one would let one
 * Odd's shell read what another's left there.
 */
const TEMPS = home('codex-tmp');

/**
 * Codex features that are on by default and that no Odd needs: other agents,
 * images, browsers and computer use, plugins, apps (a ChatGPT sign-in's
 * connectors), hooks, memories, goals, and installing what a skill or folder
 * asks for.
 */
const FEATURES_OFF = [
  'view_image',
  'multi_agent',
  'hooks',
  'memories',
  'apps',
  'remote_plugin',
  'goals',
  'shell_snapshot',
  'plugins',
  'browser_use',
  'computer_use',
  'image_generation',
  'in_app_browser',
  'skill_mcp_dependency_install',
  'workspace_dependencies',
  'tool_suggest',
  'sleep_tool'
];

/**
 * What every Codex run sets, whatever its home's config.toml says: no
 * approval prompts (a call outside the profile is refused, not escalated), no
 * sub-agents (`features.multi_agent` alone leaves spawn_agent
 * and the rest of the collaboration tools in the model's list; `agents.enabled`
 * takes them out, measured with `codex debug prompt-input` on 0.166.0), no
 * bundled skills, a shell that inherits only the core variables (so
 * anything a run's shell needs besides them goes in
 * `shell_environment_policy.set`, never on the codex process's own
 * environment) and is never a login shell, no history, analytics or update check, the
 * sign-in kept as a file, and instruction files read from the run's folder
 * only (no project root above it).
 */
const SWITCHES: Record<string, Toml> = {
  approval_policy: 'never',
  'agents.enabled': false,
  allow_login_shell: false,
  'shell_environment_policy.inherit': 'core',
  'history.persistence': 'none',
  'analytics.enabled': false,
  check_for_update_on_startup: false,
  cli_auth_credentials_store: 'file',
  project_root_markers: [],
  'skills.bundled.enabled': false,
  'skills.include_instructions': false,
  ...Object.fromEntries(FEATURES_OFF.map((f) => [`features.${f}`, false]))
};

/**
 * The config.toml written into a home that has none, so a sign-in before any
 * run is kept as a file too. The runs pass the same switches themselves.
 */
const FIRST_CONFIG = `# Oddboro's Codex home. Odds never read the owner's ~/.codex.\n${Object.entries(
  SWITCHES
)
  .map(([k, v]) => `${k} = ${toml(v)}`)
  .join('\n')}\n`;

/** What Codex shuts itself at the top of each write folder on Linux (`filesystem`). */
const SELF_SHUT = ['.codex', '.agents'];

/** The one permission profile each run defines and uses. */
const PROFILE = 'odd';

/** What one Codex run needs from run(). */
type CodexRun = {
  /** The run's key (`runsGoing`), which names its temp folder. */
  key: string;
  /** The account whose Codex home the run uses (accounts.ts). */
  account: string;
  /** The Odd's folder, the run's cwd. */
  dir: string;
  /** The folders the run reads besides its own: the owner's data folder, its thread's or those of the goals a lead's chat leads, and the folders the owner gave the Odd. */
  reads: string[];
  /** The folders the run writes: its own, on a thread its part of it, and the folders the owner gave the Odd to change. */
  writes: string[];
  /** The file the owner edited, which a run reading that edit may read and not write. */
  edited?: string;
  system: string;
  /** The catch-up preface and the message, which go in on stdin. */
  input: string;
  /** The session to resume, else a new one. */
  resume?: string;
  servers: Record<string, McpServer>;
  /** The MCP tools the run may call, as access() names them for Claude Code (`mcp__server` or `mcp__server__tool`). */
  allowed: string[];
  /** The owner's Browse the web switch: Codex's own web search, which works with the network off. */
  web: boolean;
  /** A shell (Run commands, where Codex's sandbox holds it): without one, files go through the office's file tools only. */
  commands: boolean;
  /** Whether the run's commands reach the internet (`network` in its profile). */
  network: boolean;
  /** Pictures sent with the message, each as `--image=<file>`. */
  images?: RunImage[];
  /** How hard the model thinks, as `model_reasoning_effort`: an Odd's level or an office run's. */
  effort?: Effort;
  /** The Odd's own model; without one, the office's (`OFFICE_CODEX_MODEL`) or the tool's default. */
  model?: string;
};

type CodexLaunch = { args: string[]; env: NodeJS.ProcessEnv; stdin: string; done: () => void };

/**
 * Apple's developer tools, which /usr/bin/python3, git and the other shims in
 * /usr/bin run through: `:minimal` leaves them out, so each failed with
 * "xcode-select: error: No developer tools were found" (measured on Codex
 * 0.166.0). The folder xcode-select uses by default, and the link it reads
 * when the owner switched it elsewhere; /var is itself a link.
 */
const developerToolFolders = () => sandboxPaths().codexReads;

/**
 * The OpenSSL config node reads as it starts, at the folder its OpenSSL was
 * built with. Refused it, node stops with "OpenSSL configuration error ...
 * BIO_new_file: Operation not permitted", so an Odd could not run JavaScript
 * (measured with `codex sandbox` on 0.166.0 and node 24.22.2). This path fits
 * node from nodejs.org and from nvm, which installs those builds. A Homebrew
 * node reads its own OPENSSLDIR under the Homebrew prefix instead, which is
 * not granted, so an Odd's JavaScript fails there the same way.
 */
const nodeOpenssl = () => sandboxPaths().opensslConf;

/** `developerToolFolders` and the developer folder in use, once found. */
let developerTools: string[] | undefined;

/**
 * `developerToolFolders`, and the developer folder xcode-select picks as a real path,
 * which is Xcode.app's own on a Mac that uses Xcode. Asked once, as the first
 * run's profile is built, and without DEVELOPER_DIR, which a run's shell does
 * not inherit, so it names the folder the shims in the run go to.
 */
function developerReads(): string[] {
  if (!developerTools) {
    let picked: string[] = [];
    try {
      const out = execFileSync('xcode-select', ['-p'], {
        env: { PATH: process.env.PATH },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      picked = [realpathSync(out.trim())];
    } catch {
      // No xcode-select, or no developer folder: a shim has nothing more to
      // read, so the profile reads `developerToolFolders` alone.
    }
    developerTools = [...developerToolFolders(), ...picked];
  }
  return developerTools;
}

/**
 * The kernel's allowlist for one run, every path a real one. `:root` shuts
 * everything not named; `:minimal` reads what a command needs to start,
 * `developerReads` what the shims in /usr/bin need, `nodeOpenssl` what
 * node needs, and `devReads` the owner's developer tools; /tmp,
 * which Codex lets a run write by default, is shut. Instruction files in the
 * folders the run writes are shut both ways, each path and what is under it.
 *
 * No entry names a repository's hooks, config or submodules (`REPO_RUNS`):
 * Codex itself keeps each write folder's own `.git` read only (measured with
 * `codex sandbox` on 0.166.0), so a Codex Odd cannot commit there either. A
 * repository further in (`<w>/sub/.git`) is not covered: Codex takes a glob
 * only as `deny` (it refuses to start on a `read` or `write` one), and a
 * deny would stop git reading its config. Like every tool's git walls, these
 * shut git's usual places only, not every way code in a project can run
 * later (`REPO_RUNS` in files.ts).
 *
 * On Linux, Codex itself mounts `.codex` and `.agents` read only at the top
 * of each write folder, an empty folder when there is none (measured with
 * `codex sandbox` on 0.167.0). A deny on that exact path asks bubblewrap for
 * a file there too, and every run then failed at its start ("Can't create
 * file at <w>/.agents: Is a directory"). So Linux leaves out those two exact
 * paths (`SELF_SHUT`); the deny on what is under them stays.
 */
function filesystem(r: CodexRun, temp: string): Record<string, string> {
  const dev = devReads();
  const selfShut = new Set(
    currentPlatform() === 'linux' ? r.writes.flatMap((w) => SELF_SHUT.map((n) => `${w}/${n}`)) : []
  );
  return {
    ':root': 'deny',
    ':minimal': 'read',
    ':slash_tmp': 'deny',
    ...Object.fromEntries(
      [...developerReads(), nodeOpenssl(), ...codexInstall(), ...dev.reads, ...r.reads].map((p) => [
        p,
        'read'
      ])
    ),
    // After the reads, so each deny shuts one file in a folder read above.
    ...Object.fromEntries(dev.denies.map((p) => [p, 'deny'])),
    ...Object.fromEntries([...r.writes, temp].map((p) => [p, 'write'])),
    ...Object.fromEntries(
      instructionPaths(r.writes)
        .flatMap(andBelow)
        .filter((p) => !selfShut.has(p))
        .map((p) => [p, 'deny'])
    ),
    ...(r.edited ? Object.fromEntries(andBelow(r.edited).map((p) => [p, 'read'])) : {})
  };
}

/** The variable a Codex run reads the gateway's token from (`bearer_token_env_var`). */
export const GATEWAY_TOKEN = 'ODDBORO_GATEWAY_TOKEN';

/** The gateway's token a run's servers carry, if any: every outside tool shares the run's one token. */
function gatewayToken(servers: CodexRun['servers']): string | undefined {
  for (const s of Object.values(servers)) {
    const auth = s.type === 'http' ? s.headers.Authorization : undefined;
    if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  }
  return undefined;
}

/**
 * Codex's own install, which its sandbox reads on Linux: there Codex starts a
 * copy of itself inside bubblewrap, which failed with "execvp … No such file
 * or directory" while the profile shut it (0.166.0 on Fedora 45). An npm
 * install's whole @openai folder, which holds the binary for this machine
 * beside the package or inside it; any other install's own folder.
 */
function codexInstall(): string[] {
  if (currentPlatform() !== 'linux') return [];
  const found = onPath('codex');
  if (!found) return [];
  const real = realpathSync(found);
  const npm = real.lastIndexOf(`${sep}node_modules${sep}@openai${sep}`);
  return [
    npm === -1 ? dirname(real) : real.slice(0, npm + `${sep}node_modules${sep}@openai`.length)
  ];
}

/**
 * The run's MCP servers in Codex's shape. A server access() allows whole
 * (`mcp__office`, `mcp__c`) gets every tool; one allowed tool by tool
 * (`mcp__c__t`) gets only those. Tools are called without asking, and a run
 * whose office server does not start fails.
 */
export function mcpServers(
  servers: CodexRun['servers'],
  allowed: string[]
): Record<string, Record<string, Toml>> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, s]) => {
      const grants = allowed.map(mcpGrant).filter((g) => g.server === name);
      const whole = grants.some((g) => !g.tool);
      const tools = grants.flatMap((g) => (g.tool ? [g.tool] : []));
      let server: Record<string, Toml>;
      switch (s.type) {
        case 'http': {
          // The gateway's token comes from Codex's environment, never the command
          // line, where any program could read it. Any other header goes as it is.
          const { Authorization, ...rest } = s.headers;
          const fromEnv = Authorization?.startsWith('Bearer ');
          const headers = fromEnv || !Authorization ? rest : { Authorization, ...rest };
          server = {
            url: s.url,
            ...(fromEnv ? { bearer_token_env_var: GATEWAY_TOKEN } : {}),
            ...(Object.keys(headers).length ? { http_headers: headers } : {})
          };
          break;
        }
        case 'stdio':
          server = { command: s.command, args: s.args, env: s.env };
          break;
        default: {
          // A kind with no case here fails the type check; the cast only names it.
          const missed: never = s;
          throw new Error(
            `No way to give Codex the ${name} server, a ${(missed as McpServer).type} one`
          );
        }
      }
      return [
        name,
        {
          ...server,
          default_tools_approval_mode: 'approve',
          ...(name === 'office' ? { required: true } : {}),
          ...(whole ? {} : { enabled_tools: tools })
        }
      ];
    })
  );
}

/**
 * The office's Codex home, shut to everyone but the owner, with a config.toml
 * if it had none. Made before the sign-in check and the sign-in, so a sign-in
 * keeps itself as a file, not in the keychain.
 */
function homeReady(h: CodexHome): void {
  mkdirSync(h.dir, { recursive: true, mode: 0o700 });
  chmodSync(h.dir, 0o700);
  if (!existsSync(h.config)) replace(h.config, FIRST_CONFIG);
}

/**
 * Who the office's Codex home is signed in as: undefined with no sign-in
 * file, else the email its ID token names, when it names one. The token's
 * signature is not checked: the email is shown, never trusted.
 */
export function codexAccount(account: string = OFFICE_ACCOUNT): { email?: string } | undefined {
  const h = codexHome(account);
  if (!existsSync(h.auth)) return undefined;
  try {
    const auth = JSON.parse(readFileSync(h.auth, 'utf8')) as {
      tokens?: { id_token?: unknown };
    };
    const payload = auth.tokens?.id_token;
    if (typeof payload !== 'string') return {};
    const claims = JSON.parse(
      Buffer.from(payload.split('.')[1] ?? '', 'base64url').toString('utf8')
    ) as { email?: unknown };
    return typeof claims.email === 'string' ? { email: claims.email } : {};
  } catch {
    // A sign-in file with no readable email still signs the runs in.
    return {};
  }
}

/**
 * What the desk shows when the office's Codex home has no sign-in, else
 * nothing. Codex's own advice would sign in the owner's ~/.codex, so this
 * points to the office's own sign-in, on the page.
 */
export function codexSignedOut(account: string = OFFICE_ACCOUNT): string | undefined {
  homeReady(codexHome(account));
  return codexAccount(account) ? undefined : `Codex ${NOT_SIGNED_IN}`;
}

/**
 * The environment every `codex` the office starts gets: the office's Codex
 * home, and no key or setup of the office's own. A run starts from `base`,
 * its `runEnv`; the sign-in from the owner-side `vendorEnv`.
 */
function codexEnv(h: CodexHome, base = vendorEnv(['OPENAI_', 'CODEX_'])): NodeJS.ProcessEnv {
  return Object.assign(base, { CODEX_HOME: h.dir });
}

/**
 * The browser sign-in to the office's Codex home, which the page starts
 * (agent-sign-in.ts). It says to keep the sign-in as a file even when the
 * home's config.toml does not, or the office would never see it.
 */
export function codexSignIn(account: string = OFFICE_ACCOUNT): {
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const h = codexHome(account);
  homeReady(h);
  return {
    args: ['login', '-c', `cli_auth_credentials_store=${toml('file')}`],
    env: codexEnv(h)
  };
}

/**
 * Get a Codex run ready: its home, its temp folder with the empty git
 * template inside (`shellEnv`), and the arguments, environment and input to
 * start `codex exec` with. `done` removes the temp folder.
 */
export function codexLaunch(r: CodexRun): CodexLaunch {
  const h = codexHome(r.account);
  homeReady(h);
  mkdirSync(TEMPS, { recursive: true, mode: 0o700 });
  sweep(TEMPS, '', r.key);
  const temp = join(TEMPS, r.key);
  mkdirSync(temp, { mode: 0o700 });
  const shell = shellEnv(temp);
  mkdirSync(shell.GIT_TEMPLATE_DIR, { mode: 0o700 });
  const set = (key: string, value: Toml) => ['-c', `${key}=${toml(value)}`];
  const model = r.model ?? process.env[OFFICE_MODEL_VAR.codex];
  const args = [
    'exec',
    '--json',
    // The Odd's folder is not a git repository.
    '--skip-git-repo-check',
    // A switch this Codex does not know stops the run instead of being dropped.
    '--strict-config',
    '--ignore-rules',
    ...Object.entries(SWITCHES).flatMap(([k, v]) => set(k, v)),
    // Here, not in `env`: the shell inherits only the core variables. One
    // `set` only, since a second would replace the first.
    ...set('shell_environment_policy.set', shell),
    ...set('web_search', r.web ? 'live' : 'disabled'),
    ...set('developer_instructions', r.system),
    // The shell only with Run commands; the office's file tools are the way to files.
    ...set('features.shell_tool', r.commands),
    ...set('features.unified_exec', r.commands),
    ...(currentPlatform() === 'win32'
      ? set('sandbox_mode', 'read-only')
      : [
          ...set('permissions', {
            [PROFILE]: { filesystem: filesystem(r, temp), network: { enabled: r.network } }
          }),
          ...set('default_permissions', PROFILE),
          // No AGENTS.md read at the start. On Linux Codex reads it through the
          // run's sandbox, where the office shuts it; one run in two then met
          // the deny's placeholder and failed ("failed to load AGENTS.md
          // instructions: Permission denied", 0.167.0). The run's instructions
          // come in `developer_instructions`, never in a file.
          ...(currentPlatform() === 'linux' ? set('project_doc_max_bytes', 0) : [])
        ]),
    ...set('mcp_servers', mcpServers(r.servers, r.allowed)),
    ...(r.effort ? set('model_reasoning_effort', r.effort) : []),
    ...(model ? ['-m', model] : []),
    // "-" reads the message from stdin, so one that starts with a dash is never a flag.
    // Pictures go last, after `resume <id>` on a resumed session, which takes its
    // own `--image` (Codex 0.166). Each is joined to its flag: `--image` takes many
    // values, so a bare file after it would also take the "-".
    ...(r.resume ? ['resume', r.resume] : []),
    ...(r.images ?? []).map((i) => `--image=${i.path}`),
    '-'
  ];
  return {
    args,
    env: {
      ...codexEnv(h, runEnv('codex')),
      TMPDIR: temp,
      // Codex's shell inherits only the core variables, so commands never see it.
      ...(gatewayToken(r.servers) ? { [GATEWAY_TOKEN]: gatewayToken(r.servers) } : {})
    },
    stdin: r.input,
    done: () => rmSync(temp, { recursive: true, force: true })
  };
}

/** Claude Code's name for each kind of Codex item that is a tool call, as the floor is told it. */
function toolOf(item: Record<string, unknown>): string | undefined {
  if (item.type === 'command_execution') return 'Bash';
  if (item.type === 'file_change') return 'Edit';
  if (item.type === 'mcp_tool_call') return `mcp__${String(item.server)}__${String(item.tool)}`;
  return undefined;
}

const count = (n: unknown) => (typeof n === 'number' ? n : 0);

/**
 * A reader of one run's `codex exec --json` lines (shapes from Codex's
 * exec_events.rs). Each tool call shows once, whether it first appears
 * started or, like a file change, only completed. Codex counts cached and
 * cache-written tokens inside its input tokens and reasoning inside its output
 * tokens, so input here is what is left of it and output is taken whole.
 */
export function codexReader(model: string): (e: Record<string, unknown>) => RunEvent[] {
  const seen = new Set<string>();
  return (e) => {
    if (e.type === 'thread.started' && typeof e.thread_id === 'string')
      return [{ type: 'session', id: e.thread_id }];
    if (e.type === 'item.started' || e.type === 'item.completed') {
      const item = (e.item ?? {}) as Record<string, unknown>;
      const tool = toolOf(item);
      if (tool && !seen.has(String(item.id))) {
        seen.add(String(item.id));
        return [{ type: 'tool', name: tool }];
      }
      if (e.type === 'item.completed' && item.type === 'agent_message')
        return [{ type: 'message', text: String(item.text ?? '') }];
      return [];
    }
    if (e.type === 'turn.completed') {
      const u = (e.usage ?? {}) as Record<string, unknown>;
      const cached = count(u.cached_input_tokens);
      const written = count(u.cache_write_input_tokens);
      return [
        {
          type: 'usage',
          usage: {
            [model]: {
              inputTokens: Math.max(0, count(u.input_tokens) - cached - written),
              outputTokens: count(u.output_tokens),
              cacheReadInputTokens: cached,
              cacheCreationInputTokens: written
            }
          }
        },
        { type: 'done' }
      ];
    }
    if (e.type === 'turn.failed')
      return [
        { type: 'failed', message: String((e.error as { message?: unknown })?.message ?? '') }
      ];
    if (e.type === 'error') return [{ type: 'error', message: String(e.message ?? '') }];
    return [];
  };
}
