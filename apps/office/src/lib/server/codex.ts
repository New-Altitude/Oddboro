// How a staffer's run starts on Codex instead of Claude Code: the arguments,
// the environment and the input `codex exec` gets, and how run() in staff.ts
// reads what it prints. Server only.
//
// Codex keeps its sign-in and sessions in the office's own Codex home
// (CODEX_HOME), never the owner's ~/.codex. Every switch the office sets goes
// on each run's arguments (`-c`), which beat that home's config.toml; the
// office writes a config.toml only into a home with none, since once the owner
// signs in, that file is the sign-in's to keep. A Codex Odd has a shell, held
// by a permission profile the kernel enforces (Seatbelt on a Mac): it reads
// the system's own folders (`:minimal`), Apple's developer tools (Xcode's
// too, when the Mac uses it), node's OpenSSL config, its folder,
// the owner's data folder and the thread folders it reads, writes only its
// folder, its part of a thread and its own temp folder, never an instruction
// file in them, and reaches no network. The codex process itself and the MCP servers run
// outside that profile, so the Codex home, the sign-in and every Codex Odd's
// sessions stay shut to the model.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { home } from '@oddboro/ledger';
import { andBelow, instructionPaths } from './files.ts';
import {
  mcpGrant,
  NOT_SIGNED_IN,
  replace,
  sweep,
  toml,
  vendorEnv,
  type RunEvent,
  type Toml
} from './launch.ts';

export const CODEX_HOME = home('codex');
const CONFIG = join(CODEX_HOME, 'config.toml');
/**
 * Where a sign-in is kept, since config.toml says `cli_auth_credentials_store
 * = "file"`. Sign out from the page removes it (agent-sign-in.ts).
 */
export const CODEX_AUTH = join(CODEX_HOME, 'auth.json');
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
 * web search, no sub-agents (`features.multi_agent` alone leaves spawn_agent
 * and the rest of the collaboration tools in the model's list; `agents.enabled`
 * takes them out, measured with `codex debug prompt-input` on 0.166.0), no
 * bundled skills, a shell that inherits only the core variables
 * and is never a login shell, no history, analytics or update check, the
 * sign-in kept as a file, and instruction files read from the run's folder
 * only (no project root above it).
 */
const SWITCHES: Record<string, Toml> = {
  approval_policy: 'never',
  web_search: 'disabled',
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

/** The one permission profile each run defines and uses. */
const PROFILE = 'odd';

/** What one Codex run needs from run(). */
type CodexRun = {
  /** The run's key (`runsGoing`), which names its temp folder. */
  key: string;
  /** The Odd's folder, the run's cwd. */
  dir: string;
  /** The folders the run reads besides its own: the owner's data folder, and its thread's or those of the goals a lead's chat leads. */
  reads: string[];
  /** The folders the run writes: its own, and on a thread its part of it. */
  writes: string[];
  /** The file the owner edited, which a run reading that edit may read and not write. */
  edited?: string;
  system: string;
  /** The catch-up preface and the message, which go in on stdin. */
  input: string;
  /** The session to resume, else a new one. */
  resume?: string;
  servers: Record<string, Record<string, unknown>>;
  /** The MCP tools the run may call, as access() names them for Claude Code (`mcp__server` or `mcp__server__tool`). */
  allowed: string[];
};

type CodexLaunch = { args: string[]; env: NodeJS.ProcessEnv; stdin: string; done: () => void };

/**
 * Apple's developer tools, which /usr/bin/python3, git and the other shims in
 * /usr/bin run through: `:minimal` leaves them out, so each failed with
 * "xcode-select: error: No developer tools were found" (measured on Codex
 * 0.166.0). The folder xcode-select uses by default, and the link it reads
 * when the owner switched it elsewhere; /var is itself a link.
 */
const DEVELOPER_TOOLS = [
  '/Library/Developer/CommandLineTools',
  '/private/var/db/xcode_select_link'
];

/**
 * The OpenSSL config node reads as it starts, at the folder its OpenSSL was
 * built with. Refused it, node stops with "OpenSSL configuration error ...
 * BIO_new_file: Operation not permitted", so an Odd could not run JavaScript
 * (measured with `codex sandbox` on 0.166.0 and node 24.22.2). This path fits
 * node from nodejs.org and from nvm, which installs those builds. A Homebrew
 * node reads its own OPENSSLDIR under the Homebrew prefix instead, which is
 * not granted, so an Odd's JavaScript fails there the same way.
 */
const NODE_OPENSSL = '/System/Library/OpenSSL/openssl.cnf';

/** DEVELOPER_TOOLS and the developer folder in use, once found. */
let developerTools: string[] | undefined;

/**
 * DEVELOPER_TOOLS, and the developer folder xcode-select picks as a real path,
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
      // read, so the profile reads DEVELOPER_TOOLS alone.
    }
    developerTools = [...DEVELOPER_TOOLS, ...picked];
  }
  return developerTools;
}

/**
 * The kernel's allowlist for one run, every path a real one. `:root` shuts
 * everything not named; `:minimal` reads what a command needs to start,
 * `developerReads` what the shims in /usr/bin need, and NODE_OPENSSL what
 * node needs; /tmp,
 * which Codex lets a run write by default, is shut. Instruction files in the
 * folders the run writes are shut both ways, each path and what is under it.
 */
function filesystem(r: CodexRun, temp: string): Record<string, string> {
  return {
    ':root': 'deny',
    ':minimal': 'read',
    ':slash_tmp': 'deny',
    ...Object.fromEntries([...developerReads(), NODE_OPENSSL, ...r.reads].map((p) => [p, 'read'])),
    ...Object.fromEntries([...r.writes, temp].map((p) => [p, 'write'])),
    ...Object.fromEntries(
      instructionPaths(r.writes)
        .flatMap(andBelow)
        .map((p) => [p, 'deny'])
    ),
    ...(r.edited ? Object.fromEntries(andBelow(r.edited).map((p) => [p, 'read'])) : {})
  };
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
      const server: Record<string, Toml> =
        s.type === 'http'
          ? { url: s.url as string, http_headers: s.headers as Record<string, string> }
          : {
              command: s.command as string,
              args: (s.args as string[] | undefined) ?? [],
              env: (s.env as Record<string, string> | undefined) ?? {}
            };
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
function homeReady(): void {
  mkdirSync(CODEX_HOME, { recursive: true, mode: 0o700 });
  chmodSync(CODEX_HOME, 0o700);
  if (!existsSync(CONFIG)) replace(CONFIG, FIRST_CONFIG);
}

/**
 * Who the office's Codex home is signed in as: undefined with no sign-in
 * file, else the email its ID token names, when it names one. The token's
 * signature is not checked: the email is shown, never trusted.
 */
export function codexAccount(): { email?: string } | undefined {
  if (!existsSync(CODEX_AUTH)) return undefined;
  try {
    const auth = JSON.parse(readFileSync(CODEX_AUTH, 'utf8')) as {
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
export function codexSignedOut(): string | undefined {
  homeReady();
  return codexAccount() ? undefined : `Codex ${NOT_SIGNED_IN}`;
}

/** The environment every `codex` the office starts gets: the office's Codex home, and no key or setup of the office's own. */
function codexEnv(): NodeJS.ProcessEnv {
  return Object.assign(vendorEnv(['OPENAI_', 'CODEX_']), { CODEX_HOME });
}

/**
 * The browser sign-in to the office's Codex home, which the page starts
 * (agent-sign-in.ts). It says to keep the sign-in as a file even when the
 * home's config.toml does not, or the office would never see it.
 */
export function codexSignIn(): { args: string[]; env: NodeJS.ProcessEnv } {
  homeReady();
  return {
    args: ['login', '-c', `cli_auth_credentials_store=${toml('file')}`],
    env: codexEnv()
  };
}

/**
 * Get a Codex run ready: its home, its temp folder, and the arguments,
 * environment and input to start `codex exec` with. `done` removes the temp
 * folder.
 */
export function codexLaunch(r: CodexRun): CodexLaunch {
  homeReady();
  mkdirSync(TEMPS, { recursive: true, mode: 0o700 });
  sweep(TEMPS, '', r.key);
  const temp = join(TEMPS, r.key);
  mkdirSync(temp, { mode: 0o700 });
  const set = (key: string, value: Toml) => ['-c', `${key}=${toml(value)}`];
  const model = process.env.OFFICE_CODEX_MODEL;
  const args = [
    'exec',
    '--json',
    // The Odd's folder is not a git repository.
    '--skip-git-repo-check',
    // A switch this Codex does not know stops the run instead of being dropped.
    '--strict-config',
    '--ignore-rules',
    ...Object.entries(SWITCHES).flatMap(([k, v]) => set(k, v)),
    ...set('developer_instructions', r.system),
    ...set('permissions', {
      [PROFILE]: { filesystem: filesystem(r, temp), network: { enabled: false } }
    }),
    ...set('default_permissions', PROFILE),
    ...set('mcp_servers', mcpServers(r.servers, r.allowed)),
    ...(model ? ['-m', model] : []),
    // "-" reads the message from stdin, so one that starts with a dash is never a flag.
    ...(r.resume ? ['resume', r.resume, '-'] : ['-'])
  ];
  return {
    args,
    env: { ...codexEnv(), TMPDIR: temp },
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
