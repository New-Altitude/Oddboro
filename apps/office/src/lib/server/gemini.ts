// How a staffer's run starts on Gemini CLI instead of Claude Code: the
// arguments, the environment and the input `gemini` gets, the policy that is
// its only write wall, and how run() in staff.ts reads what it prints. Server
// only.
//
// Gemini keeps its sessions in the office's own Gemini home
// (GEMINI_CLI_HOME), never the owner's ~/.gemini, and signs in with an API
// key the owner gives on the office's page, kept in the keychain like the
// Claude key, never a login. A Gemini Odd has file tools only:
// Gemini itself holds its reads to the run's folder, the owner's data folder
// and the thread folders it reads (`--include-directories`), and one policy
// file per run, which beats every settings file, decides each call. Every
// tool not named is denied, which also hides it from the model; the read tools
// and the MCP tools access() allows are allowed; writes are allowed only under
// the folders the run writes, and refused for an instruction file there, the
// file the owner edited, or a path that is not plain. Gemini runs no shell,
// but its MCP servers are processes of their own, so the run is a process
// group that stops whole.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { home, type ModelUsage } from '@oddboro/ledger';
import { INSTRUCTIONS } from './files.ts';
import { deleteSecret, getSecret, setSecret } from './keychain.ts';
import {
  mcpGrant,
  replace,
  SIGN_IN_WHERE,
  sweep,
  toml,
  vendorEnv,
  type RunEvent,
  type Toml
} from './launch.ts';
import { GEMINI_FILE_TOOLS } from '../staff/work.ts';

/** The office's Gemini home: Gemini's own folder in it is `.gemini`, with the sessions. */
const GEMINI_HOME = home('gemini');
/**
 * Each run's own folder, named by its key: its policy, its settings (which
 * hold the MCP servers' secrets) and its instructions. It sits outside
 * `.gemini`, so no run reads it.
 */
const RUNS = join(GEMINI_HOME, 'runs');

/** The file tools that change a file, and those that only read. */
const WRITE_TOOLS = Object.entries(GEMINI_FILE_TOOLS)
  .filter(([, name]) => name === 'Write' || name === 'Edit')
  .map(([tool]) => tool);
const READ_TOOLS = Object.keys(GEMINI_FILE_TOOLS).filter((t) => !WRITE_TOOLS.includes(t));

/**
 * The policy's priorities. A `--policy` file is Gemini's user tier (4), and a
 * rule's priority there is 4 + p/1000, so these sit above every rule settings
 * add (4.1 to 4.9). The highest match wins: a refusal beats an allow, and an
 * allow beats the deny of everything else.
 */
const REFUSE = 999;
const ALLOW = 990;
const DENY_REST = 980;

/**
 * Where a write's path starts in what Gemini matches a rule's `argsPattern`
 * against: the call's arguments as JSON with sorted keys, each top-level pair
 * between NUL characters. A value's own NUL is written `\u0000`, so nothing
 * in a file's content can stand in for this.
 */
const FILE_PATH = '\\x00"file_path":"';
/** One character as it stands in that JSON, as a regular expression. */
const literal = (c: string) =>
  JSON.stringify(c)
    .slice(1, -1)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Text exactly as written. */
const exact = (s: string) => [...s].map(literal).join('');
/**
 * Text in any case, since a Mac's disk ignores case. Gemini builds each
 * regular expression with no flags, so each letter is a pair.
 */
const anyCase = (s: string) =>
  [...s]
    .map((c) => (/[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : literal(c)))
    .join('');

/**
 * A path that is not plain, which no write may take: a `.` or `..` part, an
 * empty part (`//`), a trailing `/`, an escaped character (a backslash in the
 * JSON) or a character past ASCII, since a Mac's disk folds some of those
 * (the Kelvin sign is a `k`) and the case-blind refusals below spell ASCII.
 * Gemini drops a rule whose expression nests a quantifier, so the one group
 * here has none after it.
 */
const NOT_PLAIN = `${FILE_PATH}[^\\x00]*(?:/\\.{0,2}[/"]|\\\\|[^\\x00-\\x7f])`;

/** What one Gemini run needs from run(). */
type GeminiRun = {
  /** The run's key (`runsGoing`), which names its folder. */
  key: string;
  /** The Odd's folder, the run's cwd. */
  dir: string;
  /** The folders the run reads besides its own: the owner's data folder, and its thread's or those of the goals a lead's chat leads. */
  reads: string[];
  /** The folders the run writes: its own, and on a thread its part of it. */
  writes: string[];
  /** The file the owner edited, inside `dir`, which a run reading that edit may read and not write. */
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

type GeminiLaunch = { args: string[]; env: NodeJS.ProcessEnv; stdin: string; done: () => void };

type Rule = Record<string, Toml>;

/** The run's policy rules, each as Gemini's TOML table holds it. */
export function geminiRules(r: Pick<GeminiRun, 'dir' | 'writes' | 'edited' | 'allowed'>): Rule[] {
  const names = INSTRUCTIONS.map(anyCase).join('|');
  const write = (priority: number, decision: string, argsPattern: string): Rule => ({
    toolName: WRITE_TOOLS,
    decision,
    priority,
    argsPattern
  });
  return [
    write(REFUSE, 'deny', NOT_PLAIN),
    // An instruction file or folder anywhere in a folder the run writes. `(?:...)?`
    // nests a quantifier, which Gemini drops, so "any folders, or none" is `(?:x|)`.
    ...r.writes.map((w) =>
      write(REFUSE, 'deny', `${FILE_PATH}${exact(w)}/(?:[^\\x00]*/|)(?:${names})[/"]`)
    ),
    ...(r.edited
      ? [write(REFUSE, 'deny', `${FILE_PATH}${exact(r.dir)}/${anyCase(r.edited)}"`)]
      : []),
    ...r.writes.map((w) => write(ALLOW, 'allow', `${FILE_PATH}${exact(w)}/`)),
    { toolName: READ_TOOLS, decision: 'allow', priority: ALLOW },
    ...r.allowed.map(mcpGrant).map(({ server, tool }): Rule => ({
      mcpName: server,
      toolName: tool ?? '*',
      decision: 'allow',
      priority: ALLOW
    })),
    { toolName: '*', decision: 'deny', priority: DENY_REST }
  ];
}

/** The run's policy file. */
export function geminiPolicy(r: Parameters<typeof geminiRules>[0]): string {
  return geminiRules(r)
    .map(
      (rule) =>
        `[[rule]]\n${Object.entries(rule)
          .map(([k, v]) => `${k} = ${toml(v)}`)
          .join('\n')}\n`
    )
    .join('\n');
}

/** The run's MCP servers in Gemini's shape: `httpUrl` is streamable HTTP. */
function mcpServers(servers: GeminiRun['servers']): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, s]) => [
      name,
      s.type === 'http'
        ? {
            httpUrl: s.url as string,
            headers: (s.headers as Record<string, string> | undefined) ?? {}
          }
        : {
            command: s.command as string,
            args: (s.args as string[] | undefined) ?? [],
            env: (s.env as Record<string, string> | undefined) ?? {}
          }
    ])
  );
}

/**
 * The office's Gemini API key, the only sign-in a Gemini run takes, as the
 * keychain last gave it: null when it had none, undefined before the first
 * read. The miss is kept too, so the keychain is asked once per office start
 * however often the page or a run asks, and once more after each Sign out.
 * So a key put in the keychain outside the page is seen once the office
 * restarts; the page's own save is seen at once.
 */
let kept: string | null | undefined;
function geminiKey(): string | undefined {
  if (kept === undefined) kept = getSecret('gemini', 'API_KEY') ?? null;
  return kept ?? undefined;
}

/** Whether the office has a Gemini key, for the page: Gemini names no account. */
export const geminiAccount = (): { email?: string } | undefined => (geminiKey() ? {} : undefined);

/** Lists one of Google's models: free, and it answers only to a key that works. */
const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';

/**
 * Keep the owner's Gemini API key in the keychain, once one listing of
 * Google's models with it succeeds, so a typo never reads as signed in.
 */
export async function setGeminiKey(
  value: string
): Promise<{ ok: true } | { ok: false; problem: string }> {
  const key = value.trim();
  // Before anything else, so a value with a line break is never sent or stored.
  if (!/^[\w-]{20,200}$/.test(key))
    return { ok: false, problem: 'That does not look like a Gemini API key.' };
  let res: Response;
  try {
    // Through globalThis at call time, so a test's stand-in answers instead of Google.
    res = await globalThis.fetch(MODELS_URL, {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    return {
      ok: false,
      problem:
        'The office could not reach Google to try the key. Check the connection, then try again.'
    };
  }
  await res.body?.cancel();
  if (!res.ok)
    return { ok: false, problem: 'That key did not work. Check it in Google AI Studio.' };
  try {
    setSecret('gemini', 'API_KEY', key);
  } catch (e) {
    // A computer with no secret store the office can use says so in the ledger's words.
    return { ok: false, problem: e instanceof Error ? e.message : String(e) };
  }
  kept = key;
  return { ok: true };
}

/** Sign Gemini out: take its key out of the keychain, and ask the keychain again next time. */
export function clearGeminiKey(): void {
  deleteSecret('gemini', 'API_KEY');
  kept = undefined;
}

/** What the desk shows when the office has no Gemini API key, else nothing. */
export function geminiKeyMissing(): string | undefined {
  return geminiKey()
    ? undefined
    : `Gemini has no API key in this office. Add one ${SIGN_IN_WHERE}.`;
}

/**
 * Get a Gemini run ready: its folder with its policy, settings and
 * instructions, and the arguments, environment and input to start `gemini`
 * with. `done` removes the folder.
 */
export function geminiLaunch(r: GeminiRun): GeminiLaunch {
  mkdirSync(RUNS, { recursive: true, mode: 0o700 });
  sweep(RUNS, '', r.key);
  const run = join(RUNS, r.key);
  mkdirSync(run, { mode: 0o700 });
  const policy = join(run, 'policy.toml');
  const settings = join(run, 'settings.json');
  const system = join(run, 'system.md');
  replace(policy, geminiPolicy(r));
  // Read as Gemini's system settings, which merge last, over the home's and the folder's own.
  replace(
    settings,
    JSON.stringify({
      security: { auth: { selectedType: 'gemini-api-key' } },
      // No .env from the run's folder or above it reaches Gemini.
      advanced: { ignoreLocalEnv: true },
      privacy: { usageStatisticsEnabled: false },
      mcpServers: mcpServers(r.servers)
    })
  );
  replace(system, r.system);
  const model = process.env.OFFICE_GEMINI_MODEL;
  const args = [
    '-o',
    'stream-json',
    '--policy',
    policy,
    ...r.reads.flatMap((p) => ['--include-directories', p]),
    ...(model ? ['-m', model] : []),
    ...(r.resume ? ['--resume', r.resume] : [])
  ];
  const env = vendorEnv(['GEMINI_', 'GOOGLE_']);
  Object.assign(env, {
    GEMINI_CLI_HOME: GEMINI_HOME,
    // The run's folder is the Odd's own, so Gemini need not ask whether to trust it.
    GEMINI_CLI_TRUST_WORKSPACE: 'true',
    GEMINI_CLI_SYSTEM_SETTINGS_PATH: settings,
    GEMINI_SYSTEM_MD: system,
    GEMINI_API_KEY: geminiKey()
  });
  return {
    args,
    env,
    // Gemini runs a message that starts with "/" as one of its own commands;
    // after a line break, no message does.
    stdin: `\n${r.input}`,
    done: () => rmSync(run, { recursive: true, force: true })
  };
}

const count = (n: unknown) => (typeof n === 'number' ? n : 0);

/**
 * A reader of one run's `gemini -o stream-json` lines. Gemini streams the
 * reply in pieces; they are kept and sent on as one message when a tool call
 * or the result ends them, so the reply is the last message, as on Codex.
 * Tools reach the floor by Claude Code's names: a file tool by
 * GEMINI_FILE_TOOLS, an MCP tool (`mcp_<server>_<tool>`) as
 * `mcp__<server>__<tool>`. Gemini counts cached tokens inside its input, so
 * input here is what is left (`input`).
 */
export function geminiReader(servers: string[]): (e: Record<string, unknown>) => RunEvent[] {
  let text = '';
  const message = (): RunEvent[] => {
    const whole = text;
    text = '';
    return whole ? [{ type: 'message', text: whole }] : [];
  };
  const toolName = (name: string): string => {
    if (Object.hasOwn(GEMINI_FILE_TOOLS, name))
      return GEMINI_FILE_TOOLS[name as keyof typeof GEMINI_FILE_TOOLS];
    const server = servers.find((s) => name.startsWith(`mcp_${s}_`));
    return server ? `mcp__${server}__${name.slice(`mcp_${server}_`.length)}` : name;
  };
  return (e) => {
    if (e.type === 'init' && typeof e.session_id === 'string')
      return [{ type: 'session', id: e.session_id }];
    // Gemini echoes the owner's message as a user message.
    if (e.type === 'message' && e.role === 'assistant') {
      text += String(e.content ?? '');
      return [];
    }
    if (e.type === 'tool_use')
      return [...message(), { type: 'tool', name: toolName(String(e.tool_name)) }];
    if (e.type === 'error') return [{ type: 'error', message: String(e.message ?? '') }];
    if (e.type === 'result') {
      const models = ((e.stats as { models?: unknown } | undefined)?.models ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const usage: ModelUsage = Object.fromEntries(
        Object.entries(models).map(([model, m]) => [
          model,
          {
            inputTokens: count(m.input),
            outputTokens: count(m.output_tokens),
            cacheReadInputTokens: count(m.cached)
          }
        ])
      );
      const said = (e.error as { message?: unknown } | undefined)?.message;
      return [
        { type: 'usage', usage },
        ...message(),
        e.status === 'success'
          ? { type: 'done' }
          : { type: 'failed', message: String(said ?? 'Gemini ended the run with an error.') }
      ];
    }
    return [];
  };
}
