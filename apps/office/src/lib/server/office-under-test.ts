// An office under test, for the tests of a run as the office starts it
// (`followThrough`, `chat`): the office's own database (local-db.ts) in a
// throwaway folder on a free port, stand-ins for `claude`, `grok`, `codex`, `gemini`,
// `xcode-select`, `security` and the installers `npm` and `bash` first on PATH, a stand-in secret store, a few
// Odds, and the helpers that start a run and read back what its stand-in was given. Each stand-in sends back what the run gave it,
// its arguments, the tool server's environment and the run's instructions,
// and ends done. A test file imports this before anything of the office's, so
// the office reads this folder as it loads.
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
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, mock } from 'node:test';
import { onPath } from './on-path.ts';

export const folder = mkdtempSync(join(tmpdir(), 'oddboro-staff-run-'));
/** The owner's data folder in the office's home, which every Odd reads. */
export const ownerData = join(folder, 'data');
const port = await new Promise<number>((done) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => done(p));
  });
});
// The stand-in for Claude Code: it reads the message, then reports one tool
// call and a result that carries what the office gave the run. A message
// that says "Hold until <file> exists." keeps the run going until it does.
// "claude auth status" says signed out at once, and "claude auth login"
// prints its sign-in page and waits until it is stopped, as Setup's sign-in
// waits on the owner.
export const bin = join(folder, 'bin');
mkdirSync(bin);
writeFileSync(
  join(bin, 'claude'),
  `#!/usr/bin/env node
const fs = require('node:fs');
const [verb, sub] = process.argv.slice(2);
if (verb === 'auth' && sub === 'status') {
  process.stdout.write('{"loggedIn":false}\\n');
  process.exit(0);
}
if (verb === 'auth' && sub === 'login') {
  process.stdout.write('Opening https://claude.ai/oauth/authorize?test\\n');
  setInterval(() => {}, 60_000);
  return;
}
let message = '';
process.stdin.on('data', (d) => (message += d));
process.stdin.on('end', () => {
  const hold = /Hold until (\\/[^\\s"\\\\]+) exists/.exec(message)?.[1];
  if (!hold) return reply();
  const wait = setInterval(() => fs.existsSync(hold) && (clearInterval(wait), reply()), 20);
});
function reply() {
  const args = process.argv.slice(2);
  const after = (flag) => args[args.indexOf(flag) + 1];
  const gave = {
    args,
    env: JSON.parse(after('--mcp-config')).mcpServers.office.env,
    system: after('--append-system-prompt'),
    message,
    claudeMds: process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS ?? null,
    autoMemory: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? null
  };
  const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'look' } } });
  line({ type: 'result', subtype: 'success', result: JSON.stringify(gave) + '\\nOutcome: done' });
}
`
);
chmodSync(join(bin, 'claude'), 0o755);
// The stand-in for Grok, which reads no input: it sends back its arguments, the
// Grok and key variables it got, the tool server's environment from its agent
// file, and its sandbox profile. Then one MCP call the way Grok streams it
// (through use_tool), and a result. A message that says "Replay <file>"
// gets that recorded stream instead, and its arguments go in replay-args.json.
// "grok models", which renews the sign-in, adds a dot to models.log in the
// Grok home, and puts renewed.json there as the sign-in when there is one.
// With hang.pid in the Grok home, it writes its pid there and never ends,
// whatever SIGTERM says. Its arguments go in models-args.json.
// "grok login" logs its arguments and home in logins.jsonl and its pid in
// login.pid, prints its sign-in page, and waits for login.go in its home:
// then it keeps a sign-in for owner@example.com and ends. "grok logout"
// adds a dot to logouts.log.
writeFileSync(
  join(bin, 'grok'),
  `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const home = process.env.GROK_HOME;
if (args[0] === 'login') {
  fs.appendFileSync(home + '/logins.jsonl', JSON.stringify({ args, home }) + '\\n');
  fs.writeFileSync(home + '/login.pid', String(process.pid));
  process.stdout.write('Open this URL to sign in: https://auth.x.ai/oauth2/authorize?client_id=test&redirect_uri=http://127.0.0.1:5000/callback\\n');
  setInterval(() => {
    if (!fs.existsSync(home + '/login.go')) return;
    fs.rmSync(home + '/login.go');
    const expires_at = new Date(Date.now() + 86_400_000).toISOString();
    fs.writeFileSync(home + '/auth.json', JSON.stringify({ 'https://auth.x.ai::test': { email: 'owner@example.com', expires_at } }));
    process.stdout.write('Signed in as owner@example.com\\n');
    process.exit(0);
  }, 20);
  return;
}
if (args[0] === 'logout') {
  fs.appendFileSync(home + '/logouts.log', '.');
  process.exit(0);
}
if (args[0] === 'models') {
  fs.writeFileSync(home + '/models-args.json', JSON.stringify(args));
  fs.appendFileSync(process.env.GROK_HOME + '/models.log', '.');
  const hang = process.env.GROK_HOME + '/hang.pid';
  if (fs.existsSync(hang)) {
    fs.writeFileSync(hang, String(process.pid));
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 60_000);
    return;
  }
  const renewed = process.env.GROK_HOME + '/renewed.json';
  if (fs.existsSync(renewed)) fs.copyFileSync(renewed, process.env.GROK_HOME + '/auth.json');
  process.exit(0);
}
// As grok 1.0.46 refuses a value that starts with "- " after its flag (measured).
if (args.some((a) => a.startsWith('- '))) {
  process.stderr.write("error: unexpected argument '- ' found");
  process.exit(2);
}
const after = (flag) => args[args.indexOf(flag) + 1];
const joined = (flag) => args.find((a) => a.startsWith(flag + '='))?.slice(flag.length + 1);
const replay = /Replay (\\/\\S+\\.jsonl)/.exec(joined('--single'))?.[1];
if (replay) {
  fs.writeFileSync(process.env.GROK_HOME + '/replay-args.json', JSON.stringify(args));
  process.stdout.write(fs.readFileSync(replay, 'utf8'));
  process.exit(0);
}
const agent = fs.readFileSync(after('--agent'), 'utf8');
const profile = fs
  .readFileSync(process.env.GROK_HOME + '/sandbox.toml', 'utf8')
  .split(/^(?=\\[profiles\\.)/m)
  .find((b) => b.startsWith('[profiles.' + after('--sandbox') + ']'));
const gave = {
  args,
  grokEnv: Object.fromEntries(
    Object.entries(process.env).filter(([k]) => /^(GROK_|XAI_|ANTHROPIC_API_KEY|TMPDIR|NODE_OPTIONS)/.test(k))
  ),
  env: JSON.parse(/^mcpServers: (.*)$/m.exec(agent)[1]).find((s) => s.office).office.env,
  agentMode: fs.statSync(after('--agent')).mode & 0o777,
  profile,
  system: joined('--rules'),
  message: joined('--single')
};
const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'use_tool' } } });
line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'use_tool', input: { tool_name: 'office__raise_ask', tool_input: {} } }] } });
line({ type: 'result', subtype: 'success', result: JSON.stringify(gave) + '\\nOutcome: done' });
`
);
chmodSync(join(bin, 'grok'), 0o755);
// The stand-in for Codex, which reads the message on stdin: it sends back its
// arguments, the Codex and key variables it got, and what its `-c` values set
// (the MCP servers, the permission profile, the instructions), in the item
// shapes `codex exec --json` prints (exec_events.rs): a shell command, an MCP
// call, a file change, two messages and the turn's tokens. A message that
// says "Replay <file>" gets that recorded stream instead, and one that says
// "Leave a sleeper at <file>" first starts a `sleep` that outlives it, in its
// process group, and writes its pid there. Every launch's arguments go in
// launches.jsonl, a line each. "codex login" is no launch: it logs its
// arguments, home and whether config.toml was there in logins.jsonl and its
// pid in login.pid, prints its callback server and then its sign-in page, and
// waits for login.go in its home: then it keeps a sign-in whose ID token
// names owner@example.com and ends. "codex logout" adds a dot to logouts.log.
writeFileSync(
  join(bin, 'codex'),
  `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
if (args[0] === 'login') {
  const configFirst = fs.existsSync(home + '/config.toml');
  fs.appendFileSync(home + '/logins.jsonl', JSON.stringify({ args, home, configFirst }) + '\\n');
  fs.writeFileSync(home + '/login.pid', String(process.pid));
  process.stdout.write('Starting local login server on http://localhost:1455.\\nIf your browser did not open, navigate to this URL to authenticate:\\n\\nhttps://auth.openai.com/oauth/authorize?client_id=test\\n');
  setInterval(() => {
    if (!fs.existsSync(home + '/login.go')) return;
    fs.rmSync(home + '/login.go');
    const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const id_token = part({ alg: 'none' }) + '.' + part({ email: 'owner@example.com' }) + '.sig';
    fs.writeFileSync(home + '/auth.json', JSON.stringify({ tokens: { id_token } }));
    process.exit(0);
  }, 20);
  return;
}
if (args[0] === 'logout') {
  fs.appendFileSync(home + '/logouts.log', '.');
  process.exit(0);
}
fs.appendFileSync(process.env.CODEX_HOME + '/launches.jsonl', JSON.stringify(args) + '\\n');
let message = '';
process.stdin.on('data', (d) => (message += d));
process.stdin.on('end', () => {
  const replay = /Replay (\\/\\S+\\.jsonl)/.exec(message)?.[1];
  if (replay) return process.stdout.write(fs.readFileSync(replay, 'utf8'));
  const sleeper = /Leave a sleeper at (\\/\\S+)/.exec(message)?.[1];
  if (sleeper) {
    const s = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });
    fs.writeFileSync(sleeper, String(s.pid));
    s.unref();
  }
  // The office writes each -c value with JSON strings, so an inline table is JSON once its " = " is ": ".
  const set = {};
  args.forEach((a, i) => {
    if (args[i - 1] !== '-c') return;
    const v = a.slice(a.indexOf('=') + 1);
    set[a.slice(0, a.indexOf('='))] = JSON.parse(v.startsWith('{') ? v.replaceAll('" = ', '": ') : v);
  });
  const gave = {
    args,
    codexEnv: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => /^(CODEX_|OPENAI_|ANTHROPIC_API_KEY|TMPDIR|NODE_OPTIONS)/.test(k))
    ),
    env: set.mcp_servers.office.env,
    servers: set.mcp_servers,
    permissions: set.permissions[set.default_permissions],
    system: set.developer_instructions,
    message,
    temp: fs.existsSync(process.env.TMPDIR)
  };
  const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  const item = (type, o) => line({ type, item: o });
  line({ type: 'thread.started', thread_id: '019a0000-0000-7000-8000-00000000c0de' });
  line({ type: 'turn.started' });
  item('item.started', { id: 'item_0', type: 'command_execution', command: 'ls', status: 'in_progress' });
  item('item.completed', { id: 'item_0', type: 'command_execution', command: 'ls', exit_code: 0, status: 'completed' });
  item('item.started', { id: 'item_1', type: 'mcp_tool_call', server: 'office', tool: 'raise_ask', status: 'in_progress' });
  item('item.completed', { id: 'item_1', type: 'mcp_tool_call', server: 'office', tool: 'raise_ask', status: 'completed' });
  item('item.completed', { id: 'item_2', type: 'file_change', changes: [{ path: 'notes.md', kind: 'add' }], status: 'completed' });
  item('item.completed', { id: 'item_3', type: 'agent_message', text: 'Looking.' });
  item('item.completed', { id: 'item_4', type: 'agent_message', text: JSON.stringify(gave) + '\\nOutcome: done' });
  line({
    type: 'turn.completed',
    usage: { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 100, output_tokens: 50, reasoning_output_tokens: 20 }
  });
});
`
);
chmodSync(join(bin, 'codex'), 0o755);
// The stand-in for Gemini, which reads the message on stdin: like Gemini, it
// runs a message that starts with "/" as a command of its own, and fails it.
// Else it sends back its arguments, the Gemini and key variables it got, its
// run folder's policy, settings and instructions, and the message, in the
// event shapes `gemini -o stream-json` prints: the session, an echo of the
// message, a reply in pieces, a file tool and an MCP call, the reply's last
// message in two pieces and the result's tokens. A message that says "End in
// error" gets a failed result instead. Each launch adds a dot to launches.log
// in the Gemini home.
writeFileSync(
  join(bin, 'gemini'),
  `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GEMINI_CLI_HOME + '/launches.log', '.');
let message = '';
process.stdin.on('data', (d) => (message += d));
process.stdin.on('end', () => {
  const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  line({ type: 'init', session_id: '0a0a0a0a-0000-4000-8000-00000000ce01', model: 'gemini-test' });
  if (message.startsWith('/'))
    return line({ type: 'result', status: 'error', error: { type: 'Error', message: 'Ran a slash command.' } });
  if (message.includes('End in error'))
    return line({ type: 'result', status: 'error', error: { type: 'Error', message: 'Quota used up.' } });
  const settingsPath = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const run = path.dirname(settingsPath);
  const gave = {
    args,
    geminiEnv: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => /^(GEMINI_|GOOGLE_|ANTHROPIC_API_KEY|NODE_OPTIONS)/.test(k))
    ),
    env: settings.mcpServers.office.env,
    settings,
    settingsMode: fs.statSync(settingsPath).mode & 0o777,
    runMode: fs.statSync(run).mode & 0o777,
    policy: fs.readFileSync(path.join(run, 'policy.toml'), 'utf8'),
    system: fs.readFileSync(process.env.GEMINI_SYSTEM_MD, 'utf8'),
    message
  };
  line({ type: 'message', role: 'user', content: message });
  line({ type: 'message', role: 'assistant', content: 'Look', delta: true });
  line({ type: 'message', role: 'assistant', content: 'ing.', delta: true });
  line({ type: 'tool_use', tool_name: 'read_file', tool_id: 't1', parameters: { file_path: 'x' } });
  line({ type: 'tool_result', tool_id: 't1', status: 'success', output: '' });
  line({ type: 'tool_use', tool_name: 'mcp_office_raise_ask', tool_id: 't2', parameters: {} });
  line({ type: 'tool_result', tool_id: 't2', status: 'success', output: '' });
  const reply = JSON.stringify(gave) + '\\nOutcome: done';
  line({ type: 'message', role: 'assistant', content: reply.slice(0, 20), delta: true });
  line({ type: 'message', role: 'assistant', content: reply.slice(20), delta: true });
  line({
    type: 'result',
    status: 'success',
    stats: { models: { 'gemini-test': { total_tokens: 1050, input_tokens: 1000, output_tokens: 50, cached: 600, input: 400 } } }
  });
});
`
);
chmodSync(join(bin, 'gemini'), 0o755);
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
// fails. Neither installs anything.
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
  DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
  ODDBORO_LOCAL_DB: '1',
  OLLAMA_URL: 'http://127.0.0.1:9',
  // The stand-ins, node for them, and the system's own tools: never the Mac's
  // own claude, grok, codex, gemini, xcode-select or security.
  PATH: `${bin}:${rgBin}:${installers}:${dirname(process.execPath)}:/usr/bin:/bin`,
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
    deleteSecret: (connector: string, name: string) => secrets.delete(`${connector}:${name}`)
  }
});
// A Codex run starts only from a signed-in home; the stand-in reads nothing in it.
mkdirSync(join(folder, 'codex'));
writeFileSync(join(folder, 'codex', 'auth.json'), '{}');
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
  env: Record<string, string>;
  system: string;
  message: string;
  claudeMds: string | null;
  autoMemory: string | null;
  grokEnv?: Record<string, string>;
  agentMode?: number;
  profile?: string;
  codexEnv?: Record<string, string>;
  /** The Codex run's MCP servers, as its `-c mcp_servers` said them. */
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
/** What one follow-up's run was given, and the run keys going while it ran. */
export async function runOf(id: number, ask?: number): Promise<Gave & { going: string[] }> {
  const f = await L.startFollowUp(id);
  assert.ok(f, `follow-up ${id} could not start`);
  let going: string[] = [];
  // The stand-in's tool call comes before its result, so the run still goes.
  const seen = (e: { type: string; inProgress?: Record<string, { doing?: string }[]> }) => {
    if (e.type === 'working' && e.inProgress?.[f.staffId]?.some((w) => w.doing))
      going = [...L.runsGoing];
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
  return { ...(JSON.parse(text.slice(0, text.lastIndexOf('\nOutcome:'))) as Gave), tools };
}
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
 * `fn`, run with HOME at an empty folder of its own, so the Mac's own
 * ~/.grok/bin, where `grokCommand` also looks, is never found. Only around a
 * test: the office reads HOME as it loads for paths it shuts.
 */
export async function awayFromHome<T>(fn: (home: string) => T | Promise<T>): Promise<T> {
  const real = process.env.HOME;
  const home = mkdtempSync(join(folder, 'home-'));
  process.env.HOME = home;
  try {
    return await fn(home);
  } finally {
    if (real === undefined) delete process.env.HOME;
    else process.env.HOME = real;
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
