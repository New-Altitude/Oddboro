// An office under test, for the tests of a run as the office starts it
// (`followThrough`, `chat`), and the last of three files that build it. The
// throwaway folder is office-test-home.ts's and the stand-ins for `claude`,
// `grok`, `codex` and `gemini` (what each sends back is described there) are
// office-stand-ins.ts's. This file adds stand-ins for ripgrep, `xcode-select`,
// `security` and the installers `npm` and `bash`, all first on PATH, a stand-in
// secret store, the office's own database (local-db.ts) in that folder (on
// Windows, on a free port), a few Odds, and the helpers that start a run and
// read back what its stand-in was given. A test file imports this before
// anything of the office's, so the office reads this folder as it loads.
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { after, mock } from 'node:test';
import { onPath } from './on-path.ts';
import { folder, port, bin, nodeBin } from './office-test-home.ts';
import './office-stand-ins.ts';

// A stand-in ripgrep, which Grok's grep runs, on PATH through a link the way
// Homebrew puts it there.
export const rgBin = join(folder, 'rg-bin');
export const rgReal = join(folder, 'rg-real');
mkdirSync(rgBin);
mkdirSync(rgReal);
writeFileSync(join(rgReal, 'rg'), '#!/bin/sh\n');
chmodSync(join(rgReal, 'rg'), 0o755);
symlinkSync(join(rgReal, 'rg'), join(rgBin, 'rg'));
// A stand-in xcode-select, which names an Xcode.app developer folder, as on a
// Mac that uses Xcode rather than the Command Line Tools alone. It names it
// through a link, and names DEVELOPER_DIR instead when that is set, as the
// real one does; the office's own environment sets it (below). So the profile
// holds Xcode.app's real folder only when the office asks with PATH alone and
// takes the real path.
const xcode = join(folder, 'Applications', 'Xcode.app', 'Contents', 'Developer');
mkdirSync(xcode, { recursive: true });
symlinkSync(join(folder, 'Applications', 'Xcode.app'), join(folder, 'Applications', 'Linked.app'));
const linked = join(folder, 'Applications', 'Linked.app', 'Contents', 'Developer');
const elsewhere = join(folder, 'Applications', 'Elsewhere.app', 'Contents', 'Developer');
mkdirSync(elsewhere, { recursive: true });
writeFileSync(join(bin, 'xcode-select'), `#!/bin/sh\necho "\${DEVELOPER_DIR:-${linked}}"\n`);
chmodSync(join(bin, 'xcode-select'), 0o755);
// A stand-in `security`, the Keychain's own command, which fails and logs
// each call in `keychainCalls`. The office's secret store is a stand-in below,
// so nothing here should ever reach it, let alone the owner's own Keychain.
export const keychainCalls = join(folder, 'security-calls.log');
writeFileSync(join(bin, 'security'), `#!/bin/sh\necho "$1" >> '${keychainCalls}'\nexit 1\n`);
chmodSync(join(bin, 'security'), 0o755);
// The stand-ins for the installers the page's Install runs, `npm` and `bash`
// (xAI's script runs through `bash -c`), in a folder of their own so a test
// can leave the tools themselves off PATH. Each logs its name and arguments,
// and the names in the environment it got, in `installs`, a line each,
// prints a line, then waits for `<name>.go` in
// the office's folder and ends done, or with `<name>.fail` there says why and
// fails. Neither installs anything. Two minutes, longer than any test may
// run, and it gives up, so a test that died before telling it never leaves
// it running.
export const installers = join(folder, 'installers');
export const installs = join(folder, 'installs.jsonl');
mkdirSync(installers);
for (const name of ['npm', 'bash']) {
  writeFileSync(
    join(installers, name),
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(installs)}, JSON.stringify({ args: ['${name}', ...process.argv.slice(2)], env: Object.keys(process.env) }) + '\\n');
process.stdout.write('Installing.\\n');
const go = ${JSON.stringify(join(folder, `${name}.go`))};
const fail = ${JSON.stringify(join(folder, `${name}.fail`))};
setInterval(() => {
  if (fs.existsSync(fail)) {
    process.stderr.write('${name} error: could not install\\n');
    process.exit(1);
  }
  if (!fs.existsSync(go)) return;
  fs.rmSync(go);
  process.exit(0);
}, 20);
setTimeout(() => {
  process.stderr.write('${name} error: never told to end\\n');
  process.exit(1);
}, 120_000);
`
  );
  chmodSync(join(installers, name), 0o755);
}
// Set before the office's modules load: they read where everything is as they start.
Object.assign(process.env, {
  ODDBORO_HOME: folder,
  ODDBORO_DB_PORT: String(port),
  // A file that does not exist, so no .env reaches this office.
  ODDBORO_ENV: join(folder, 'none.env'),
  // No tool's maker is asked for its newest version (versions.ts).
  ODDBORO_NO_LATEST: '1',
  ODDBORO_LOCAL_DB: '1',
  // The stand-ins, node for them, and the system's own tools: never the Mac's
  // own claude, grok, codex, gemini, xcode-select or security.
  PATH: `${bin}:${rgBin}:${installers}:${nodeBin}:/usr/bin:/bin`,
  // Never handed to a Grok run.
  XAI_API_KEY: 'from-the-parent',
  ANTHROPIC_API_KEY: 'from-the-parent',
  GROK_SANDBOX: 'off',
  // Never handed to a Codex run, which gets the office's own Codex home.
  OPENAI_API_KEY: 'from-the-parent',
  CODEX_HOME: 'from-the-parent',
  // Never handed to a Gemini run, which gets the office's own key and home.
  GEMINI_API_KEY: 'from-the-parent',
  GOOGLE_API_KEY: 'from-the-parent',
  GEMINI_SYSTEM_MD: 'from-the-parent',
  // Harmless to the stand-ins, and never handed to a Grok, Codex or Gemini run either.
  NODE_OPTIONS: '--no-warnings',
  // A developer folder the office never asks xcode-select with (`developerReads`).
  DEVELOPER_DIR: elsewhere
});
delete process.env.OFFICE_AUTH;
/** The office's Gemini key under test: the shape the page takes, and nothing Google knows. */
export const OFFICE_GEMINI_KEY = 'the-office-key-for-tests-01';
/**
 * The office's secret store under test, by "<connector>:<NAME>", in place of
 * the system's own (`@oddboro/ledger/secrets`), so no test reads or writes the
 * owner's Keychain. It starts with the office's Gemini key.
 */
export const secrets = new Map([['gemini:API_KEY', OFFICE_GEMINI_KEY]]);
/** Each name the office read from the store, in order. */
export const secretReads: string[] = [];
const realSecrets = await import('@oddboro/ledger/secrets');
mock.module('@oddboro/ledger/secrets', {
  namedExports: {
    ...realSecrets,
    getSecret: (connector: string, name: string) => {
      secretReads.push(`${connector}:${name}`);
      return secrets.get(`${connector}:${name}`);
    },
    setSecret: (connector: string, name: string, value: string) =>
      void secrets.set(`${connector}:${name}`, value),
    deleteSecret: (connector: string, name: string) => secrets.delete(`${connector}:${name}`),
    // The stand-in store always answers, whatever this computer's own does.
    secretStore: () => ({ ok: true })
  }
});
// A Codex run starts only from a signed-in home; the stand-in reads nothing in it.
mkdirSync(join(folder, 'codex'));
writeFileSync(join(folder, 'codex', 'auth.json'), '{}');
// A static import beside this file loads as this file waits on its port above,
// so home.ts would read neither ODDBORO_HOME nor ODDBORO_DB_PORT, and the
// office would start in a folder other than this one.
const { DATABASE_PORT } = await import('@oddboro/ledger/home');
assert.equal(
  DATABASE_PORT,
  port,
  "This test file loaded the office's code before the harness set its port. Import the office's modules with `await import(...)` in the test file."
);
const { startLocalDatabase } = await import('@oddboro/ledger/local-db');
const stopDatabase = await startLocalDatabase();
const { bringUpToDate } = await import('@oddboro/ledger/upgrade');
await bringUpToDate();
export const L = await import('@oddboro/ledger');
export const { bus } = await import('./events.ts');
export const { chat, followThrough, history, isBusy } = await import('./staff.ts');
export const { currentOffice } = await import('./space.ts');
export const { PATCH } = await import('../../routes/api/staff/[id]/+server.ts');
/** The hire drawer's POST. */
export const hireRoute = await import('../../routes/api/staff/+server.ts');
export const agents = await import('../../routes/api/agents/+server.ts');

after(async () => {
  await L.pg.end();
  await stopDatabase();
  rmSync(folder, { recursive: true, force: true });
});

export const odd = (id: string, name: string) => ({
  id,
  name,
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  // Above Draft, so a run held to Draft shows it.
  permission: 'act',
  agent: 'claude',
  desk: `You are ${name}.`
});
await L.pg`insert into staff ${L.pg([
  odd('lead', 'Lena'),
  odd('paige', 'Paige'),
  odd('cleo', 'Cleo'),
  { ...odd('gus', 'Gus'), agent: 'grok' },
  odd('sam', 'Sam')
])}`;

/** What the stand-in says the run gave it. */
export type Gave = {
  args: string[];
  /** The names of every variable in the environment the tool was started with. */
  envNames: string[];
  /** The servers a Claude Code run got, read from the file `--mcp-config` names while the run went. */
  mcp?: unknown;
  /** A Claude Code run's settings, read from the file `--settings` names while the run went. */
  claudeSettings?: {
    permissions: { allow: string[]; deny: string[] };
    enabledPlugins: unknown;
    sandbox?: unknown;
  };
  env: Record<string, string>;
  system: string;
  message: string;
  /** What a streamed Claude Code chat was given after its first message (Send now). */
  added?: string[];
  claudeMds: string | null;
  autoMemory: string | null;
  /** The Claude Code run's CLAUDE_CODE_TMPDIR and NODE_OPTIONS, which Run commands sets. */
  tmpdir?: string | null;
  nodeOptions?: string | null;
  /** The git environment a run's shell gets: Claude Code's GIT_ variables, or Codex's `-c shell_environment_policy.set`. */
  git?: Record<string, string>;
  /** The Claude Code folder the run got (`CLAUDE_CONFIG_DIR`): its account's, or none for the owner's own login. */
  configDir?: string | null;
  /** Whether that environment's GIT_TEMPLATE_DIR was there and empty while the run went. */
  gitTemplate?: boolean;
  /** The Claude Code run's npm cache and user config, which Run commands sets (`shellEnv`). */
  npm?: { npm_config_cache: string | null; npm_config_userconfig: string | null };
  /** The Claude Code run's ANTHROPIC_API_KEY, which only a key sign-in sets. */
  apiKey?: string | null;
  grokEnv?: Record<string, string>;
  /** The Grok run's HOME: the owner's, or the run home `runHome` made. */
  home?: string;
  agentMode?: number;
  /** The Grok run's agent file's `prompt_mode`, and the mode of the file `--prompt-file` names. */
  promptMode?: string;
  promptFileMode?: number;
  /** The Grok run's message as content blocks, from a `.json` prompt file. */
  prompt?: { type: string; data?: string; mimeType?: string; text?: string }[];
  profile?: string;
  codexEnv?: Record<string, string>;
  /** The Codex run's MCP servers, as its `-c mcp_servers` said them, or the Grok run's, as its agent file names them. */
  servers?: Record<string, Record<string, unknown>>;
  /** The permission profile the Codex run used, as its `-c permissions` said it. */
  permissions?: { filesystem: Record<string, string>; network: { enabled: boolean } };
  /** Whether the Codex run's temp folder (TMPDIR) was there while it ran. */
  temp?: boolean;
  geminiEnv?: Record<string, string>;
  /** The Gemini run's system settings, policy and the modes of its settings file and run folder. */
  settings?: Record<string, Record<string, unknown>>;
  settingsMode?: number;
  runMode?: number;
  policy?: string;
};
/** The folders the office's file server holds a run to, as `ODDBORO_FILES` names them. */
export type FileWalls = { cwd: string; reads: string[]; writes: string[]; noWrite: string[] };
/**
 * The office's file server (`files`) a run was given, in any tool's shape:
 * Claude Code's `--mcp-config`, Codex's `-c mcp_servers` or Grok's agent
 * file. Its command, its arguments and the walls it holds, or nothing.
 */
export function filesOf(
  run: Gave
): { command: string; args: string[]; walls: FileWalls } | undefined {
  const servers =
    run.servers ?? (run.mcp as { mcpServers: Record<string, Record<string, unknown>> }).mcpServers;
  const files = servers.files as
    { command: string; args: string[]; env: { ODDBORO_FILES: string } } | undefined;
  if (!files) return undefined;
  return {
    command: files.command,
    args: files.args,
    walls: JSON.parse(files.env.ODDBORO_FILES) as FileWalls
  };
}
/** What one follow-up's run was given, and the run keys going while it ran. */
export async function runOf(id: number, ask?: number): Promise<Gave & { going: string[] }> {
  const f = await L.startFollowUp(id);
  assert.ok(f, `follow-up ${id} could not start`);
  let going: string[] = [];
  // The stand-in's tool call comes before its result, so the run still goes.
  const seen = (e: { type: string; inProgress?: Record<string, { doing?: string }[]> }) => {
    if (e.type === 'working' && e.inProgress?.[f.staffId]?.some((w) => w.doing))
      going = [...L.runsGoing.keys()];
  };
  bus.on('event', seen);
  const r = await followThrough(f, ask ? await L.ask(ask) : undefined).finally(() =>
    bus.off('event', seen)
  );
  assert.equal(r.outcome, 'done', r.text);
  return { ...(JSON.parse(r.text) as Gave), going };
}
/** One chat message's run: what it was given, and the tools the floor was told it used. */
export async function chatOf(id: string, message = 'Hello.'): Promise<Gave & { tools: string[] }> {
  const tools: string[] = [];
  let text = '';
  await chat(id, message, (e) => {
    if (e.type === 'tool') tools.push(e.name);
    if (e.type === 'done') text = e.text;
    if (e.type === 'error') text = e.message;
  });
  assert.ok(text.startsWith('{'), `${id}'s chat gave no reply: ${text}`);
  return { ...gaveIn(text), tools };
}
/** What a run's stand-in said it was given, from the run's text, which ends with its outcome line. */
export const gaveIn = (text: string): Gave =>
  JSON.parse(text.slice(0, text.lastIndexOf('\nOutcome:'))) as Gave;
/** `fn`, run as if the office ran on `platform`. */
export async function onPlatform<T>(
  platform: NodeJS.Platform,
  fn: () => T | Promise<T>
): Promise<T> {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await fn();
  } finally {
    if (real) Object.defineProperty(process, 'platform', real);
  }
}
/**
 * The stand-in Grok and Codex by the names a Windows office starts, grok.exe
 * and codex.exe (`agentCommand`), in a folder of their own.
 */
const windowsTools = join(folder, 'windows-tools');
mkdirSync(windowsTools);
for (const tool of ['grok', 'codex'])
  symlinkSync(join(bin, tool), join(windowsTools, `${tool}.exe`));
/**
 * `fn`, run as if the office ran on Windows, with the stand-in Grok and Codex
 * first on PATH as grok.exe and codex.exe. Without them a Windows run finds
 * neither by name, and the run would start whatever grok or codex this Mac has.
 */
export async function onWindows<T>(fn: () => T | Promise<T>): Promise<T> {
  return withEnv({ PATH: `${windowsTools}${delimiter}${process.env.PATH ?? ''}` }, () =>
    onPlatform('win32', fn)
  );
}
/** `fn`, run with `vars` set in the office's own environment, which is then put back. */
export async function withEnv<T>(
  vars: Record<string, string>,
  fn: () => T | Promise<T>
): Promise<T> {
  const real = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(real))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}
/** `fn`, run with HOME at `home`, which is then put back. */
const withHome = <T>(home: string, fn: (home: string) => T | Promise<T>): Promise<T> =>
  withEnv({ HOME: home }, () => fn(home));
/**
 * Git variables the office's own environment may hold, from the owner's shell
 * or a git hook: each would point an Odd's git elsewhere, and none may reach a run.
 */
export const OFFICE_PROCESS_GIT = {
  GIT_DIR: '/nonexistent',
  GIT_CONFIG_PARAMETERS: "'x.y=z'",
  GIT_EDITOR: 'true'
};
/**
 * `fn`, run with HOME at an empty folder of its own, so the Mac's own
 * ~/.grok/bin, where `grokCommand` also looks, is never found. Only around a
 * test: the office reads HOME as it loads for paths it shuts.
 */
export const awayFromHome = <T>(fn: (home: string) => T | Promise<T>): Promise<T> =>
  withHome(mkdtempSync(join(folder, 'home-')), fn);
/**
 * `fn`, run with HOME at an empty folder under the system's temp folder,
 * removed after. `awayFromHome`'s sits in the office's home, where
 * `checkFolder` refuses every folder; a folder in this one can be given.
 */
export async function ownerHome<T>(fn: (home: string) => T | Promise<T>): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), 'oddboro-owner-'));
  try {
    return await withHome(home, fn);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
/** No test reached the system's secret store: `security` here is the stand-in, and nothing ran it. */
export function assertKeychainUntouched(): void {
  assert.equal(onPath('security'), join(bin, 'security'));
  assert.ok(
    !existsSync(keychainCalls),
    `security ran: ${existsSync(keychainCalls) && readFileSync(keychainCalls, 'utf8')}`
  );
}
/** The one follow-up of a kind an ask started. */
export const startedBy = async (ask: number, kind: string) => {
  const [row] = await L.pg<{ id: number }[]>`
    select id from follow_ups where ask_id = ${ask} and kind = ${kind}`;
  assert.ok(row, `ask ${ask} started no ${kind}`);
  return row.id;
};

export const code = (d: string) => resolve(L.CODE, d);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** Arguments with this machine's paths and each run's ids as stand-ins, so they can be compared whole. */
export const plain = (args: string[]) =>
  args.map((a) =>
    a
      // macOS links the temp folder into /private.
      .replaceAll(realpathSync(folder), '<home>')
      .replaceAll(folder, '<home>')
      .replaceAll(dirname(process.execPath), '<node>')
      .replaceAll(resolve(L.CODE), '<code>')
      .replaceAll(homedir(), '~')
      .replace(UUID, '<id>')
  );
/** The value after `flag` as a stand-in. */
export const hide = (args: string[], ...flags: string[]) =>
  args.map((a, i) => (flags.includes(args[i - 1]) ? `<${args[i - 1].replace(/^-+/, '')}>` : a));

/**
 * Whether a rule of a Gemini run's policy with `decision` matches a write to
 * `path`, as Gemini matches it: the arguments as JSON, each pair between NULs.
 * Each value the office writes is a JSON string, one key a line.
 */
export function writeRule(policy: string, decision: 'allow' | 'deny', path: string): boolean {
  const args = `{\0"content":"x"\0,\0"file_path":${JSON.stringify(path)}\0}`;
  return policy
    .split('[[rule]]\n')
    .filter(Boolean)
    .map(
      (block) =>
        Object.fromEntries(
          block
            .trim()
            .split('\n')
            .map((l) => [l.slice(0, l.indexOf(' = ')), JSON.parse(l.slice(l.indexOf(' = ') + 3))])
        ) as Record<string, unknown>
    )
    .some(
      (r) =>
        r.decision === decision &&
        typeof r.argsPattern === 'string' &&
        new RegExp(r.argsPattern).test(args)
    );
}

/** Every Codex launch so far, as its stand-in logged its arguments. */
export const codexLaunches = (): string[][] => {
  const log = join(folder, 'codex', 'launches.jsonl');
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as string[])
    : [];
};
export const goal = async (title: string) =>
  (await L.pg<{ id: number }[]>`insert into goals (title) values (${title}) returning id`)[0].id;
const give = (from: string, to: string, thread: Parameters<typeof L.handOff>[0]['thread']) =>
  L.handOff({
    from,
    to,
    work: { title: `For ${to}`, brief: 'Do it.' },
    thread
  });
/** A hand-off that went with no ask. */
export async function gave(...a: Parameters<typeof give>): Promise<{ id: number; thread: number }> {
  const h = await give(...a);
  assert.ok('id' in h, JSON.stringify(h));
  return h;
}
/** An Odd's switches and folders as the owner left them; anything not named is off. */
export async function setOwn(
  id: string,
  o: { commands?: boolean; web?: boolean; folders?: { path: string; write: boolean }[] }
): Promise<void> {
  await L.pg`
    update staff set commands = ${o.commands ?? false}, web = ${o.web ?? false},
      folders = ${JSON.stringify(o.folders ?? [])}::jsonb where id = ${id}`;
}
/** What the owner's page sends one route: its params, its query and its JSON body. */
export type Call = {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
};
/**
 * The owner's page calling one of the office's routes, answered by the
 * route's own handler for `method`. `route` is its id, like `/api/staff/[id]`.
 * A route that refuses throws, as SvelteKit's `error` does.
 */
export async function request(route: string, method: string, call: Call = {}): Promise<Response> {
  const module = (await import(`../../routes${route}/+server.ts`)) as Record<
    string,
    ((event: unknown) => Promise<Response>) | undefined
  >;
  const handler = module[method];
  assert.ok(handler, `${route} has no ${method}`);
  let path = route;
  for (const [k, v] of Object.entries(call.params ?? {})) path = path.replace(`[${k}]`, v);
  const url = new URL(`http://office${path}`);
  url.search = new URLSearchParams(call.query ?? {}).toString();
  return handler({
    params: call.params ?? {},
    url,
    // A GET or HEAD carries no body: `Request` refuses one.
    request: new Request(url, {
      method,
      body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(call.body ?? {})
    }),
    getClientAddress: () => '127.0.0.1'
  });
}
/** The owner's PATCH of an Odd from its card. */
export const patch = (id: string, body: unknown) =>
  request('/api/staff/[id]', 'PATCH', { params: { id }, body });
/** What the route said when it refused a PATCH. */
export async function refusal(
  body: ReturnType<typeof patch>
): Promise<{ status: number; message: string }> {
  try {
    await body;
  } catch (e) {
    const h = e as { status: number; body: { message: string } };
    return { status: h.status, message: h.body.message };
  }
  assert.fail('the route took it');
}
/** Whether the ledger holds a line with this title. */
export const recorded = async (title: string) =>
  (await L.pg`select 1 from ledger where title = ${title}`).length === 1;

export { folder, ownerData, bin, nodeBin, EXIT_BEFORE_READING } from './office-test-home.ts';
